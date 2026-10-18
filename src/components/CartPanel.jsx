import { useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store.jsx'
import { formatRupiah } from '../lib/format'
import { cashChange, cashSuggestions, formatDigits, parseRupiah } from '../lib/cash'
import { newId } from '../lib/uuid'

// Isi keranjang + pembayaran. Dipakai di panel kanan (layar lebar) dan di lembar bawah (HP).
// lines: [{ row (baris katalog), qty }]; onClose opsional (tombol "Kembali" di HP).
export default function CartPanel({ lines, onQty, onRemove, onClose, onPaid, onStale }) {
  const { api } = useStore()
  const [method, setMethod] = useState('cash')
  const [checked, setChecked] = useState(false) // QRIS: sudah dicek di GoPay Merchant
  const [customer, setCustomer] = useState('')
  const [cashText, setCashText] = useState('') // uang diterima (tunai), hanya alat bantu hitung
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [qrMissing, setQrMissing] = useState(false)

  // Satu key per "percobaan": retry dengan isi yang sama memakai key yang sama (aman dari
  // transaksi ganda), tapi isi/pembayaran berubah = percobaan baru.
  const keyRef = useRef(newId())
  const signature = `${method}|${lines.map((l) => `${l.row.variant_id}:${l.qty}`).join(',')}`
  useEffect(() => {
    keyRef.current = newId()
  }, [signature])

  const total = lines.reduce((n, l) => n + l.qty * l.row.price, 0)
  // Tunai: bila uang diterima diisi tapi kurang dari total, tombol selesai ditahan.
  // Dikosongkan = tidak menghitung kembalian (tidak wajib).
  const received = method === 'cash' ? parseRupiah(cashText) : null
  const cash = method === 'cash' ? cashChange(received, total) : null
  const canPay = lines.length > 0 && !busy && (method === 'cash' ? !(cash && cash.short > 0) : checked)

  async function pay() {
    if (!canPay) return
    setBusy(true)
    setError('')
    try {
      const saleId = await api.checkout({
        idempotencyKey: keyRef.current,
        paymentMethod: method,
        paymentConfirmed: method === 'cash' || checked,
        customerName: customer.trim(),
        items: lines.map((l) => ({ variantId: l.row.variant_id, qty: l.qty })),
      })
      onPaid(saleId, cash && cash.short === 0 ? { received, change: cash.change } : null)
    } catch (err) {
      setError(err.message || 'Gagal menyimpan transaksi. Coba lagi.')
      setBusy(false)
      onStale() // stok mungkin berubah: muat ulang katalog
    }
  }

  return (
    <div className="cart">
      {lines.length === 0 ? (
        <p className="muted">Keranjang kosong.</p>
      ) : (
        <ul className="cart-lines">
          {lines.map(({ row, qty }) => (
            <li key={row.variant_id}>
              <div className="cart-name">
                <b>{row.display_name}</b>
                <br /><small>{row.variant_label} · {formatRupiah(row.price)}</small>
              </div>
              <div className="stepper">
                <button type="button" aria-label={`Kurangi ${row.display_name} ${row.variant_label}`}
                  onClick={() => onQty(row.variant_id, qty - 1)}>−</button>
                <output aria-label="Jumlah">{qty}</output>
                <button type="button" aria-label={`Tambah ${row.display_name} ${row.variant_label}`}
                  disabled={qty >= row.stock} onClick={() => onQty(row.variant_id, qty + 1)}>+</button>
              </div>
              <b className="num">{formatRupiah(qty * row.price)}</b>
              <button type="button" className="small" aria-label={`Hapus ${row.display_name} ${row.variant_label}`}
                onClick={() => onRemove(row.variant_id)}>✕</button>
            </li>
          ))}
        </ul>
      )}

      <p className="cart-total">Total <b>{formatRupiah(total)}</b></p>

      <label className="form">
        Nama pembeli (opsional, catatan pribadi)
        <input value={customer} onChange={(e) => setCustomer(e.target.value)} maxLength={80} />
      </label>

      <div className="segmented" role="group" aria-label="Metode pembayaran">
        <button type="button" aria-pressed={method === 'cash'} onClick={() => setMethod('cash')}>Tunai</button>
        <button type="button" aria-pressed={method === 'qris'} onClick={() => setMethod('qris')}>QRIS</button>
      </div>

      {method === 'cash' && lines.length > 0 && (
        <div className="cash">
          <label>
            Uang diterima (Rp)
            <input type="text" inputMode="numeric" autoComplete="off" placeholder="mis. 100.000"
              value={formatDigits(received)} maxLength={13}
              onChange={(e) => setCashText(e.target.value)} />
          </label>
          <div className="cash-quick" role="group" aria-label="Pilih nominal uang diterima">
            <button type="button" className="small" onClick={() => setCashText(String(total))}>Uang pas</button>
            {cashSuggestions(total).map((n) => (
              <button type="button" className="small" key={n} onClick={() => setCashText(String(n))}>
                {formatRupiah(n)}
              </button>
            ))}
          </div>
          {cash && cash.short > 0 && (
            <p className="cash-short" role="alert">Uang kurang <b>{formatRupiah(cash.short)}</b></p>
          )}
          {cash && cash.short === 0 && (
            <p className="cash-change" role="status" aria-live="polite">
              {cash.change === 0 ? 'Uang pas, tidak ada kembalian' : <>Kembalian <b>{formatRupiah(cash.change)}</b></>}
            </p>
          )}
        </div>
      )}

      {method === 'qris' && (
        <div className="qris">
          <p>Minta pembeli scan QRIS toko. Cek dulu pembayaran masuk di <b>GoPay Merchant</b>, baru centang di bawah.</p>
          {!qrMissing && (
            <img src="/qris.png" alt="QRIS Squishy MMG" className="qris-img" onError={() => setQrMissing(true)} />
          )}
          <label className="check">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            Saya sudah cek: {formatRupiah(total)} sudah masuk di GoPay Merchant
          </label>
        </div>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions">
        {onClose && <button type="button" onClick={onClose}>Kembali</button>}
        <button type="button" className="primary" disabled={!canPay} onClick={pay}>
          {busy ? 'Menyimpan…' : `Selesaikan · ${formatRupiah(total)}`}
        </button>
      </div>
    </div>
  )
}
