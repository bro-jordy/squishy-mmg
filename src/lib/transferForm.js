// Logika formulir Transfer Stok (murni, bisa dites). Satu "baris" = satu barang asal yang
// dikirim (boleh dirinci per varian/warna) dan ke mana masuknya di toko tujuan.
// Produk = hasil groupByProduct (varian: variant_id, variant_label, stock, variant_active).

export const NEW_PRODUCT = '__new__'

export const emptyLine = (key) => ({
  key, fromProductId: '', fromQty: {}, toChoice: '', toQty: {}, newSku: '', newName: '', newPrice: '',
})

export const matchBySku = (sku, toProducts) =>
  toProducts.filter((p) => p.sku.toLowerCase() === String(sku).trim().toLowerCase())

const normName = (n) => String(n ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

// Produk tujuan dengan nama asli yang sama (tanpa membedakan huruf besar/kecil), walau SKU beda.
export const matchByName = (name, toProducts) =>
  toProducts.filter((p) => normName(p.rawName) === normName(name))

// Tujuan otomatis: tepat satu produk dengan SKU sama; bila SKU tidak ada di tujuan, tepat satu
// produk dengan nama sama. Selain itu dipilih manual.
export function defaultToChoice(fromProduct, toProducts) {
  if (!fromProduct) return ''
  const bySku = matchBySku(fromProduct.sku, toProducts)
  if (bySku.length === 1) return bySku[0].id
  if (bySku.length === 0) {
    const byName = matchByName(fromProduct.rawName, toProducts)
    if (byName.length === 1) return byName[0].id
  }
  return ''
}

const toInt = (v) => (/^\d+$/.test(String(v ?? '').trim()) ? Number(v) : NaN)

// Mengembalikan { error, total, payload }. payload = { from, to, newProduct? } untuk api.transferStock.
export function validateLine(line, { fromProducts, toProducts }) {
  const fp = fromProducts.find((p) => p.id === line.fromProductId)
  if (!fp) return { error: 'Pilih barang asal' }

  const from = []
  for (const v of fp.variants) {
    const raw = line.fromQty[v.variant_id]
    if (raw === undefined || String(raw).trim() === '') continue
    const qty = toInt(raw)
    if (!(qty >= 0)) return { error: `Jumlah ${v.variant_label} harus angka bulat` }
    if (qty === 0) continue
    if (qty > v.stock) return { error: `Stok ${v.variant_label} hanya ${v.stock}` }
    from.push({ variantId: v.variant_id, qty })
  }
  if (from.length === 0) return { error: 'Isi jumlah yang ditransfer' }
  const total = from.reduce((n, i) => n + i.qty, 0)

  if (!line.toChoice) return { error: 'Pilih barang tujuan', total }
  if (line.toChoice === NEW_PRODUCT) {
    const price = toInt(line.newPrice)
    if (!line.newSku.trim() || !line.newName.trim()) return { error: 'Barang baru butuh SKU dan nama', total }
    if (!(price >= 0)) return { error: 'Harga barang baru harus angka bulat', total }
    return { error: null, total, payload: { from, newProduct: { sku: line.newSku.trim(), name: line.newName.trim(), price } } }
  }

  const tp = toProducts.find((p) => p.id === line.toChoice)
  if (!tp) return { error: 'Barang tujuan tidak ditemukan', total }
  const tvs = tp.variants.filter((v) => v.variant_active)
  if (tvs.length === 0) return { error: 'Barang tujuan tidak punya varian aktif', total }
  if (tvs.length === 1) return { error: null, total, payload: { from, to: [{ variantId: tvs[0].variant_id, qty: total }] } }

  const to = []
  for (const v of tvs) {
    const raw = line.toQty[v.variant_id]
    if (raw === undefined || String(raw).trim() === '') continue
    const qty = toInt(raw)
    if (!(qty >= 0)) return { error: `Jumlah tujuan ${v.variant_label} harus angka bulat`, total }
    if (qty > 0) to.push({ variantId: v.variant_id, qty })
  }
  const sumTo = to.reduce((n, i) => n + i.qty, 0)
  if (sumTo !== total) return { error: `Bagikan ${total} ke varian tujuan (baru ${sumTo})`, total }
  return { error: null, total, payload: { from, to } }
}
