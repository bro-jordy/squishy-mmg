import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyLine, defaultToChoice, matchBySku, matchByName, validateLine, NEW_PRODUCT } from './transferForm.js'

const v = (id, label, stock, active = true) => ({ variant_id: id, variant_label: label, stock, variant_active: active })
const prod = (id, sku, variants, rawName = `Produk ${id}`) => ({ id, sku, name: rawName, rawName, variants })

const fromProducts = [prod('r1', 'A35', [v('rv1', 'Biru', 2), v('rv2', 'Merah', 1), v('rv3', 'Pink', 3)])]
const toProducts = [prod('s1', 'A35', [v('sv1', 'Random', 5)]), prod('s2', 'a35', [v('sv2', 'Random', 0)]), prod('s3', 'A12', [v('sv3', 'Ungu', 1), v('sv4', 'Biru', 1)])]
const ctx = { fromProducts, toProducts }
const line = (over) => ({ ...emptyLine('k'), fromProductId: 'r1', ...over })

test('tujuan otomatis hanya bila SKU punya tepat satu produk di tujuan', () => {
  assert.equal(matchBySku('A35', toProducts).length, 2) // beda huruf besar/kecil dianggap sama
  assert.equal(defaultToChoice(fromProducts[0], toProducts), '') // dua kandidat: harus dipilih
  assert.equal(defaultToChoice(fromProducts[0], [toProducts[0]]), 's1')
  assert.equal(defaultToChoice(fromProducts[0], [toProducts[2]]), '') // tidak ada: harus dipilih
})

test('rincian per warna di asal masuk total ke satu varian tujuan', () => {
  const r = validateLine(line({ fromQty: { rv1: '2', rv2: '1', rv3: '3' }, toChoice: 's1' }), ctx)
  assert.equal(r.error, null)
  assert.equal(r.total, 6)
  assert.deepEqual(r.payload.from.map((i) => i.qty), [2, 1, 3])
  assert.deepEqual(r.payload.to, [{ variantId: 'sv1', qty: 6 }])
})

test('tujuan banyak varian: jumlah harus dibagikan sama dengan total', () => {
  const l = line({ fromQty: { rv1: '2' }, toChoice: 's3', toQty: { sv3: '1' } })
  assert.match(validateLine(l, ctx).error, /Bagikan 2/)
  const ok = validateLine({ ...l, toQty: { sv3: '1', sv4: '1' } }, ctx)
  assert.equal(ok.error, null)
  assert.deepEqual(ok.payload.to, [{ variantId: 'sv3', qty: 1 }, { variantId: 'sv4', qty: 1 }])
})

test('barang baru di tujuan butuh SKU, nama, harga', () => {
  const base = line({ fromQty: { rv1: '1' }, toChoice: NEW_PRODUCT })
  assert.match(validateLine(base, ctx).error, /SKU dan nama/)
  assert.match(validateLine({ ...base, newSku: 'A95', newName: 'Cheese Cube', newPrice: 'x' }, ctx).error, /Harga/)
  const r = validateLine({ ...base, newSku: 'A95', newName: 'Cheese Cube', newPrice: '35000' }, ctx)
  assert.deepEqual(r.payload.newProduct, { sku: 'A95', name: 'Cheese Cube', price: 35000 })
  assert.equal(r.payload.to, undefined)
})

test('validasi: belum pilih, jumlah nol/melebihi stok/bukan angka', () => {
  assert.match(validateLine(emptyLine('k'), ctx).error, /barang asal/)
  assert.match(validateLine(line({ toChoice: 's1' }), ctx).error, /jumlah/i)
  assert.match(validateLine(line({ fromQty: { rv1: '0' }, toChoice: 's1' }), ctx).error, /jumlah/i)
  assert.match(validateLine(line({ fromQty: { rv1: '3' }, toChoice: 's1' }), ctx).error, /hanya 2/)
  assert.match(validateLine(line({ fromQty: { rv1: '1.5' }, toChoice: 's1' }), ctx).error, /angka bulat/)
  assert.match(validateLine(line({ fromQty: { rv1: '1' } }), ctx).error, /barang tujuan/)
})

test('SKU beda tapi nama sama: tujuan terpilih otomatis berdasarkan nama', () => {
  const rea = prod('r9', 'A12.1', [v('rv9', 'Pink', 2)], 'Squishy QQ Candy')
  const soso = [prod('s9', 'A12', [v('sv9', 'Random', 1)], 'SQUISHY QQ CANDY'), prod('s8', 'A12', [v('sv8', 'Random', 1)], 'ICE CUBE MALTOSE')]
  assert.equal(matchBySku('A12.1', soso).length, 0)
  assert.deepEqual(matchByName('Squishy QQ  Candy', soso).map((p) => p.id), ['s9']) // spasi ganda & huruf besar diabaikan
  assert.equal(defaultToChoice(rea, soso), 's9')
  // dua produk bernama sama: tidak ditebak
  assert.equal(defaultToChoice(rea, [...soso, prod('s7', 'A99', [v('sv7', 'Random', 1)], 'squishy qq candy')]), '')
  // SKU cocok mengalahkan nama
  assert.equal(defaultToChoice(prod('r1', 'A12', [], 'Lain'), soso), '') // dua SKU A12: pilih manual
})
