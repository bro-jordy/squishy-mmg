import test from 'node:test'
import assert from 'node:assert/strict'
import { formatRupiah, stockStatus } from './format.js'

test('formatRupiah memakai titik ribuan', () => {
  assert.equal(formatRupiah(1104000), 'Rp 1.104.000')
  assert.equal(formatRupiah(5000), 'Rp 5.000')
  assert.equal(formatRupiah(0), 'Rp 0')
  assert.equal(formatRupiah(120), 'Rp 120')
  assert.equal(formatRupiah(-35000), '-Rp 35.000')
})

test('formatRupiah menolak bilangan pecahan', () => {
  assert.throws(() => formatRupiah(35000.5), TypeError)
})

test('stockStatus', () => {
  assert.equal(stockStatus(0).key, 'habis')
  assert.equal(stockStatus(2).key, 'menipis')
  assert.equal(stockStatus(3).key, 'ok')
})
