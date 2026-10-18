const JAKARTA = 'Asia/Jakarta'

// Rp 1.104.000 (integer Rupiah; tidak pernah float)
export function formatRupiah(amount) {
  if (!Number.isInteger(amount)) throw new TypeError('Rupiah harus integer')
  const sign = amount < 0 ? '-' : ''
  const digits = String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${sign}Rp ${digits}`
}

export function formatDateTimeJakarta(value) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: JAKARTA,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

// Ambang "menipis" belum dikonfirmasi pemilik; ubah di sini.
export const LOW_STOCK_THRESHOLD = 2

export function stockStatus(stock) {
  if (stock <= 0) return { key: 'habis', label: 'Habis' }
  if (stock <= LOW_STOCK_THRESHOLD) return { key: 'menipis', label: 'Menipis' }
  return { key: 'ok', label: '' }
}

// Tanggal "YYYY-MM-DD" menurut waktu Jakarta (hari bisnis), bukan zona browser.
export function jakartaDateKey(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JAKARTA, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value))
  const get = (t) => parts.find((p) => p.type === t).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export const todayJakarta = () => jakartaDateKey(new Date())

export function formatTimeJakarta(value) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: JAKARTA, hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

export function formatDateJakarta(key) {
  // key "YYYY-MM-DD" -> "17 Okt 2026"
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${key}T00:00:00Z`))
}

// Batas waktu (ISO UTC) satu hari Jakarta: [awal, awal hari berikutnya).
export function jakartaDayRange(fromKey, toKey) {
  const start = new Date(`${fromKey}T00:00:00+07:00`)
  const end = new Date(new Date(`${toKey}T00:00:00+07:00`).getTime() + 24 * 3600 * 1000)
  return { start: start.toISOString(), end: end.toISOString() }
}
