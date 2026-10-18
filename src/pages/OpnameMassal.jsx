import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../lib/store.jsx'
import { groupByProduct } from '../lib/catalog'
import Modal from '../components/Modal.jsx'

const signed = (n) => (n > 0 ? `+${n}` : String(n))
const parse = (v) => (v === '' || v === undefined ? null : Number(v))

// Hitung fisik semua barang sekaligus. Baris yang dikosongkan tidak diubah; hanya baris
// yang hasil hitungnya BEDA dari stok sistem yang dicatat (sebagai koreksi/opname).
// Lakukan saat tidak ada penjualan, supaya stok sistem tidak bergeser selama menghitung.
export default function OpnameMassal() {
  const { api, store } = useStore()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [counts, setCounts] = useState({}) // variant_id -> teks isian
  const [query, setQuery] = useState('')
  const [review, setReview] = useState(false)
  const [reason, setReason] = useState('Stok opname')
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
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

  // varian nonaktif dengan stok 0 tidak perlu dihitung
  const counted = useMemo(() => (rows ?? []).filter((r) => r.is_sellable || r.stock > 0), [rows])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return groupByProduct(counted).filter((p) =>
      !q || `${p.sku} ${p.name} ${p.variants.map((v) => v.variant_label).join(' ')}`.toLowerCase().includes(q))
  }, [counted, query])

  const summary = useMemo(() => {
    const changes = []
    let filled = 0
    let invalid = 0
    for (const r of counted) {
      const n = parse(counts[r.variant_id])
      if (n === null) continue
      filled += 1
      if (!Number.isInteger(n) || n < 0) { invalid += 1; continue }
      if (n !== r.stock) changes.push({ row: r, counted: n, delta: n - r.stock })
    }
    return { changes, filled, invalid }
  }, [counted, counts])

  const set = (id, v) => setCounts((c) => ({ ...c, [id]: v }))

  async function save() {
    if (busy) return
    setBusy(true)
    setSaveError('')
    try {
      const changed = await api.bulkOpname({
        items: summary.changes.map((c) => ({ variantId: c.row.variant_id, counted: c.counted })),
        reason,
      })
      setNotice(`Opname tersimpan: ${changed} varian disesuaikan`)
      setCounts({})
      setReview(false)
      await load()
    } catch (err) {
      setSaveError(err.message || 'Gagal menyimpan. Coba lagi.')
    }
    setBusy(false)
  }

  if (error) return <p className="error" role="alert">{error}</p>
  if (!rows) return <p role="status">Memuat stok…</p>

  const net = summary.changes.reduce((n, c) => n + c.delta, 0)

  return (
    <section className={summary.filled > 0 ? 'with-actionbar' : ''}>
      <p><Link className="btn-link" to="/barang/stok">← Stok Barang</Link></p>
      <h2>Opname massal · {store.nama}</h2>
      <p className="muted">
        Isi hasil hitung fisik tiap barang. <b>Baris yang dikosongkan tidak diubah.</b> Hanya yang hasilnya
        berbeda dari stok sistem yang dicatat. Sebaiknya dilakukan saat tidak ada penjualan.
      </p>
      {notice && <p className="notice" role="status">{notice}</p>}

      <input className="search" type="search" placeholder="Cari nama, SKU, atau warna" aria-label="Cari barang"
        value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="opname-tools">
        <button type="button" className="small" onClick={() =>
          setCounts((c) => ({ ...c, ...Object.fromEntries(shown.flatMap((p) => p.variants).map((v) => [v.variant_id, String(v.stock)])) }))}>
          Isi yang tampil dengan stok sistem
        </button>
        <button type="button" className="small" onClick={() => setCounts({})} disabled={summary.filled === 0}>
          Kosongkan semua isian
        </button>
      </div>

      {rows.length === 0 && (
        <div className="card empty-state">
          <b>{store.nama} belum punya barang.</b>
          <p className="muted">Tambahkan dulu di <Link to="/barang/master">Master Barang</Link>, baru bisa di-opname.</p>
        </div>
      )}
      {rows.length > 0 && shown.length === 0 && <p className="muted">Tidak ada barang yang cocok.</p>}
      <ul className="products">
        {shown.map((p) => (
          <li key={p.id} className="card">
            <div className="product-head">
              <span className="product-name">{p.name}</span>
              <span className="sku">SKU {p.sku}</span>
            </div>
            <ul className="variants opname-rows">
              {p.variants.map((v) => {
                const n = parse(counts[v.variant_id])
                const bad = n !== null && (!Number.isInteger(n) || n < 0)
                const delta = n !== null && !bad ? n - v.stock : null
                return (
                  <li key={v.variant_id}>
                    <span>
                      {v.variant_label}
                      <br /><small className="muted">Sistem: {v.stock}</small>
                    </span>
                    <span className="opname-input">
                      {delta !== null && delta !== 0 && <b className={`badge ${delta > 0 ? 'st-ok' : 'st-pending'}`}>{signed(delta)}</b>}
                      {bad && <b className="badge st-void">Tidak valid</b>}
                      <input type="number" inputMode="numeric" min="0" step="1" placeholder="—"
                        aria-label={`Hasil hitung ${p.name} ${v.variant_label}`}
                        value={counts[v.variant_id] ?? ''} onChange={(e) => set(v.variant_id, e.target.value)} />
                    </span>
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ul>

      {summary.filled > 0 && (
        <div className="actionbar">
          <span>
            {summary.filled} diisi · <b>{summary.changes.length} berbeda</b>
            {summary.changes.length > 0 && <> ({signed(net)} total)</>}
            {summary.invalid > 0 && <> · <b className="neg">{summary.invalid} tidak valid</b></>}
          </span>
          <button type="button" className="primary" disabled={summary.invalid > 0 || summary.changes.length === 0}
            onClick={() => { setSaveError(''); setReview(true) }}>
            Tinjau & simpan
          </button>
        </div>
      )}

      {review && (
        <Modal title="Tinjau opname" onClose={() => setReview(false)}>
          <p className="muted">{summary.changes.length} varian akan disesuaikan di <b>{store.nama}</b>:</p>
          <ul className="plain review-list">
            {summary.changes.map((c) => (
              <li key={c.row.variant_id}>
                <span>{c.row.display_name} · {c.row.variant_label}</span>
                <span>{c.row.stock} → <b>{c.counted}</b> ({signed(c.delta)})</span>
              </li>
            ))}
          </ul>
          <label className="form">
            Alasan (wajib)
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={150} />
          </label>
          {saveError && <p className="error" role="alert">{saveError}</p>}
          <div className="dialog-actions">
            <button type="button" onClick={() => setReview(false)}>Kembali</button>
            <button type="button" className="primary" disabled={busy || !reason.trim()} onClick={save}>
              {busy ? 'Menyimpan…' : 'Simpan semua'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}
