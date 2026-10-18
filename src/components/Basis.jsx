// Pengingat bahwa dasar hitung pembagian belum final.
export default function Basis({ settings }) {
  const pct = settings?.pct_bagian_25 ?? '25'
  return (
    <p className="hint" role="note">
      <b>Dasar hitung: omzet</b> (transaksi selesai dan pembayaran terkonfirmasi; void tidak ikut).
      Bagian 25% = {pct}% dari omzet, Bagian 75% = sisanya. <b>Dasar ini belum dikonfirmasi</b>:
      kalau pembagian ternyata dari laba setelah modal/biaya, angka di sini perlu disesuaikan.
    </p>
  )
}
