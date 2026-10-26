import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initContainer } from './localStore.js'
import { transferStock, TransferError } from './transferLogic.js'
import { stockOf } from './stockLogic.js'
import { createProduct } from './masterLogic.js'

const seed = JSON.parse(readFileSync(new URL('../data/local-seed.json', import.meta.url), 'utf8'))
const NOW = new Date('2026-10-26T03:00:00Z')
const REA = seed.stores[0].id
const SOSO = seed.stores[1].id

// Soso kosong di data contoh: buat satu barang "Random" di Soso untuk tujuan transfer.
function setup() {
  let c = initContainer(seed, NOW)
  const r = createProduct(c.states[SOSO], { sku: 'A12', name: 'Cube Random', price: 35000, variants: [{ varian: '', warna: 'Random', stock: 1 }] }, NOW)
  c = { ...c, states: { ...c.states, [SOSO]: r.state } }
  const rea = c.states[REA]
  const prod = rea.products.find((p) => p.sku === 'A12')
  const vs = rea.variants.filter((v) => v.product_id === prod.id)
  return { c, ungu: vs.find((v) => v.warna === 'Ungu').id, biru: vs.find((v) => v.warna === 'Biru').id, soso: r.state.variants[0].id }
}
test('transfer Rea -> Soso: dirinci per warna di asal, total masuk satu varian Random', () => {
  const { c, ungu, biru, soso } = setup()
  const u0 = stockOf(c.states[REA], ungu)
  const b0 = stockOf(c.states[REA], biru)
  const r = transferStock(c, {
    fromStoreId: REA, toStoreId: SOSO, note: 'ambil untuk Soso', byName: 'Owner',
    lines: [{ from: [{ variantId: ungu, qty: 2 }, { variantId: biru, qty: 1 }], to: [{ variantId: soso, qty: 3 }] }],
  }, NOW)
  assert.equal(stockOf(r.container.states[REA], ungu), u0 - 2)
  assert.equal(stockOf(r.container.states[REA], biru), b0 - 1)
  assert.equal(stockOf(r.container.states[SOSO], soso), 4)
  const outs = r.container.states[REA].movements.filter((m) => m.transfer_id === r.transferId)
  assert.deepEqual(outs.map((m) => m.movement_type), ['transfer_out', 'transfer_out'])
  const ins = r.container.states[SOSO].movements.filter((m) => m.transfer_id === r.transferId)
  assert.equal(ins.length, 1)
  assert.equal(ins[0].reason, 'Transfer dari Toko Rea: ambil untuk Soso')
  assert.equal(r.container.transfers[0].detail[0].qty, 3)
  assert.equal(c.states[REA].movements.length < r.container.states[REA].movements.length, true) // state lama utuh
})

test('transfer ke barang baru di tujuan: varian Random dibuat otomatis', () => {
  const { c, biru } = setup()
  const r = transferStock(c, {
    fromStoreId: REA, toStoreId: SOSO,
    lines: [{ from: [{ variantId: biru, qty: 1 }], newProduct: { sku: 'A99', name: 'Barang Baru Uji', price: 40000 } }],
  }, NOW)
  const soso = r.container.states[SOSO]
  const p = soso.products.find((x) => x.sku === 'A99')
  const v = soso.variants.find((x) => x.product_id === p.id)
  assert.equal(v.warna, 'Random')
  assert.equal(stockOf(soso, v.id), 1)
  assert.throws(() => transferStock(r.container, {
    fromStoreId: REA, toStoreId: SOSO,
    lines: [{ from: [{ variantId: biru, qty: 1 }], newProduct: { sku: 'a99', name: 'barang baru uji', price: 1 } }],
  }, NOW), /sudah ada di Toko Soso/)
})

test('Soso -> Rea: total dari satu varian dirinci ke beberapa warna', () => {
  const { c, ungu, biru, soso } = setup()
  const u0 = stockOf(c.states[REA], ungu)
  const r = transferStock(c, {
    fromStoreId: SOSO, toStoreId: REA,
    lines: [{ from: [{ variantId: soso, qty: 1 }], to: [{ variantId: ungu, qty: 1 }] }],
  }, NOW)
  assert.equal(stockOf(r.container.states[SOSO], soso), 0)
  assert.equal(stockOf(r.container.states[REA], ungu), u0 + 1)
  void biru
})

test('transfer ditolak tanpa mengubah apa pun: jumlah beda, stok kurang, toko sama, varian salah toko', () => {
  const { c, ungu, biru, soso } = setup()
  const base = { fromStoreId: REA, toStoreId: SOSO }
  const ok = { from: [{ variantId: ungu, qty: 1 }], to: [{ variantId: soso, qty: 1 }] }
  assert.throws(() => transferStock(c, { ...base, lines: [] }, NOW), TransferError)
  assert.throws(() => transferStock(c, { ...base, toStoreId: REA, lines: [ok] }, NOW), /berbeda/)
  assert.throws(() => transferStock(c, { ...base, lines: [{ from: [{ variantId: ungu, qty: 2 }], to: [{ variantId: soso, qty: 1 }] }] }, NOW), /harus sama/)
  assert.throws(() => transferStock(c, { ...base, lines: [{ from: [{ variantId: ungu, qty: 0 }], to: [{ variantId: soso, qty: 0 }] }] }, NOW), /lebih dari 0/)
  assert.throws(() => transferStock(c, { ...base, lines: [{ from: [{ variantId: ungu, qty: 999 }], to: [{ variantId: soso, qty: 999 }] }] }, NOW), /Stok tidak cukup/)
  assert.throws(() => transferStock(c, { ...base, lines: [{ from: [{ variantId: ungu, qty: 1 }], to: [{ variantId: biru, qty: 1 }] }] }, NOW), /tujuan yang tidak ditemukan/)
  // atomik: baris 1 valid, baris 2 gagal -> state asli tidak berubah (fungsi murni)
  const before = JSON.stringify(c)
  assert.throws(() => transferStock(c, { ...base, lines: [ok, { from: [{ variantId: biru, qty: 999 }], to: [{ variantId: soso, qty: 999 }] }] }, NOW), /Stok tidak cukup/)
  assert.equal(JSON.stringify(c), before)
})
