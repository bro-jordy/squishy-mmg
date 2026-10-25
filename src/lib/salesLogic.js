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

// Edit transaksi selesai (hanya owner; dicek pemanggil). Padanan edit_sale() di
// db/migrations/2026-10-25_edit_sale.sql. items: [{ variantId, qty, unitPrice }].
// Total dihitung ulang; selisih stok dicatat sebagai movement 'adjustment'.
export function editSale(state, { saleId, paymentMethod, paymentConfirmed, items, reason }, now = new Date()) {
  const sale = state.sales.find((s) => s.id === saleId)
  if (!sale) throw new SaleError('Transaksi tidak ditemukan')
  if (sale.status !== 'completed') throw new SaleError('Hanya transaksi selesai yang bisa diedit (transaksi void tidak)')
  if (typeof reason !== 'string' || reason.trim() === '') throw new SaleError('Alasan edit wajib diisi')
  if (!['cash', 'qris'].includes(paymentMethod)) throw new SaleError(`Metode pembayaran tidak valid: ${paymentMethod}`)
  if (!Array.isArray(items) || items.length === 0) throw new SaleError('Transaksi harus punya minimal satu barang')
  const seen = new Set()
  for (const it of items) {
    if (!it?.variantId || !Number.isInteger(it.qty) || it.qty <= 0 || !Number.isInteger(it.unitPrice) || it.unitPrice < 0) {
      throw new SaleError('Setiap item wajib punya variant_id, qty > 0, dan harga >= 0')
    }
    if (seen.has(it.variantId)) throw new SaleError('Barang yang sama tidak boleh muncul dua kali')
    seen.add(it.variantId)
  }

  const stock = stockMap(state)
  const variants = new Map(state.variants.map((v) => [v.id, v]))
  const products = new Map(state.products.map((p) => [p.id, p]))
  const oldItems = new Map(sale.sale_items.map((i) => [i.variant_id, i]))

  const lines = []
  const deltas = [] // { variantId, delta }: > 0 stok kembali, < 0 stok keluar
  for (const it of items) {
    const v = variants.get(it.variantId)
    if (!v) throw new SaleError('Ada barang yang tidak ditemukan di toko ini')
    const p = products.get(v.product_id)
    const label = labelOf(v)
    const old = oldItems.get(it.variantId)
    if (!old && !(v.is_active && p.is_active)) throw new SaleError(`Barang nonaktif: ${p.name} (${label})`)
    const delta = (old?.qty ?? 0) - it.qty
    if (delta < 0 && (stock.get(it.variantId) ?? 0) < -delta) {
      throw new SaleError(`Stok tidak cukup: ${p.name} (${label}): sisa ${stock.get(it.variantId) ?? 0}, tambahan diminta ${-delta}`)
    }
    if (delta !== 0) deltas.push({ variantId: it.variantId, delta })
    lines.push({
      variant_id: it.variantId, qty: it.qty, unit_price: it.unitPrice, line_total: it.qty * it.unitPrice,
      sku: old?.sku ?? p.sku, product_name: old?.product_name ?? p.name, variant_label: old?.variant_label ?? label,
    })
  }
  // barang yang dihapus dari transaksi: stok kembali penuh
  for (const old of sale.sale_items) {
    if (!seen.has(old.variant_id)) deltas.push({ variantId: old.variant_id, delta: old.qty })
  }

  let nextId = state.nextId
  const movements = deltas.map((d) => ({
    id: nextId++, variant_id: d.variantId, movement_type: 'adjustment', qty_delta: d.delta,
    reason: `Edit transaksi ${sale.sale_no}: ${reason.trim()}`, sale_id: saleId, created_at: now.toISOString(),
  }))

  const confirmed = paymentMethod === 'cash' || Boolean(paymentConfirmed)
  const total = lines.reduce((n, l) => n + l.line_total, 0)
  return {
    state: {
      ...state,
      nextId,
      sales: state.sales.map((s) => s.id !== saleId ? s : {
        ...s,
        payment_method: paymentMethod,
        payment_status: confirmed ? 'confirmed' : 'unconfirmed',
        payment_confirmed_at: confirmed ? (s.payment_confirmed_at ?? now.toISOString()) : null,
        total,
        edited_at: now.toISOString(),
        sale_items: lines.map((l, i) => ({ id: `${saleId}-e${now.getTime()}-${i + 1}`, ...l })),
      }),
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

// Saring transaksi menurut metode bayar: 'all' | 'cash' | 'qris'.
export function filterByPayment(sales, method) {
  return method === 'cash' || method === 'qris' ? sales.filter((s) => s.payment_method === method) : sales
}
