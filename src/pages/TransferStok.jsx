import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../lib/store.jsx'
import { groupByProduct } from '../lib/catalog'
import { formatDateTimeJakarta } from '../lib/format'
import { NEW_PRODUCT, defaultToChoice, emptyLine, matchByName, matchBySku, validateLine } from '../lib/transferForm'

const sumStock = (p) => p.variants.reduce((n, v) => n + v.stock, 0)
const optionLabel = (p) => `${p.sku} · ${p.name} (stok ${sumStock(p)})`
let lineSeq = 0
const newLine = () => emptyLine(`l${++lineSeq}`)

// Transfer stok antar toko. Hanya owner. Pencocokan barang eksplisit: pilih barang asal
// (boleh dirinci per warna) lalu barang tujuan; SKU yang sama di tujuan otomatis terpilih
// bila hanya ada satu, selain itu dipilih manual atau dibuat sebagai barang baru.
export default function TransferStok() {
  const { api, stores, store, isPlatformOwner } = useStore()
  const other = stores.find((s) => s.id !== store.id)
  const [fromId, setFromId] = useState(store.id)
  const [toId, setToId] = useState(other?.id ?? '')
  const [fromRows, setFromRows] = useState(null)
  const [toRows, setToRows] = useState(null)
  const [lines, setLines] = useState([newLine()])
  const [note, setNote] = useState('')
  const [history, setHistory] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const fromStore = stores.find((s) => s.id === fromId)
  const toStore = stores.find((s) => s.id === toId)

  const load = useCallback(async () => {
    if (!fromId || !toId) return
    try {
      const [a, b, h] = await Promise.all([api.fetchStoreCatalog(fromId), api.fetchStoreCatalog(toId), api.fetchTransfers()])
      setFromRows(a)
      setToRows(b)
      setHistory(h)
      setError('')
    } catch {
      setError('Gagal memuat data transfer. Coba muat ulang.')
    }
  }, [api, fromId, toId])

  useEffect(() => {
    setFromRows(null)
    setToRows(null)
    load()
  }, [load])

  const fromProducts = useMemo(() => groupByProduct(fromRows ?? []).filter((p) => sumStock(p) > 0), [fromRows])
  const toProducts = useMemo(() => groupByProduct(toRows ?? []).filter((p) => p.variants.some((v) => v.variant_active)), [toRows])
  const ctx = { fromProducts, toProducts }

  if (!isPlatformOwner) {
    return <p>Transfer stok hanya untuk owner.</p>
  }
  if (!other) return <p className="muted">Transfer stok butuh dua toko.</p>

  const patch = (key, p) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))

  function pickFrom(line, productId) {
    const fp = fromProducts.find((p) => p.id === productId)
    patch(line.key, { fromProductId: productId, fromQty: {}, toQty: {}, toChoice: defaultToChoice(fp, toProducts) })
  }

  function swap() {
    setFromId(toId)
    setToId(fromId)
    setLines([newLine()])
    setNotice('')
  }

  const results = lines.map((l) => validateLine(l, ctx))
  const allValid = lines.length > 0 && results.every((r) => !r.error)
  const grandTotal = results.reduce((n, r) => n + (r.error ? 0 : r.total), 0)

  async function submit(e) {
    e.preventDefault()
    if (busy || !allValid) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api.transferStock({ fromStoreId: fromId, toStoreId: toId, note: note.trim(), lines: results.map((r) => r.payload) })
      setNotice(`Transfer berhasil: ${grandTotal} pcs dari ${fromStore.nama} ke ${toStore.nama}.`)
      setLines([newLine()])
      setNote('')
      await load()
    } catch (err) {
      setError(err.message || 'Gagal transfer. Coba lagi.')
    }
    setBusy(false)
  }

  const storeName = (id) => stores.find((s) => s.id === id)?.nama ?? 'Toko'

  return (
    <div className="transfer">
      {notice && <p className="notice" role="status">{notice}</p>}

      <div className="transfer-route">
        <label>Dari
          <select value={fromId} onChange={(e) => { setFromId(e.target.value); setToId(stores.find((s) => s.id !== e.target.value)?.id ?? ''); setLines([newLine()]) }}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.nama}</option>)}
          </select>
        </label>
        <button type="button" onClick={swap} aria-label="Tukar arah transfer">⇄</button>
        <label>Ke
          <input value={toStore?.nama ?? ''} readOnly aria-readonly="true" />
        </label>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {(!fromRows || !toRows) && !error && <p role="status">Memuat barang…</p>}

      {fromRows && toRows && (
        <form className="form" onSubmit={submit}>
          {lines.map((line, idx) => {
            const fp = fromProducts.find((p) => p.id === line.fromProductId)
            const bySku = fp ? matchBySku(fp.sku, toProducts) : []
            const byName = fp ? matchByName(fp.rawName, toProducts).filter((p) => !bySku.includes(p)) : []
            const others = toProducts.filter((p) => !bySku.includes(p) && !byName.includes(p))
            const tp = toProducts.find((p) => p.id === line.toChoice)
            const tvs = tp ? tp.variants.filter((v) => v.variant_active) : []
            const res = results[idx]
            const toSum = tvs.reduce((n, v) => n + (/^\d+$/.test(line.toQty[v.variant_id] ?? '') ? Number(line.toQty[v.variant_id]) : 0), 0)
            return (
              <fieldset key={line.key} className="card transfer-line">
                <legend>Barang {idx + 1}</legend>

                <label>Barang asal ({fromStore.nama})
                  <select value={line.fromProductId} onChange={(e) => pickFrom(line, e.target.value)}>
                    <option value="">Pilih barang…</option>
                    {fromProducts.map((p) => <option key={p.id} value={p.id}>{optionLabel(p)}</option>)}
                  </select>
                </label>

                {fp && (
                  <>
                    <p className="muted">Jumlah dikirim (stok total {fromStore.nama}: <b>{sumStock(fp)}</b>)</p>
                    <ul className="transfer-qty">
                      {fp.variants.filter((v) => v.stock > 0).map((v) => (
                        <li key={v.variant_id}>
                          <span>{v.variant_label} <small className="muted">stok {v.stock}</small></span>
                          <input inputMode="numeric" placeholder="0" aria-label={`Jumlah ${v.variant_label}`}
                            value={line.fromQty[v.variant_id] ?? ''}
                            onChange={(e) => patch(line.key, { fromQty: { ...line.fromQty, [v.variant_id]: e.target.value } })} />
                        </li>
                      ))}
                    </ul>

                    <label>Masuk ke ({toStore.nama})
                      <select value={line.toChoice} onChange={(e) => patch(line.key, { toChoice: e.target.value, toQty: {} })}>
                        <option value="">{bySku.length > 1 ? 'Ada beberapa SKU sama, pilih…' : bySku.length === 0 && byName.length === 0 ? 'SKU ini belum ada di tujuan, pilih…' : 'Pilih…'}</option>
                        {bySku.length > 0 && (
                          <optgroup label={`SKU sama (${fp.sku})`}>
                            {bySku.map((p) => <option key={p.id} value={p.id}>{optionLabel(p)}</option>)}
                          </optgroup>
                        )}
                        {byName.length > 0 && (
                          <optgroup label="Nama sama, SKU beda">
                            {byName.map((p) => <option key={p.id} value={p.id}>{optionLabel(p)}</option>)}
                          </optgroup>
                        )}
                        {others.length > 0 && (
                          <optgroup label={`Barang lain di ${toStore.nama}`}>
                            {others.map((p) => <option key={p.id} value={p.id}>{optionLabel(p)}</option>)}
                          </optgroup>
                        )}
                        <option value={NEW_PRODUCT}>＋ Barang baru di {toStore.nama}…</option>
                      </select>
                    </label>
                    {tp && !bySku.includes(tp) && byName.includes(tp) && (
                      <p className="hint">Nama sama dengan barang asal, tapi SKU berbeda ({fp.sku} → {tp.sku}). Pastikan ini barang yang sama.</p>
                    )}

                    {line.toChoice === NEW_PRODUCT && (
                      <div className="transfer-new">
                        <label>SKU<input value={line.newSku} onChange={(e) => patch(line.key, { newSku: e.target.value })} placeholder={fp.sku} /></label>
                        <label>Nama<input value={line.newName} onChange={(e) => patch(line.key, { newName: e.target.value })} placeholder={fp.rawName} /></label>
                        <label>Harga (Rp)<input inputMode="numeric" value={line.newPrice} onChange={(e) => patch(line.key, { newPrice: e.target.value })} placeholder={String(fp.price)} /></label>
                        <button type="button" className="small" onClick={() => patch(line.key, { newSku: fp.sku, newName: fp.rawName, newPrice: String(fp.price) })}>Samakan dengan {fromStore.nama}</button>
                        <p className="hint">Dibuat dengan satu varian “Random”; stok awalnya dari transfer ini.</p>
                      </div>
                    )}

                    {tp && (
                      <>
                        <p className="muted">Stok total {toStore.nama} sekarang: <b>{sumStock(tp)}</b></p>
                        {tvs.length > 1 && (
                          <>
                            <p className="muted">Bagikan ke varian tujuan (sisa dibagikan: <b>{(res.total ?? 0) - toSum}</b>)</p>
                            <ul className="transfer-qty">
                              {tvs.map((v) => (
                                <li key={v.variant_id}>
                                  <span>{v.variant_label} <small className="muted">stok {v.stock}</small></span>
                                  <input inputMode="numeric" placeholder="0" aria-label={`Jumlah tujuan ${v.variant_label}`}
                                    value={line.toQty[v.variant_id] ?? ''}
                                    onChange={(e) => patch(line.key, { toQty: { ...line.toQty, [v.variant_id]: e.target.value } })} />
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </>
                    )}
                  </>
                )}

                {res.error && fp && <p className="muted transfer-err">{res.error}</p>}
                {lines.length > 1 && (
                  <button type="button" className="danger-outline" onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}>Hapus baris</button>
                )}
              </fieldset>
            )
          })}

          <button type="button" onClick={() => setLines((ls) => [...ls, newLine()])}>+ Tambah barang</button>
          <label>Catatan (opsional)
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="mis. diambil untuk jualan offline" />
          </label>
          <p className="edit-total">Total: <b>{grandTotal} pcs</b> dari {fromStore.nama} ke {toStore.nama}</p>
          <button type="submit" className="primary" disabled={busy || !allValid}>
            {busy ? 'Memproses…' : 'Transfer sekarang'}
          </button>
        </form>
      )}

      <h2>Riwayat transfer</h2>
      {history.length === 0 && <p className="muted">Belum ada transfer.</p>}
      <ul className="sales">
        {history.map((t) => (
          <li key={t.id} className="card transfer-history">
            <b>{storeName(t.from_store_id)} → {storeName(t.to_store_id)}</b>
            <small className="muted"> · {formatDateTimeJakarta(t.created_at)}{t.created_by_name ? ` · ${t.created_by_name}` : ''}{t.note ? ` · ${t.note}` : ''}</small>
            <ul>
              {t.detail.map((d, i) => (
                <li key={i}>
                  {d.from.map((f) => `${f.name} (${f.label}) ×${f.qty}`).join(', ')}
                  {' → '}
                  {d.to.map((x) => `${x.name} (${x.label}) ×${x.qty}`).join(', ')}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
