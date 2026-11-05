// Rekap penjualan, pembagian 25%/75%, dan setoran. Aturan hitung sama dengan view
// v_daily_summary / v_settlement_balance di db/schema.sql (ubah keduanya bersamaan).
//
// DASAR HITUNG: omzet transaksi selesai dan pembayaran terkonfirmasi (void tidak ikut).
// BELUM FINAL: tergantung konfirmasi pemilik, omzet atau laba setelah modal/biaya.
import { jakartaDateKey } from './format.js'

export const DEFAULT_PCT = 25

export class ReportError extends Error {}

const counts = (s) => s.status === 'completed' && s.payment_status === 'confirmed'

// Bagian 25% dibulatkan per hari (setengah ke atas), sisanya = Bagian 75%; jumlah selalu pas.
export function splitShare(total, pct = DEFAULT_PCT) {
  const a = Math.floor((total * pct + 50) / 100)
  return { bagian_25: a, bagian_75: total - a }
}

// Harga dasar (dari pemilik) bisa lebih rendah dari harga jual. Setoran pemilik (Bagian 75%) dihitung
// dari harga dasar; Bagian 25% (bagian toko) = penjualan - setoran, jadi selisih harga jual di atas
// harga dasar seluruhnya milik toko. Tanpa selisih (dasar = total) hasilnya sama dengan splitShare.
export function splitWithBase(total, dasar, pct = DEFAULT_PCT) {
  const { bagian_75 } = splitShare(dasar, pct)
  return { bagian_25: total - bagian_75, bagian_75 }
}

// Harga dasar satu item; transaksi lama (tanpa snapshot) dianggap sama dengan harga jual.
export const baseOf = (it) => it.base_unit_price ?? it.unit_price
const baseTotal = (s) => s.sale_items.reduce((n, it) => n + it.qty * baseOf(it), 0)

// Rekap per hari Jakarta, urut tanggal naik.
export function dailySummary(sales, pct = DEFAULT_PCT) {
  const days = new Map()
  for (const s of sales) {
    if (!counts(s)) continue
    const day = jakartaDateKey(s.sold_at)
    const d = days.get(day) ?? { day, transaksi: 0, total_penjualan: 0, total_dasar: 0 }
    d.transaksi += 1
    d.total_penjualan += s.total
    d.total_dasar += baseTotal(s)
    days.set(day, d)
  }
  return [...days.values()]
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map(({ total_dasar, ...d }) => ({ ...d, ...splitWithBase(d.total_penjualan, total_dasar, pct) }))
}

// Setoran dialokasikan ke hari terlama dulu (asumsi; aturan setoran belum dikonfirmasi).
export function allocateSettlements(days, settledTotal) {
  let left = settledTotal
  return days.map((d) => {
    const disetor = Math.min(left, d.bagian_75)
    left -= disetor
    const status = d.bagian_75 === 0 ? 'kosong' : disetor === 0 ? 'belum' : disetor < d.bagian_75 ? 'sebagian' : 'lunas'
    return { ...d, disetor, sisa: d.bagian_75 - disetor, status }
  })
}

export function settlementBalance(days, settlements) {
  const total = days.reduce((n, d) => n + d.bagian_75, 0)
  const disetor = settlements.filter((s) => s.share === 'bagian_75').reduce((n, s) => n + s.amount, 0)
  const sisa = total - disetor
  const status = disetor > total ? 'kelebihan' : disetor === 0 && total > 0 ? 'belum' : disetor < total ? 'sebagian' : 'lunas'
  return { total_bagian_75: total, sudah_disetor: disetor, sisa, status }
}

export function topProducts(sales, limit = 5) {
  const map = new Map()
  for (const s of sales) {
    if (!counts(s)) continue
    for (const it of s.sale_items) {
      const key = `${it.sku}|${it.product_name}`
      const t = map.get(key) ?? { sku: it.sku, name: it.product_name, qty: 0, revenue: 0 }
      t.qty += it.qty
      t.revenue += it.line_total
      map.set(key, t)
    }
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, limit)
}

// Rekap export per SKU. Hanya transaksi selesai & terkonfirmasi (sama dengan rekap lain).
// Baris = SKU + nama + harga jual + harga dasar (varian digabung; harga beda = baris beda).
// Untung Toko = 25% dari harga dasar (dibulatkan per baris) + selisih (harga jual - dasar) x qty.
// 75% Pemilik = setoran dari harga dasar. Total = 75% Pemilik + Untung Toko.
export function exportRows(sales, pct = DEFAULT_PCT) {
  const map = new Map()
  for (const s of sales) {
    if (!counts(s)) continue
    for (const it of s.sale_items) {
      const key = `${it.sku}|${it.product_name}|${it.unit_price}|${baseOf(it)}`
      const r = map.get(key) ?? { sku: it.sku, nama: it.product_name, qty: 0, harga: it.unit_price, harga_dasar: baseOf(it), total: 0, dasar: 0 }
      r.qty += it.qty
      r.total += it.line_total
      r.dasar += it.qty * baseOf(it)
      map.set(key, r)
    }
  }
  return [...map.values()]
    .sort((a, b) => a.sku.localeCompare(b.sku, 'en', { numeric: true }) || a.nama.localeCompare(b.nama) || a.harga - b.harga)
    .map(({ dasar, ...r }) => {
      const { bagian_25, bagian_75 } = splitShare(dasar, pct)
      const selisih = r.total - dasar
      return { ...r, bagian_25, bagian_75, selisih, untung_toko: bagian_25 + selisih }
    })
}

// CSV (pemisah ';' agar langsung rapi di Excel berlokal Indonesia; BOM agar UTF-8 terbaca). Baris TOTAL di akhir.
export function exportCsv(rows) {
  const esc = (v) => {
    const t = String(v)
    return /[";\n\r]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t
  }
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0)
  const n = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.') // pemisah ribuan: 1.234.000
  const rp = (v) => `Rp ${n(v)}`
  // Rekap owner toko: Total = 75% Pemilik + Untung Toko (25% harga dasar + selisih harga jual).
  const lines = [['SKU', 'Nama Barang', 'Qty Terjual', 'Harga Jual', 'Harga Dasar', 'Total', '75% Pemilik', 'Untung Toko (25%+Selisih)']]
  for (const r of rows) {
    lines.push([r.sku, r.nama, n(r.qty), rp(r.harga), rp(r.harga_dasar), rp(r.total), rp(r.bagian_75), rp(r.untung_toko)])
  }
  lines.push(['', 'TOTAL', n(sum('qty')), '', '', rp(sum('total')), rp(sum('bagian_75')), rp(sum('untung_toko'))])
  return `\uFEFF${lines.map((l) => l.map(esc).join(';')).join('\r\n')}\r\n`
}

// Rekap untuk PEMILIK BARANG: hanya harga dasar (bukan harga jual), tanpa untung toko.
// Kolom: SKU, Nama Barang, Qty Terjual, Harga (= harga dasar), Total (= qty x harga dasar), 75%.
// Baris = SKU + nama + harga dasar (varian digabung). 75% dihitung dari Total dasar, dibulatkan per baris.
export function exportRowsOwner(sales, pct = DEFAULT_PCT) {
  const map = new Map()
  for (const s of sales) {
    if (!counts(s)) continue
    for (const it of s.sale_items) {
      const base = baseOf(it)
      const key = `${it.sku}|${it.product_name}|${base}`
      const r = map.get(key) ?? { sku: it.sku, nama: it.product_name, qty: 0, harga: base, total: 0 }
      r.qty += it.qty
      r.total += it.qty * base
      map.set(key, r)
    }
  }
  return [...map.values()]
    .sort((a, b) => a.sku.localeCompare(b.sku, 'en', { numeric: true }) || a.nama.localeCompare(b.nama) || a.harga - b.harga)
    .map((r) => ({ ...r, bagian_75: splitShare(r.total, pct).bagian_75 }))
}

const csvCell = (v) => {
  const t = String(v)
  return /[";\n\r]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t
}
const csvNum = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

export function exportCsvOwner(rows) {
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0)
  const rp = (v) => `Rp ${csvNum(v)}`
  const lines = [['SKU', 'Nama Barang', 'Qty Terjual', 'Harga', 'Total', '75%']]
  for (const r of rows) lines.push([r.sku, r.nama, csvNum(r.qty), rp(r.harga), rp(r.total), rp(r.bagian_75)])
  lines.push(['', 'TOTAL', csvNum(sum('qty')), '', rp(sum('total')), rp(sum('bagian_75'))])
  return `\uFEFF${lines.map((l) => l.map(csvCell).join(';')).join('\r\n')}\r\n`
}

const addDays = (key, n) => {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Tombol periode cepat (Transaksi, export Bagi Hasil, Dashboard).
export const PERIOD_PRESETS = [
  ['hari', 'Hari ini'], ['7hari', '7 hari'], ['bulan', 'Bulan ini'], ['bulanlalu', 'Bulan lalu'],
]

export function periodRange(preset, today) {
  if (preset === '7hari') return { from: addDays(today, -6), to: today }
  if (preset === 'bulan') return { from: `${today.slice(0, 8)}01`, to: today }
  if (preset === 'bulanlalu') {
    const last = addDays(`${today.slice(0, 8)}01`, -1) // hari terakhir bulan lalu
    return { from: `${last.slice(0, 8)}01`, to: last }
  }
  return { from: today, to: today }
}

// ---- Setoran (validasi dipakai kedua mode) ------------------------------------

const isDateKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
const orNull = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim())

export function cleanSettlement({ settled_on, amount, recipient, period_start, period_end, note }) {
  const n = amount === '' || amount === null || amount === undefined ? NaN : Number(amount)
  if (!Number.isInteger(n) || n <= 0) throw new ReportError('Nominal setoran harus bilangan bulat lebih dari 0')
  if (!isDateKey(settled_on)) throw new ReportError('Tanggal setoran tidak valid')
  const ps = orNull(period_start)
  const pe = orNull(period_end)
  if ((ps && !isDateKey(ps)) || (pe && !isDateKey(pe))) throw new ReportError('Tanggal periode tidak valid')
  if (ps && pe && ps > pe) throw new ReportError('Periode awal tidak boleh setelah periode akhir')
  return {
    settled_on, amount: n, share: 'bagian_75',
    recipient: orNull(recipient), period_start: ps, period_end: pe, note: orNull(note),
  }
}

export function addSettlement(state, input, now = new Date()) {
  const fields = cleanSettlement(input)
  const row = { id: `st${state.nextSettlementNo}`, ...fields, created_at: now.toISOString() }
  return {
    settlementId: row.id,
    state: { ...state, nextSettlementNo: state.nextSettlementNo + 1, settlements: [...state.settlements, row] },
  }
}

export function deleteSettlement(state, id) {
  if (!state.settlements.some((s) => s.id === id)) throw new ReportError('Catatan setoran tidak ditemukan')
  return { ...state, settlements: state.settlements.filter((s) => s.id !== id) }
}
