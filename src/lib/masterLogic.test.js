import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { addVariant, createProduct, normText, updateProduct, updateVariant, InputError } from './masterLogic.js'
import { adjust, initState, stockMap, stockOf } from './stockLogic.js'
import { buildCatalog } from './catalog.js'

const seed = JSON.parse(readFileSync(new URL('../data/local-seed.json', import.meta.url), 'utf8'))
const base = () => initState(seed, new Date('2026-10-17T00:00:00Z'))
const catalog = (state) => {
  const m = stockMap(state)
  return buildCatalog({
    products: state.products,
    variants: state.variants.map((v) => ({ ...v, stock: m.get(v.id) ?? 0 })),
  })
}
const input = (extra = {}) => ({
  sku: ' Z1 ', name: ' Squishy Baru ', price: '45000',
  variants: [
    { varian: 'Maltose', warna: 'Pink', stock: '3' },
    { varian: '-', warna: 'Biru', stock: 2 },
    { varian: '', warna: '', stock: '' },
  ],
  ...extra,
})

test('normText: kosong dan "-" jadi null', () => {
  assert.equal(normText(' - '), null)
  assert.equal(normText(''), null)
  assert.equal(normText(undefined), null)
  assert.equal(normText(' Pink '), 'Pink')
})

test('createProduct: produk + varian + stok awal tercatat sebagai opening', () => {
  const { state, productId } = createProduct(base(), input(), new Date('2026-10-18T00:00:00Z'))
  const p = state.products.find((x) => x.id === productId)
  assert.deepEqual([p.sku, p.name, p.price, p.is_active], ['Z1', 'Squishy Baru', 45000, true])
  const vs = state.variants.filter((v) => v.product_id === productId)
  assert.equal(vs.length, 3)
  assert.equal(vs.find((v) => v.warna === 'Biru').varian, null)
  assert.equal(vs.reduce((n, v) => n + stockOf(state, v.id), 0), 5)
  const openings = state.movements.filter((m) => vs.some((v) => v.id === m.variant_id))
  assert.equal(openings.length, 2) // varian stok 0 tidak punya movement
  assert.ok(openings.every((m) => m.movement_type === 'opening'))
})

test('createProduct: tidak mengubah state lama dan id tidak bentrok', () => {
  const s = base()
  const before = JSON.stringify(s)
  const a = createProduct(s, input())
  assert.equal(JSON.stringify(s), before)
  const b = createProduct(a.state, input({ sku: 'Z2' }))
  const ids = [...b.state.products.map((p) => p.id), ...b.state.variants.map((v) => v.id)]
  assert.equal(new Set(ids).size, ids.length)
})

test('createProduct: duplikat SKU+nama (tanpa beda huruf besar) ditolak', () => {
  const { state } = createProduct(base(), input())
  assert.throws(() => createProduct(state, input({ sku: 'z1', name: 'SQUISHY BARU' })), /sudah ada/)
})

test('createProduct: input salah ditolak', () => {
  const s = base()
  assert.throws(() => createProduct(s, input({ sku: '' })), InputError)
  assert.throws(() => createProduct(s, input({ price: '-1' })), /Harga/)
  assert.throws(() => createProduct(s, input({ price: '12.5' })), /Harga/)
  assert.throws(() => createProduct(s, input({ price: '' })), /Harga/)
  assert.throws(() => createProduct(s, input({ variants: [] })), /varian/)
  assert.throws(() => createProduct(s, input({ variants: [{ warna: 'x', stock: -1 }] })), /Stok awal/)
  assert.throws(() => createProduct(s, input({ variants: [{ warna: 'Pink' }, { warna: 'pink' }] })), /kembar/)
})

test('addVariant: stok awal jadi opening; varian kembar ditolak', () => {
  const s = base()
  const pid = s.products.find((p) => p.sku === 'A12').id
  const { state, variantId } = addVariant(s, { productId: pid, varian: 'Maltose', warna: 'Putih', stock: '4' })
  assert.equal(stockOf(state, variantId), 4)
  assert.throws(() => addVariant(state, { productId: pid, varian: 'maltose', warna: 'PUTIH' }), /sudah ada/)
  assert.throws(() => addVariant(s, { productId: 'nope', warna: 'x' }), /tidak ditemukan/)
  assert.throws(() => addVariant(s, { productId: pid, warna: 'x', stock: -1 }), /Stok awal/)
})

test('updateProduct: ubah harga & nonaktifkan; duplikat ditolak', () => {
  const s = base()
  const a12 = s.products.find((p) => p.sku === 'A12')
  const s2 = updateProduct(s, { id: a12.id, sku: 'A12', name: a12.name, price: '36000', is_active: false })
  assert.equal(s2.products.find((p) => p.id === a12.id).price, 36000)
  const rows = catalog(s2).filter((r) => r.sku === 'A12')
  assert.ok(rows.every((r) => !r.is_sellable && !r.product_active))
  const other = s.products.find((p) => p.sku === 'A13')
  assert.throws(() => updateProduct(s, { id: other.id, sku: 'a12', name: a12.name.toUpperCase(), price: 1 }), /sudah ada/)
  // nama sendiri tidak dianggap duplikat
  assert.doesNotThrow(() => updateProduct(s, { id: a12.id, sku: 'A12', name: a12.name, price: 1 }))
})

test('updateVariant: nonaktifkan satu varian; duplikat ditolak', () => {
  const s = base()
  const pid = s.products.find((p) => p.sku === 'A12').id
  const [v1, v2] = s.variants.filter((v) => v.product_id === pid)
  const s2 = updateVariant(s, { id: v1.id, varian: v1.varian, warna: v1.warna, is_active: false })
  const rows = catalog(s2).filter((r) => r.product_id === pid)
  assert.equal(rows.filter((r) => !r.variant_active).length, 1)
  assert.throws(() => updateVariant(s, { id: v1.id, varian: v2.varian, warna: v2.warna.toUpperCase() }), /sudah ada/)
})

test('retur ke pemilik: mengurangi stok, wajib alasan, tak boleh minus', () => {
  const s = base()
  const v = s.variants[0]
  const r = adjust(s, { variantId: v.id, type: 'return_owner', delta: -v.stock_awal, reason: 'Retur ke pemilik' })
  assert.equal(r.stock, 0)
  assert.throws(() => adjust(s, { variantId: v.id, type: 'return_owner', delta: -(v.stock_awal + 1), reason: 'x' }), /minus/)
  assert.throws(() => adjust(s, { variantId: v.id, type: 'return_owner', delta: 1, reason: 'x' }), /mengurangi/)
  assert.throws(() => adjust(s, { variantId: v.id, type: 'return_owner', delta: -1, reason: ' ' }), /Alasan/)
  assert.throws(() => adjust(s, { variantId: 'nope', type: 'restock', delta: 1, reason: 'x' }), /tidak ditemukan/)
})

test('katalog: produk baru muncul dengan aturan tampilan yang sama', () => {
  const { state } = createProduct(base(), input({
    sku: 'Z9', name: 'Squishy Tes',
    variants: [{ varian: 'Maltose', warna: 'Pink', stock: 1 }, { varian: 'Maltose', warna: 'Biru', stock: 1 }],
  }))
  const rows = catalog(state).filter((r) => r.sku === 'Z9')
  assert.equal(rows[0].display_name, 'Squishy Tes · Maltose')
  assert.deepEqual(rows.map((r) => r.variant_label).sort(), ['Biru', 'Pink'])
})
