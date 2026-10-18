import { useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store.jsx'
import { formatDateTimeJakarta } from '../lib/format'
import { MOVEMENT_LABEL } from '../lib/stockLogic'

const MODES = {
  masuk: { label: 'Barang masuk', type: 'restock', reason: 'Barang masuk', qtyLabel: 'Jumlah masuk' },
  rusak: { label: 'Rusak / hilang', type: 'damaged', reason: 'Barang rusak', qtyLabel: 'Jumlah rusak' },
  retur: { label: 'Retur ke pemilik', type: 'return_owner', reason: 'Retur ke pemilik', qtyLabel: 'Jumlah diretur' },
  opname: { label: 'Opname', type: 'adjustment', reason: 'Stok opname', qtyLabel: 'Jumlah fisik (hasil hitung)' },
}

// rusak & retur mengurangi stok sebanyak jumlah yang diisi
const DECREASE = new Set(['rusak', 'retur'])

const signed = (n) => (n > 0 ? `+${n}` : String(n))

export default function AdjustDialog({ item, onClose, onSaved }) {
  const { api } = useStore()
  const ref = useRef(null)
  const [mode, setMode] = useState('masuk')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState(MODES.masuk.reason)
  const [reasonTouched, setReasonTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState(null)

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  useEffect(() => {
    let active = true
    api.fetchMovements(item.variant_id)
      .then((rows) => active && setHistory(rows))
      .catch(() => active && setHistory([]))
    return () => {
      active = false
    }
  }, [api, item.variant_id])

  function pickMode(next) {
    setMode(next)
    setQty('')
    setError('')
    if (!reasonTouched) setReason(MODES[next].reason)
  }

  const n = qty === '' ? null : Number(qty)
  const validInt = n !== null && Number.isInteger(n) && n >= (mode === 'opname' ? 0 : 1)
  let delta = null
  if (validInt) {
    delta = mode === 'masuk' ? n : DECREASE.has(mode) ? -n : n - item.stock
  }
  const newStock = delta === null ? null : item.stock + delta
  const tooMuch = DECREASE.has(mode) && validInt && n > item.stock

  let hint = ''
  if (tooMuch) hint = `Melebihi stok sistem (${item.stock}).`
  else if (mode === 'opname' && validInt && delta === 0) hint = 'Sama dengan stok sistem, tidak ada yang perlu diubah.'

  const canSubmit =
    !busy && validInt && delta !== 0 && !tooMuch && reason.trim() !== ''

  async function onSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError('')
    const finalReason =
      mode === 'opname' ? `${reason.trim()} (hitung ${n}, sistem ${item.stock})` : reason.trim()
    try {
      await api.adjustStock({
        variantId: item.variant_id,
        type: MODES[mode].type,
        delta,
        reason: finalReason,
      })
      onSaved(`${item.display_name} · ${item.variant_label}: stok ${item.stock} → ${newStock}`)
    } catch (err) {
      setError(err.message || 'Gagal menyimpan. Coba lagi.')
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="adj-title">
      <form onSubmit={onSubmit}>
        <h2 id="adj-title">Ubah stok</h2>
        <p className="muted">
          {item.display_name} · {item.variant_label}
          <br />
          Stok sekarang: <b>{item.stock}</b>
        </p>

        <div className="segmented" role="group" aria-label="Jenis perubahan">
          {Object.entries(MODES).map(([key, m]) => (
            <button type="button" key={key} aria-pressed={mode === key} onClick={() => pickMode(key)}>
              {m.label}
            </button>
          ))}
        </div>

        <label>
          {MODES[mode].qtyLabel}
          <input
            type="number" inputMode="numeric" min={mode === 'opname' ? 0 : 1} step="1"
            value={qty} onChange={(e) => setQty(e.target.value)} autoFocus required
          />
        </label>
        {DECREASE.has(mode) && item.stock > 0 && (
          <button type="button" className="small" onClick={() => setQty(String(item.stock))}>
            Semua ({item.stock})
          </button>
        )}
        {hint && <p className="hint">{hint}</p>}
        {newStock !== null && !tooMuch && delta !== 0 && (
          <p className="preview" aria-live="polite">
            Stok: {item.stock} → <b>{newStock}</b> ({signed(delta)})
          </p>
        )}

        <label>
          Alasan (wajib)
          <input
            type="text" value={reason} required maxLength={200}
            onChange={(e) => { setReason(e.target.value); setReasonTouched(true) }}
          />
        </label>

        {error && <p className="error" role="alert">{error}</p>}

        <div className="dialog-actions">
          <button type="button" onClick={() => ref.current?.close()}>Batal</button>
          <button type="submit" className="primary" disabled={!canSubmit}>
            {busy ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>

        <h3>Riwayat terakhir</h3>
        {history === null ? (
          <p className="muted" role="status">Memuat…</p>
        ) : history.length === 0 ? (
          <p className="muted">Belum ada riwayat.</p>
        ) : (
          <ul className="history">
            {history.map((m) => (
              <li key={m.id}>
                <span>
                  <b>{MOVEMENT_LABEL[m.movement_type] ?? m.movement_type}</b> · {m.reason}
                  <br />
                  <small className="muted">{formatDateTimeJakarta(m.created_at)}</small>
                </span>
                <b className="delta">{signed(m.qty_delta)}</b>
              </li>
            ))}
          </ul>
        )}
      </form>
    </dialog>
  )
}
