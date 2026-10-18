import { useCallback, useEffect, useMemo, useState } from 'react'
import { groupByProduct } from '../lib/catalog'
import { stockStatus } from '../lib/format'
import { Link } from 'react-router-dom'
import { useStore } from '../lib/store.jsx'
import AdjustDialog from '../components/AdjustDialog.jsx'

const FILTERS = [
  { key: 'semua', label: 'Semua' },
  { key: 'menipis', label: 'Menipis' },
  { key: 'habis', label: 'Habis' },
]

export default function Stok() {
  const { api, isAdmin, store } = useStore()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('semua')
  const [editing, setEditing] = useState(null)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      setRows(await api.fetchCatalog())
      setError('')
    } catch {
      setError('Gagal memuat stok. Coba muat ulang.')
    }
  }, [api])

  useEffect(() => {
    load()
  }, [load])

  const counts = useMemo(() => {
    const c = { habis: 0, menipis: 0 }
    for (const r of rows ?? []) {
      const k = stockStatus(r.stock).key
      if (k in c) c[k] += 1
    }
    return c
  }, [rows])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = []
    for (const p of groupByProduct(rows ?? [])) {
      const nameMatch = !q || `${p.sku} ${p.name}`.toLowerCase().includes(q)
      const variants = p.variants.filter(
        // varian nonaktif dengan stok 0 tidak perlu diurus lagi
        (v) => (v.is_sellable || v.stock > 0) && (filter === 'semua' || stockStatus(v.stock).key === filter) &&
          (nameMatch || v.variant_label.toLowerCase().includes(q)),
      )
      if (variants.length) out.push({ ...p, variants })
    }
    return out
  }, [rows, query, filter])

  if (error) return <p className="error" role="alert">{error}</p>
  if (!rows) return <p role="status">Memuat stok…</p>

  return (
    <section>
      <h2 className="sr-only">Stok Barang</h2>
      <p className="muted">
        {counts.habis} varian habis · {counts.menipis} menipis
        {!isAdmin && ' · Hanya admin toko yang bisa mengubah stok.'}
      </p>
      {notice && <p className="notice" role="status">{notice}</p>}
      {isAdmin && (
        <p><Link className="btn-link" to="/barang/stok/opname">Opname massal (hitung semua stok sekaligus)</Link></p>
      )}

      <input className="search" type="search" placeholder="Cari nama, SKU, atau warna"
        aria-label="Cari stok" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="segmented" role="group" aria-label="Filter stok">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {rows.length === 0 && (
        <div className="card empty-state">
          <b>{store.nama} belum punya barang.</b>
          <p className="muted">Tambahkan dulu di <Link to="/barang/master">Master Barang</Link>; stoknya bisa diisi sekalian atau lewat Opname massal.</p>
        </div>
      )}
      {rows.length > 0 && shown.length === 0 && <p className="muted">Tidak ada yang cocok.</p>}
      <ul className="products">
        {shown.map((p) => (
          <li key={p.id} className="card">
            <div className="product-head">
              <span className="product-name">{p.name}</span>
              <span className="sku">SKU {p.sku}</span>
            </div>
            <ul className="variants">
              {p.variants.map((v) => {
                const st = stockStatus(v.stock)
                return (
                  <li key={v.variant_id} className={v.is_sellable ? '' : 'inactive'}>
                    <span>{v.variant_label}{v.is_sellable ? '' : ' (nonaktif)'}</span>
                    <span className="stock">
                      {st.label && <b className={`badge ${st.key}`}>{st.label}</b>}
                      <b>{v.stock}</b>
                      {isAdmin && (
                        <button type="button" className="small"
                          aria-label={`Ubah stok ${p.name} ${v.variant_label}`}
                          onClick={() => { setNotice(''); setEditing({ ...v, display_name: p.name }) }}>
                          Ubah
                        </button>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ul>

      {editing && (
        <AdjustDialog
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); setNotice(msg); load() }}
        />
      )}
    </section>
  )
}
