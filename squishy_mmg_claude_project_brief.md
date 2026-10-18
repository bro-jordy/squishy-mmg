# Squishy MMG — Project Brief untuk Claude

## 1. Tujuan Project
Bangun aplikasi web/PWA sederhana untuk operasional toko **Squishy MMG**. Aplikasi dipakai pemilik toko untuk mengelola master barang dan stok, menjalankan kasir, mencatat pembayaran, melihat laporan penjualan, serta menghitung pembagian **25% dan 75%** agar pemilik tahu nominal yang harus disetor.

Aplikasi harus nyaman dipakai dari iPhone, Android, dan desktop. Fokus awal satu toko; jangan membangun kompleksitas multi-toko sekarang.

## 2. Aturan Kerja untuk Claude
- Gunakan **React + JavaScript + Vite**; jangan TypeScript untuk versi awal.
- Backend/database: **Supabase** (Auth, PostgreSQL, Storage bila perlu).
- Deployment: **Vercel**.
- Mulai dengan audit repository, lalu kerjakan bertahap. Jangan membangun seluruh aplikasi sekaligus.
- Jangan mengarang kebutuhan bisnis yang belum jelas. Tanyakan sebelum mengunci keputusan penting.
- Jangan pernah mengekspos Supabase service-role key atau secret di frontend.
- Gunakan Row Level Security (RLS) untuk data yang diakses dari client.
- Operasi checkout dan stok harus aman dari transaksi ganda, race condition, dan stok minus.
- Simpan harga sebagai integer Rupiah, bukan floating point.
- Gunakan zona waktu `Asia/Jakarta`.
- Hindari dependency yang tidak perlu.

## 3. Pembagian 25% / 75% dan Setoran
Dashboard internal harus menampilkan:
- Total penjualan dan penjualan harian.
- Bagian 25% dan bagian 75%.
- Rekap pembagian per tanggal dan periode.
- Nominal yang sudah disetor, belum disetor, dan sisa setoran.
- Riwayat setoran supaya pemilik tidak lupa setor.

**Penting:** sebelum perhitungan keuangan difinalkan, konfirmasi apakah pembagian 25%/75% berasal dari **omzet kotor** atau **laba setelah modal/biaya**. Jangan mencampur penjualan, laba, dan setoran. Label perhitungan harus jelas.

Sampai aturan dikonfirmasi, implementasi boleh memakai simulasi 25% dan 75% dari omzet untuk preview, tetapi beri label bahwa dasar hitungnya masih perlu konfirmasi.

Jika pembagian dari omzet:
- Bagian 25% = dasar penjualan yang memenuhi aturan bisnis × 25%.
- Bagian 75% = dasar penjualan yang memenuhi aturan bisnis × 75%.
- Hanya transaksi selesai yang dihitung; transaksi void/batal tidak boleh tetap masuk.
- Hindari menghitung transaksi lebih dari sekali.

Fitur setoran:
- Catat nominal, tanggal, penerima/tujuan (opsional), dan catatan.
- Tampilkan status belum disetor / sebagian / lunas dan hitung sisa otomatis.
- Jangan membuat transfer otomatis; fitur ini hanya pencatatan internal.
- Gunakan label netral “Bagian 25%” dan “Bagian 75%” sampai penerimanya dikonfirmasi.

## 4. Aplikasi Kasir — Wajib
Kasir adalah fitur inti, bukan tambahan.

Alur:
1. Cari/pilih produk.
2. Pilih varian yang tersedia.
3. Masukkan jumlah dan tambahkan ke keranjang.
4. Tampilkan subtotal dan total.
5. Pilih pembayaran tunai atau QRIS statis.
6. Untuk QRIS, pelanggan scan QR toko; kasir mengecek pembayaran secara manual di **GoPay Merchant**.
7. Kasir baru mengonfirmasi pembayaran di Squishy MMG setelah memeriksa GoPay Merchant.
8. Simpan transaksi, kurangi stok, lalu tampilkan ringkasan dan struk yang dapat dicetak/disimpan sebagai PDF melalui browser.

Pembayaran:
- QRIS statis; tidak ada integrasi payment gateway atau konfirmasi otomatis pada tahap awal.
- Memilih QRIS saja tidak berarti pembayaran lunas.
- Simpan metode pembayaran dan status konfirmasi.

Keamanan:
- Cegah checkout ganda karena tombol ditekan berulang atau jaringan lambat.
- Validasi stok terbaru di database saat checkout dan cegah stok minus.
- Simpan harga saat transaksi sebagai snapshot agar riwayat tidak berubah ketika harga produk diedit.
- Stok dikurangi tepat satu kali saat transaksi selesai.
- Void memerlukan konfirmasi dan alasan, mengembalikan stok tepat satu kali, dan menyimpan audit trail. Jangan menghapus transaksi secara permanen.

## 5. Master Barang, SKU, dan Varian
Master barang harus mendukung sekitar 100 jenis/varian awal dan bisa bertambah tanpa batas hardcode.

Data produk:
- SKU dasar, nama produk, harga jual integer Rupiah, status aktif/nonaktif.
- Deskripsi/gambar opsional.

Data varian:
- `variant_id` unik untuk setiap varian yang bisa dijual.
- Relasi ke produk, nama varian/tipe, warna, stok awal, stok berjalan, status aktif/nonaktif.

Aturan penting:
- SKU dasar boleh sama untuk beberapa varian.
- Setiap varian jual harus punya `variant_id` unik.
- **Jangan pernah mengurangi stok hanya berdasarkan SKU dasar.** Gunakan ID varian unik.
- Harga saat ini sama untuk semua varian dari satu produk.
- Jangan menambahkan UI harga berbeda per varian kecuali diminta kemudian.

Koreksi stok:
- Setiap penyesuaian stok wajib punya alasan, misalnya stok opname, barang rusak, barang masuk, atau koreksi.
- Jangan mengubah stok diam-diam tanpa riwayat.
- Simpan delta/jumlah, alasan, waktu, dan pengguna yang mengubah stok bila tersedia.

## 6. Spreadsheet yang Sudah Ada
Struktur Google Sheets yang sudah dibahas:

### Sheet `Master Barang`
- SKU
- Nama Barang
- Varian
- Warna
- Stok Awal
- Qty Stock / stok berjalan
- Harga

### Sheet `Penjualan`
- Tanggal
- SKU
- Nama Barang
- Varian
- Warna
- Qty
- Harga Satuan
- Total

Spreadsheet saat ini membedakan barang dengan kombinasi SKU + varian + warna. Di aplikasi gunakan ID varian unik sebagai identitas utama.

**Ya, master barang sebaiknya disertakan** saat mulai mengerjakan aplikasi, minimal export Excel/CSV atau salinan sheet `Master Barang`. Ini membantu Claude memetakan nama produk, SKU, varian, warna, stok, dan harga yang benar. Sertakan sheet `Penjualan` juga hanya jika transaksi historis ingin diimpor.

Jangan menganggap spreadsheet otomatis tersinkron dengan aplikasi. Pada tahap awal, spreadsheet menjadi sumber data untuk impor, kecuali sinkronisasi live memang diminta nanti.

Sebelum impor:
- Periksa header, contoh baris, duplikat, dan nilai kosong.
- Pastikan apakah stok yang tercatat adalah stok awal atau stok saat ini supaya tidak terhitung dua kali.
- Tampilkan ringkasan validasi sebelum impor final.
- Jangan mengubah file sumber otomatis.

## 7. Dashboard Internal Pemilik
Dashboard responsif untuk HP dan desktop, dengan:
- Penjualan hari ini dan periode pilihan.
- Jumlah transaksi.
- Bagian 25% dan 75%.
- Nominal yang belum disetor.
- Stok menipis/habis.
- Produk terlaris bila datanya tersedia.

Rekap harian menampilkan tanggal, total penjualan, bagian 25%, bagian 75%, dan status/jumlah setoran. Sediakan filter tanggal/periode. Hitung dari transaksi selesai, dengan perlakuan void yang konsisten. Format Rupiah Indonesia, contoh `Rp 1.104.000`.

## 8. Riwayat Transaksi dan Laporan
- Daftar transaksi: tanggal, nomor transaksi, total, metode pembayaran, status.
- Detail item, varian, kuantitas, harga satuan, dan total.
- Filter tanggal, nomor transaksi, atau produk jika memungkinkan.
- Transaksi void tetap terlihat dengan alasan.
- Laporan penjualan dan pembagian 25%/75% berdasarkan rentang tanggal.
- Ekspor CSV boleh ditambahkan jika sederhana dan tidak mengganggu fitur utama.

## 9. Autentikasi dan Akses
- Penggunaan internal pemilik/kasir yang diizinkan.
- Gunakan Supabase Auth.
- Lindungi dashboard, produk, transaksi, stok, dan setoran dari akses publik.
- Terapkan RLS secara eksplisit; menyembunyikan tombol di frontend bukan kontrol akses.
- Walau awalnya satu akun, jangan membuat database terbuka untuk publik.

## 10. Model Data yang Disarankan
Claude boleh menyesuaikan setelah audit, tetapi pertimbangkan:
- `products`: produk dan harga jual.
- `product_variants`: varian yang dapat dijual, dengan `variant_id` unik.
- `sales`: nomor transaksi, waktu, total, metode pembayaran, status, status konfirmasi pembayaran.
- `sale_items`: transaksi, `variant_id`, qty, harga snapshot, total item.
- `stock_movements`: penjualan, void, barang masuk, barang rusak, dan penyesuaian stok beserta alasan.
- `settlements`: catatan setoran bagian 25%/75%, nominal, tanggal, catatan, dan periode/tujuan.
- `profiles`/role jika dibutuhkan.

Checkout dan void harus konsisten, aman, dan idempotent. Jangan mengandalkan pencocokan nama produk untuk mengubah stok.

## 11. UI/UX
- Nama aplikasi: **Squishy MMG**.
- Desain bersih, ramah, sederhana, dan cepat dipakai saat melayani pelanggan.
- Mobile-first dan responsif.
- Navigasi: Dashboard, Kasir, Produk/Master Barang, Stok, Transaksi, Setoran 25%/75%, Pengaturan.
- Tombol kasir mudah dijangkau di HP.
- Format angka Rupiah dan pesan loading/error yang jelas.
- Jangan mengandalkan warna saja untuk menyampaikan status.

## 12. Pengujian Minimum
Uji setidaknya:
- Satu SKU dasar dengan beberapa varian.
- Penjualan hanya mengurangi stok varian yang dipilih.
- Checkout ditolak jika stok kurang.
- Klik checkout berulang tidak membuat transaksi ganda.
- QRIS belum lunas sebelum konfirmasi manual.
- Transaksi selesai tercermin di laporan dan pembagian 25%/75%.
- Void mengembalikan stok sekali dan mengoreksi laporan.
- Harga historis tidak berubah saat harga produk diedit.
- Setoran memperbarui sisa yang belum disetor dengan benar.
- Penyesuaian stok wajib memiliki alasan.
- RLS mencegah akses tidak sah.

## 13. Tahapan Pengerjaan
### Fase 0 — Audit dan rencana
Audit repository, rangkum struktur/teknologi, fitur yang sudah ada, risiko teknis/keamanan, pertanyaan yang belum jelas, dan rencana tahap. Jangan langsung membangun ulang project.

### Fase 1 — Fondasi
Setup aplikasi, routing, layout responsif, Supabase, autentikasi, RLS, dan skema database.

### Fase 2 — Master barang dan stok
CRUD produk/varian, impor master barang dengan validasi, dan riwayat pergerakan/penyesuaian stok.

### Fase 3 — Kasir
Keranjang, tunai, QRIS statis dengan konfirmasi manual, checkout aman, pengurangan stok, riwayat transaksi, dan struk.

### Fase 4 — Dashboard dan setoran
Rekap harian/periode, perhitungan 25%/75%, pencatatan setoran, dan sisa yang belum disetor.

### Fase 5 — Pengujian dan deployment
Jalankan test, periksa RLS dan operasi stok/transaksi, siapkan environment variables, lalu deploy ke Vercel tanpa mengekspos secret.

## 14. Pertanyaan Bisnis yang Harus Dikonfirmasi
Jangan menunda audit repository untuk pertanyaan ini, tetapi konfirmasi sebelum finalisasi keuangan:
1. Pembagian 25%/75% dihitung dari omzet kotor atau laba setelah modal/biaya?
2. Siapa penerima bagian 25% dan siapa penerima 75%?
3. Setoran dilakukan per transaksi, harian, atau per periode?
4. Apakah diskon, refund, atau biaya lain memengaruhi pembagian?
5. Apakah transaksi historis perlu diimpor, atau cukup master barang lalu mulai mencatat transaksi baru?

## 15. Prompt Awal untuk Claude
Mulai dari **Fase 0 — Audit dan rencana**. Baca brief ini dan periksa repository yang tersedia. Jangan langsung membangun seluruh aplikasi. Laporkan:
1. Struktur project dan teknologi yang sudah ada.
2. Fitur yang sudah berfungsi dan yang belum.
3. Risiko teknis/keamanan.
4. Rencana implementasi bertahap sesuai project saat ini.
5. Data master barang yang diperlukan untuk impor.

Gunakan JavaScript, bukan TypeScript. Aplikasi kasir dan dashboard pembagian 25%/75% adalah fitur inti Squishy MMG.
