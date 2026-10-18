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

// Rekap per hari Jakarta, urut tanggal naik.
export function dailySummary(sales, pct = DEFAULT_PCT) {
  const days = new Map()
  for (const s of sales) {
    if (!counts(s)) continue
    const day = jakartaDateKey(s.sold_at)
    const d = days.get(day) ?? { day, transaksi: 0, total_penjualan: 0 }
    d.transaksi += 1
    d.total_penjualan += s.total
    days.set(day, d)
  }
  return [...days.values()]
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map((d) => ({ ...d, ...splitShare(d.total_penjualan, pct) }))
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

const addDays = (key, n) => {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function periodRange(preset, today) {
  if (preset === '7hari') return { from: addDays(today, -6), to: today }
  if (preset === 'bulan') return { from: `${today.slice(0, 8)}01`, to: today }
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
