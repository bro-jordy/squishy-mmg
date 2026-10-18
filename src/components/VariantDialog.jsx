import { useState } from 'react'
import Modal from './Modal.jsx'
import { useStore } from '../lib/store.jsx'

// Tambah varian ke produk (variant = null) atau ubah varian yang ada.
export default function VariantDialog({ product, variant, onClose, onSaved }) {
  const { api } = useStore()
  const editing = Boolean(variant)
  const [varian, setVarian] = useState(variant?.varian ?? '')
  const [warna, setWarna] = useState(variant?.warna ?? '')
  const [stock, setStock] = useState('')
  const [active, setActive] = useState(variant?.variant_active ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (editing) {
        await api.updateVariant({ id: variant.variant_id, varian, warna, is_active: active })
        onSaved('Varian diperbarui')
      } else {
        await api.addVariant({ productId: product.id, varian, warna, stock })
        onSaved(`Varian ditambahkan ke ${product.rawName}`)
      }
    } catch (err) {
      setError(err.message || 'Gagal menyimpan. Coba lagi.')
      setBusy(false)
    }
  }

  return (
    <Modal title={editing ? 'Ubah varian' : 'Tambah varian'} onClose={onClose}>
      <form onSubmit={onSubmit} className="form">
        <p className="muted">{product.rawName} · SKU {product.sku}</p>
        <label>
          Varian
          <input value={varian} onChange={(e) => setVarian(e.target.value)} autoFocus
            placeholder="mis. Maltose, Crunchy, Beruang" />
        </label>
        <label>
          Warna
          <input value={warna} onChange={(e) => setWarna(e.target.value)} />
        </label>
        <p className="muted">Kosongkan kalau tidak ada.</p>
        {editing ? (
          <>
            <label className="check">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Varian aktif (bisa dijual)
            </label>
            <p className="muted">Stok sekarang {variant.stock}. Ubah stok lewat Barang → Stok Barang.</p>
          </>
        ) : (
          <label>
            Stok awal
            <input type="number" inputMode="numeric" min="0" step="1" value={stock}
              onChange={(e) => setStock(e.target.value)} placeholder="0" />
          </label>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Batal</button>
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </form>
    </Modal>
  )
}
