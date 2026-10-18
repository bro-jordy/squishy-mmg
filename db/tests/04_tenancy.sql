-- Tes isolasi antar toko dan pengelolaan pengguna.
-- Soso (admin SOSO) TIDAK boleh melihat/mengubah apa pun di toko REA, dan sebaliknya.
\set ON_ERROR_STOP on
select id as rea  from stores where kode = 'REA'  \gset
select id as soso from stores where kode = 'SOSO' \gset

-- Acuan stok toko REA sebelum Soso bertindak (varian A12 Ungu).
select v.id as r_ungu from product_variants v join products p on p.id = v.product_id
 where v.store_id = :'rea' and p.sku = 'A12' and v.warna = 'Ungu' \gset
select stock as r_ungu0 from product_variants where id = :'r_ungu' \gset

-- Toko SOSO mulai kosong: Soso menambahkan barangnya sendiri (SKU sama persis dengan REA
-- itu diperbolehkan), lalu mengisi stok lewat opname massal.
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000c1');  -- Soso
select create_product(:'soso','A12','Squishy Ice Cube',35000,
  '[{"varian":"Maltose","warna":"Ungu","stock":0},{"varian":"Maltose","warna":"Biru","stock":0}]'::jsonb) is not null as p1 \gset
select create_product(:'soso','A27','Squishy Dumpling Mini',5000,'[{"varian":"-","warna":"-","stock":0}]'::jsonb) is not null as p2 \gset
select t_assert((select count(*) from products where sku = 'A12') = 1, 'SKU sama dengan REA diperbolehkan; Soso hanya melihat miliknya');
select t_vid(:'soso','A12','Ungu') as s_ungu \gset
select t_vid(:'soso','A27') as s_dumpling \gset
select bulk_opname(:'soso', jsonb_build_array(
  jsonb_build_object('variant_id',:'s_ungu','counted',4),
  jsonb_build_object('variant_id',:'s_dumpling','counted',50)),'Stok opname') as n \gset
select t_assert(:n = 2, 'Soso mengisi stok tokonya lewat opname massal');
select t_assert((select stock from product_variants where id=:'s_ungu') = 4, 'stok SOSO Ungu = 4');

-- stok toko lain tidak ikut berubah (SKU sama persis)
select t_as('00000000-0000-0000-0000-0000000000b1');  -- Rea
select t_assert((select stock from product_variants where id=:'r_ungu') = :r_ungu0, 'stok REA Ungu tidak berubah oleh opname SOSO');

-- ===== Soso tidak melihat apa pun milik REA =====
select t_as('00000000-0000-0000-0000-0000000000c1');
select t_assert((select count(*) from stores) = 1 and (select kode from stores) = 'SOSO', 'Soso hanya melihat tokonya');
select t_assert((select count(*) from products where store_id = :'rea') = 0, 'produk REA tersembunyi');
select t_assert((select count(*) from product_variants where store_id = :'rea') = 0, 'varian REA tersembunyi');
select t_assert((select count(*) from v_catalog where store_id = :'rea') = 0, 'katalog REA tersembunyi');
select t_assert((select count(*) from sales where store_id = :'rea') = 0, 'transaksi REA tersembunyi');
select t_assert((select count(*) from sale_items where store_id = :'rea') = 0, 'item transaksi REA tersembunyi');
select t_assert((select count(*) from stock_movements where store_id = :'rea') = 0, 'riwayat stok REA tersembunyi');
select t_assert((select count(*) from settlements where store_id = :'rea') = 0, 'setoran REA tersembunyi');
select t_assert((select count(*) from v_daily_summary where store_id = :'rea') = 0, 'rekap REA tersembunyi');
select t_assert((select count(*) from v_settlement_balance where store_id = :'rea') = 0, 'saldo REA tersembunyi');
select t_assert((select count(*) from store_members where store_id = :'rea') = 0, 'anggota REA tersembunyi');
select t_assert((select count(*) from profiles where id <> '00000000-0000-0000-0000-0000000000c1') = 0, 'profil orang lain tersembunyi');

-- ===== Soso tidak bisa menulis ke toko REA =====
select t_expect_error(format($q$select checkout(%L,gen_random_uuid(),'cash',true,jsonb_build_array(jsonb_build_object('variant_id',%L,'qty',1)))$q$,:'rea',:'r_ungu'),'Tidak diizinkan');
-- varian toko lain lewat toko sendiri = "tidak ditemukan" (dan tidak ada transaksi tersisa)
select t_expect_error(format($q$select checkout(%L,gen_random_uuid(),'cash',true,jsonb_build_array(jsonb_build_object('variant_id',%L,'qty',1)))$q$,:'soso',:'r_ungu'),'tidak ditemukan');
select t_assert((select count(*) from sales) = 0, 'checkout gagal tidak meninggalkan transaksi');
select t_expect_error(format($q$select adjust_stock(%L,'restock',5,'x')$q$,:'r_ungu'),'admin');
select t_expect_error(format($q$select bulk_opname(%L, jsonb_build_array(jsonb_build_object('variant_id',%L,'counted',1)),'x')$q$,:'rea',:'r_ungu'),'admin');
select t_expect_error(format($q$select bulk_opname(%L, jsonb_build_array(jsonb_build_object('variant_id',%L,'counted',1)),'x')$q$,:'soso',:'r_ungu'),'tidak ditemukan');
select t_expect_error(format($q$select create_product(%L,'ZZ','X',1,'[{"warna":"x"}]')$q$,:'rea'),'admin');
select t_expect_error(format($q$select add_variant((select id from products where store_id=%L limit 1),'a','b',1)$q$,:'rea'),'admin');
select t_expect_error(format($q$select list_members(%L)$q$,:'rea'),'admin');
select t_expect_error(format($q$select add_member(%L,'baru@t.test','Baru','kasir')$q$,:'rea'),'admin');
select t_expect_error(format($q$select set_member(%L,'00000000-0000-0000-0000-0000000000d1','kasir',false)$q$,:'rea'),'admin');
select t_expect_error(format($q$insert into settlements(store_id,amount) values (%L,1000)$q$,:'rea'),'row-level security');
update products set price = 1 where store_id = :'rea';
update product_variants set is_active = false where store_id = :'rea';
select t_assert((select count(*) from products where store_id=:'rea') = 0, 'update lintas toko tidak berefek (tersembunyi)');

-- ===== transaksi Rea di REA tidak mengubah SOSO; nomor transaksi per toko =====
select t_as('00000000-0000-0000-0000-0000000000b1');  -- Rea
select checkout(:'rea','22222222-2222-2222-2222-222222222222','cash',true,jsonb_build_array(jsonb_build_object('variant_id',:'r_ungu','qty',1))) as rsale \gset
select t_as('00000000-0000-0000-0000-0000000000a1');  -- owner memeriksa kedua toko
select t_assert((select stock from product_variants where id=:'s_ungu') = 4, 'stok SOSO tidak terpengaruh penjualan REA');
select t_assert((select stock from product_variants where id=:'r_ungu') = :r_ungu0 - 1, 'stok REA berkurang oleh penjualan REA');
select t_as('00000000-0000-0000-0000-0000000000b1');
select t_assert((select sale_no from sales where id=:'rsale') ~ '^REA-', 'nomor REA');
select t_assert((select cashier_name from sales where id=:'rsale') = 'Rea', 'nama kasir = akun yang login');
-- kunci transaksi yang sama tidak bisa dipakai di toko lain
select t_as('00000000-0000-0000-0000-0000000000a1');  -- owner (bisa di kedua toko)
select t_expect_error(format($q$select checkout(%L,'22222222-2222-2222-2222-222222222222','cash',true,jsonb_build_array(jsonb_build_object('variant_id',%L,'qty',1)))$q$,:'soso',:'s_ungu'),'toko lain');
select checkout(:'soso',gen_random_uuid(),'cash',true,jsonb_build_array(jsonb_build_object('variant_id',:'s_ungu','qty',1))) as osale \gset
select t_assert((select sale_no from sales where id=:'osale') ~ '^SOSO-\d{6}-0001$', 'nomor SOSO mulai 0001 sendiri');
select t_assert((select stock from product_variants where id=:'s_ungu') = 3, 'stok SOSO berkurang oleh penjualan SOSO');
select t_assert((select cashier_name from sales where id=:'osale') = 'Owner', 'nama owner tercatat');
select t_assert((select count(*) from stores) = 2, 'owner melihat kedua toko');
select t_assert((select count(distinct store_id) from sales) = 2, 'owner melihat transaksi kedua toko');
select t_assert((select count(*) from v_catalog where store_id=:'soso') = 3
              and (select count(*) from v_catalog where store_id=:'rea') >= 73
              and (select count(*) from v_catalog) = (select count(*) from v_catalog where store_id=:'soso') + (select count(*) from v_catalog where store_id=:'rea'),
  'owner melihat katalog kedua toko');
-- produk baru di REA (tes 02) tidak muncul di SOSO
select t_assert((select count(*) from v_catalog where store_id=:'soso' and sku='Z1') = 0, 'produk baru REA tidak ada di SOSO');
-- Soso melihat transaksinya (dibuat owner) karena ia admin tokonya
select t_as('00000000-0000-0000-0000-0000000000c1');
select t_assert((select count(*) from sales) = 1, 'admin SOSO melihat semua transaksi tokonya');
-- persen per toko
reset role;
update stores set pct_bagian_25 = 30 where kode = 'SOSO';
set role authenticated;
select t_assert((select bagian_25 from v_daily_summary where store_id=:'soso') = 10500 and (select bagian_75 from v_daily_summary where store_id=:'soso') = 24500, 'persen bagi hasil per toko (30% dari 35000)');
reset role;
update stores set pct_bagian_25 = 25 where kode = 'SOSO';

-- ===== keanggotaan =====
set role authenticated;
-- kasir REA tidak bisa masuk ke SOSO
select t_as('00000000-0000-0000-0000-0000000000d1');
select t_assert((select count(*) from stores) = 1 and (select kode from stores) = 'REA', 'kasir hanya melihat tokonya');
select t_assert((select count(*) from v_catalog where store_id = :'soso') = 0, 'kasir tidak melihat katalog SOSO');
select t_expect_error(format($q$select checkout(%L,gen_random_uuid(),'cash',true,jsonb_build_array(jsonb_build_object('variant_id',%L,'qty',1)))$q$,:'soso',:'s_ungu'),'Tidak diizinkan');
select t_expect_error(format($q$select list_members(%L)$q$,:'rea'),'admin');
-- admin REA mengelola kasir
select t_as('00000000-0000-0000-0000-0000000000b1');
select t_assert((select count(*) from list_members(:'rea')) = 2, 'list_members: Rea & kasir');
select t_assert((select email from list_members(:'rea') where role = 'kasir') = 'kasir@t.test', 'email tampil');
select t_expect_error(format($q$select add_member(%L,'tidak-ada@t.test','X','kasir')$q$,:'rea'),'belum dibuat');
select t_expect_error(format($q$select add_member(%L,'baru@t.test','Baru','admin')$q$,:'rea'),'owner platform');
select t_expect_error(format($q$select add_member(%L,'owner@t.test','X','kasir')$q$,:'rea'),'owner platform');
select add_member(:'rea','baru@t.test','Kasir Baru','kasir');
select t_assert((select nama from profiles where id='00000000-0000-0000-0000-0000000000e1') = 'Kasir Baru', 'profil dibuat saat ditambahkan');
select t_assert((select count(*) from list_members(:'rea')) = 3, 'anggota bertambah');
-- admin tidak boleh mengubah admin lain / menaikkan jadi admin / menonaktifkan diri
select t_expect_error(format($q$select set_member(%L,'00000000-0000-0000-0000-0000000000e1','admin',true)$q$,:'rea'),'kasir');
select t_expect_error(format($q$select set_member(%L,'00000000-0000-0000-0000-0000000000b1','kasir',true)$q$,:'rea'),'kasir');
-- nonaktifkan kasir -> kehilangan akses (riwayat tetap)
select set_member(:'rea','00000000-0000-0000-0000-0000000000d1','kasir',false);
select t_as('00000000-0000-0000-0000-0000000000d1');
select t_assert((select count(*) from stores) = 0, 'kasir nonaktif tidak melihat toko');
select t_assert((select count(*) from v_catalog) = 0, 'kasir nonaktif tidak melihat katalog');
select t_expect_error(format($q$select checkout(%L,gen_random_uuid(),'cash',true,jsonb_build_array(jsonb_build_object('variant_id',%L,'qty',1)))$q$,:'rea',:'r_ungu'),'Tidak diizinkan');
select t_as('00000000-0000-0000-0000-0000000000b1');
select t_assert((select count(*) from sales where cashier_name = 'Kasir Rea') >= 1, 'riwayat transaksi kasir tetap ada');
select set_member(:'rea','00000000-0000-0000-0000-0000000000d1','kasir',true);
select t_as('00000000-0000-0000-0000-0000000000d1');
select t_assert((select count(*) from stores) = 1, 'diaktifkan lagi: bisa masuk');
-- owner boleh menjadikan admin
select t_as('00000000-0000-0000-0000-0000000000a1');
select set_member(:'rea','00000000-0000-0000-0000-0000000000e1','admin',true);
select t_assert((select role from list_members(:'rea') where user_id='00000000-0000-0000-0000-0000000000e1') = 'admin', 'owner menjadikan admin');
-- akun nonaktif global (profiles.is_active) tidak punya akses sama sekali
reset role;
update profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000b1';
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000b1');
select t_assert((select count(*) from stores) = 0 and (select count(*) from products) = 0, 'profil nonaktif: tidak ada akses');
reset role;
update profiles set is_active = true where id = '00000000-0000-0000-0000-0000000000b1';
select t_assert(not exists(select 1 from product_variants v where v.stock <> (select coalesce(sum(qty_delta),0) from stock_movements m where m.variant_id=v.id)),'ledger = saldo');
select 'TES TENANCY LOLOS' as hasil;
