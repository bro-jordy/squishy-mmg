-- Tes transfer stok antar toko (hanya owner): pencocokan eksplisit, rinci per varian,
-- barang baru di tujuan, atomik, riwayat, dan hak akses.
\set ON_ERROR_STOP on
select id as rea  from stores where kode = 'REA'  \gset
select id as soso from stores where kode = 'SOSO' \gset
set role authenticated;

-- siapkan barang tujuan di Soso (admin Soso): satu varian "Random", stok 1
select t_as('00000000-0000-0000-0000-0000000000c1');
select create_product(:'soso','A12','Cube Random',35000,
  '[{"varian":"-","warna":"Random","stock":1}]'::jsonb) as sp \gset
select id as sv from product_variants where product_id = :'sp' \gset

select t_as('00000000-0000-0000-0000-0000000000a1');
select t_vid(:'rea','A12','Ungu') as ungu \gset
select t_vid(:'rea','A12','Biru') as biru \gset
select stock as ungu0 from product_variants where id = :'ungu' \gset
select stock as biru0 from product_variants where id = :'biru' \gset
-- pastikan cukup stok untuk uji
select adjust_stock(:'ungu','restock',3,'siapkan uji transfer') \gset
select adjust_stock(:'biru','restock',3,'siapkan uji transfer') \gset
select stock as ungu0 from product_variants where id = :'ungu' \gset
select stock as biru0 from product_variants where id = :'biru' \gset

-- hanya owner: admin toko dan kasir ditolak
select t_as('00000000-0000-0000-0000-0000000000b1');
select t_expect_error(format($q$select transfer_stock(%L,%L,%L::jsonb,'x')$q$,:'rea',:'soso',
  jsonb_build_array(jsonb_build_object('from',jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',1)),
                                       'to',jsonb_build_array(jsonb_build_object('variant_id',:'sv','qty',1))))),'owner');
select t_as('00000000-0000-0000-0000-0000000000d1');
select t_expect_error(format($q$select transfer_stock(%L,%L,%L::jsonb,'x')$q$,:'rea',:'soso',
  jsonb_build_array(jsonb_build_object('from',jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',1)),
                                       'to',jsonb_build_array(jsonb_build_object('variant_id',:'sv','qty',1))))),'owner');

select t_as('00000000-0000-0000-0000-0000000000a1');
-- validasi
select t_expect_error(format($q$select transfer_stock(%L,%L,'[]'::jsonb,'x')$q$,:'rea',:'soso'),'Tidak ada barang');
select t_expect_error(format($q$select transfer_stock(%L,%L,%L::jsonb,'x')$q$,:'rea',:'rea',
  jsonb_build_array(jsonb_build_object('from',jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',1)),
                                       'to',jsonb_build_array(jsonb_build_object('variant_id',:'sv','qty',1))))),'berbeda');
-- jumlah asal <> tujuan
select t_expect_error(format($q$select transfer_stock(%L,%L,%L::jsonb,'x')$q$,:'rea',:'soso',
  jsonb_build_array(jsonb_build_object('from',jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',2)),
                                       'to',jsonb_build_array(jsonb_build_object('variant_id',:'sv','qty',1))))),'harus sama');
-- varian tujuan milik toko lain (varian Rea sebagai tujuan di Soso)
select t_expect_error(format($q$select transfer_stock(%L,%L,%L::jsonb,'x')$q$,:'rea',:'soso',
  jsonb_build_array(jsonb_build_object('from',jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',1)),
                                       'to',jsonb_build_array(jsonb_build_object('variant_id',:'biru','qty',1))))),'tujuan');
-- stok kurang
select t_expect_error(format($q$select transfer_stock(%L,%L,%L::jsonb,'x')$q$,:'rea',:'soso',
  jsonb_build_array(jsonb_build_object('from',jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',:ungu0+99)),
                                       'to',jsonb_build_array(jsonb_build_object('variant_id',:'sv','qty',:ungu0+99))))),'Stok tidak cukup');
-- atomik: baris 1 valid + baris 2 gagal = tidak ada yang berubah
select t_expect_error(format($q$select transfer_stock(%L,%L,%L::jsonb,'x')$q$,:'rea',:'soso',
  jsonb_build_array(
    jsonb_build_object('from',jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',1)),
                       'to',jsonb_build_array(jsonb_build_object('variant_id',:'sv','qty',1))),
    jsonb_build_object('from',jsonb_build_array(jsonb_build_object('variant_id',:'biru','qty',:biru0+99)),
                       'to',jsonb_build_array(jsonb_build_object('variant_id',:'sv','qty',:biru0+99))))),'Stok tidak cukup');
select t_assert((select stock from product_variants where id=:'ungu')=:ungu0,'atomik: stok asal tidak berubah');
select t_assert((select stock from product_variants where id=:'sv')=1,'atomik: stok tujuan tidak berubah');
select t_assert((select count(*) from stock_transfers)=0,'atomik: tidak ada riwayat transfer');

-- Rea -> Soso: Ungu 2 + Biru 1 (dirinci per warna) masuk total 3 ke satu varian Random
select transfer_stock(:'rea',:'soso',
  jsonb_build_array(jsonb_build_object(
    'from',jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',2),jsonb_build_object('variant_id',:'biru','qty',1)),
    'to',jsonb_build_array(jsonb_build_object('variant_id',:'sv','qty',3)))),'ambil untuk Soso') as t1 \gset
select t_assert((select stock from product_variants where id=:'ungu')=:ungu0-2,'Ungu -2');
select t_assert((select stock from product_variants where id=:'biru')=:biru0-1,'Biru -1');
select t_assert((select stock from product_variants where id=:'sv')=4,'Soso Random +3');
select t_assert((select count(*) from stock_movements where transfer_id=:'t1' and movement_type='transfer_out')=2,'2 movement keluar');
select t_assert((select count(*) from stock_movements where transfer_id=:'t1' and movement_type='transfer_in')=1,'1 movement masuk');
select t_assert((select reason from stock_movements where transfer_id=:'t1' and movement_type='transfer_in')='Transfer dari Toko Rea: ambil untuk Soso','alasan masuk');
select t_assert((select (detail->0->>'qty')::int from stock_transfers where id=:'t1')=3,'detail jumlah');
select t_assert((select created_by_name from stock_transfers where id=:'t1')='Owner','pembuat tercatat');

-- barang baru di Soso (varian Random otomatis)
select transfer_stock(:'rea',:'soso',
  jsonb_build_array(jsonb_build_object(
    'from',jsonb_build_array(jsonb_build_object('variant_id',:'biru','qty',1)),
    'new_product',jsonb_build_object('sku','A99','name','Barang Baru Uji','price',40000))),null) as t2 \gset
select t_assert((select count(*) from products where store_id=:'soso' and sku='A99' and name='Barang Baru Uji' and price=40000)=1,'produk baru di Soso');
select t_assert((select v.stock from product_variants v join products p on p.id=v.product_id where p.store_id=:'soso' and p.sku='A99')=1,'stok produk baru = 1');
select t_assert((select v.warna from product_variants v join products p on p.id=v.product_id where p.store_id=:'soso' and p.sku='A99')='Random','varian Random');
select t_expect_error(format($q$select transfer_stock(%L,%L,%L::jsonb,'x')$q$,:'rea',:'soso',
  jsonb_build_array(jsonb_build_object('from',jsonb_build_array(jsonb_build_object('variant_id',:'biru','qty',1)),
    'new_product',jsonb_build_object('sku','A99','name','barang baru uji','price',1)))),'sudah ada');

-- Soso -> Rea: total 2 dari Random dirinci ke Ungu 1 + Biru 1
select transfer_stock(:'soso',:'rea',
  jsonb_build_array(jsonb_build_object(
    'from',jsonb_build_array(jsonb_build_object('variant_id',:'sv','qty',2)),
    'to',jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',1),jsonb_build_object('variant_id',:'biru','qty',1)))),'balik') as t3 \gset
select t_assert((select stock from product_variants where id=:'sv')=2,'Soso Random 4 -> 2');
select t_assert((select stock from product_variants where id=:'ungu')=:ungu0-1,'Ungu +1 (balik)');

-- hak baca riwayat: hanya owner
select t_assert((select count(*) from stock_transfers)=3,'owner melihat 3 transfer');
select t_as('00000000-0000-0000-0000-0000000000c1');
select t_assert((select count(*) from stock_transfers)=0,'admin toko tidak melihat riwayat transfer');
select t_assert((select count(*) from stock_movements where transfer_id is not null)>0,'admin Soso melihat pergerakan tokonya sendiri');
select t_assert((select count(*) from stock_movements where store_id=:'rea')=0,'admin Soso tidak melihat pergerakan Rea');
reset role;
select t_expect_error($q$update stock_transfers set note='x'$q$,'append-only');
select t_assert(not exists(select 1 from product_variants v where v.stock <> (select coalesce(sum(qty_delta),0) from stock_movements m where m.variant_id=v.id)),'ledger = saldo setelah transfer');
select 'SEMUA TES LOLOS' as hasil;
