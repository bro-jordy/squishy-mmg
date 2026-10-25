-- Tes edit transaksi selesai (hanya owner): metode bayar, nominal, item, stok, riwayat.
\set ON_ERROR_STOP on
select id as rea from stores where kode = 'REA' \gset
set role authenticated;

select t_as('00000000-0000-0000-0000-0000000000d1');  -- kasir REA
select t_vid(:'rea','A12','Ungu') as ungu \gset
select t_vid(:'rea','A12','Biru') as biru \gset
select stock as ungu0 from product_variants where id = :'ungu' \gset
select stock as biru0 from product_variants where id = :'biru' \gset
select checkout(:'rea','55555555-5555-5555-5555-555555555555','cash',true,
  jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',1)),'Tes edit',null) as sx \gset
select t_assert((select stock from product_variants where id=:'ungu')=:ungu0-1,'sebelum edit: stok -1');

-- hanya owner platform: kasir dan admin toko ditolak
select t_expect_error(format($q$select edit_sale(%L,'qris',true,%L::jsonb,'x')$q$,:'sx',
  jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',1,'unit_price',35000))),'owner');
select t_as('00000000-0000-0000-0000-0000000000b1');
select t_expect_error(format($q$select edit_sale(%L,'qris',true,%L::jsonb,'x')$q$,:'sx',
  jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',1,'unit_price',35000))),'owner');

select t_as('00000000-0000-0000-0000-0000000000a1');  -- owner
-- validasi input
select t_expect_error(format($q$select edit_sale(%L,'qris',true,%L::jsonb,'  ')$q$,:'sx',
  jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',1,'unit_price',35000))),'Alasan');
select t_expect_error(format($q$select edit_sale(%L,'transfer',true,%L::jsonb,'x')$q$,:'sx',
  jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',1,'unit_price',35000))),'Metode');
select t_expect_error(format($q$select edit_sale(%L,'qris',true,'[]'::jsonb,'x')$q$,:'sx'),'minimal satu');
select t_expect_error(format($q$select edit_sale(%L,'qris',true,%L::jsonb,'x')$q$,:'sx',
  jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',0,'unit_price',35000))),'qty');
select t_expect_error(format($q$select edit_sale(%L,'qris',true,%L::jsonb,'x')$q$,:'sx',
  jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',1,'unit_price',35000),
                    jsonb_build_object('variant_id',:'ungu','qty',1,'unit_price',35000))),'dua kali');
select t_expect_error(format($q$select edit_sale(%L,'qris',true,%L::jsonb,'x')$q$,:'sx',
  jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',:ungu0+50,'unit_price',35000))),'Stok tidak cukup');
select t_assert((select stock from product_variants where id=:'ungu')=:ungu0-1,'edit gagal: stok tidak berubah');
select t_assert((select total from sales where id=:'sx')=35000,'edit gagal: total tidak berubah');

-- edit 1: cash -> QRIS, qty 1->2, harga 35000->30000
select edit_sale(:'sx','qris',true,
  jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',2,'unit_price',30000)),'koreksi pembeli');
select t_assert((select total from sales where id=:'sx')=60000,'total dihitung ulang');
select t_assert((select payment_method from sales where id=:'sx')='qris','metode jadi QRIS');
select t_assert((select payment_status from sales where id=:'sx')='confirmed','QRIS terkonfirmasi');
select t_assert((select edited_at is not null from sales where id=:'sx'),'edited_at terisi');
select t_assert((select stock from product_variants where id=:'ungu')=:ungu0-2,'stok ikut qty baru');
select t_assert((select unit_price from sale_items where sale_id=:'sx')=30000,'harga baru');
select t_assert((select product_name from sale_items where sale_id=:'sx')<>'','nama snapshot tetap ada');
select t_assert((select total_penjualan from v_daily_summary where store_id=:'rea' and day=jakarta_today())>=60000,'rekap harian ikut');

-- edit 2: ganti barang Ungu -> Biru, QRIS belum dikonfirmasi
select edit_sale(:'sx','qris',false,
  jsonb_build_array(jsonb_build_object('variant_id',:'biru','qty',1,'unit_price',35000)),'salah warna');
select t_assert((select stock from product_variants where id=:'ungu')=:ungu0,'stok Ungu kembali');
select t_assert((select stock from product_variants where id=:'biru')=:biru0-1,'stok Biru berkurang');
select t_assert((select payment_status from sales where id=:'sx')='unconfirmed','QRIS belum dikonfirmasi');
select t_assert((select payment_confirmed_at is null from sales where id=:'sx'),'confirmed_at kosong');
select t_assert((select count(*) from sale_items where sale_id=:'sx')=1,'satu item');

-- edit 3: kembali ke tunai (cash selalu confirmed)
select edit_sale(:'sx','cash',false,
  jsonb_build_array(jsonb_build_object('variant_id',:'biru','qty',1,'unit_price',35000)),'ternyata tunai');
select t_assert((select payment_status from sales where id=:'sx')='confirmed','cash selalu confirmed');

-- riwayat edit: 3 baris, admin toko boleh membaca, kasir tidak
select t_assert((select count(*) from sale_edits where sale_id=:'sx')=3,'3 riwayat edit');
select t_assert((select before->>'total' from sale_edits where sale_id=:'sx' order by id limit 1)='35000','riwayat: total sebelum');
select t_assert((select after->>'total' from sale_edits where sale_id=:'sx' order by id limit 1)='60000','riwayat: total sesudah');
select t_as('00000000-0000-0000-0000-0000000000b1');
select t_assert((select count(*) from sale_edits where sale_id=:'sx')=3,'admin toko melihat riwayat');
select t_as('00000000-0000-0000-0000-0000000000d1');
select t_assert((select count(*) from sale_edits)=0,'kasir tidak melihat riwayat');

-- transaksi void tidak bisa diedit; item tidak bisa diubah lewat jalur lain
select t_as('00000000-0000-0000-0000-0000000000b1');
select void_sale(:'sx','batal');
select t_as('00000000-0000-0000-0000-0000000000a1');
select t_expect_error(format($q$select edit_sale(%L,'cash',true,%L::jsonb,'x')$q$,:'sx',
  jsonb_build_array(jsonb_build_object('variant_id',:'biru','qty',1,'unit_price',35000))),'transaksi selesai');
select t_expect_error(format($q$update sale_items set qty = 5 where sale_id = %L$q$,:'sx'),'permission denied');
reset role;
select t_expect_error(format($q$update sale_items set qty = 5 where sale_id = %L$q$,:'sx'),'append-only');
select t_assert(not exists(select 1 from product_variants v where v.stock <> (select coalesce(sum(qty_delta),0) from stock_movements m where m.variant_id=v.id)),'ledger = saldo setelah edit');
select 'SEMUA TES LOLOS' as hasil;
