import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../lib/store.jsx'
import { groupByProduct } from '../lib/catalog'
import { formatRupiah, todayJakarta } from '../lib/format'
import { useMediaQuery } from '../lib/useMediaQuery'
import CartPanel from '../components/CartPanel.jsx'
import Modal from '../components/Modal.jsx'
import SaleDialog from '../components/SaleDialog.jsx'

// Layar lebar: keranjang jadi panel kanan yang selalu terlihat.
// HP: bar di bawah (dekat jempol) yang membuka lembar keranjang dari bawah.
const WIDE = '(min-width: 900px)'

export default function Kasir() {
  const wide = useMediaQuery(WIDE)
  const { api, isAdmin, store } = useStore()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState(null)
  const [cart, setCart] = useState({}) // variant_id -> qty
  const [lastAdded, setLastAdded] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [panelKey, setPanelKey] = useState(0) // ganti = panel keranjang mulai dari kosong

  const load = useCallback(async () => {
    try {
      setRows(await api.fetchCatalog())
      setError('')
    } catch {
      setError('Gagal memuat barang. Coba muat ulang.')
    }
  }, [api])

  useEffect(() => {
    load()
  }, [load])

  const byVariant = useMemo(() => new Map((rows ?? []).map((r) => [r.variant_id, r])), [rows])

  // Stok bisa berubah (muat ulang): batasi qty di keranjang sesuai stok terbaru.
  useEffect(() => {
    if (!rows) return
    setCart((c) => {
      const next = {}
      for (const [id, qty] of Object.entries(c)) {
        const row = byVariant.get(id)
        const q = row?.is_sellable ? Math.min(qty, row.stock) : 0
        if (q > 0) next[id] = q
      }
      return Object.keys(next).length === Object.keys(c).length &&
        Object.entries(next).every(([k, v]) => c[k] === v) ? c : next
    })
  }, [rows, byVariant])

  const products = useMemo(() => {
    const q = query.trim().toLowerCase()
    return groupByProduct((rows ?? []).filter((r) => r.is_sellable)).filter((p) =>
      !q || `${p.sku} ${p.name} ${p.variants.map((v) => v.variant_label).join(' ')}`.toLowerCase().includes(q))
  }, [rows, query])

  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ row: byVariant.get(id), qty }))
    .filter((l) => l.row)
  const itemCount = lines.reduce((n, l) => n + l.qty, 0)
  const total = lines.reduce((n, l) => n + l.qty * l.row.price, 0)

  const setQty = (id, qty) =>
    setCart((c) => {
      const next = { ...c }
      if (qty <= 0) delete next[id]
      else next[id] = Math.min(qty, byVariant.get(id)?.stock ?? 0)
      return next
    })
  const add = (row) => {
    setQty(row.variant_id, (cart[row.variant_id] ?? 0) + 1)
    setLastAdded(`${row.display_name} · ${row.variant_label}`)
  }
  const remove = (row) => setQty(row.variant_id, (cart[row.variant_id] ?? 0) - 1)

  async function onPaid(saleId) {
    const today = todayJakarta()
    const sales = await api.fetchSales({ from: today, to: today })
    setReceipt(sales.find((s) => s.id === saleId) ?? null)
    setCart({})
    setLastAdded('')
    setSheetOpen(false)
    setPanelKey((k) => k + 1)
    setQuery('')
    setOpenId(null)
    load()
  }

  if (error) return <p className="error" role="alert">{error}</p>
  if (!rows) return <p role="status">Memuat barang…</p>

  const cartProps = {
    lines,
    onQty: setQty,
    onRemove: (id) => setQty(id, 0),
    onPaid,
    onStale: load,
  }

  return (
    <section className={!wide && itemCount > 0 ? 'with-cartbar' : ''}>
      <h1>Kasir</h1>
      <div className="pos">
        <div className="pos-main">
          <input className="search" type="search" placeholder="Cari nama barang atau SKU"
            aria-label="Cari barang" value={query} onChange={(e) => setQuery(e.target.value)} />

          {rows.length === 0 && (
            <div className="card empty-state">
              <b>{store.nama} belum punya barang.</b>
              <p className="muted">
                {isAdmin
                  ? <>Tambahkan barang dulu lewat <Link to="/barang/master">Barang → Master Barang</Link>, lalu isi stoknya. Setelah itu barang muncul di sini.</>
                  : 'Barang belum diisi. Minta admin toko menambahkannya dulu.'}
              </p>
            </div>
          )}
          {rows.length > 0 && products.length === 0 && <p className="muted">Tidak ada barang yang cocok.</p>}
          <ul className="pos-list">
            {products.map((p) => {
              const open = openId === p.id || (query.trim() !== '' && products.length <= 3)
              const inCart = p.variants.reduce((n, v) => n + (cart[v.variant_id] ?? 0), 0)
              return (
                <li key={p.id} className="card">
                  <button type="button" className="pos-product" aria-expanded={open}
                    onClick={() => setOpenId(open ? null : p.id)}>
                    <span>
                      <b>{p.name}</b>
                      <br /><small className="muted">SKU {p.sku}</small>
                    </span>
                    <span className="pos-price">
                      {formatRupiah(p.price)}
                      {inCart > 0 && <b className="badge incart"> {inCart} di keranjang</b>}
                    </span>
                  </button>
                  {open && (
                    <div className="pos-variants" role="group" aria-label={`Pilihan ${p.name}`}>
                      {p.variants.map((v) => {
                        const qty = cart[v.variant_id] ?? 0
                        const left = v.stock - qty
                        return (
                          <div key={v.variant_id} className="variant-wrap">
                            {qty > 0 && (
                              <button type="button" className="minus"
                                aria-label={`Kurangi ${p.name} ${v.variant_label}`} onClick={() => remove(v)}>−</button>
                            )}
                            <button type="button" className="variant-chip"
                              disabled={left <= 0} onClick={() => add(v)}
                              aria-label={`Tambah ${p.name} ${v.variant_label}`}>
                              <span>{v.variant_label}{qty > 0 && <b className="qty-badge"> ×{qty}</b>}</span>
                              <small>{v.stock <= 0 ? 'Habis' : left <= 0 ? 'Semua di keranjang' : `Stok ${left}`}</small>
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>

        {wide && (
          <aside className="cart-panel card" aria-label="Keranjang">
            <h2>Keranjang</h2>
            <CartPanel key={panelKey} {...cartProps} />
          </aside>
        )}
      </div>

      {!wide && itemCount > 0 && (
        <button type="button" className="cartbar" onClick={() => setSheetOpen(true)}
          aria-label={`Lihat keranjang: ${itemCount} item, ${formatRupiah(total)}`}>
          <span className="cartbar-info">
            <b>{itemCount} item · {formatRupiah(total)}</b>
            {lastAdded && <small>Terakhir: {lastAdded}</small>}
          </span>
          <span className="cartbar-cta">Lihat keranjang ›</span>
        </button>
      )}

      {!wide && sheetOpen && (
        <Modal title="Keranjang" className="sheet" onClose={() => setSheetOpen(false)}>
          <CartPanel key={panelKey} {...cartProps} onClose={() => setSheetOpen(false)} />
        </Modal>
      )}

      {receipt && <SaleDialog sale={receipt} justSaved onClose={() => setReceipt(null)} onChanged={() => setReceipt(null)} />}
    </section>
  )
}
