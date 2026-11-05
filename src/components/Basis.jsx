// Pengingat bahwa dasar hitung pembagian belum final.
export default function Basis({ settings }) {
  const pct = settings?.pct_bagian_25 ?? '25'
  return (
    <p className="hint" role="note">
      <b>Dasar hitung: omzet</b> (transaksi selesai dan pembayaran terkonfirmasi; void tidak ikut).
      Bagian 75% (setoran pemilik) = {100 - Number(pct)}% dari <b>harga dasar</b> pemilik (sama dengan harga jual kecuali diisi di Master Barang).
      Bagian toko = penjualan dikurangi setoran, jadi selisih harga jual di atas harga dasar milik toko. <b>Dasar ini belum dikonfirmasi</b>:
      kalau pembagian ternyata dari laba setelah modal/biaya, angka di sini perlu disesuaikan.
    </p>
  )
}
