import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { adjust, initState, movementsFor, stockMap, stockOf, StockError } from './stockLogic.js'

const seed = JSON.parse(readFileSync(new URL('../data/local-seed.json', import.meta.url), 'utf8'))
const v = seed.variants[0] // stok awal 6
const base = () => initState(seed, new Date('2026-10-17T00:00:00Z'))

test('stok awal = stock seed, tercatat sebagai movement opening', () => {
  const s = base()
  assert.equal([...stockMap(s).values()].reduce((a, b) => a + b, 0), 388)
  assert.equal(stockOf(s, v.id), v.stock)
  assert.ok(s.movements.every((m) => m.movement_type === 'opening'))
})

test('barang masuk menambah stok dan tercatat dengan alasan', () => {
  const r = adjust(base(), { variantId: v.id, type: 'restock', delta: 4, reason: ' Barang masuk ' })
  assert.equal(r.stock, v.stock + 4)
  assert.equal(stockOf(r.state, v.id), v.stock + 4)
  const last = movementsFor(r.state, v.id)[0]
  assert.equal(last.reason, 'Barang masuk')
  assert.equal(last.qty_delta, 4)
})

test('state lama tidak berubah (immutable)', () => {
  const s = base()
  adjust(s, { variantId: v.id, type: 'restock', delta: 1, reason: 'x' })
  assert.equal(stockOf(s, v.id), v.stock)
})

test('alasan wajib', () => {
  for (const reason of ['', '   ', undefined]) {
    assert.throws(() => adjust(base(), { variantId: v.id, type: 'restock', delta: 1, reason }), StockError)
  }
})

test('stok tidak boleh minus', () => {
  assert.throws(
    () => adjust(base(), { variantId: v.id, type: 'damaged', delta: -(v.stock + 1), reason: 'rusak' }),
    /minus/,
  )
  const r = adjust(base(), { variantId: v.id, type: 'damaged', delta: -v.stock, reason: 'rusak semua' })
  assert.equal(r.stock, 0)
})

test('tanda jumlah sesuai jenis; 0 dan pecahan ditolak', () => {
  const a = { variantId: v.id, reason: 'x' }
  assert.throws(() => adjust(base(), { ...a, type: 'restock', delta: -1 }), StockError)
  assert.throws(() => adjust(base(), { ...a, type: 'damaged', delta: 1 }), StockError)
  assert.throws(() => adjust(base(), { ...a, type: 'adjustment', delta: 0 }), StockError)
  assert.throws(() => adjust(base(), { ...a, type: 'adjustment', delta: 1.5 }), StockError)
  assert.throws(() => adjust(base(), { ...a, type: 'bebas', delta: 1 }), StockError)
  assert.equal(adjust(base(), { ...a, type: 'adjustment', delta: -2 }).stock, v.stock - 2)
})

test('riwayat: terbaru dulu dan dibatasi', () => {
  let s = base()
  for (let i = 1; i <= 5; i++) {
    s = adjust(s, { variantId: v.id, type: 'restock', delta: i, reason: `masuk ${i}` }).state
  }
  const h = movementsFor(s, v.id, 3)
  assert.deepEqual(h.map((m) => m.reason), ['masuk 5', 'masuk 4', 'masuk 3'])
})
