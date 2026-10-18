import { useCallback, useEffect, useMemo, useState } from 'react'
import { groupByProduct } from '../lib/catalog'
import { formatRupiah, stockStatus } from '../lib/format'
import { useStore } from '../lib/store.jsx'
import ProductDialog from '../components/ProductDialog.jsx'
import VariantDialog from '../components/VariantDialog.jsx'

export default function MasterBarang() {
  const { api, isAdmin, store } = useStore()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [dialog, setDialog] = useState(null) // {type:'product', product?} | {type:'variant', product, variant?}
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      setRows(await api.fetchCatalog())
      setError('')
    } catch {
      setError('Gagal memuat master barang. Coba muat ulang.')
    }
  }, [api])

  useEffect(() => {
    load()
  }, [load])

  const products = useMemo(() => groupByProduct(rows ?? []), [rows])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products
      .filter((p) => (showInactive || p.active) && (!q || `${p.sku} ${p.name}`.toLowerCase().includes(q)))
      .map((p) => ({ ...p, variants: p.variants.filter((v) => showInactive || v.variant_active) }))
      .filter((p) => p.variants.length > 0 || showInactive)
  }, [products, query, showInactive])

  const inactiveCount = products.filter((p) => !p.active).length

  if (error) return <p className="error" role="alert">{error}</p>
  if (!rows) return <p role="status">Memuat master barang…</p>

  const done = (msg) => { setDialog(null); setNotice(msg); load() }

  return (
    <section>
      <h2 className="sr-only">Master Barang</h2>
      <div className="page-head">
        {isAdmin && (
          <button type="button" className="primary" onClick={() => { setNotice(''); setDialog({ type: 'product' }) }}>
            + Tambah barang
          </button>
        )}
      </div>
      {notice && <p className="notice" role="status">{notice}</p>}

      <input className="search" type="search" placeholder="Cari nama atau SKU"
        aria-label="Cari barang" value={query} onChange={(e) => setQuery(e.target.value)} />
      <label className="check">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        Tampilkan yang nonaktif{inactiveCount > 0 ? ` (${inactiveCount} produk)` : ''}
      </label>
      <p className="muted">
        {shown.length} produk · {shown.reduce((n, p) => n + p.variants.length, 0)} varian
      </p>

      <ul className="products">
        {shown.map((p) => (
          <li key={p.id} className={`card ${p.active ? '' : 'inactive'}`}>
            <div className="product-head">
              <span className="product-name">{p.name}{p.active ? '' : ' (nonaktif)'}</span>
              <span className="price">{formatRupiah(p.price)}</span>
            </div>
            <div className="product-head">
              <span className="sku">SKU {p.sku}</span>
              {isAdmin && (
                <button type="button" className="small" aria-label={`Ubah produk ${p.name}`}
                  onClick={() => { setNotice(''); setDialog({ type: 'product', product: p }) }}>
                  Ubah
                </button>
              )}
            </div>
            <ul className="variants">
              {p.variants.map((v) => {
                const st = stockStatus(v.stock)
                return (
                  <li key={v.variant_id} className={v.is_sellable ? '' : 'inactive'}>
                    <span>{v.variant_label}{v.variant_active ? '' : ' (nonaktif)'}</span>
                    <span className="stock">
                      {st.label && <b className={`badge ${st.key}`}>{st.label}</b>} {v.stock}
                      {isAdmin && (
                        <button type="button" className="small"
                          aria-label={`Ubah varian ${p.name} ${v.variant_label}`}
                          onClick={() => { setNotice(''); setDialog({ type: 'variant', product: p, variant: v }) }}>
                          Ubah
                        </button>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
            {isAdmin && (
              <button type="button" className="small add-variant" aria-label={`Tambah varian ke ${p.name}`}
                onClick={() => { setNotice(''); setDialog({ type: 'variant', product: p }) }}>
                + Tambah varian
              </button>
            )}
          </li>
        ))}
      </ul>
      {rows.length === 0 && (
        <div className="card empty-state">
          <b>{store.nama} belum punya barang.</b>
          <p className="muted">Mulai dengan tombol <b>+ Tambah barang</b>: isi SKU, nama, harga, dan varian beserta stok awalnya.</p>
        </div>
      )}
      {rows.length > 0 && shown.length === 0 && <p className="muted">Tidak ada barang yang cocok.</p>}

      {dialog?.type === 'product' && (
        <ProductDialog
          product={dialog.product ?? null}
          products={products}
          onClose={() => setDialog(null)}
          onSaved={done}
          onAddVariantTo={(p) => setDialog({ type: 'variant', product: p })}
        />
      )}
      {dialog?.type === 'variant' && (
        <VariantDialog
          product={dialog.product}
          variant={dialog.variant ?? null}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      )}
    </section>
  )
}
