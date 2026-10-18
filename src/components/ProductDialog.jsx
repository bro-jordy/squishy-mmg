import { useState } from 'react'
import Modal from './Modal.jsx'
import { useStore } from '../lib/store.jsx'
import { cleanProduct } from '../lib/masterLogic'

let rowSeq = 0
const newRow = () => ({ key: ++rowSeq, varian: '', warna: '', stock: '' })

// Tambah barang baru (product = null) atau ubah produk yang ada.
export default function ProductDialog({ product, products, onClose, onSaved, onAddVariantTo }) {
  const { api } = useStore()
  const editing = Boolean(product)
  const [sku, setSku] = useState(product?.sku ?? '')
  const [name, setName] = useState(product?.rawName ?? '')
  const [price, setPrice] = useState(product ? String(product.price) : '')
  const [active, setActive] = useState(product?.active ?? true)
  const [rows, setRows] = useState([newRow()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const totalStock = product ? product.variants.reduce((n, v) => n + v.stock, 0) : 0

  // SKU sama dengan produk lain: tawarkan tambah varian, bukan produk dobel.
  const skuKey = sku.trim().toLowerCase()
  const sameSku = !editing && skuKey
    ? products.filter((p) => p.sku.toLowerCase() === skuKey)
    : []

  const setRow = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  async function onSubmit(e) {
    e.preventDefault()
    if (busy) return
    setError('')
    try {
      cleanProduct({ sku, name, price }) // validasi cepat sebelum menunggu server
    } catch (err) {
      setError(err.message)
      return
    }
    setBusy(true)
    try {
      if (editing) {
        await api.updateProduct({ id: product.id, sku, name, price, is_active: active })
        onSaved(`Produk "${name.trim()}" diperbarui`)
      } else {
        await api.createProduct({ sku, name, price, variants: rows })
        onSaved(`Produk "${name.trim()}" ditambahkan dengan ${rows.length} varian`)
      }
    } catch (err) {
      setError(err.message || 'Gagal menyimpan. Coba lagi.')
      setBusy(false)
    }
  }

  return (
    <Modal title={editing ? 'Ubah produk' : 'Tambah barang'} onClose={onClose}>
      <form onSubmit={onSubmit} className="form">
        <label>
          SKU
          <input value={sku} onChange={(e) => setSku(e.target.value)} required maxLength={30}
            autoFocus={!editing} autoCapitalize="characters" />
        </label>

        {sameSku.length > 0 && (
          <div className="hint" role="status">
            SKU ini sudah dipakai: {sameSku.map((p) => p.name).join(', ')}.
            Kalau barangnya sama dan cuma beda varian/warna, tambahkan sebagai varian di sana.
            {sameSku.map((p) => (
              <button type="button" key={p.id} className="small" onClick={() => onAddVariantTo(p)}>
                Tambah varian ke {p.name}
              </button>
            ))}
          </div>
        )}

        <label>
          Nama barang
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </label>
        <label>
          Harga jual (Rp, satu harga untuk semua varian)
          <input type="number" inputMode="numeric" min="0" step="1" value={price}
            onChange={(e) => setPrice(e.target.value)} required />
        </label>

        {editing ? (
          <>
            <label className="check">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Barang aktif (bisa dijual)
            </label>
            {!active && totalStock > 0 && (
              <p className="hint">
                Masih ada stok {totalStock} unit. Kalau barang ini diretur, kurangi stoknya dulu di
                Barang → Stok Barang → Ubah → Retur ke pemilik.
              </p>
            )}
            <p className="muted">Harga baru tidak mengubah transaksi yang sudah tercatat.</p>
          </>
        ) : (
          <fieldset>
            <legend>Varian</legend>
            <p className="muted">
              Kosongkan "Varian" atau "Warna" kalau tidak ada. Stok awal tercatat di riwayat stok.
            </p>
            {rows.map((r, i) => (
              <div className="variant-row" key={r.key}>
                <input aria-label={`Varian ${i + 1}`} placeholder="Varian (mis. Maltose)" value={r.varian}
                  onChange={(e) => setRow(r.key, { varian: e.target.value })} />
                <input aria-label={`Warna ${i + 1}`} placeholder="Warna" value={r.warna}
                  onChange={(e) => setRow(r.key, { warna: e.target.value })} />
                <input aria-label={`Stok awal ${i + 1}`} placeholder="Stok" type="number" inputMode="numeric"
                  min="0" step="1" value={r.stock} onChange={(e) => setRow(r.key, { stock: e.target.value })} />
                <button type="button" className="small" aria-label={`Hapus varian ${i + 1}`}
                  disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="small" onClick={() => setRows((rs) => [...rs, newRow()])}>
              + Tambah varian
            </button>
          </fieldset>
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
