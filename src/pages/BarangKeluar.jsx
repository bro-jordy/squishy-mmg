import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../lib/store.jsx'
import { downloadCsv, toCsv } from '../lib/csv'
import { formatDateTimeJakarta, jakartaDateKey } from '../lib/format'
import { MOVEMENT_LABEL } from '../lib/stockLogic'

const FILTERS = [
  ['semua', 'Semua'],
  ['return_owner', 'Retur ke pemilik'],
  ['damaged', 'Dikeluarkan (rusak)'],
  ['transfer_out', 'Transfer keluar'],
]

// Riwayat barang yang keluar dari stok bukan karena terjual: retur ke pemilik, dikeluarkan/rusak, transfer.
export default function BarangKeluar() {
  const { api, store } = useStore()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [type, setType] = useState('semua')
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const load = useCallback(async () => {
    try {
      setRows(await api.fetchOutgoing())
      setError('')
    } catch {
      setError('Gagal memuat riwayat. Coba muat ulang.')
    }
  }, [api])

  useEffect(() => {
    load()
  }, [load])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? []).filter((r) => {
      const day = jakartaDateKey(r.created_at)
      return (type === 'semua' || r.movement_type === type)
        && (!from || day >= from) && (!to || day <= to)
        && (!q || `${r.sku} ${r.product_name} ${r.variant_label} ${r.reason}`.toLowerCase().includes(q))
    })
  }, [rows, type, query, from, to])

  const totalQty = shown.reduce((n, r) => n + Math.abs(r.qty_delta), 0)

  function onExport() {
    const lines = [['Tanggal', 'Jenis', 'SKU', 'Nama Barang', 'Varian', 'Qty', 'Alasan']]
    for (const r of shown) {
      lines.push([formatDateTimeJakarta(r.created_at), MOVEMENT_LABEL[r.movement_type], r.sku, r.product_name,
        r.variant_label, Math.abs(r.qty_delta), r.reason])
    }
    lines.push(['', 'TOTAL', '', '', '', totalQty, ''])
    downloadCsv(`barang-keluar-${store.kode}-${jakartaDateKey(new Date())}.csv`, toCsv(lines))
  }

  if (error) return <p className="error" role="alert">{error}</p>
  if (!rows) return <p role="status">Memuat riwayat…</p>

  return (
    <div>
      <div className="segmented" role="group" aria-label="Jenis">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={type === key} onClick={() => setType(key)}>{label}</button>
        ))}
      </div>
      <div className="filters">
        <label>Dari<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Sampai<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <input className="search" type="search" placeholder="Cari SKU, nama barang, atau alasan"
        aria-label="Cari riwayat barang keluar" value={query} onChange={(e) => setQuery(e.target.value)} />

      <p className="muted">{shown.length} catatan · <b>{totalQty}</b> barang keluar</p>
      <button type="button" disabled={shown.length === 0} onClick={onExport}>Export CSV</button>

      {shown.length === 0 && <p className="muted">Belum ada barang keluar.</p>}
      <ul className="plain history-list">
        {shown.map((r) => (
          <li key={r.id}>
            <span>
              <b>{r.product_name}</b> · {r.variant_label} <small className="muted">({r.sku})</small>
              <br /><small className="muted">
                {formatDateTimeJakarta(r.created_at)} · {MOVEMENT_LABEL[r.movement_type]}
                {r.reason ? ` · ${r.reason}` : ''}
              </small>
            </span>
            <b className="num">{Math.abs(r.qty_delta)}</b>
          </li>
        ))}
      </ul>
    </div>
  )
}
