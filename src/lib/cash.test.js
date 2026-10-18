import test from 'node:test'
import assert from 'node:assert/strict'
import { cashChange, cashSuggestions, formatDigits, parseRupiah } from './cash.js'

test('parseRupiah membaca angka dari isian apa adanya', () => {
  assert.equal(parseRupiah('100.000'), 100000)
  assert.equal(parseRupiah('Rp 50000'), 50000)
  assert.equal(parseRupiah(' 5 000 '), 5000)
  assert.equal(parseRupiah(''), null)
  assert.equal(parseRupiah('abc'), null)
  assert.equal(parseRupiah(undefined), null)
  assert.equal(parseRupiah('0'), 0)
})

test('formatDigits memakai titik ribuan', () => {
  assert.equal(formatDigits(100000), '100.000')
  assert.equal(formatDigits(5000), '5.000')
  assert.equal(formatDigits(0), '0')
  assert.equal(formatDigits(null), '')
})

test('kembalian: cukup, pas, kurang, belum diisi', () => {
  assert.deepEqual(cashChange(100000, 35000), { change: 65000, short: 0 })
  assert.deepEqual(cashChange(35000, 35000), { change: 0, short: 0 })
  assert.deepEqual(cashChange(20000, 35000), { change: 0, short: 15000 })
  assert.equal(cashChange(null, 35000), null)
  assert.deepEqual(cashChange(0, 5000), { change: 0, short: 5000 })
})

test('saran nominal: pecahan umum di atas total, tanpa duplikat, terkecil dulu', () => {
  assert.deepEqual(cashSuggestions(35000), [40000, 50000, 100000])
  assert.deepEqual(cashSuggestions(5000), [10000, 20000, 50000, 100000])
  assert.deepEqual(cashSuggestions(22000), [25000, 30000, 40000, 50000])
  assert.deepEqual(cashSuggestions(120000), [150000, 200000])
  assert.deepEqual(cashSuggestions(57000), [60000, 100000])
  assert.deepEqual(cashSuggestions(100000), [150000, 200000])
  assert.deepEqual(cashSuggestions(200000), [250000, 300000])
  assert.deepEqual(cashSuggestions(0), [])
  assert.deepEqual(cashSuggestions(-5), [])
  assert.ok(cashSuggestions(35000).every((n) => n > 35000))
  assert.equal(cashSuggestions(22000, 2).length, 2)
})
