# Squishy MMG

Aplikasi kasir, master barang, stok, dan rekap pembagian 25%/75% untuk toko Squishy MMG.
React + JavaScript + Vite; backend Supabase (Auth + PostgreSQL + RLS); deploy ke Vercel.
Brief lengkap: `squishy_mmg_claude_project_brief.md`.

## Multi-toko (satu aplikasi, data terpisah penuh)

Ada **dua toko** (Toko Rea dan Toko Soso) di satu aplikasi dan satu database. Tiap toko punya
master barang, stok, transaksi, setoran, dan pengguna **sendiri**. SKU boleh (dan memang) sama
persis di kedua toko karena sumbernya sama, tapi stok dan transaksinya tidak pernah tercampur. Toko Soso saat ini kosong (belum ada barang); barangnya ditambahkan lewat Master Barang atau diimpor.
Pemisahan dijaga di database (RLS), bukan hanya di layar: akun Soso tidak bisa membaca atau
mengubah data Toko Rea, sekalipun memanggil API langsung.

| Peran | Akses |
|---|---|
| **Owner platform** | Semua toko; memilih toko dari pemilih di sidebar/atas. Satu-satunya yang bisa menjadikan seseorang admin. |
| **Admin toko** (Rea, Soso) | Semua menu di **tokonya saja**: Dashboard, Kasir, Transaksi, Barang (Master Barang, Stok Barang, Opname massal), Bagi Hasil, Pengaturan (Umum, Pengguna). Mengelola kasir tokonya. |
| **Kasir** | Hanya **Kasir** dan **Transaksi** (hanya transaksi yang ia buat sendiri). |

**Edit transaksi selesai**: hanya **owner platform** (tombol *Edit* di detail transaksi). Bisa mengganti metode bayar (QRIS/Tunai), qty, harga satuan, dan menambah/menghapus barang; total dihitung ulang, selisih stok dicatat sebagai penyesuaian, dan tiap edit tersimpan (sebelum/sesudah, siapa, alasan) di tabel `sale_edits`. Transaksi void tidak bisa diedit. Edit ikut mengubah rekap Bagi Hasil.

Nama kasir tercatat di tiap transaksi (berdasarkan akun yang login) dan tampil di Transaksi,
tapi **tidak** di struk.

## Jalankan lokal (tanpa Supabase)

```bash
npm install
npm run dev:local     # buka http://localhost:5173
```

Mode lokal memakai data contoh dari master barang (`src/data/local-seed.json`), tanpa login,
dan menyimpan perubahan hanya di browser. Pilih pengguna contoh lewat alamat atau link di
banner kuning: `?sebagai=owner` (kedua toko), `rea`, `soso`, `kasir` (kasir Toko Rea).
Toko Rea berisi master barang + Stock Awal dari sheet; Toko Soso dimulai **kosong** (barangnya ditambahkan nanti).
Reset lewat link kuning. Dibuka dari HP di WiFi yang sama: `npm run dev:local -- --host`.

Memperbarui data contoh setelah spreadsheet berubah (atau mengganti nama toko di `STORES`):

```bash
python3 -I scripts/generate_seed.py db/data/master_barang_snapshot.csv db/seed.sql src/data/local-seed.json
```

## QRIS toko

Taruh gambar QRIS statis di `public/qris.png`; muncul di keranjang saat memilih QRIS. QRIS dianggap
lunas hanya setelah kasir mencentang bahwa dana sudah masuk di GoPay Merchant (tidak ada konfirmasi otomatis).

## Pasang dengan Supabase + Vercel

1. **Supabase**: buat project. Di SQL Editor jalankan `db/schema.sql`, lalu `db/seed.sql`
   (membuat kedua toko beserta master barangnya). `schema.sql` sudah memuat semua migrasi; untuk database yang sudah berjalan, jalankan file di `db/migrations/` yang belum pernah dijalankan (aman diulang).
2. **Matikan pendaftaran publik**: Authentication → Sign In / Providers → matikan "Allow new users to sign up".
3. **Buat login**: Authentication → Users → Add user (email + password) untuk owner, Rea, Soso.
   Lalu edit email di `db/setup_owner.sql` dan jalankan: itu menjadikan owner sebagai owner platform
   dan Rea/Soso sebagai admin tokonya. **Kasir** ditambahkan dari aplikasi (Pengaturan → Pengguna).
4. **Jalankan lokal ke Supabase**: salin `.env.example` ke `.env.local`, isi `VITE_SUPABASE_URL` dan
   `VITE_SUPABASE_ANON_KEY` (Project Settings → API; hanya anon/publishable key), lalu `npm run dev`.
5. **Vercel**: import repo, framework Vite (build `npm run build`, output `dist`). Isi dua Environment
   Variables yang sama. `vercel.json` sudah mengatur routing dan header keamanan.
6. Di iPhone: buka situs → Share → **Add to Home Screen**. Android: menu → Install app.
7. Hari pertama: Rea mencocokkan stok lewat **Barang → Stok Barang → Opname massal**. Soso menambahkan barang tokonya lewat **Barang → Master Barang → + Tambah barang** (atau minta diimpor), lalu mengisi stoknya.

**Jangan pernah** menaruh service-role key di aplikasi atau di variabel `VITE_*` (semua `VITE_*` ikut ke browser).
Akses data dijaga RLS di database, bukan oleh tombol yang disembunyikan.

## Navigasi

- **Laptop/tablet (≥ 900px)**: sidebar yang bisa dikecilkan (pilihan diingat; otomatis kecil di Kasir). Owner punya pemilih toko di sidebar.
- **HP**: bar ikon di bawah; Pengaturan dan Keluar di menu akun (pojok kanan atas); pemilih toko (owner) di bilah atas.
- Menu: Dashboard, Kasir, Transaksi, **Barang** (sub-tab *Master Barang* | *Stok Barang*), **Bagi Hasil**, Pengaturan (*Umum* | *Pengguna*).

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev:local` | dev server mode lokal |
| `npm run dev` | dev server mode Supabase |
| `npm test` | tes aplikasi (format, katalog, stok, penjualan, rekap, setoran, multi-toko, pengguna) |
| `npm run test:db` | tes database di PostgreSQL sementara, termasuk isolasi antar toko (butuh `brew install postgresql@17`) |
| `npm run build` / `build:local` | build produksi / build lokal |

## Catatan bisnis yang masih terbuka

- **Dasar pembagian 25%/75%**: sekarang dari omzet (transaksi selesai dan pembayaran terkonfirmasi, void tidak ikut),
  persen per toko (`stores.pct_bagian_25`, saat ini 25 untuk keduanya). Belum dikonfirmasi: omzet atau laba.
- **Setoran**: hanya pencatatan internal. Status per hari dialokasikan dari hari terlama.
- **Nama toko** ("Toko Rea", "Toko Soso") masih sementara; ganti dengan `update stores set nama = '...' where kode = 'REA'`.
- **Impor penjualan historis (16–17 Okt)**: belum dilakukan; stok Toko Rea dari kolom Stock Awal di sheet.
