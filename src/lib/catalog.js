// Padanan view `v_catalog` di db/schema.sql (dipakai mode lokal). Ubah keduanya bersamaan.
// Aturan: bila SEMUA varian satu produk punya nilai "varian" yang sama, nilai itu ikut
// judul produk dan kasir cuma memilih warna; kalau campur, label = "varian · warna".
export function buildCatalog({ products, variants }) {
  const byProduct = new Map()
  for (const v of variants) {
    if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, [])
    byProduct.get(v.product_id).push(v)
  }

  const rows = []
  for (const p of products) {
    const vs = byProduct.get(p.id) ?? []
    const distinct = new Set(vs.map((v) => v.varian ?? ''))
    const shared = distinct.size === 1 && vs[0].varian ? vs[0].varian : null

    for (const v of vs) {
      rows.push({
        variant_id: v.id,
        product_id: p.id,
        sku: p.sku,
        display_name: shared ? `${p.name} · ${shared}` : p.name,
        variant_label: shared
          ? (v.warna ?? 'Standar')
          : ([v.varian, v.warna].filter(Boolean).join(' · ') || 'Standar'),
        price: p.price,
        stock: v.stock,
        is_sellable: p.is_active && v.is_active,
        product_name: p.name,
        varian: v.varian ?? null,
        warna: v.warna ?? null,
        product_active: p.is_active,
        variant_active: v.is_active,
      })
    }
  }
  return rows
}

const collator = new Intl.Collator('id', { numeric: true })

// Kelompokkan baris katalog per produk, urut SKU lalu nama (A1, A3, A3.1, A9, A12 ...).
export function groupByProduct(rows) {
  const map = new Map()
  for (const r of rows) {
    if (!map.has(r.product_id)) {
      map.set(r.product_id, {
        id: r.product_id,
        sku: r.sku,
        name: r.display_name,
        rawName: r.product_name,
        price: r.price,
        active: r.product_active,
        variants: [],
      })
    }
    map.get(r.product_id).variants.push(r)
  }
  return [...map.values()].sort(
    (a, b) => collator.compare(a.sku, b.sku) || collator.compare(a.name, b.name),
  )
}
