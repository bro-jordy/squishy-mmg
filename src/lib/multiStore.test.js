import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initContainer } from './localStore.js'
import { bulkOpname, stockMap, stockOf, StockError } from './stockLogic.js'
import { checkout, salesInRange, voidSale } from './salesLogic.js'
import { addMember, listMembers, setMember, MemberError } from './memberLogic.js'
import { createProduct } from './masterLogic.js'
import { newId } from './uuid.js'

const seed = JSON.parse(readFileSync(new URL('../data/local-seed.json', import.meta.url), 'utf8'))
const NOW = new Date('2026-10-17T03:00:00Z')
const fresh = () => initContainer(seed, NOW)
const [REA, SOSO] = seed.stores.map((s) => s.id)
const vid = (state, sku, warna) => {
  const p = state.products.find((x) => x.sku === sku)
  return state.variants.find((v) => v.product_id === p.id && (warna === undefined || v.warna === warna)).id
}

test('dua toko: REA berisi master dari sheet, SOSO dimulai KOSONG', () => {
  const c = fresh()
  assert.equal(c.stores.length, 2)
  const [a, b] = [c.states[REA], c.states[SOSO]]
  assert.equal(a.products.length, 25)
  assert.equal(a.variants.length, 73)
  assert.equal(b.products.length, 0)
  assert.equal(b.variants.length, 0)
  const total = (s) => [...stockMap(s).values()].reduce((n, x) => n + x, 0)
  assert.equal(total(a), 388)
  assert.equal(total(b), 0)
  // toko kosong tetap bisa diisi sendiri: tambah barang dengan SKU yang sama persis dengan REA
  const added = createProduct(b, { sku: 'A12', name: 'Squishy Ice Cube', price: 35000,
    variants: [{ varian: 'Maltose', warna: 'Ungu', stock: 4 }] }, NOW).state
  assert.equal(added.products.length, 1)
  assert.equal(a.products.length, 25) // REA tidak ikut berubah
  assert.equal(total(added), 4)
})

test('penjualan di satu toko tidak mengubah stok toko lain (SKU sama persis)', () => {
  const c = fresh()
  // Soso menambah barang dengan SKU yang sama persis (stok awal 0), lalu opname massal jadi 4
  const made = createProduct(c.states[SOSO], { sku: 'A12', name: 'Squishy Ice Cube', price: 35000,
    variants: [{ varian: 'Maltose', warna: 'Ungu', stock: 0 }] }, NOW).state
  const sosoState = bulkOpname(made, {
    items: [{ variantId: vid(made, 'A12', 'Ungu'), counted: 4 }], reason: 'Stok opname' }, NOW).state
  const rea = c.states[REA]
  const before = stockOf(rea, vid(rea, 'A12', 'Ungu'))
  const sold = checkout(rea, { idempotencyKey: newId(), paymentMethod: 'cash',
    items: [{ variantId: vid(rea, 'A12', 'Ungu'), qty: 1 }], cashierId: 'u-kasir', cashierName: 'Kasir Rea' }, NOW)
  assert.equal(stockOf(sold.state, vid(rea, 'A12', 'Ungu')), before - 1)
  assert.equal(stockOf(sosoState, vid(sosoState, 'A12', 'Ungu')), 4)
  // varian toko lain tidak bisa dipakai di toko ini
  assert.throws(() => checkout(rea, { idempotencyKey: newId(), paymentMethod: 'cash',
    items: [{ variantId: 'v-tidak-ada', qty: 1 }] }, NOW), /tidak ditemukan/)
})

test('nama kasir tercatat di transaksi; kasir hanya melihat transaksinya sendiri', () => {
  let s = fresh().states[REA]
  const v = vid(s, 'A27')
  s = checkout(s, { idempotencyKey: newId(), paymentMethod: 'cash', items: [{ variantId: v, qty: 1 }],
    cashierId: 'u-kasir', cashierName: 'Kasir Rea' }, NOW).state
  s = checkout(s, { idempotencyKey: newId(), paymentMethod: 'cash', items: [{ variantId: v, qty: 2 }],
    cashierId: 'u-rea', cashierName: 'Rea' }, NOW).state
  assert.deepEqual(s.sales.map((x) => x.cashier_name), ['Kasir Rea', 'Rea'])
  assert.equal(salesInRange(s, '2026-10-17', '2026-10-17').length, 2)            // admin: semua
  const own = salesInRange(s, '2026-10-17', '2026-10-17', 'u-kasir')            // kasir: miliknya
  assert.equal(own.length, 1)
  assert.equal(own[0].cashier_name, 'Kasir Rea')
  const voided = voidSale(s, { saleId: s.sales[0].id, reason: 'batal', voidedByName: 'Rea' }, NOW).state
  assert.equal(voided.sales[0].voided_by_name, 'Rea')
})

test('opname massal: hanya selisih dicatat, alasan memuat hitung & sistem, atomik', () => {
  const s = fresh().states[REA]
  const a = vid(s, 'A12', 'Ungu'); const b = vid(s, 'A12', 'Biru'); const c = vid(s, 'A12', 'Hijau')
  const [sa, sb] = [stockOf(s, a), stockOf(s, b)]
  const r = bulkOpname(s, { reason: ' Stok opname ', items: [
    { variantId: a, counted: sa + 3 }, { variantId: b, counted: sb }, { variantId: c, counted: 0 }] }, NOW)
  assert.equal(r.changed, 2)
  assert.equal(stockOf(r.state, a), sa + 3)
  assert.equal(stockOf(r.state, c), 0)
  const m = r.state.movements.filter((x) => x.variant_id === a).at(-1)
  assert.equal(m.movement_type, 'adjustment')
  assert.equal(m.reason, `Stok opname (hitung ${sa + 3}, sistem ${sa})`)
  // atomik & validasi
  const before = JSON.stringify(s)
  assert.throws(() => bulkOpname(s, { reason: 'x', items: [{ variantId: a, counted: 9 }, { variantId: 'nope', counted: 1 }] }, NOW), /tidak ditemukan/)
  assert.throws(() => bulkOpname(s, { reason: 'x', items: [{ variantId: a, counted: -1 }] }, NOW), StockError)
  assert.throws(() => bulkOpname(s, { reason: 'x', items: [{ variantId: a, counted: 1.5 }] }, NOW), StockError)
  assert.throws(() => bulkOpname(s, { reason: ' ', items: [{ variantId: a, counted: 1 }] }, NOW), /Alasan/)
  assert.throws(() => bulkOpname(s, { reason: 'x', items: [] }, NOW), /Tidak ada/)
  assert.equal(JSON.stringify(s), before)
  // tidak ada selisih = tidak ada movement
  assert.equal(bulkOpname(s, { reason: 'x', items: [{ variantId: a, counted: sa }] }, NOW).changed, 0)
})

test('pengguna toko: admin hanya mengelola kasir; owner boleh menjadikan admin', () => {
  const s = fresh().states[REA]
  const admin = { isOwner: false, userId: 'u-rea' }
  const owner = { isOwner: true, userId: 'u-owner' }
  assert.deepEqual(listMembers(s).map((m) => m.role), ['admin', 'kasir'])
  const s2 = addMember(s, { email: ' Baru@Lokal.test ', nama: 'Kasir Baru', role: 'kasir' }, admin)
  assert.equal(s2.members.at(-1).email, 'baru@lokal.test')
  assert.equal(s2.members.at(-1).nama, 'Kasir Baru')
  assert.throws(() => addMember(s, { email: 'x@y.z', role: 'admin' }, admin), /owner platform/)
  assert.throws(() => addMember(s, { email: 'rea@lokal.test', role: 'kasir' }, admin), /owner platform/)
  assert.throws(() => addMember(s, { email: 'bukan-email', role: 'kasir' }, admin), /Email/)
  assert.throws(() => setMember(s, { userId: 'u-rea', role: 'kasir', active: true }, admin), /kasir/)
  assert.throws(() => setMember(s, { userId: 'u-kasir', role: 'admin', active: true }, admin), /kasir/)
  assert.throws(() => setMember(s, { userId: 'nope', role: 'kasir', active: true }, admin), /tidak terdaftar/)
  const off = setMember(s, { userId: 'u-kasir', role: 'kasir', active: false }, admin)
  assert.equal(off.members.find((m) => m.user_id === 'u-kasir').is_active, false)
  const on = addMember(off, { email: 'kasir@lokal.test', role: 'kasir' }, admin) // tambah ulang = aktifkan
  assert.equal(on.members.find((m) => m.user_id === 'u-kasir').is_active, true)
  assert.equal(setMember(s, { userId: 'u-kasir', role: 'admin', active: true }, owner).members.find((m) => m.user_id === 'u-kasir').role, 'admin')
  assert.throws(() => setMember(s, { userId: 'u-rea', role: 'admin', active: false }, admin), /kasir/)
})

test('nomor transaksi memakai kode toko', () => {
  const s = fresh().states[REA]
  const r = checkout(s, { idempotencyKey: newId(), paymentMethod: 'cash', storeKode: 'REA',
    items: [{ variantId: vid(s, 'A27'), qty: 1 }] }, NOW)
  assert.equal(r.state.sales[0].sale_no, 'REA-261017-0001')
})
