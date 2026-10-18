// Bantuan pembayaran tunai di kasir: uang diterima -> kembalian, plus saran nominal.
// Hanya alat bantu hitung; tidak disimpan ke database dan tidak dicetak di struk.

const BILLS = [5000, 10000, 20000, 50000, 100000]

// "100.000" / "Rp 100000" -> 100000; kosong atau tanpa angka -> null.
export function parseRupiah(text) {
  const digits = String(text ?? '').replace(/\D/g, '')
  if (digits === '') return null
  const n = Number(digits)
  return Number.isSafeInteger(n) ? n : null
}

// 100000 -> "100.000" (untuk isian; tanpa "Rp").
export function formatDigits(n) {
  return n === null || n === undefined ? '' : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

// Nominal yang biasa diberikan pembeli: pembulatan ke atas ke pecahan umum
// (5rb, 10rb, 20rb, 50rb, 100rb), tanpa duplikat, terkecil dulu. "Uang pas" ditampilkan terpisah.
export function cashSuggestions(total, max = 4) {
  if (!Number.isInteger(total) || total <= 0) return []
  const out = new Set()
  for (const b of BILLS) {
    const c = Math.ceil(total / b) * b
    if (c > total) out.add(c)
  }
  // Selalu tawarkan pecahan besar berikutnya di atas total (mis. total 100.000 -> 150.000, 200.000).
  for (const b of [50000, 100000]) out.add((Math.floor(total / b) + 1) * b)
  return [...out].sort((a, b) => a - b).slice(0, max)
}

// received null (belum diisi) -> null. Cukup -> { change, short: 0 }. Kurang -> { change: 0, short }.
export function cashChange(received, total) {
  if (received === null || received === undefined) return null
  return received >= total
    ? { change: received - total, short: 0 }
    : { change: 0, short: total - received }
}
