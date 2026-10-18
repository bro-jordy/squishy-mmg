import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildCatalog } from './catalog.js'

const seed = JSON.parse(readFileSync(new URL('../data/local-seed.json', import.meta.url), 'utf8'))
const rows = buildCatalog(seed)
const bySku = (sku) => rows.filter((r) => r.sku === sku)

test('seed: 25 produk, 73 varian, tanpa duplikat Roti Spiral', () => {
  assert.equal(seed.products.length, 25)
  assert.equal(rows.length, 73)
  assert.equal(bySku('A1').length, 13)
})

test('A95 dan A17 tampil sebagai dua produk berbeda dengan harga masing-masing', () => {
  assert.equal(bySku('A95')[0].display_name, 'Squishy Cheese Cube · Coconut Oil')
  assert.equal(bySku('A95')[0].price, 50000)
  assert.equal(bySku('A17')[0].display_name, 'Squishy Cheese Cube')
  assert.equal(bySku('A17')[0].price, 35000)
})

test('A33: satu produk dengan 6 varian bentuk', () => {
  const a33 = bySku('A33')
  assert.equal(a33.length, 6)
  assert.equal(new Set(a33.map((r) => r.product_id)).size, 1)
  assert.deepEqual(a33.map((r) => r.variant_label).sort(),
    ['Bar', 'Hersey', 'Kit Kat', 'KKUNKK', 'Reeses', 'Sneakers'].sort())
})

test('varian campur memakai label gabungan; varian sama jadi judul', () => {
  assert.deepEqual(bySku('A9').map((r) => r.variant_label).sort(),
    ['Coconut Oil · Coklat', 'Crunchy · Krem'])
  assert.equal(bySku('A26')[0].display_name, 'Squishy Fruit · Coconut Oil')
  assert.deepEqual(bySku('A26').map((r) => r.variant_label).sort(), ['Hijau', 'Pink'])
  assert.equal(bySku('A27')[0].variant_label, 'Standar')
})

test('stok awal total 388 dan semua bisa dijual', () => {
  assert.equal(rows.reduce((n, r) => n + r.stock, 0), 388)
  assert.ok(rows.every((r) => r.is_sellable))
})
