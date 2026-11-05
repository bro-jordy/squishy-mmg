-- Tes harga dasar pemilik: setoran dari harga dasar, selisih harga jual milik toko,
-- snapshot per transaksi, edit transaksi, dan produk tanpa harga dasar (tetap 25/75).
\set ON_ERROR_STOP on
select id as rea from stores where kode = 'REA' \gset
set role authenticated;

select t_as('00000000-0000-0000-0000-0000000000b1');  -- admin REA
select t_vid(:'rea','A12','Ungu') as ungu \gset
select t_vid(:'rea','A12','Biru') as biru \gset
select product_id as pid from product_variants where id = :'ungu' \gset

-- ringkasan hari ini sebelum (baris bisa belum ada)
select coalesce(sum(total_penjualan),0) as t0, coalesce(sum(bagian_25),0) as b25_0, coalesce(sum(bagian_75),0) as b75_0
  from v_daily_summary where store_id = :'rea' and day = (now() at time zone 'Asia/Jakarta')::date \gset

-- tanpa harga dasar: sama dengan 25/75 biasa (harga jual 35.000 x2 = 70.000 -> 17.500 / 52.500)
select t_as('00000000-0000-0000-0000-0000000000d1');  -- kasir
select checkout(:'rea','81000000-0000-0000-0000-000000000001','cash',true,
  jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',2)),null,null) as s1 \gset
select t_assert((select base_unit_price from sale_items where sale_id=:'s1')=35000,'tanpa harga dasar: snapshot = harga jual');
select t_as('00000000-0000-0000-0000-0000000000b1');
select t_assert((select bagian_75 from v_daily_summary where store_id=:'rea' and day=(now() at time zone 'Asia/Jakarta')::date)=:b75_0+52500,'tanpa harga dasar: 75% dari harga jual');
select t_assert((select bagian_25 from v_daily_summary where store_id=:'rea' and day=(now() at time zone 'Asia/Jakarta')::date)=:b25_0+17500,'tanpa harga dasar: 25% dari harga jual');

-- hanya admin toko yang boleh mengisi harga dasar; kasir ditolak (RLS menyaring diam-diam: 0 baris)
select t_as('00000000-0000-0000-0000-0000000000d1');
with u as (update products set base_price = 1 where id=:'pid' returning 1)
select t_assert((select count(*) from u)=0,'kasir tidak bisa ubah harga dasar');
select t_as('00000000-0000-0000-0000-0000000000b1');
update products set base_price = 20000 where id = :'pid';
select t_expect_error(format($q$update products set base_price = -1 where id = %L$q$,:'pid'),'check');

-- harga dasar 20.000, jual 35.000 x2: total 70.000; setoran = 40.000 - 25% (10.000) = 30.000; toko = 40.000
select t_as('00000000-0000-0000-0000-0000000000d1');
select checkout(:'rea','81000000-0000-0000-0000-000000000002','cash',true,
  jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',2)),null,null) as s2 \gset
select t_assert((select unit_price from sale_items where sale_id=:'s2')=35000,'harga jual tetap 35.000');
select t_assert((select base_unit_price from sale_items where sale_id=:'s2')=20000,'snapshot harga dasar 20.000');
select t_assert((select total from sales where id=:'s2')=70000,'total = harga jual x qty');
select t_as('00000000-0000-0000-0000-0000000000b1');
select t_assert((select bagian_75 from v_daily_summary where store_id=:'rea' and day=(now() at time zone 'Asia/Jakarta')::date)=:b75_0+52500+30000,'setoran pemilik = 75% dari harga dasar');
select t_assert((select bagian_25 from v_daily_summary where store_id=:'rea' and day=(now() at time zone 'Asia/Jakarta')::date)=:b25_0+17500+40000,'bagian toko = penjualan - setoran');
select t_assert((select total_penjualan from v_daily_summary where store_id=:'rea' and day=(now() at time zone 'Asia/Jakarta')::date)=:t0+70000+70000,'penjualan = harga jual');

-- harga dasar berubah lagi: transaksi lama tidak ikut
select t_as('00000000-0000-0000-0000-0000000000b1');
update products set base_price = 10000 where id = :'pid';
select t_assert((select base_unit_price from sale_items where sale_id=:'s2')=20000,'harga dasar baru tidak mengubah transaksi lama');

-- edit transaksi (owner): barang lama pertahankan snapshot, barang baru pakai harga dasar produk saat ini
select t_as('00000000-0000-0000-0000-0000000000a1');
select edit_sale(:'s2','cash',true,
  jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',1,'unit_price',40000),
                    jsonb_build_object('variant_id',:'biru','qty',1,'unit_price',35000)),'tes harga dasar');
select t_assert((select base_unit_price from sale_items where sale_id=:'s2' and variant_id=:'ungu')=20000,'edit: barang lama pertahankan snapshot');
select t_assert((select base_unit_price from sale_items where sale_id=:'s2' and variant_id=:'biru')=10000,'edit: barang baru ikut harga dasar produk');
select t_assert((select unit_price from sale_items where sale_id=:'s2' and variant_id=:'ungu')=40000,'edit: harga jual boleh diubah');

-- kembali ke tanpa harga dasar (kosong)
select t_as('00000000-0000-0000-0000-0000000000b1');
update products set base_price = null where id = :'pid';
select t_as('00000000-0000-0000-0000-0000000000d1');
select checkout(:'rea','81000000-0000-0000-0000-000000000003','cash',true,
  jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',1)),null,null) as s3 \gset
select t_assert((select base_unit_price from sale_items where sale_id=:'s3')=35000,'harga dasar dikosongkan: snapshot = harga jual');
select 'LOLOS';
