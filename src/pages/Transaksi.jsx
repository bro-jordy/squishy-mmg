import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../lib/store.jsx'
import { formatDateJakarta, formatRupiah, formatTimeJakarta, todayJakarta } from '../lib/format'
import SaleDialog, { saleStatus } from '../components/SaleDialog.jsx'
import EditSaleDialog from '../components/EditSaleDialog.jsx'
import { filterByPayment } from '../lib/salesLogic'

const METHOD = { cash: 'Tunai', qris: 'QRIS', unpaid: 'Belum bayar' }
const METHOD_FILTERS = [['all', 'Semua'], ['qris', 'QRIS'], ['cash', 'Tunai'], ['unpaid', 'Belum bayar']]

export default function Transaksi() {
  const { api, isAdmin, isPlatformOwner } = useStore()
  const [from, setFrom] = useState(todayJakarta())
  const [to, setTo] = useState(todayJakarta())
  const [query, setQuery] = useState('')
  const [sales, setSales] = useState(null)
  const [error, setError] = useState('')
  const [method, setMethod] = useState('all')
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(null)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!from || !to || from > to) return
    try {
      setSales(await api.fetchSales({ from, to }))
      setError('')
    } catch {
      setError('Gagal memuat transaksi. Coba muat ulang.')
    }
  }, [api, from, to])

  useEffect(() => {
    load()
  }, [load])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const byMethod = filterByPayment(sales ?? [], method)
    if (!q) return byMethod
    return byMethod.filter((s) =>
      [s.sale_no, s.customer_name ?? '', s.cashier_name ?? '', ...s.sale_items.map((i) => `${i.product_name} ${i.variant_label} ${i.sku}`)]
        .join(' ').toLowerCase().includes(q))
  }, [sales, query, method])

  // Hanya transaksi selesai & pembayaran terkonfirmasi yang dihitung sebagai penjualan.
  const counted = shown.filter((s) => s.status === 'completed' && s.payment_status === 'confirmed')
  const sum = counted.reduce((n, s) => n + s.total, 0)

  return (
    <section>
      <h1>Transaksi</h1>
      {notice && <p className="notice" role="status">{notice}</p>}

      <div className="filters">
        <label>Dari<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Sampai<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <div className="segmented" role="group" aria-label="Metode pembayaran">
        {METHOD_FILTERS.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={method === key} onClick={() => setMethod(key)}>{label}</button>
        ))}
      </div>
      <input className="search" type="search" placeholder="Cari no. transaksi, pembeli, kasir, atau barang"
        aria-label="Cari transaksi" value={query} onChange={(e) => setQuery(e.target.value)} />

      {error && <p className="error" role="alert">{error}</p>}
      {!sales && !error && <p role="status">Memuat transaksi…</p>}
      {sales && (
        <>
          <p className="muted">
            {formatDateJakarta(from)}{from !== to && ` – ${formatDateJakarta(to)}`} ·{' '}
            {method !== 'all' && `${METHOD[method]} · `}{counted.length} transaksi selesai{method === 'unpaid' && ` · ${shown.filter((s) => s.status === 'completed').length} menunggu bayar`} · <b>{formatRupiah(sum)}</b>
          </p>
          {shown.length === 0 && <p className="muted">Belum ada transaksi.</p>}
          <ul className="sales">
            {shown.map((s) => {
              const st = saleStatus(s)
              return (
                <li key={s.id}>
                  <button type="button" className={`sale-row ${s.status === 'void' ? 'void' : ''}`}
                    onClick={() => { setNotice(''); setSelected(s) }}>
                    <span>
                      <b>{s.sale_no}</b>
                      <br /><small className="muted">
                        {formatTimeJakarta(s.sold_at)} · {METHOD[s.payment_method ?? 'unpaid']}
                        {s.customer_name ? ` · ${s.customer_name}` : ''} · {s.sale_items.length} barang
                        {isAdmin && s.cashier_name ? ` · kasir: ${s.cashier_name}` : ''}
                      </small>
                      <br /><small className="sale-items">
                        {s.sale_items.map((i) => `${i.product_name} · ${i.variant_label}${i.qty > 1 ? ` ×${i.qty}` : ''}`).join(', ')}
                      </small>
                    </span>
                    <span className="sale-right">
                      <b>{formatRupiah(s.total)}</b>
                      <b className={`badge st-${st.key}`}>{st.label}</b>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {selected && (
        <SaleDialog
          sale={selected}
          onClose={() => setSelected(null)}
          onEdit={isPlatformOwner ? () => { setEditing(selected); setSelected(null) } : undefined}
          onChanged={(msg) => { setSelected(null); setNotice(msg); load() }}
        />
      )}

      {editing && (
        <EditSaleDialog
          sale={editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); setNotice(msg); load() }}
        />
      )}
    </section>
  )
}
