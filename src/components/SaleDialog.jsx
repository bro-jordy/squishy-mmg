import { useState } from 'react'
import Modal from './Modal.jsx'
import { formatDateTimeJakarta, formatRupiah } from '../lib/format'
import { useStore } from '../lib/store.jsx'

export function saleStatus(sale) {
  if (sale.status === 'void') return { key: 'void', label: 'Void' }
  if (sale.payment_status === 'unpaid') return { key: 'unpaid', label: 'Belum dibayar' }
  if (sale.payment_status !== 'confirmed') return { key: 'pending', label: 'Pembayaran belum dikonfirmasi' }
  return { key: 'ok', label: 'Selesai' }
}

const METHOD = { cash: 'Tunai', qris: 'QRIS' }

// Judul struk (sama untuk semua toko). Ganti di sini kalau mau, mis. 'Zoyu Squishy'.
const RECEIPT_TITLE = 'Squishy Zoyu'

// Struk + detail transaksi. Bagian struk bisa dicetak / disimpan PDF lewat dialog
// cetak browser (lihat @media print di styles.css); tombol-tombol tidak ikut tercetak.
export default function SaleDialog({ sale, cash = null, justSaved = false, onClose, onChanged, onEdit }) {
  const { api, isAdmin } = useStore()
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const st = saleStatus(sale)
  const [paying, setPaying] = useState(false)
  const [payMethod, setPayMethod] = useState('cash')
  const [payChecked, setPayChecked] = useState(false)

  async function confirmPay(e) {
    e.preventDefault()
    if (busy || (payMethod === 'qris' && !payChecked)) return
    setBusy(true)
    setError('')
    try {
      await api.payHold({ saleId: sale.id, method: payMethod, confirmed: payMethod === 'cash' || payChecked })
      onChanged(`Transaksi ${sale.sale_no} sudah dibayar (${METHOD[payMethod]})`)
    } catch (err) {
      setError(err.message || 'Gagal menyimpan pembayaran. Coba lagi.')
      setBusy(false)
    }
  }

  async function confirmVoid(e) {
    e.preventDefault()
    if (busy || !reason.trim()) return
    setBusy(true)
    setError('')
    try {
      await api.voidSale({ saleId: sale.id, reason: reason.trim() })
      onChanged(`Transaksi ${sale.sale_no} di-void, stok dikembalikan`)
    } catch (err) {
      setError(err.message || 'Gagal void. Coba lagi.')
      setBusy(false)
    }
  }

  return (
    <Modal title={justSaved ? 'Transaksi tersimpan' : 'Detail transaksi'} onClose={onClose} className="receipt-dialog">
      {justSaved && <p className="notice no-print" role="status">{sale.payment_status === 'unpaid' ? 'Pesanan disimpan, belum dibayar. Stok sudah dikurangi; tandai sudah bayar nanti lewat menu Transaksi.' : 'Stok sudah dikurangi.'}</p>}
      {justSaved && cash && (
        <p className="cash-result no-print" role="status">
          Uang diterima {formatRupiah(cash.received)}<br />
          {cash.change === 0 ? <b>Uang pas, tanpa kembalian</b> : <>Kembalian <b>{formatRupiah(cash.change)}</b></>}
        </p>
      )}

      <article className="receipt" aria-label="Struk">
        <h3>{RECEIPT_TITLE}</h3>
        <p className="receipt-meta">
          {formatDateTimeJakarta(sale.sold_at)}
          {sale.customer_name && <><br />Pembeli: {sale.customer_name}</>}
        </p>
        <table>
          <tbody>
            {sale.sale_items.map((it) => (
              <tr key={it.id}>
                <td>
                  {it.product_name}
                  <br /><small>{it.variant_label} · {it.qty} × {formatRupiah(it.unit_price)}</small>
                </td>
                <td className="num">{formatRupiah(it.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><th>Total</th><th className="num">{formatRupiah(sale.total)}</th></tr>
          </tfoot>
        </table>
        <p className="receipt-meta">
          Bayar: {sale.payment_method ? `${METHOD[sale.payment_method]} · ` : ''}{st.label}
          {sale.status === 'void' && <><br />Alasan void: {sale.void_reason}</>}
        </p>
        <p className="receipt-thanks">Terima kasih!</p>
      </article>

      {/* Info internal (no. transaksi, kasir): tidak ikut tercetak dan tidak ada di struk */}
      <p className="muted internal-info no-print">
        No. transaksi: <b>{sale.sale_no}</b>
        {sale.cashier_name && <><br />Dicatat oleh: <b>{sale.cashier_name}</b></>}
        {sale.voided_by_name && <><br />Di-void oleh: <b>{sale.voided_by_name}</b></>}
        {sale.edited_at && <><br />Diedit owner: <b>{formatDateTimeJakarta(sale.edited_at)}</b></>}
      </p>

      {paying ? (
        <form className="form no-print" onSubmit={confirmPay}>
          <div className="segmented" role="group" aria-label="Metode pembayaran">
            <button type="button" aria-pressed={payMethod === 'cash'} onClick={() => setPayMethod('cash')}>Tunai</button>
            <button type="button" aria-pressed={payMethod === 'qris'} onClick={() => setPayMethod('qris')}>QRIS</button>
          </div>
          {payMethod === 'qris' && (
            <label className="check">
              <input type="checkbox" checked={payChecked} onChange={(e) => setPayChecked(e.target.checked)} />
              Saya sudah cek: {formatRupiah(sale.total)} sudah masuk di GoPay Merchant
            </label>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" onClick={() => setPaying(false)}>Batal</button>
            <button type="submit" className="primary" disabled={busy || (payMethod === 'qris' && !payChecked)}>
              {busy ? 'Menyimpan…' : 'Tandai sudah bayar'}
            </button>
          </div>
        </form>
      ) : voiding ? (
        <form className="form no-print" onSubmit={confirmVoid}>
          <label>
            Alasan void (wajib)
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus required />
          </label>
          <p className="hint">Stok semua barang di transaksi ini akan dikembalikan. Transaksi tetap tersimpan dengan status Void.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" onClick={() => setVoiding(false)}>Batal</button>
            <button type="submit" className="danger" disabled={busy || !reason.trim()}>
              {busy ? 'Memproses…' : 'Ya, void transaksi'}
            </button>
          </div>
        </form>
      ) : (
        <div className="dialog-actions no-print">
          {sale.status === 'completed' && sale.payment_status === 'unpaid' && (
            <button type="button" className="primary" onClick={() => setPaying(true)}>Sudah bayar</button>
          )}
          {isAdmin && sale.status === 'completed' && (
            <button type="button" className="danger-outline" onClick={() => setVoiding(true)}>Void</button>
          )}
          {onEdit && sale.status === 'completed' && <button type="button" onClick={onEdit}>Edit</button>}
          <button type="button" onClick={() => window.print()}>Cetak struk</button>
          <button type="button" className="primary" onClick={onClose}>{justSaved ? 'Selesai' : 'Tutup'}</button>
        </div>
      )}
    </Modal>
  )
}
