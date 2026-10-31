import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal.jsx'
import { formatRupiah } from '../lib/format'
import { useStore } from '../lib/store.jsx'

const toInt = (v) => (/^\d+$/.test(String(v).trim()) ? Number(v) : NaN)

// Edit transaksi selesai (hanya owner): metode bayar, qty, harga satuan, tambah/hapus barang.
// Total dihitung dari item. Setiap edit wajib beralasan dan tercatat di database.
export default function EditSaleDialog({ sale, onClose, onSaved }) {
  const { api } = useStore()
  const [method, setMethod] = useState(sale.payment_method ?? 'cash')
  const [confirmed, setConfirmed] = useState(sale.payment_status === 'confirmed')
  const [items, setItems] = useState(() => sale.sale_items.map((i) => ({
    variantId: i.variant_id, label: `${i.product_name} · ${i.variant_label}`, qty: String(i.qty), price: String(i.unit_price),
  })))
  const [reason, setReason] = useState('')
  const [customer, setCustomer] = useState(sale.customer_name ?? '')
  const [catalog, setCatalog] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.fetchCatalog().then(setCatalog).catch(() => setError('Daftar barang gagal dimuat; menambah barang belum bisa.'))
  }, [api])

  const addable = useMemo(() => {
    const used = new Set(items.map((i) => i.variantId))
    return catalog.filter((r) => r.is_sellable && !used.has(r.variant_id))
  }, [catalog, items])

  const parsed = items.map((i) => ({ variantId: i.variantId, qty: toInt(i.qty), unitPrice: toInt(i.price) }))
  const valid = parsed.length > 0 && parsed.every((i) => i.qty > 0 && i.unitPrice >= 0)
  const total = valid ? parsed.reduce((n, i) => n + i.qty * i.unitPrice, 0) : null

  const patch = (idx, field, value) => setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, [field]: value } : x)))

  function addItem(variantId) {
    const r = catalog.find((x) => x.variant_id === variantId)
    if (!r) return
    setItems((xs) => [...xs, { variantId, label: `${r.display_name} · ${r.variant_label}`, qty: '1', price: String(r.price) }])
  }

  // Nama pembeli disimpan sendiri (tanpa alasan, tanpa menyentuh barang/harga).
  async function saveCustomer() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await api.setSaleCustomer({ saleId: sale.id, customerName: customer.trim() })
      onSaved(`Nama pembeli ${sale.sale_no} disimpan`)
    } catch (err) {
      setError(err.message || 'Gagal menyimpan nama. Coba lagi.')
      setBusy(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    if (busy || !valid || !reason.trim()) return
    setBusy(true)
    setError('')
    try {
      if (customer.trim() !== (sale.customer_name ?? '')) await api.setSaleCustomer({ saleId: sale.id, customerName: customer.trim() })
      await api.editSale({ saleId: sale.id, paymentMethod: method, paymentConfirmed: confirmed, items: parsed, reason: reason.trim() })
      onSaved(`Transaksi ${sale.sale_no} diedit`)
    } catch (err) {
      setError(err.message || 'Gagal menyimpan. Coba lagi.')
      setBusy(false)
    }
  }

  return (
    <Modal title={`Edit ${sale.sale_no}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Nama pembeli (opsional)
          <input value={customer} onChange={(e) => setCustomer(e.target.value)} maxLength={80} />
        </label>
        {customer.trim() !== (sale.customer_name ?? '') && (
          <button type="button" className="small" disabled={busy} onClick={saveCustomer}>Simpan nama saja</button>
        )}

        <fieldset className="edit-method">
          <legend>Metode pembayaran</legend>
          <div className="segmented" role="group" aria-label="Metode pembayaran">
            {[['qris', 'QRIS'], ['cash', 'Tunai']].map(([key, label]) => (
              <button key={key} type="button" aria-pressed={method === key} onClick={() => setMethod(key)}>{label}</button>
            ))}
          </div>
          {method === 'qris' && (
            <label className="check">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              Dana QRIS sudah masuk (terkonfirmasi)
            </label>
          )}
        </fieldset>

        <h3>Barang</h3>
        <ul className="edit-items">
          {items.map((it, idx) => (
            <li key={it.variantId}>
              <b>{it.label}</b>
              <div className="edit-row">
                <label>Qty<input inputMode="numeric" value={it.qty} onChange={(e) => patch(idx, 'qty', e.target.value)} /></label>
                <label>Harga satuan (Rp)<input inputMode="numeric" value={it.price} onChange={(e) => patch(idx, 'price', e.target.value)} /></label>
                <button type="button" className="danger-outline" disabled={items.length === 1}
                  onClick={() => setItems((xs) => xs.filter((_, i) => i !== idx))}>Hapus</button>
              </div>
            </li>
          ))}
        </ul>
        {addable.length > 0 && (
          <label>
            Tambah barang
            <select value="" onChange={(e) => addItem(e.target.value)}>
              <option value="">Pilih barang…</option>
              {addable.map((r) => (
                <option key={r.variant_id} value={r.variant_id}>
                  {r.sku} · {r.display_name} · {r.variant_label} (stok {r.stock})
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="edit-total">Total baru: <b>{total === null ? 'cek isian qty dan harga' : formatRupiah(total)}</b>
          {total !== null && total !== sale.total && <small className="muted"> (sebelumnya {formatRupiah(sale.total)})</small>}
        </p>

        <label>
          Alasan edit (wajib)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} required />
        </label>
        <p className="hint">Stok menyesuaikan selisih qty. Edit tercatat (sebelum dan sesudah) dan ikut mengubah rekap bagi hasil.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Batal</button>
          <button type="submit" className="primary" disabled={busy || !valid || !reason.trim()}>
            {busy ? 'Menyimpan…' : 'Simpan perubahan'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
