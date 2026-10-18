import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  addSettlement, allocateSettlements, cleanSettlement, dailySummary, deleteSettlement,
  periodRange, settlementBalance, splitShare, topProducts, ReportError,
} from './reportLogic.js'
import { checkout, voidSale } from './salesLogic.js'
import { initState } from './stockLogic.js'
import { newId } from './uuid.js'

const seed = JSON.parse(readFileSync(new URL('../data/local-seed.json', import.meta.url), 'utf8'))
const D16 = new Date('2026-10-16T03:00:00Z')
const D17 = new Date('2026-10-17T03:00:00Z')
const vid = (s, sku, warna) => {
  const p = s.products.find((x) => x.sku === sku)
  return s.variants.find((v) => v.product_id === p.id && (warna === undefined || v.warna === warna)).id
}
const sell = (s, sku, qty, when, warna, method = 'cash', confirmed = true) =>
  checkout(s, { idempotencyKey: newId(), paymentMethod: method, paymentConfirmed: confirmed,
    items: [{ variantId: vid(s, sku, warna), qty }] }, when)

// Meniru angka di spreadsheet: 16 Okt Rp 80.000, 17 Okt Rp 1.024.000
test('splitShare: 25% dibulatkan, jumlah selalu pas', () => {
  assert.deepEqual(splitShare(80000), { bagian_25: 20000, bagian_75: 60000 })
  assert.deepEqual(splitShare(1024000), { bagian_25: 256000, bagian_75: 768000 })
  assert.deepEqual(splitShare(22000), { bagian_25: 5500, bagian_75: 16500 })
  const odd = splitShare(35001) // 8750,25 -> 8750
  assert.equal(odd.bagian_25 + odd.bagian_75, 35001)
  assert.equal(splitShare(0).bagian_25, 0)
  assert.equal(splitShare(10, 25).bagian_25, 3) // 2,5 dibulatkan ke atas
})

test('dailySummary: hanya selesai & terkonfirmasi; void dan belum konfirmasi tidak ikut', () => {
  let s = initState(seed, D16)
  s = sell(s, 'A27', 2, D16).state                    // 10.000 (16 Okt)
  s = sell(s, 'A27', 4, D16).state                    // 20.000
  s = sell(s, 'A9', 1, D16, 'Krem').state             // 50.000 -> 16 Okt = 80.000
  s = sell(s, 'A88', 1, D17, 'Pink').state            // 120.000 (17 Okt)
  s = sell(s, 'A12', 1, D17, 'Ungu', 'qris', false).state // belum dikonfirmasi: tidak ikut
  const batal = sell(s, 'A25', 1, D17)                // 35.000 lalu di-void
  s = voidSale(batal.state, { saleId: batal.saleId, reason: 'batal' }, D17).state
  const days = dailySummary(s.sales)
  assert.deepEqual(days.map((d) => d.day), ['2026-10-16', '2026-10-17'])
  assert.deepEqual(days[0], { day: '2026-10-16', transaksi: 3, total_penjualan: 80000, bagian_25: 20000, bagian_75: 60000 })
  assert.equal(days[1].total_penjualan, 120000)
  assert.equal(days[1].transaksi, 1)
  const total = days.reduce((n, d) => n + d.total_penjualan, 0)
  assert.equal(days.reduce((n, d) => n + d.bagian_25 + d.bagian_75, 0), total) // tidak dihitung dua kali
})

test('setoran: saldo, status, dan alokasi hari terlama dulu', () => {
  const days = [
    { day: '2026-10-16', bagian_75: 60000 },
    { day: '2026-10-17', bagian_75: 768000 },
    { day: '2026-10-18', bagian_75: 0 },
  ]
  const st = (amount) => [{ share: 'bagian_75', amount }]
  assert.deepEqual(settlementBalance(days, []), { total_bagian_75: 828000, sudah_disetor: 0, sisa: 828000, status: 'belum' })
  assert.equal(settlementBalance(days, st(100000)).status, 'sebagian')
  assert.equal(settlementBalance(days, st(100000)).sisa, 728000)
  assert.equal(settlementBalance(days, st(828000)).status, 'lunas')
  assert.equal(settlementBalance(days, st(900000)).status, 'kelebihan')
  assert.equal(settlementBalance([], []).status, 'lunas')

  const alloc = allocateSettlements(days, 100000)
  assert.deepEqual(alloc.map((d) => [d.status, d.disetor, d.sisa]),
    [['lunas', 60000, 0], ['sebagian', 40000, 728000], ['kosong', 0, 0]])
  assert.equal(allocateSettlements(days, 0)[0].status, 'belum')
})

test('void setelah disetor menjadikan kelebihan setor, bukan error', () => {
  let s = initState(seed, D17)
  const a = sell(s, 'A88', 1, D17, 'Pink') // 120.000 -> 75% = 90.000
  s = a.state
  const days = dailySummary(s.sales)
  assert.equal(days[0].bagian_75, 90000)
  const paid = [{ share: 'bagian_75', amount: 90000 }]
  assert.equal(settlementBalance(days, paid).status, 'lunas')
  s = voidSale(s, { saleId: a.saleId, reason: 'refund' }, D17).state
  const after = settlementBalance(dailySummary(s.sales), paid)
  assert.equal(after.status, 'kelebihan')
  assert.equal(after.sisa, -90000)
})

test('topProducts: urut jumlah terjual, void dan belum konfirmasi tidak dihitung', () => {
  let s = initState(seed, D17)
  s = sell(s, 'A27', 5, D17).state
  s = sell(s, 'A27', 3, D17).state
  s = sell(s, 'A9', 1, D17, 'Krem').state
  s = sell(s, 'A12', 1, D17, 'Ungu', 'qris', false).state
  const top = topProducts(s.sales)
  assert.deepEqual(top.map((t) => [t.sku, t.qty, t.revenue]), [['A27', 8, 40000], ['A9', 1, 50000]])
  assert.equal(topProducts(s.sales, 1).length, 1)
})

test('periodRange memakai tanggal Jakarta', () => {
  assert.deepEqual(periodRange('hari', '2026-10-17'), { from: '2026-10-17', to: '2026-10-17' })
  assert.deepEqual(periodRange('7hari', '2026-10-17'), { from: '2026-10-11', to: '2026-10-17' })
  assert.deepEqual(periodRange('7hari', '2026-03-03'), { from: '2026-02-25', to: '2026-03-03' })
  assert.deepEqual(periodRange('bulan', '2026-10-17'), { from: '2026-10-01', to: '2026-10-17' })
})

test('catat & hapus setoran dengan validasi', () => {
  let s = initState(seed, D17)
  const a = addSettlement(s, { settled_on: '2026-10-17', amount: '50000', recipient: ' Pemilik ', note: '' }, D17)
  assert.equal(a.state.settlements.length, 1)
  assert.deepEqual([a.state.settlements[0].amount, a.state.settlements[0].recipient, a.state.settlements[0].note],
    [50000, 'Pemilik', null])
  assert.equal(a.state.settlements[0].share, 'bagian_75')
  const b = addSettlement(a.state, { settled_on: '2026-10-18', amount: 1000 }, D17)
  assert.notEqual(a.settlementId, b.settlementId)
  assert.equal(deleteSettlement(b.state, a.settlementId).settlements.length, 1)
  assert.throws(() => deleteSettlement(b.state, 'nope'), /tidak ditemukan/)
  for (const amount of [0, -5, 1.5, '', 'abc']) {
    assert.throws(() => cleanSettlement({ settled_on: '2026-10-17', amount }), ReportError)
  }
  assert.throws(() => cleanSettlement({ settled_on: 'kemarin', amount: 1 }), /Tanggal/)
  assert.throws(() => cleanSettlement({ settled_on: '2026-10-17', amount: 1, period_start: '2026-10-18', period_end: '2026-10-17' }), /Periode/)
})
