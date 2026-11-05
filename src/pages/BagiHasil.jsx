import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../lib/store.jsx'
import { formatDateJakarta, formatRupiah, todayJakarta } from '../lib/format'
import { downloadCsv } from '../lib/csv'
import { exportCsv, exportCsvOwner, exportRows, exportRowsOwner, settlementBalance } from '../lib/reportLogic'
import PeriodPresets from '../components/PeriodPresets.jsx'
import Basis from '../components/Basis.jsx'

const STATUS_LABEL = { belum: 'Belum disetor', sebagian: 'Sebagian', lunas: 'Lunas', kelebihan: 'Kelebihan setor' }
const EMPTY = { settled_on: '', amount: '', recipient: '', period_start: '', period_end: '', note: '' }

export default function BagiHasil() {
  const { api, store } = useStore()
  const [days, setDays] = useState(null)
  const [settlements, setSettlements] = useState([])
  const [settings, setSettings] = useState(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ ...EMPTY, settled_on: todayJakarta() })
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [exp, setExp] = useState({ from: todayJakarta(), to: todayJakarta() })
  const [expBusy, setExpBusy] = useState('') // '' | 'toko' | 'pemilik'
  const [expError, setExpError] = useState('')

  const load = useCallback(async () => {
    try {
      const [d, s, cfg] = await Promise.all([api.fetchDailySummary(), api.fetchSettlements(), api.fetchSettings()])
      setDays(d); setSettlements(s); setSettings(cfg); setError('')
    } catch {
      setError('Gagal memuat setoran. Coba muat ulang.')
    }
  }, [api])

  useEffect(() => {
    load()
  }, [load])

  const bal = useMemo(() => (days ? settlementBalance(days, settlements) : null), [days, settlements])
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function onSubmit(e) {
    e.preventDefault()
    if (busy) return
    setFormError('')
    const amount = Number(form.amount)
    if (bal && Number.isInteger(amount) && amount > Math.max(bal.sisa, 0)) {
      setFormError(`Nominal melebihi sisa yang belum disetor (${formatRupiah(Math.max(bal.sisa, 0))}).`)
      return
    }
    setBusy(true)
    try {
      await api.addSettlement(form)
      setNotice(`Setoran ${formatRupiah(amount)} dicatat`)
      setForm({ ...EMPTY, settled_on: todayJakarta() })
      await load()
    } catch (err) {
      setFormError(err.message || 'Gagal mencatat. Coba lagi.')
    }
    setBusy(false)
  }

  // jenis 'toko' = rekap lengkap untuk owner toko (ada harga dasar, selisih, untung toko);
  // 'pemilik' = rekap untuk pemilik barang (hanya harga dasar dan 75%, tanpa untung toko).
  async function onExport(kind) {
    if (expBusy || !exp.from || !exp.to || exp.from > exp.to) return
    setExpBusy(kind)
    setExpError('')
    try {
      const sales = await api.fetchSales({ from: exp.from, to: exp.to })
      const owner = kind === 'pemilik'
      const rows = owner ? exportRowsOwner(sales, settings?.pct_bagian_25) : exportRows(sales, settings?.pct_bagian_25)
      if (rows.length === 0) {
        setExpError('Tidak ada penjualan lunas pada periode ini.')
      } else {
        const period = `${exp.from}${exp.from === exp.to ? '' : `_sd_${exp.to}`}`
        downloadCsv(`rekap-${owner ? 'pemilik' : 'toko'}-${store.kode}-${period}.csv`, owner ? exportCsvOwner(rows) : exportCsv(rows))
      }
    } catch {
      setExpError('Gagal menyiapkan export. Coba lagi.')
    }
    setExpBusy('')
  }

  async function remove(s) {
    if (!window.confirm(`Hapus catatan setoran ${formatRupiah(s.amount)} tanggal ${formatDateJakarta(s.settled_on)}?`)) return
    try {
      await api.deleteSettlement(s.id)
      setNotice('Catatan setoran dihapus')
      await load()
    } catch (err) {
      setNotice('')
      setFormError(err.message)
    }
  }

  if (error) return <p className="error" role="alert">{error}</p>
  if (!bal) return <p role="status">Memuat setoran…</p>

  return (
    <section>
      <h1>Bagi Hasil <span className="muted store-tag">· {store.nama}</span></h1>
      <Basis settings={settings} />
      <p className="muted">Ini hanya pencatatan internal, tidak melakukan transfer apa pun.</p>
      {notice && <p className="notice" role="status">{notice}</p>}

      <div className="stats">
        <div className="card stat">
          <span>Penjualan</span>
          <b>{formatRupiah(days.reduce((n, d) => n + d.total_penjualan, 0))}</b>
          <small>{days.reduce((n, d) => n + d.transaksi, 0)} transaksi</small>
        </div>
        <div className="card stat"><span>Total Bagian 75% (pemilik)</span><b>{formatRupiah(bal.total_bagian_75)}</b></div>
        <div className="card stat"><span>Sudah disetor</span><b>{formatRupiah(bal.sudah_disetor)}</b></div>
        <div className="card stat">
          <span>{bal.sisa < 0 ? 'Kelebihan setor' : 'Sisa belum disetor'}</span>
          <b>{formatRupiah(Math.abs(bal.sisa))}</b>
          <small><span className={`badge sd-${bal.status}`}>{STATUS_LABEL[bal.status]}</span></small>
        </div>
        <div className="card stat">
          <span>Total Bagian toko</span>
          <b>{formatRupiah(days.reduce((n, d) => n + d.bagian_25, 0))}</b>
        </div>
      </div>

      <h2>Export rekap</h2>
      <div className="card form">
        <p className="muted">
          File CSV (buka di Excel/Sheets), hanya penjualan lunas.<br />
          <b>Untuk pemilik barang:</b> SKU, Nama Barang, Qty Terjual, Harga, Total, 75%. Harga = harga dasar, tanpa untung toko.<br />
          <b>Untuk owner toko:</b> SKU, Nama Barang, Qty Terjual, Harga Jual, Harga Dasar, Total, 75% Pemilik, Untung Toko (25% + selisih).
        </p>
        <PeriodPresets from={exp.from} to={exp.to} onPick={setExp} />
        <div className="filters">
          <label>Dari<input type="date" value={exp.from} max={exp.to} onChange={(e) => setExp((x) => ({ ...x, from: e.target.value }))} /></label>
          <label>Sampai<input type="date" value={exp.to} min={exp.from} onChange={(e) => setExp((x) => ({ ...x, to: e.target.value }))} /></label>
        </div>
        {expError && <p className="error" role="alert">{expError}</p>}
        <div className="export-actions">
          <button type="button" className="primary" disabled={Boolean(expBusy) || !exp.from || !exp.to || exp.from > exp.to} onClick={() => onExport('pemilik')}>
            {expBusy === 'pemilik' ? 'Menyiapkan…' : 'Unduh CSV untuk pemilik barang'}
          </button>
          <button type="button" disabled={Boolean(expBusy) || !exp.from || !exp.to || exp.from > exp.to} onClick={() => onExport('toko')}>
            {expBusy === 'toko' ? 'Menyiapkan…' : 'Unduh CSV untuk owner toko'}
          </button>
        </div>
      </div>

      <h2>Catat setoran</h2>
      <form className="card form" onSubmit={onSubmit}>
        <label>
          Nominal (Rp)
          <input type="number" inputMode="numeric" min="1" step="1" required value={form.amount} onChange={set('amount')} />
        </label>
        {bal.sisa > 0 && (
          <button type="button" className="small" onClick={() => setForm((f) => ({ ...f, amount: String(bal.sisa) }))}>
            Isi sisa penuh ({formatRupiah(bal.sisa)})
          </button>
        )}
        <label>
          Tanggal setor
          <input type="date" required value={form.settled_on} onChange={set('settled_on')} />
        </label>
        <div className="filters">
          <label>Untuk periode: dari (opsional)<input type="date" value={form.period_start} onChange={set('period_start')} /></label>
          <label>sampai<input type="date" value={form.period_end} min={form.period_start} onChange={set('period_end')} /></label>
        </div>
        <label>
          Penerima / tujuan (opsional)
          <input value={form.recipient} onChange={set('recipient')} maxLength={80} />
        </label>
        <label>
          Catatan (opsional)
          <input value={form.note} onChange={set('note')} maxLength={200} />
        </label>
        {formError && <p className="error" role="alert">{formError}</p>}
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Catat setoran'}</button>
      </form>

      <h2>Riwayat setoran</h2>
      {settlements.length === 0 ? <p className="muted">Belum ada setoran tercatat.</p> : (
        <ul className="plain history-list">
          {settlements.map((s) => (
            <li key={s.id}>
              <span>
                <b>{formatRupiah(s.amount)}</b> · {formatDateJakarta(s.settled_on)}
                {s.recipient && <> · {s.recipient}</>}
                {(s.period_start || s.period_end) && (
                  <><br /><small className="muted">Periode {s.period_start ? formatDateJakarta(s.period_start) : '…'} – {s.period_end ? formatDateJakarta(s.period_end) : '…'}</small></>
                )}
                {s.note && <><br /><small className="muted">{s.note}</small></>}
              </span>
              <button type="button" className="small" aria-label={`Hapus setoran ${formatRupiah(s.amount)} ${formatDateJakarta(s.settled_on)}`} onClick={() => remove(s)}>Hapus</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
