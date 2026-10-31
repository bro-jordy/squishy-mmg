import { LOCAL_MODE } from './mode'
import { supabase } from './supabase'
import { buildCatalog } from './catalog'
import { adjust, bulkOpname as bulkOpnameLogic, movementsFor, outgoingMovements, OUTGOING_TYPES, stockMap, StockError } from './stockLogic'
import * as master from './masterLogic'
import * as salesLogic from './salesLogic'
import * as report from './reportLogic'
import * as members from './memberLogic'
import { transferStock as transferLogic } from './transferLogic'
import { LOCAL_USERS } from './localUsers'
import { jakartaDayRange } from './format'
import { clearState, loadContainer, saveContainer } from './localStore'

// Satu pintu akses data. Halaman memanggil fungsi di sini (lewat useStore().api), tidak
// langsung ke Supabase, supaya mode lokal dan Supabase bisa bertukar tanpa mengubah halaman.
// Semua fungsi terikat ke SATU toko (storeId) dan akun yang login; data toko lain tidak
// pernah ikut. Semua fungsi tulis melempar Error dengan pesan yang aman ditampilkan.

let local = null // { seed, container } — hanya mode lokal

// Sumber data lokal: data contoh, atau clone production bila file src/data/prod-clone.json ada
// (dibuat scripts/build_prod_clone.py, di-gitignore). Pilih lewat ?data=prod / ?data=contoh;
// pilihan diingat di browser ini.
const SOURCE_KEY = 'mmg-local-source'
const cloneFiles = import.meta.glob('../data/prod-clone.json')
const CLONE_PATH = '../data/prod-clone.json'
function wantedSource() {
  try {
    const q = new URLSearchParams(window.location.search).get('data')
    if (q === 'prod' || q === 'contoh') localStorage.setItem(SOURCE_KEY, q)
    // Clone production dipakai otomatis bila file-nya ada, kecuali sudah memilih ?data=contoh.
    return localStorage.getItem(SOURCE_KEY) !== 'contoh' && CLONE_PATH in cloneFiles ? 'prod' : 'contoh'
  } catch {
    return CLONE_PATH in cloneFiles ? 'prod' : 'contoh'
  }
}
export const cloneAvailable = () => CLONE_PATH in cloneFiles
export const usingClone = () => LOCAL_MODE && wantedSource() === 'prod'

async function getLocal() {
  if (!local) {
    const seed = wantedSource() === 'prod'
      ? (await cloneFiles[CLONE_PATH]()).default
      : (await import('../data/local-seed.json')).default
    local = { seed, container: loadContainer(seed) }
  }
  return local
}

async function localState(storeId) {
  const l = await getLocal()
  const state = l.container.states[storeId]
  if (!state) throw new Error('Toko tidak ditemukan')
  return state
}

async function mutateLocal(storeId, fn) {
  const l = await getLocal()
  const state = await localState(storeId)
  const result = fn(state)
  const next = result.state ?? result
  l.container = { ...l.container, states: { ...l.container.states, [storeId]: next } }
  saveContainer(l.seed, l.container)
  return result
}

// Seperti mutateLocal, tapi untuk operasi lintas toko (transfer stok): fn(container) -> { container, ... }
async function mutateLocalContainer(fn) {
  const l = await getLocal()
  const result = fn(l.container)
  l.container = result.container
  saveContainer(l.seed, l.container)
  return result
}

function dbError(error) {
  const m = error.message ?? ''
  if (error.code === '42501') {
    // pesan dari fungsi database sudah berbahasa Indonesia; pesan teknis diganti
    return new Error(/permission denied|row-level security/i.test(m) ? 'Tidak diizinkan' : m)
  }
  if (error.code === '23505') {
    return new Error(m.includes('uq_product_sku_name')
      ? 'Produk dengan SKU dan nama itu sudah ada'
      : 'Varian dan warna itu sudah ada di produk ini')
  }
  return new Error(m || 'Terjadi kesalahan. Coba lagi.')
}

// ---- Akses: akun -> toko apa saja & perannya --------------------------------------

// Mengembalikan { profile, stores: [{ id, kode, nama, role: 'admin'|'kasir', ... }] }.
// Owner platform = admin di SEMUA toko. profile null = akun belum terdaftar / dinonaktifkan.
export async function loadAccess({ userId, localKey }) {
  if (LOCAL_MODE) {
    const user = LOCAL_USERS[localKey]
    const { container } = await getLocal()
    const stores = []
    for (const s of container.stores) {
      const m = container.states[s.id].members.find((x) => x.user_id === user.id && x.is_active)
      if (user.is_platform_owner) stores.push({ ...s, role: 'admin' })
      else if (m) stores.push({ ...s, role: m.role })
    }
    return { profile: user, stores }
  }
  const { data: profile, error } = await supabase
    .from('profiles').select('id, nama, is_platform_owner, is_active').eq('id', userId).maybeSingle()
  if (error) throw error
  if (!profile || !profile.is_active) return { profile: null, stores: [] }
  const [{ data: stores, error: e1 }, { data: mem, error: e2 }] = await Promise.all([
    supabase.from('stores').select('id, kode, nama, pct_bagian_25, dasar_pembagian').order('nama'),
    supabase.from('store_members').select('store_id, role, is_active').eq('user_id', userId),
  ])
  if (e1 || e2) throw e1 || e2
  const roleOf = new Map(mem.filter((m) => m.is_active).map((m) => [m.store_id, m.role]))
  return {
    profile,
    stores: stores
      .map((s) => ({ ...s, role: profile.is_platform_owner ? 'admin' : roleOf.get(s.id) }))
      .filter((s) => s.role),
  }
}

// ---- API per toko ------------------------------------------------------------------

// user: { id, nama }; role: 'admin' | 'kasir' (peran di toko ini); store: { id, nama, ... }
export function createApi({ store, user, role, isPlatformOwner = false }) {
  const storeId = store.id
  const isAdmin = role === 'admin'
  // Mode lokal meniru aturan database: tindakan admin ditolak untuk kasir.
  const needAdmin = (what = 'melakukan ini') => {
    if (LOCAL_MODE && !isAdmin) throw new Error(`Hanya admin toko yang boleh ${what}`)
  }

  return {
    async fetchCatalog() {
      if (LOCAL_MODE) {
        const state = await localState(storeId)
        const stock = stockMap(state)
        return buildCatalog({
          products: state.products,
          variants: state.variants.map((v) => ({ ...v, stock: stock.get(v.id) ?? 0 })),
        })
      }
      const { data, error } = await supabase
        .from('v_catalog')
        .select('variant_id, product_id, sku, display_name, variant_label, price, stock, is_sellable, ' +
          'product_name, varian, warna, product_active, variant_active')
        .eq('store_id', storeId)
      if (error) throw error
      return data
    },

    // ---- Stok ----
    // type: 'restock' (delta > 0) | 'damaged' | 'return_owner' (delta < 0) | 'adjustment' (+/-).
    // Mengembalikan stok baru.
    async adjustStock({ variantId, type, delta, reason }) {
      if (LOCAL_MODE) {
        needAdmin('menyesuaikan stok')
        return (await mutateLocal(storeId, (s) => adjust(s, { variantId, type, delta, reason }))).stock
      }
      const { data, error } = await supabase.rpc('adjust_stock', {
        p_variant_id: variantId, p_type: type, p_delta: delta, p_reason: reason,
      })
      if (error) throw new StockError(dbError(error).message)
      return data
    },

    // items: [{ variantId, counted }] -> jumlah varian yang berubah
    async bulkOpname({ items, reason }) {
      if (LOCAL_MODE) {
        needAdmin('opname')
        return (await mutateLocal(storeId, (s) => bulkOpnameLogic(s, { items, reason }))).changed
      }
      const { data, error } = await supabase.rpc('bulk_opname', {
        p_store_id: storeId,
        p_items: items.map((i) => ({ variant_id: i.variantId, counted: i.counted })),
        p_reason: reason,
      })
      if (error) throw new StockError(dbError(error).message)
      return data
    },

    async fetchMovements(variantId, limit = 20) {
      if (LOCAL_MODE) return movementsFor(await localState(storeId), variantId, limit)
      const { data, error } = await supabase
        .from('stock_movements')
        .select('id, movement_type, qty_delta, reason, created_at')
        .eq('variant_id', variantId)
        .order('id', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data
    },

    // Riwayat barang keluar (dikeluarkan/rusak, retur ke pemilik, transfer keluar), terbaru dulu.
    // Baris datar: { id, movement_type, qty_delta, reason, created_at, sku, product_name, variant_label }.
    async fetchOutgoing() {
      if (LOCAL_MODE) return outgoingMovements(await localState(storeId))
      const { data, error } = await supabase
        .from('stock_movements')
        .select('id, movement_type, qty_delta, reason, created_at, product_variants(varian, warna, products(sku, name))')
        .eq('store_id', storeId)
        .in('movement_type', OUTGOING_TYPES)
        .order('id', { ascending: false })
        .limit(1000)
      if (error) throw error
      return data.map(({ product_variants: v, ...m }) => ({
        ...m,
        sku: v?.products?.sku ?? '',
        product_name: v?.products?.name ?? '',
        variant_label: [v?.varian, v?.warna].filter(Boolean).join(' · ') || 'Standar',
      }))
    },

    // ---- Master barang (admin toko) ----
    // input: { sku, name, price, variants: [{ varian, warna, stock }] } -> id produk
    async createProduct(input) {
      const fields = master.cleanProduct(input)
      const variants = master.cleanVariants(input.variants)
      if (LOCAL_MODE) {
        needAdmin('menambah barang')
        return (await mutateLocal(storeId, (s) => master.createProduct(s, { ...fields, variants }))).productId
      }
      const { data, error } = await supabase.rpc('create_product', {
        p_store_id: storeId, p_sku: fields.sku, p_name: fields.name, p_price: fields.price, p_variants: variants,
      })
      if (error) throw dbError(error)
      return data
    },

    async addVariant({ productId, varian, warna, stock }) {
      const v = master.cleanVariant({ varian, warna, stock })
      if (LOCAL_MODE) {
        needAdmin('menambah varian')
        return (await mutateLocal(storeId, (s) => master.addVariant(s, { productId, ...v }))).variantId
      }
      const { data, error } = await supabase.rpc('add_variant', {
        p_product_id: productId, p_varian: v.varian, p_warna: v.warna, p_stock: v.stock,
      })
      if (error) throw dbError(error)
      return data
    },

    async updateProduct({ id, sku, name, price, is_active }) {
      const fields = master.cleanProduct({ sku, name, price })
      if (LOCAL_MODE) {
        needAdmin('mengubah barang')
        await mutateLocal(storeId, (s) => master.updateProduct(s, { id, ...fields, is_active }))
        return
      }
      const { data, error } = await supabase
        .from('products').update({ ...fields, is_active }).eq('id', id).select('id')
      if (error) throw dbError(error)
      // RLS menyaring baris secara diam-diam bagi yang bukan admin: 0 baris = tidak diizinkan.
      if (!data?.length) throw new Error('Tidak diizinkan atau produk tidak ditemukan')
    },

    async updateVariant({ id, varian, warna, is_active }) {
      const v = { varian: master.normText(varian), warna: master.normText(warna) }
      if (LOCAL_MODE) {
        needAdmin('mengubah varian')
        await mutateLocal(storeId, (s) => master.updateVariant(s, { id, ...v, is_active }))
        return
      }
      const { data, error } = await supabase
        .from('product_variants').update({ ...v, is_active }).eq('id', id).select('id')
      if (error) throw dbError(error)
      if (!data?.length) throw new Error('Tidak diizinkan atau varian tidak ditemukan')
    },

    // ---- Penjualan ----
    // input: { idempotencyKey, paymentMethod: 'cash'|'qris', paymentConfirmed, hold (pesanan ditahan), customerName,
    //          note, items: [{ variantId, qty }] }  -> id transaksi.
    // Dipanggil SETELAH kasir mengonfirmasi pembayaran. Key yang sama = transaksi yang sama.
    // Nama kasir diambil dari akun yang login (tercatat di transaksi, tidak di struk).
    async checkout(input) {
      if (LOCAL_MODE) {
        const withCashier = { ...input, cashierId: user.id, cashierName: user.nama, storeKode: store.kode }
        return (await mutateLocal(storeId, (s) => salesLogic.checkout(s, withCashier))).saleId
      }
      if (input.hold) {
        const { data, error } = await supabase.rpc('hold_sale', {
          p_store_id: storeId,
          p_idempotency_key: input.idempotencyKey,
          p_items: input.items.map((i) => ({ variant_id: i.variantId, qty: i.qty })),
          p_customer_name: input.customerName || null,
          p_note: input.note || null,
        })
        if (error) throw dbError(error)
        return data
      }
      const { data, error } = await supabase.rpc('checkout', {
        p_store_id: storeId,
        p_idempotency_key: input.idempotencyKey,
        p_payment_method: input.paymentMethod,
        p_payment_confirmed: Boolean(input.paymentConfirmed),
        p_items: input.items.map((i) => ({ variant_id: i.variantId, qty: i.qty })),
        p_customer_name: input.customerName || null,
        p_note: input.note || null,
      })
      if (error) throw dbError(error)
      return data
    },

    // Tandai pesanan ditahan sudah dibayar. method: 'cash'|'qris'; QRIS lunas bila confirmed.
    async payHold({ saleId, method, confirmed }) {
      if (LOCAL_MODE) {
        await mutateLocal(storeId, (s) => ({ state: salesLogic.payHold(s, { saleId, method, confirmed }) }))
        return
      }
      const { error } = await supabase.rpc('pay_hold', { p_sale_id: saleId, p_method: method, p_confirmed: Boolean(confirmed) })
      if (error) throw dbError(error)
    },

    // Transaksi pada rentang tanggal Jakarta [from, to], terbaru dulu, lengkap dengan item.
    // Admin: semua transaksi toko. Kasir: hanya yang ia buat sendiri (dijaga RLS di database).
    async fetchSales({ from, to }) {
      if (LOCAL_MODE) {
        return salesLogic.salesInRange(await localState(storeId), from, to, isAdmin ? null : user.id)
      }
      const { start, end } = jakartaDayRange(from, to)
      const { data, error } = await supabase
        .from('sales')
        .select(SALE_COLUMNS)
        .eq('store_id', storeId)
        .gte('sold_at', start)
        .lt('sold_at', end)
        .order('sold_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return data
    },

    async voidSale({ saleId, reason }) {
      if (LOCAL_MODE) {
        needAdmin('void')
        await mutateLocal(storeId, (s) => salesLogic.voidSale(s, { saleId, reason, voidedByName: user.nama }))
        return
      }
      const { error } = await supabase.rpc('void_sale', { p_sale_id: saleId, p_reason: reason })
      if (error) throw dbError(error)
    },

    // Edit transaksi selesai: HANYA owner platform. items: [{ variantId, qty, unitPrice }].
    // Total dihitung ulang; stok disesuaikan; tiap edit tercatat (sebelum/sesudah) di database.
    async editSale({ saleId, paymentMethod, paymentConfirmed, items, reason }) {
      if (LOCAL_MODE) {
        if (!isPlatformOwner) throw new Error('Hanya owner yang boleh mengedit transaksi')
        await mutateLocal(storeId, (s) => salesLogic.editSale(s, { saleId, paymentMethod, paymentConfirmed, items, reason }))
        return
      }
      const { error } = await supabase.rpc('edit_sale', {
        p_sale_id: saleId,
        p_payment_method: paymentMethod,
        p_payment_confirmed: Boolean(paymentConfirmed),
        p_items: items.map((i) => ({ variant_id: i.variantId, qty: i.qty, unit_price: i.unitPrice })),
        p_reason: reason,
      })
      if (error) throw dbError(error)
    },

    // Ubah nama pembeli saja (HANYA owner platform); barang/harga/stok tidak berubah.
    async setSaleCustomer({ saleId, customerName }) {
      if (!isPlatformOwner) throw new Error('Hanya owner yang boleh mengedit transaksi')
      if (LOCAL_MODE) {
        await mutateLocal(storeId, (s) => ({ state: salesLogic.setCustomer(s, { saleId, customerName }) }))
        return
      }
      const { error } = await supabase.rpc('set_sale_customer', { p_sale_id: saleId, p_customer_name: customerName || null })
      if (error) throw dbError(error)
    },

    // ---- Transfer stok antar toko (HANYA owner platform) ----
    // Katalog toko LAIN (untuk memilih barang tujuan/asal). Baris sama bentuknya dengan fetchCatalog.
    async fetchStoreCatalog(otherStoreId) {
      if (!isPlatformOwner) throw new Error('Hanya owner yang boleh transfer stok')
      if (LOCAL_MODE) {
        const l = await getLocal()
        const state = l.container.states[otherStoreId]
        if (!state) throw new Error('Toko tidak ditemukan')
        const stock = stockMap(state)
        return buildCatalog({
          products: state.products,
          variants: state.variants.map((v) => ({ ...v, stock: stock.get(v.id) ?? 0 })),
        })
      }
      const { data, error } = await supabase
        .from('v_catalog')
        .select('variant_id, product_id, sku, display_name, variant_label, price, stock, is_sellable, ' +
          'product_name, varian, warna, product_active, variant_active')
        .eq('store_id', otherStoreId)
      if (error) throw error
      return data
    },

    // lines: [{ from: [{ variantId, qty }], to: [{ variantId, qty }], newProduct?: { sku, name, price } }]
    // Jumlah asal harus sama dengan jumlah tujuan. Mengembalikan id transfer.
    async transferStock({ fromStoreId, toStoreId, lines, note }) {
      if (!isPlatformOwner) throw new Error('Hanya owner yang boleh transfer stok')
      if (LOCAL_MODE) {
        return (await mutateLocalContainer((c) => transferLogic(c, { fromStoreId, toStoreId, lines, note, byName: user.nama }))).transferId
      }
      const { data, error } = await supabase.rpc('transfer_stock', {
        p_from_store: fromStoreId,
        p_to_store: toStoreId,
        p_lines: lines.map((l) => ({
          from: l.from.map((i) => ({ variant_id: i.variantId, qty: i.qty })),
          to: (l.to ?? []).map((i) => ({ variant_id: i.variantId, qty: i.qty })),
          ...(l.newProduct ? { new_product: { sku: l.newProduct.sku, name: l.newProduct.name, price: l.newProduct.price } } : {}),
        })),
        p_note: note || null,
      })
      if (error) throw dbError(error)
      return data
    },

    // Riwayat transfer terbaru (semua toko), terbaru dulu.
    async fetchTransfers(limit = 30) {
      if (!isPlatformOwner) throw new Error('Hanya owner yang boleh melihat transfer stok')
      if (LOCAL_MODE) {
        const l = await getLocal()
        return [...(l.container.transfers ?? [])].reverse().slice(0, limit)
      }
      const { data, error } = await supabase
        .from('stock_transfers')
        .select('id, from_store_id, to_store_id, note, detail, created_by_name, created_at')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data
    },

    // ---- Rekap & setoran (admin toko) ----
    // Pengaturan pembagian toko. Hanya dibaca; mengubah persen menghitung ulang SELURUH
    // riwayat toko itu, jadi sengaja tidak ada tombol ubah di aplikasi.
    async fetchSettings() {
      if (LOCAL_MODE) {
        return { pct_bagian_25: report.DEFAULT_PCT, dasar_pembagian: 'omzet', nama_toko: store.nama }
      }
      const { data, error } = await supabase
        .from('stores').select('nama, pct_bagian_25, dasar_pembagian').eq('id', storeId).single()
      if (error) throw error
      return { pct_bagian_25: data.pct_bagian_25, dasar_pembagian: data.dasar_pembagian, nama_toko: data.nama }
    },

    // Rekap SELURUH hari (naik). Penyaringan periode dilakukan di halaman, karena alokasi
    // setoran per hari butuh riwayat penuh.
    async fetchDailySummary() {
      if (LOCAL_MODE) {
        return report.dailySummary((await localState(storeId)).sales, report.DEFAULT_PCT)
      }
      const { data, error } = await supabase
        .from('v_daily_summary')
        .select('day, transaksi, total_penjualan, bagian_25, bagian_75')
        .eq('store_id', storeId)
        .order('day', { ascending: true })
        .limit(1000)
      if (error) throw error
      return data
    },

    async fetchSettlements() {
      if (LOCAL_MODE) {
        const state = await localState(storeId)
        return [...state.settlements].sort((a, b) =>
          a.settled_on < b.settled_on ? 1 : a.settled_on > b.settled_on ? -1
            : b.id.localeCompare(a.id, 'en', { numeric: true }))
      }
      const { data, error } = await supabase
        .from('settlements')
        .select('id, settled_on, amount, share, recipient, period_start, period_end, note, created_at')
        .eq('store_id', storeId)
        .order('settled_on', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },

    // Hanya pencatatan internal; tidak ada transfer otomatis.
    async addSettlement(input) {
      const fields = report.cleanSettlement(input)
      if (LOCAL_MODE) {
        needAdmin('mencatat setoran')
        return (await mutateLocal(storeId, (s) => report.addSettlement(s, fields))).settlementId
      }
      const { data, error } = await supabase
        .from('settlements').insert({ ...fields, store_id: storeId }).select('id').single()
      if (error) throw dbError(error)
      return data.id
    },

    async deleteSettlement(id) {
      if (LOCAL_MODE) {
        needAdmin('menghapus setoran')
        await mutateLocal(storeId, (s) => report.deleteSettlement(s, id))
        return
      }
      const { data, error } = await supabase.from('settlements').delete().eq('id', id).select('id')
      if (error) throw dbError(error)
      if (!data?.length) throw new Error('Tidak diizinkan atau catatan tidak ditemukan')
    },

    // ---- Pengguna toko (admin toko) ----
    // Login dibuat di Supabase (Authentication > Users); di sini hanya mendaftarkannya ke toko.
    async listMembers() {
      if (LOCAL_MODE) {
        needAdmin('melihat pengguna')
        return members.listMembers(await localState(storeId))
      }
      const { data, error } = await supabase.rpc('list_members', { p_store_id: storeId })
      if (error) throw dbError(error)
      return data
    },

    async addMember({ email, nama, role: memberRole }) {
      if (LOCAL_MODE) {
        needAdmin('menambah pengguna')
        await mutateLocal(storeId, (s) => members.addMember(s, { email, nama, role: memberRole }, { isOwner: isPlatformOwner, userId: user.id }))
        return
      }
      const { error } = await supabase.rpc('add_member', {
        p_store_id: storeId, p_email: email, p_nama: nama || null, p_role: memberRole,
      })
      if (error) throw dbError(error)
    },

    async setMember({ userId, role: memberRole, active }) {
      if (LOCAL_MODE) {
        needAdmin('mengubah pengguna')
        await mutateLocal(storeId, (s) => members.setMember(s, { userId, role: memberRole, active }, { isOwner: isPlatformOwner, userId: user.id }))
        return
      }
      const { error } = await supabase.rpc('set_member', {
        p_store_id: storeId, p_user_id: userId, p_role: memberRole, p_active: active,
      })
      if (error) throw dbError(error)
    },
  }
}

const SALE_COLUMNS =
  'id, sale_no, sold_at, customer_name, payment_method, payment_status, status, total, note, ' +
  'void_reason, voided_at, voided_by_name, cashier_name, edited_at, ' +
  'sale_items(id, variant_id, qty, unit_price, line_total, sku, product_name, variant_label)'

export function resetLocalData() {
  clearState()
  local = null
}
