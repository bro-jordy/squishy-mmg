const toInt = (v) => (/^\d+$/.test(String(v).trim()) ? Number(v) : NaN)

const METHOD_LABEL = { qris: 'QRIS', cash: 'Tunai', unpaid: 'Belum bayar' }

// Alasan otomatis dari perubahan (nama pembeli, barang/SKU, qty, harga, pembayaran).
// Hanya usulan: owner bebas mengubahnya sebelum menyimpan.
export function autoReason({ sale, customer, items, method, confirmed }) {
  const parts = []
  const before = (sale.customer_name ?? '').trim()
  const after = customer.trim()
  if (before !== after) {
    if (!before) parts.push(`Tambah nama pembeli (${after})`)
    else if (!after) parts.push(`Hapus nama pembeli (${before})`)
    else parts.push(`Ganti nama pembeli (${before} → ${after})`)
  }

  const old = new Map(sale.sale_items.map((i) => [i.variant_id, i]))
  const cur = new Map(items.map((i) => [i.variantId, i]))
  const name = (sku, label) => `${sku} ${label}`.trim()
  const removed = sale.sale_items.filter((i) => !cur.has(i.variant_id)).map((i) => name(i.sku, `${i.product_name} · ${i.variant_label}`))
  const added = items.filter((i) => !old.has(i.variantId)).map((i) => name(i.sku, i.label))
  if (removed.length && added.length) parts.push(`Ganti barang ${removed.join(', ')} → ${added.join(', ')}`)
  else if (removed.length) parts.push(`Hapus barang ${removed.join(', ')}`)
  else if (added.length) parts.push(`Tambah barang ${added.join(', ')}`)
  for (const it of items) {
    const o = old.get(it.variantId)
    if (!o) continue
    const label = name(o.sku, `${o.product_name} · ${o.variant_label}`)
    if (toInt(it.qty) !== o.qty) parts.push(`Ubah qty ${label} ${o.qty} → ${it.qty}`)
    if (toInt(it.price) !== o.unit_price) parts.push(`Ubah harga ${label} ${o.unit_price} → ${it.price}`)
  }

  const oldMethod = sale.payment_status === 'unpaid' ? 'unpaid' : sale.payment_method
  if (method !== oldMethod) parts.push(`Ubah pembayaran ${METHOD_LABEL[oldMethod]} → ${METHOD_LABEL[method]}`)
  else if (method === 'qris' && confirmed !== (sale.payment_status === 'confirmed')) {
    parts.push(confirmed ? 'QRIS dikonfirmasi' : 'QRIS belum dikonfirmasi')
  }
  return parts.join('; ')
}
