// Logika stok untuk MODE LOKAL. Padanan fungsi adjust_stock() + tabel stock_movements
// di db/schema.sql: stok = jumlah movement (ledger), alasan wajib, tidak boleh minus.
// Ubah keduanya bersamaan.

export const MOVEMENT_LABEL = {
  opening: 'Stok awal',
  sale: 'Penjualan',
  void: 'Void',
  restock: 'Barang masuk',
  damaged: 'Rusak',
  return_owner: 'Retur ke pemilik',
  adjustment: 'Koreksi / opname',
}

export class StockError extends Error {}

// State lokal: produk, varian, dan ledger movement. Stok = jumlah movement.
export function initState(seed, now = new Date()) {
  const variants = seed.variants.map(({ stock, ...v }) => ({ ...v, stock_awal: stock }))
  const movements = seed.variants
    .filter((v) => v.stock > 0)
    .map((v, i) => ({
      id: i + 1,
      variant_id: v.id,
      movement_type: 'opening',
      qty_delta: v.stock,
      reason: 'Stok awal (master barang)',
      created_at: now.toISOString(),
    }))
  return {
    nextId: movements.length + 1,
    nextProductNo: seed.products.length + 1,
    nextVariantNo: seed.variants.length + 1,
    nextSaleNo: 1,
    saleCounters: {},
    sales: [],
    nextSettlementNo: 1,
    settlements: [],
    products: seed.products.map((p) => ({ ...p })),
    variants,
    movements,
  }
}

export function stockMap(state) {
  const map = new Map()
  for (const m of state.movements) {
    map.set(m.variant_id, (map.get(m.variant_id) ?? 0) + m.qty_delta)
  }
  return map
}

export function stockOf(state, variantId) {
  return stockMap(state).get(variantId) ?? 0
}

const SIGN_RULES = {
  restock: (d) => d > 0 || 'Barang masuk harus berjumlah positif',
  damaged: (d) => d < 0 || 'Barang rusak harus mengurangi stok',
  return_owner: (d) => d < 0 || 'Retur harus mengurangi stok',
  adjustment: () => true,
}

// Mengembalikan { state, stock } baru; state lama tidak diubah.
export function adjust(state, { variantId, type, delta, reason }, now = new Date()) {
  if (!(type in SIGN_RULES)) throw new StockError(`Jenis penyesuaian tidak valid: ${type}`)
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new StockError('Alasan penyesuaian wajib diisi')
  }
  if (!Number.isInteger(delta) || delta === 0) {
    throw new StockError('Jumlah penyesuaian harus bilangan bulat dan tidak boleh 0')
  }
  const ok = SIGN_RULES[type](delta)
  if (ok !== true) throw new StockError(ok)

  if (!state.variants.some((v) => v.id === variantId)) throw new StockError('Varian tidak ditemukan')
  const current = stockOf(state, variantId)
  if (current + delta < 0) {
    throw new StockError(`Stok tidak boleh minus (sisa ${current}, perubahan ${delta})`)
  }

  const movement = {
    id: state.nextId,
    variant_id: variantId,
    movement_type: type,
    qty_delta: delta,
    reason: reason.trim(),
    created_at: now.toISOString(),
  }
  return {
    state: { ...state, nextId: state.nextId + 1, movements: [...state.movements, movement] },
    stock: current + delta,
  }
}

export function movementsFor(state, variantId, limit = 20) {
  return state.movements
    .filter((m) => m.variant_id === variantId)
    .sort((a, b) => b.id - a.id)
    .slice(0, limit)
}

// Opname massal: stok jadi sama dengan hasil hitung; hanya yang selisih dicatat sebagai
// 'adjustment' dengan alasan "<alasan> (hitung X, sistem Y)". Atomik: satu item tidak valid
// = semuanya ditolak. items: [{ variantId, counted }]. Mengembalikan { state, changed }.
export function bulkOpname(state, { items, reason }, now = new Date()) {
  if (typeof reason !== 'string' || reason.trim() === '') throw new StockError('Alasan opname wajib diisi')
  if (!Array.isArray(items) || items.length === 0) throw new StockError('Tidak ada hasil hitung yang dikirim')

  const counted = new Map() // varian yang sama: hasil terakhir dipakai
  for (const it of items) {
    if (!it?.variantId || !Number.isInteger(it.counted) || it.counted < 0) {
      throw new StockError('Setiap item butuh hasil hitung bilangan bulat ≥ 0')
    }
    counted.set(it.variantId, it.counted)
  }
  const known = new Set(state.variants.map((v) => v.id))
  for (const id of counted.keys()) {
    if (!known.has(id)) throw new StockError('Ada varian yang tidak ditemukan di toko ini')
  }

  const stock = stockMap(state)
  let nextId = state.nextId
  const movements = []
  for (const [variantId, n] of counted) {
    const current = stock.get(variantId) ?? 0
    const delta = n - current
    if (delta === 0) continue
    movements.push({
      id: nextId++, variant_id: variantId, movement_type: 'adjustment', qty_delta: delta,
      reason: `${reason.trim()} (hitung ${n}, sistem ${current})`, created_at: now.toISOString(),
    })
  }
  return {
    changed: movements.length,
    state: { ...state, nextId, movements: [...state.movements, ...movements] },
  }
}
