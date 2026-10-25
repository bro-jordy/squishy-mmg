import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkout, confirmPayment, editSale, filterByPayment, salesInRange, voidSale, SaleError } from './salesLogic.js'
import { initState, stockOf, stockMap } from './stockLogic.js'
import { updateProduct, updateVariant } from './masterLogic.js'
import { jakartaDateKey, jakartaDayRange } from './format.js'
import { newId } from './uuid.js'

const seed = JSON.parse(readFileSync(new URL('../data/local-seed.json', import.meta.url), 'utf8'))
const NOW = new Date('2026-10-17T03:00:00Z') // 10:00 WIB
const base = () => initState(seed, NOW)
const vid = (state, sku, warna) => {
  const p = state.products.find((x) => x.sku === sku)
  return state.variants.find((v) => v.product_id === p.id && (warna === undefined || v.warna === warna)).id
}
const buy = (state, items, extra = {}) =>
  checkout(state, { idempotencyKey: newId(), paymentMethod: 'cash', items, ...extra }, NOW)

test('checkout hanya mengurangi stok varian yang dipilih (satu SKU, banyak varian)', () => {
  const s = base()
  const ungu = vid(s, 'A12', 'Ungu')
  const biru = vid(s, 'A12', 'Biru')
  const r = buy(s, [{ variantId: ungu, qty: 1 }])
  assert.equal(stockOf(r.state, ungu), stockOf(s, ungu) - 1)
  assert.equal(stockOf(r.state, biru), stockOf(s, biru))
  const sale = r.state.sales[0]
  assert.equal(sale.total, 35000)
  assert.equal(sale.sale_items[0].variant_label, 'Maltose · Ungu')
  assert.equal(sale.payment_status, 'confirmed')
})

test('checkout ditolak bila stok kurang dan state tidak berubah', () => {
  const s = base()
  const v = vid(s, 'A12', 'Hijau') // stok 1
  const before = JSON.stringify(s)
  assert.throws(() => buy(s, [{ variantId: v, qty: 2 }]), /Stok tidak cukup/)
  assert.equal(JSON.stringify(s), before)
  // item kembar digabung sebelum dicek: 1 + 1 > stok 1
  assert.throws(() => buy(s, [{ variantId: v, qty: 1 }, { variantId: v, qty: 1 }]), /Stok tidak cukup/)
})

test('key yang sama tidak membuat transaksi ganda dan stok tidak berkurang dua kali', () => {
  const s = base()
  const v = vid(s, 'A25')
  const key = newId()
  const a = checkout(s, { idempotencyKey: key, paymentMethod: 'cash', items: [{ variantId: v, qty: 2 }] }, NOW)
  const b = checkout(a.state, { idempotencyKey: key, paymentMethod: 'cash', items: [{ variantId: v, qty: 2 }] }, NOW)
  assert.equal(b.created, false)
  assert.equal(b.saleId, a.saleId)
  assert.equal(b.state.sales.length, 1)
  assert.equal(stockOf(b.state, v), stockOf(s, v) - 2)
})

test('QRIS yang belum dikonfirmasi tercatat unconfirmed; cash selalu confirmed', () => {
  const s = base()
  const v = vid(s, 'A25')
  const q = checkout(s, { idempotencyKey: newId(), paymentMethod: 'qris', paymentConfirmed: false, items: [{ variantId: v, qty: 1 }] }, NOW)
  assert.equal(q.state.sales[0].payment_status, 'unconfirmed')
  assert.equal(q.state.sales[0].payment_confirmed_at, null)
  const done = confirmPayment(q.state, q.saleId, NOW)
  assert.equal(done.sales[0].payment_status, 'confirmed')
  const c = checkout(s, { idempotencyKey: newId(), paymentMethod: 'cash', paymentConfirmed: false, items: [{ variantId: v, qty: 1 }] }, NOW)
  assert.equal(c.state.sales[0].payment_status, 'confirmed')
})

test('void mengembalikan stok tepat sekali, wajib alasan, transaksi tetap ada', () => {
  const s = base()
  const v = vid(s, 'A25')
  const r = buy(s, [{ variantId: v, qty: 3 }])
  assert.throws(() => voidSale(r.state, { saleId: r.saleId, reason: '  ' }), /Alasan/)
  const v1 = voidSale(r.state, { saleId: r.saleId, reason: 'salah input' }, NOW)
  const v2 = voidSale(v1.state, { saleId: r.saleId, reason: 'salah input' }, NOW) // klik dua kali
  assert.equal(stockOf(v2.state, v), stockOf(s, v))
  assert.equal(v2.state.sales.length, 1)
  assert.equal(v2.state.sales[0].status, 'void')
  assert.equal(v2.state.sales[0].void_reason, 'salah input')
  assert.equal(v2.state.movements.filter((m) => m.sale_id === r.saleId).length, 2)
  assert.throws(() => voidSale(r.state, { saleId: 'nope', reason: 'x' }), /tidak ditemukan/)
})

test('harga historis tidak berubah saat harga produk diedit', () => {
  const s = base()
  const v = vid(s, 'A12', 'Ungu')
  const r = buy(s, [{ variantId: v, qty: 1 }])
  const p = r.state.products.find((x) => x.sku === 'A12')
  const edited = updateProduct(r.state, { id: p.id, sku: p.sku, name: p.name, price: 99000 })
  assert.equal(edited.sales[0].sale_items[0].unit_price, 35000)
  assert.equal(edited.sales[0].total, 35000)
  const r2 = buy(edited, [{ variantId: v, qty: 1 }])
  assert.equal(r2.state.sales[1].total, 99000)
})

test('barang/varian nonaktif dan input salah ditolak', () => {
  const s = base()
  const v = vid(s, 'A25')
  const p = s.products.find((x) => x.sku === 'A25')
  const offProduct = updateProduct(s, { id: p.id, sku: p.sku, name: p.name, price: p.price, is_active: false })
  assert.throws(() => buy(offProduct, [{ variantId: v, qty: 1 }]), /nonaktif/)
  const offVariant = updateVariant(s, { id: v, varian: null, warna: 'Kuning', is_active: false })
  assert.throws(() => buy(offVariant, [{ variantId: v, qty: 1 }]), /nonaktif/)
  assert.throws(() => buy(s, []), /Keranjang kosong/)
  assert.throws(() => buy(s, [{ variantId: v, qty: 0 }]), SaleError)
  assert.throws(() => buy(s, [{ variantId: v, qty: 1.5 }]), SaleError)
  assert.throws(() => buy(s, [{ variantId: 'nope', qty: 1 }]), /tidak ditemukan/)
  assert.throws(() => checkout(s, { idempotencyKey: newId(), paymentMethod: 'kartu', items: [{ variantId: v, qty: 1 }] }, NOW), /Metode/)
})

test('nomor transaksi berurutan per hari Jakarta dan reset di hari berikutnya', () => {
  let s = base()
  const v = vid(s, 'A27') // dumpling, stok 120
  s = buy(s, [{ variantId: v, qty: 1 }]).state
  s = buy(s, [{ variantId: v, qty: 1 }]).state
  assert.deepEqual(s.sales.map((x) => x.sale_no), ['MMG-261017-0001', 'MMG-261017-0002'])
  // 17:30 UTC = 00:30 WIB hari berikutnya
  const late = new Date('2026-10-17T17:30:00Z')
  const r = checkout(s, { idempotencyKey: newId(), paymentMethod: 'cash', items: [{ variantId: v, qty: 1 }] }, late)
  assert.equal(r.state.sales[2].sale_no, 'MMG-261018-0001')
  assert.equal(jakartaDateKey(late), '2026-10-18')
})

test('stok tidak pernah minus lewat rangkaian jual dan void', () => {
  let s = base()
  const v = vid(s, 'A12', 'Hijau') // stok 1
  const a = buy(s, [{ variantId: v, qty: 1 }])
  assert.throws(() => buy(a.state, [{ variantId: v, qty: 1 }]), /sisa 0/)
  const back = voidSale(a.state, { saleId: a.saleId, reason: 'batal' }, NOW).state
  s = buy(back, [{ variantId: v, qty: 1 }]).state
  assert.ok([...stockMap(s).values()].every((n) => n >= 0))
})

test('rentang tanggal Jakarta', () => {
  let s = base()
  const v = vid(s, 'A27')
  s = buy(s, [{ variantId: v, qty: 1 }]).state
  s = checkout(s, { idempotencyKey: newId(), paymentMethod: 'cash', items: [{ variantId: v, qty: 1 }] }, new Date('2026-10-17T17:30:00Z')).state
  assert.equal(salesInRange(s, '2026-10-17', '2026-10-17').length, 1)
  assert.equal(salesInRange(s, '2026-10-18', '2026-10-18').length, 1)
  assert.equal(salesInRange(s, '2026-10-17', '2026-10-18').length, 2)
  assert.deepEqual(jakartaDayRange('2026-10-17', '2026-10-17'),
    { start: '2026-10-16T17:00:00.000Z', end: '2026-10-17T17:00:00.000Z' })
})

test('newId: format UUID v4 dan unik', () => {
  const ids = new Set(Array.from({ length: 50 }, newId))
  assert.equal(ids.size, 50)
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('edit transaksi: metode, nominal, item; stok mengikuti dan total dihitung ulang', () => {
  const s = base()
  const ungu = vid(s, 'A12', 'Ungu')
  const biru = vid(s, 'A12', 'Biru')
  const r = buy(s, [{ variantId: ungu, qty: 1 }])
  const e1 = editSale(r.state, {
    saleId: r.saleId, paymentMethod: 'qris', paymentConfirmed: true, reason: 'koreksi',
    items: [{ variantId: ungu, qty: 2, unitPrice: 30000 }],
  }, NOW)
  const sale = e1.state.sales[0]
  assert.equal(sale.total, 60000)
  assert.equal(sale.payment_method, 'qris')
  assert.equal(sale.payment_status, 'confirmed')
  assert.ok(sale.edited_at)
  assert.equal(stockOf(e1.state, ungu), stockOf(s, ungu) - 2)

  // ganti barang Ungu -> Biru; QRIS belum dikonfirmasi
  const e2 = editSale(e1.state, {
    saleId: r.saleId, paymentMethod: 'qris', paymentConfirmed: false, reason: 'salah warna',
    items: [{ variantId: biru, qty: 1, unitPrice: 35000 }],
  }, NOW)
  assert.equal(stockOf(e2.state, ungu), stockOf(s, ungu))
  assert.equal(stockOf(e2.state, biru), stockOf(s, biru) - 1)
  assert.equal(e2.state.sales[0].payment_status, 'unconfirmed')
  assert.equal(e2.state.sales[0].payment_confirmed_at, null)
  assert.equal(e2.state.sales[0].sale_items.length, 1)

  // tunai selalu terkonfirmasi
  const e3 = editSale(e2.state, {
    saleId: r.saleId, paymentMethod: 'cash', paymentConfirmed: false, reason: 'tunai',
    items: [{ variantId: biru, qty: 1, unitPrice: 35000 }],
  }, NOW)
  assert.equal(e3.state.sales[0].payment_status, 'confirmed')
  // ledger tetap sama dengan saldo
  for (const [id, n] of stockMap(e3.state)) {
    const sum = e3.state.movements.filter((m) => m.variant_id === id).reduce((a, m) => a + m.qty_delta, 0)
    assert.equal(sum, n)
  }
})

test('edit transaksi: validasi, stok kurang, dan transaksi void ditolak tanpa mengubah state', () => {
  const s = base()
  const v = vid(s, 'A25')
  const r = buy(s, [{ variantId: v, qty: 1 }])
  const ok = { saleId: r.saleId, paymentMethod: 'cash', reason: 'x', items: [{ variantId: v, qty: 1, unitPrice: 1000 }] }
  assert.throws(() => editSale(r.state, { ...ok, reason: ' ' }), /Alasan/)
  assert.throws(() => editSale(r.state, { ...ok, paymentMethod: 'transfer' }), /Metode/)
  assert.throws(() => editSale(r.state, { ...ok, items: [] }), /minimal satu/)
  assert.throws(() => editSale(r.state, { ...ok, items: [{ variantId: v, qty: 0, unitPrice: 1 }] }), /qty/)
  assert.throws(() => editSale(r.state, { ...ok, items: [ok.items[0], ok.items[0]] }), /dua kali/)
  assert.throws(() => editSale(r.state, { ...ok, items: [{ variantId: v, qty: stockOf(r.state, v) + 5, unitPrice: 1 }] }), /Stok tidak cukup/)
  assert.throws(() => editSale(r.state, { ...ok, saleId: 'nope' }), /tidak ditemukan/)
  const voided = voidSale(r.state, { saleId: r.saleId, reason: 'batal' }, NOW)
  assert.throws(() => editSale(voided.state, ok), /transaksi selesai/)
})

test('filter pembayaran: semua / tunai / QRIS', () => {
  const s = base()
  const v = vid(s, 'A25')
  const a = buy(s, [{ variantId: v, qty: 1 }])
  const b = checkout(a.state, { idempotencyKey: newId(), paymentMethod: 'qris', paymentConfirmed: true, items: [{ variantId: v, qty: 1 }] }, NOW)
  const all = b.state.sales
  assert.equal(filterByPayment(all, 'all').length, 2)
  assert.deepEqual(filterByPayment(all, 'cash').map((x) => x.payment_method), ['cash'])
  assert.deepEqual(filterByPayment(all, 'qris').map((x) => x.payment_method), ['qris'])
})
