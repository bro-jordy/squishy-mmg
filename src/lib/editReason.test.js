import test from 'node:test'
import assert from 'node:assert/strict'
import { autoReason } from './editReason.js'

const sale = (over = {}) => ({
  customer_name: null, payment_method: null, payment_status: 'unpaid',
  sale_items: [{ variant_id: 'v1', sku: 'A1', product_name: 'Kiwi', variant_label: 'Pink', qty: 1, unit_price: 40000 }],
  ...over,
})
const items = (over = {}) => [{ variantId: 'v1', sku: 'A1', label: 'Kiwi · Pink', qty: '1', price: '40000', ...over }]
const base = (o = {}) => ({ sale: sale(), customer: '', items: items(), method: 'unpaid', confirmed: false, ...o })

test('tanpa perubahan: alasan kosong', () => assert.equal(autoReason(base()), ''))
test('nama baru / ganti / hapus', () => {
  assert.equal(autoReason(base({ customer: 'April' })), 'Tambah nama pembeli (April)')
  assert.equal(autoReason(base({ sale: sale({ customer_name: 'Apri' }), customer: 'April' })), 'Ganti nama pembeli (Apri → April)')
  assert.equal(autoReason(base({ sale: sale({ customer_name: 'Apri' }), customer: ' ' })), 'Hapus nama pembeli (Apri)')
})
test('ganti SKU/varian, qty, harga, dan pembayaran', () => {
  assert.equal(autoReason(base({ items: [{ variantId: 'v2', sku: 'A2', label: 'Kiwi · Biru', qty: '1', price: '40000' }] })),
    'Ganti barang A1 Kiwi · Pink → A2 Kiwi · Biru')
  assert.equal(autoReason(base({ items: items({ qty: '3', price: '35000' }) })),
    'Ubah qty A1 Kiwi · Pink 1 → 3; Ubah harga A1 Kiwi · Pink 40000 → 35000')
  assert.equal(autoReason(base({ method: 'cash' })), 'Ubah pembayaran Belum bayar → Tunai')
})
