import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../lib/store.jsx'
import { formatDateJakarta, formatRupiah, stockStatus, todayJakarta } from '../lib/format'
import { allocateSettlements, periodRange, settlementBalance, topProducts } from '../lib/reportLogic'
import Basis from '../components/Basis.jsx'

const PRESETS = [
  { key: 'hari', label: 'Hari ini' },
  { key: '7hari', label: '7 hari' },
  { key: 'bulan', label: 'Bulan ini' },
  { key: 'kustom', label: 'Pilih tanggal' },
]

const STATUS_LABEL = { belum: 'Belum disetor', sebagian: 'Sebagian', lunas: 'Lunas', kosong: '–', kelebihan: 'Kelebihan setor' }

export default function Dashboard() {
  const { api, store } = useStore()
  const today = todayJakarta()
  const [preset, setPreset] = useState('hari')
  const [custom, setCustom] = useState({ from: today, to: today })
  const [days, setDays] = useState(null)
  const [settlements, setSettlements] = useState([])
  const [settings, setSettings] = useState(null)
  const [catalog, setCatalog] = useState([])
  const [sales, setSales] = useState([])
  const [error, setError] = useState('')

  const range = preset === 'kustom' ? custom : periodRange(preset, today)
  const validRange = range.from && range.to && range.from <= range.to

  useEffect(() => {
    Promise.all([api.fetchDailySummary(), api.fetchSettlements(), api.fetchSettings(), api.fetchCatalog()])
      .then(([d, s, cfg, cat]) => { setDays(d); setSettlements(s); setSettings(cfg); setCatalog(cat) })
      .catch(() => setError('Gagal memuat dashboard. Coba muat ulang.'))
  }, [api])

  useEffect(() => {
    if (!validRange) return
    let active = true
    api.fetchSales(range).then((s) => active && setSales(s)).catch(() => active && setSales([]))
    return () => { active = false }
  }, [api, range.from, range.to, validRange])

  const view = useMemo(() => {
    if (!days) return null
    const settled = settlements.filter((s) => s.share === 'bagian_75').reduce((n, s) => n + s.amount, 0)
    const allocated = allocateSettlements(days, settled)
    const inRange = allocated.filter((d) => d.day >= range.from && d.day <= range.to)
    const sum = (k) => inRange.reduce((n, d) => n + d[k], 0)
    return {
      rows: [...inRange].reverse(),
      total: sum('total_penjualan'), transaksi: sum('transaksi'),
      b25: sum('bagian_25'), b75: sum('bagian_75'),
      balance: settlementBalance(days, settlements),
    }
  }, [days, settlements, range.from, range.to])

  const stock = useMemo(() => {
    const low = catalog.filter((r) => r.is_sellable && stockStatus(r.stock).key !== 'ok')
    return {
      habis: low.filter((r) => r.stock <= 0),
      menipis: low.filter((r) => r.stock > 0),
    }
  }, [catalog])

  const best = useMemo(() => topProducts(sales), [sales])

  if (error) return <p className="error" role="alert">{error}</p>
  if (!view) return <p role="status">Memuat dashboard…</p>

  const bal = view.balance
  return (
    <section>
      <h1>Dashboard <span className="muted store-tag">· {store.nama}</span></h1>
      <Basis settings={settings} />

      <div className="segmented" role="group" aria-label="Periode">
        {PRESETS.map((p) => (
          <button key={p.key} type="button" aria-pressed={preset === p.key} onClick={() => setPreset(p.key)}>
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'kustom' && (
        <div className="filters">
          <label>Dari<input type="date" value={custom.from} max={custom.to}
            onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></label>
          <label>Sampai<input type="date" value={custom.to} min={custom.from}
            onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></label>
        </div>
      )}
      <p className="muted">
        {validRange ? <>{formatDateJakarta(range.from)}{range.from !== range.to && ` – ${formatDateJakarta(range.to)}`}</> : 'Rentang tanggal tidak valid'}
      </p>

      <div className="stats">
        <div className="card stat"><span>Penjualan</span><b>{formatRupiah(view.total)}</b><small>{view.transaksi} transaksi</small></div>
        <div className="card stat"><span>Bagian 25%</span><b>{formatRupiah(view.b25)}</b></div>
        <div className="card stat"><span>Bagian 75%</span><b>{formatRupiah(view.b75)}</b></div>
        <div className="card stat">
          <span>Belum disetor (semua waktu)</span>
          <b>{formatRupiah(Math.max(bal.sisa, 0))}</b>
          <small>
            <span className={`badge sd-${bal.status}`}>{STATUS_LABEL[bal.status] ?? bal.status}</span>{' '}
            <Link to="/bagi-hasil">Catat setoran</Link>
          </small>
        </div>
      </div>

      <h2>Rekap harian</h2>
      {view.rows.length === 0 ? <p className="muted">Belum ada penjualan di periode ini.</p> : (
        <div className="table-wrap">
          <table className="rekap">
            <thead>
              <tr><th>Tanggal</th><th className="num">Penjualan</th><th className="num">Bagian 25%</th><th className="num">Bagian 75%</th><th>Setoran</th></tr>
            </thead>
            <tbody>
              {view.rows.map((d) => (
                <tr key={d.day}>
                  <td>{formatDateJakarta(d.day)}<br /><small className="muted">{d.transaksi} transaksi</small></td>
                  <td className="num">{formatRupiah(d.total_penjualan)}</td>
                  <td className="num">{formatRupiah(d.bagian_25)}</td>
                  <td className="num">{formatRupiah(d.bagian_75)}</td>
                  <td>
                    <span className={`badge sd-${d.status}`}>{STATUS_LABEL[d.status]}</span>
                    {d.status !== 'kosong' && <><br /><small>{formatRupiah(d.disetor)} / {formatRupiah(d.bagian_75)}</small></>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th>Total</th><th className="num">{formatRupiah(view.total)}</th><th className="num">{formatRupiah(view.b25)}</th><th className="num">{formatRupiah(view.b75)}</th><th /></tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="muted small-note">Status setoran per hari dialokasikan dari hari terlama (aturan setoran belum dikonfirmasi).</p>

      <div className="two-col">
        <div>
          <h2>Stok perlu perhatian</h2>
          {stock.habis.length + stock.menipis.length === 0 ? <p className="muted">Semua stok aman.</p> : (
            <ul className="plain">
              {[...stock.habis, ...stock.menipis].slice(0, 10).map((r) => (
                <li key={r.variant_id}>
                  <span>{r.display_name} · {r.variant_label}</span>
                  <span><b className={`badge ${stockStatus(r.stock).key}`}>{stockStatus(r.stock).label}</b> <b>{r.stock}</b></span>
                </li>
              ))}
            </ul>
          )}
          <p><Link to="/barang/stok">Lihat semua stok</Link> · {stock.habis.length} habis, {stock.menipis.length} menipis</p>
        </div>
        <div>
          <h2>Terlaris di periode ini</h2>
          {best.length === 0 ? <p className="muted">Belum ada data.</p> : (
            <ol className="plain">
              {best.map((t) => (
                <li key={`${t.sku}|${t.name}`}>
                  <span>{t.name}</span>
                  <span><b>{t.qty}</b> terjual · {formatRupiah(t.revenue)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  )
}
