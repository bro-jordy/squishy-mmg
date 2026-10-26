// Transfer stok antar toko untuk MODE LOKAL (hanya owner; dicek pemanggil). Padanan
// transfer_stock() di db/migrations/2026-10-26_stock_transfer.sql: pencocokan eksplisit,
// jumlah asal = jumlah tujuan, stok asal cukup, atomik (state lama tidak diubah bila gagal),
// barang tujuan boleh dibuat baru (satu varian "Random"). Ubah keduanya bersamaan.
import { stockOf } from './stockLogic.js'
import { createProduct, InputError } from './masterLogic.js'

export class TransferError extends Error {}

const labelOf = (v) => [v.varian, v.warna].filter(Boolean).join(' · ') || 'Standar'

// line: { from: [{ variantId, qty }], to: [{ variantId, qty }], newProduct?: { sku, name, price } }
// Mengembalikan { container, transferId }.
export function transferStock(container, { fromStoreId, toStoreId, lines, note, byName = null }, now = new Date()) {
  if (!fromStoreId || !toStoreId || fromStoreId === toStoreId) throw new TransferError('Pilih dua toko yang berbeda')
  const fromStore = container.stores.find((s) => s.id === fromStoreId)
  const toStore = container.stores.find((s) => s.id === toStoreId)
  if (!fromStore || !toStore) throw new TransferError('Toko tidak ditemukan')
  if (!Array.isArray(lines) || lines.length === 0) throw new TransferError('Tidak ada barang yang ditransfer')

  const cleanNote = typeof note === 'string' && note.trim() ? note.trim() : null
  const transferId = `t${(container.transfers?.length ?? 0) + 1}`
  const work = { [fromStoreId]: container.states[fromStoreId], [toStoreId]: container.states[toStoreId] }
  const detail = []

  const checkSide = (items, what) => {
    if (!Array.isArray(items) || items.length === 0) throw new TransferError(`Setiap baris butuh barang ${what}`)
    const seen = new Set()
    for (const it of items) {
      if (!it?.variantId || !Number.isInteger(it.qty) || it.qty <= 0) throw new TransferError(`Jumlah barang ${what} harus lebih dari 0`)
      if (seen.has(it.variantId)) throw new TransferError(`Varian ${what} yang sama tidak boleh muncul dua kali dalam satu baris`)
      seen.add(it.variantId)
    }
    return items.reduce((n, it) => n + it.qty, 0)
  }
  const describe = (state, variantId, qty) => {
    const v = state.variants.find((x) => x.id === variantId)
    const p = v && state.products.find((x) => x.id === v.product_id)
    return { v, p, desc: v && { variant_id: variantId, sku: p.sku, name: p.name, label: labelOf(v), qty } }
  }
  const move = (storeId, variantId, type, delta, reason) => {
    const s = work[storeId]
    work[storeId] = {
      ...s,
      nextId: s.nextId + 1,
      movements: [...s.movements, {
        id: s.nextId, variant_id: variantId, movement_type: type, qty_delta: delta, reason,
        transfer_id: transferId, created_at: now.toISOString(),
      }],
    }
  }

  for (const rawLine of lines) {
    const sumFrom = checkSide(rawLine.from, 'asal')
    let to = rawLine.to
    if (rawLine.newProduct) {
      const np = rawLine.newProduct
      try {
        const r = createProduct(work[toStoreId], {
          sku: np.sku, name: np.name, price: np.price, variants: [{ varian: '', warna: 'Random', stock: 0 }],
        }, now)
        work[toStoreId] = r.state
        to = [{ variantId: r.state.variants.find((v) => v.product_id === r.productId).id, qty: sumFrom }]
      } catch (e) {
        if (e instanceof InputError && /sudah ada/.test(e.message)) {
          throw new TransferError(`Barang dengan SKU dan nama itu sudah ada di ${toStore.nama}: pilih barang yang sudah ada`)
        }
        throw e instanceof InputError ? new TransferError(e.message) : e
      }
    }
    const sumTo = checkSide(to, 'tujuan')
    if (sumFrom !== sumTo) throw new TransferError(`Jumlah asal (${sumFrom}) dan tujuan (${sumTo}) harus sama`)

    const fromDesc = []
    for (const it of rawLine.from) {
      const { v, desc } = describe(work[fromStoreId], it.variantId, it.qty)
      if (!v) throw new TransferError(`Ada barang asal yang tidak ditemukan di ${fromStore.nama}`)
      const have = stockOf(work[fromStoreId], it.variantId)
      if (have < it.qty) {
        throw new TransferError(`Stok tidak cukup di ${fromStore.nama}: ${desc.name} (${desc.label}): sisa ${have}, diminta ${it.qty}`)
      }
      move(fromStoreId, it.variantId, 'transfer_out', -it.qty, `Transfer ke ${toStore.nama}${cleanNote ? `: ${cleanNote}` : ''}`)
      fromDesc.push(desc)
    }
    const toDesc = []
    for (const it of to) {
      const { v, desc } = describe(work[toStoreId], it.variantId, it.qty)
      if (!v) throw new TransferError(`Ada barang tujuan yang tidak ditemukan di ${toStore.nama}`)
      move(toStoreId, it.variantId, 'transfer_in', it.qty, `Transfer dari ${fromStore.nama}${cleanNote ? `: ${cleanNote}` : ''}`)
      toDesc.push(desc)
    }
    detail.push({ from: fromDesc, to: toDesc, qty: sumFrom })
  }

  const transfer = {
    id: transferId, from_store_id: fromStoreId, to_store_id: toStoreId, note: cleanNote, detail,
    created_by_name: byName, created_at: now.toISOString(),
  }
  return {
    transferId,
    container: {
      ...container,
      states: { ...container.states, ...work },
      transfers: [...(container.transfers ?? []), transfer],
    },
  }
}
