// Logika penjualan untuk MODE LOKAL. Padanan checkout(), void_sale(), confirm_payment()
// di db/schema.sql: stok dicek terbaru, harga di-snapshot, stok berkurang/kembali tepat
// sekali lewat ledger, key yang sama tidak membuat transaksi ganda. Ubah keduanya bersamaan.
import { stockMap } from './stockLogic.js'
import { jakartaDateKey } from './format.js'

export class SaleError extends Error {}

const labelOf = (v) => [v.varian, v.warna].filter(Boolean).join(' · ') || 'Standar'

// items: [{ variantId, qty }]. Mengembalikan { state, saleId, created }.
export function checkout(state, input, now = new Date()) {
  const { idempotencyKey, paymentMethod, paymentConfirmed, items, customerName, note, cashierId, cashierName, storeKode = 'MMG' } = input
  if (!idempotencyKey) throw new SaleError('idempotency_key wajib diisi')

  const existing = state.sales.find((s) => s.idempotency_key === idempotencyKey)
  if (existing) return { state, saleId: existing.id, created: false }

  if (!['cash', 'qris'].includes(paymentMethod)) {
    throw new SaleError(`Metode pembayaran tidak valid: ${paymentMethod}`)
  }
  if (!Array.isArray(items) || items.length === 0) throw new SaleError('Keranjang kosong')

  const wanted = new Map() // varian yang sama digabung
  for (const it of items) {
    if (!it?.variantId || !Number.isInteger(it.qty) || it.qty <= 0) {
      throw new SaleError('Setiap item wajib punya variant_id dan qty > 0')
    }
    wanted.set(it.variantId, (wanted.get(it.variantId) ?? 0) + it.qty)
  }

  const stock = stockMap(state)
  const variants = new Map(state.variants.map((v) => [v.id, v]))
  const products = new Map(state.products.map((p) => [p.id, p]))
  const lines = []
  let total = 0
  for (const [variantId, qty] of wanted) {
    const v = variants.get(variantId)
    if (!v) throw new SaleError('Ada varian yang tidak ditemukan di keranjang')
    const p = products.get(v.product_id)
    const label = labelOf(v)
    if (!(v.is_active && p.is_active)) throw new SaleError(`Barang nonaktif: ${p.name} (${label})`)
    const have = stock.get(variantId) ?? 0
    if (have < qty) {
      throw new SaleError(`Stok tidak cukup: ${p.name} (${label}): sisa ${have}, diminta ${qty}`)
    }
    lines.push({
      variant_id: variantId, qty, unit_price: p.price, line_total: qty * p.price,
      sku: p.sku, product_name: p.name, variant_label: label,
    })
    total += qty * p.price
  }

  const confirmed = paymentMethod === 'cash' || Boolean(paymentConfirmed)
  const day = jakartaDateKey(now)
  const counter = (state.saleCounters[day] ?? 0) + 1
  const id = `s${state.nextSaleNo}`

  let nextId = state.nextId
  const movements = lines.map((l) => ({
    id: nextId++, variant_id: l.variant_id, movement_type: 'sale', qty_delta: -l.qty,
    reason: 'Penjualan', sale_id: id, created_at: now.toISOString(),
  }))

  const sale = {
    id,
    sale_no: `${storeKode}-${day.slice(2).replaceAll('-', '')}-${String(counter).padStart(4, '0')}`,
    idempotency_key: idempotencyKey,
    sold_at: now.toISOString(),
    customer_name: customerName?.trim() || null,
    payment_method: paymentMethod,
    payment_status: confirmed ? 'confirmed' : 'unconfirmed',
    payment_confirmed_at: confirmed ? now.toISOString() : null,
    status: 'completed',
    total,
    note: note?.trim() || null,
    void_reason: null,
    voided_at: null,
    voided_by_name: null,
    created_by: cashierId ?? null,
    cashier_name: cashierName?.trim() || null,
    sale_items: lines.map((l, i) => ({ id: `${id}-${i + 1}`, ...l })),
  }

  return {
    saleId: id,
    created: true,
    state: {
      ...state,
      nextId,
      nextSaleNo: state.nextSaleNo + 1,
      saleCounters: { ...state.saleCounters, [day]: counter },
      sales: [...state.sales, sale],
      movements: [...state.movements, ...movements],
    },
  }
}

// Void: wajib alasan; stok kembali tepat sekali; transaksi tidak dihapus. Idempotent.
export function voidSale(state, { saleId, reason, voidedByName }, now = new Date()) {
  if (typeof reason !== 'string' || reason.trim() === '') throw new SaleError('Alasan void wajib diisi')
  const sale = state.sales.find((s) => s.id === saleId)
  if (!sale) throw new SaleError('Transaksi tidak ditemukan')
  if (sale.status === 'void') return { state }

  let nextId = state.nextId
  const movements = sale.sale_items.map((it) => ({
    id: nextId++, variant_id: it.variant_id, movement_type: 'void', qty_delta: it.qty,
    reason: `Void: ${reason.trim()}`, sale_id: saleId, created_at: now.toISOString(),
  }))
  return {
    state: {
      ...state,
      nextId,
      sales: state.sales.map((s) => s.id === saleId
        ? { ...s, status: 'void', void_reason: reason.trim(), voided_at: now.toISOString(), voided_by_name: voidedByName ?? null }
        : s),
      movements: [...state.movements, ...movements],
    },
  }
}

export function confirmPayment(state, saleId, now = new Date()) {
  return {
    ...state,
    sales: state.sales.map((s) => s.id === saleId && s.status === 'completed' && s.payment_status === 'unconfirmed'
      ? { ...s, payment_status: 'confirmed', payment_confirmed_at: now.toISOString() }
      : s),
  }
}

// Transaksi dalam rentang tanggal Jakarta [from, to] (YYYY-MM-DD), terbaru dulu.
// createdBy diisi untuk kasir: hanya transaksi buatannya sendiri.
export function salesInRange(state, from, to, createdBy = null) {
  return state.sales
    .filter((s) => {
      const d = jakartaDateKey(s.sold_at)
      return d >= from && d <= to && (!createdBy || s.created_by === createdBy)
    })
    .sort((a, b) => (a.sold_at < b.sold_at ? 1 : a.sold_at > b.sold_at ? -1 : b.id.localeCompare(a.id, 'en', { numeric: true })))
}
