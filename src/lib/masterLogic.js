// Logika master barang untuk MODE LOKAL + validasi input yang dipakai kedua mode.
// Padanan create_product(), add_variant() dan aturan unik di db/schema.sql
// (SKU+nama unik, varian+warna unik per produk, tanpa membedakan huruf besar/kecil).
// Ubah keduanya bersamaan.
import { StockError } from './stockLogic.js'

export class InputError extends Error {}

// Teks kosong atau "-" (kebiasaan di spreadsheet) berarti "tidak ada".
export function normText(value) {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s === '' || s === '-' ? null : s
}

function toInt(value) {
  if (value === '' || value === null || value === undefined) return NaN
  return Number(value)
}

export function cleanProduct({ sku, name, price }) {
  const cleanSku = String(sku ?? '').trim()
  const cleanName = String(name ?? '').trim()
  if (!cleanSku || !cleanName) throw new InputError('SKU dan nama wajib diisi')
  const p = toInt(price)
  if (!Number.isInteger(p) || p < 0) throw new InputError('Harga harus bilangan bulat ≥ 0')
  return { sku: cleanSku, name: cleanName, price: p }
}

const variantKey = (v) => `${(v.varian ?? '').toLowerCase()}|${(v.warna ?? '').toLowerCase()}`

export function cleanVariant({ varian, warna, stock = 0 }) {
  const s = stock === '' ? 0 : toInt(stock)
  if (!Number.isInteger(s) || s < 0) throw new InputError('Stok awal harus bilangan bulat ≥ 0')
  return { varian: normText(varian), warna: normText(warna), stock: s }
}

export function cleanVariants(list) {
  if (!Array.isArray(list) || list.length === 0) throw new InputError('Minimal satu varian')
  const out = list.map(cleanVariant)
  const seen = new Set()
  for (const v of out) {
    const k = variantKey(v)
    if (seen.has(k)) throw new InputError('Ada varian dan warna yang kembar dalam satu produk')
    seen.add(k)
  }
  return out
}

const sameProduct = (a, b) =>
  a.sku.toLowerCase() === b.sku.toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase()

function assertProductFree(state, fields, exceptId = null) {
  if (state.products.some((p) => p.id !== exceptId && sameProduct(p, fields))) {
    throw new InputError('Produk dengan SKU dan nama itu sudah ada')
  }
}

function assertVariantFree(state, productId, fields, exceptId = null) {
  const k = variantKey(fields)
  if (state.variants.some((v) => v.product_id === productId && v.id !== exceptId && variantKey(v) === k)) {
    throw new InputError('Varian dan warna itu sudah ada di produk ini')
  }
}

function openingMovement(state, variantId, stock, now) {
  return {
    id: state.nextId,
    variant_id: variantId,
    movement_type: 'opening',
    qty_delta: stock,
    reason: 'Stok awal (master barang)',
    created_at: now.toISOString(),
  }
}

export function createProduct(state, input, now = new Date()) {
  const fields = cleanProduct(input)
  const variants = cleanVariants(input.variants)
  assertProductFree(state, fields)

  const productId = `p${state.nextProductNo}`
  let nextVariantNo = state.nextVariantNo
  let nextId = state.nextId
  const newVariants = []
  const newMovements = []
  for (const v of variants) {
    const id = `v${nextVariantNo++}`
    newVariants.push({ id, product_id: productId, varian: v.varian, warna: v.warna, stock_awal: v.stock, is_active: true })
    if (v.stock > 0) {
      newMovements.push(openingMovement({ nextId }, id, v.stock, now))
      nextId += 1
    }
  }
  return {
    productId,
    state: {
      ...state,
      nextId,
      nextProductNo: state.nextProductNo + 1,
      nextVariantNo,
      products: [...state.products, { id: productId, ...fields, is_active: true }],
      variants: [...state.variants, ...newVariants],
      movements: [...state.movements, ...newMovements],
    },
  }
}

export function addVariant(state, { productId, varian, warna, stock = 0 }, now = new Date()) {
  if (!state.products.some((p) => p.id === productId)) throw new InputError('Produk tidak ditemukan')
  const v = cleanVariant({ varian, warna, stock })
  assertVariantFree(state, productId, v)

  const id = `v${state.nextVariantNo}`
  const movements = v.stock > 0 ? [openingMovement(state, id, v.stock, now)] : []
  return {
    variantId: id,
    state: {
      ...state,
      nextId: state.nextId + movements.length,
      nextVariantNo: state.nextVariantNo + 1,
      variants: [...state.variants, { id, product_id: productId, varian: v.varian, warna: v.warna, stock_awal: v.stock, is_active: true }],
      movements: [...state.movements, ...movements],
    },
  }
}

export function updateProduct(state, { id, sku, name, price, is_active }) {
  const current = state.products.find((p) => p.id === id)
  if (!current) throw new InputError('Produk tidak ditemukan')
  const fields = cleanProduct({ sku, name, price })
  assertProductFree(state, fields, id)
  return {
    ...state,
    products: state.products.map((p) =>
      p.id === id ? { ...p, ...fields, is_active: is_active ?? p.is_active } : p),
  }
}

export function updateVariant(state, { id, varian, warna, is_active }) {
  const current = state.variants.find((v) => v.id === id)
  if (!current) throw new StockError('Varian tidak ditemukan')
  const fields = { varian: normText(varian), warna: normText(warna) }
  assertVariantFree(state, current.product_id, fields, id)
  return {
    ...state,
    variants: state.variants.map((v) =>
      v.id === id ? { ...v, ...fields, is_active: is_active ?? v.is_active } : v),
  }
}
