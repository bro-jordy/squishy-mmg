-- Tes master barang (toko REA oleh admin Rea): create_product, add_variant, retur,
-- nonaktif, serta penolakan untuk kasir.
\set ON_ERROR_STOP on
select id as rea  from stores where kode = 'REA'  \gset
select id as soso from stores where kode = 'SOSO' \gset
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000b1');  -- Rea (admin REA)

-- tambah produk baru dengan 3 varian + stok awal
select create_product(:'rea',' Z1 ',' Squishy Baru ',45000,
  '[{"varian":"Maltose","warna":"Pink","stock":3},{"varian":"-","warna":"Biru","stock":2},{"varian":"","warna":"","stock":0}]'::jsonb) as pid \gset
select t_assert((select count(*) from product_variants where product_id=:'pid')=3,'3 varian');
select t_assert((select sku||'|'||name from products where id=:'pid')='Z1|Squishy Baru','trim');
select t_assert((select varian is null from product_variants where product_id=:'pid' and warna='Biru'),'"-" jadi null');
select t_assert((select sum(stock) from product_variants where product_id=:'pid')=5,'stok awal 5');
select t_assert((select count(*) from stock_movements m join product_variants v on v.id=m.variant_id where v.product_id=:'pid' and m.movement_type='opening')=2,'opening hanya stok>0');
select t_assert((select store_id from products where id=:'pid')=:'rea'::uuid,'produk masuk toko REA');
-- duplikat (case-insensitive), varian kembar, input salah, atomik
select t_expect_error(format($q$select create_product(%L,'z1','SQUISHY BARU',1000,'[{"warna":"x"}]')$q$,:'rea'),'sudah ada');
select t_expect_error(format($q$select create_product(%L,'Z2','Dobel',1000,'[{"warna":"Pink"},{"warna":"pink"}]')$q$,:'rea'),'kembar');
select t_assert((select count(*) from products where sku='Z2')=0,'produk gagal tidak tersimpan (atomik)');
select t_expect_error(format($q$select create_product(%L,'Z3','X',-1,'[{"warna":"x"}]')$q$,:'rea'),'Harga');
select t_expect_error(format($q$select create_product(%L,'Z3','X',1000,'[]')$q$,:'rea'),'varian');
select t_expect_error(format($q$select create_product(%L,'','X',1000,'[{"warna":"x"}]')$q$,:'rea'),'wajib');
select t_expect_error(format($q$select create_product(%L,'Z3','X',1000,'[{"warna":"x","stock":-1}]')$q$,:'rea'),'minus');
-- tambah varian ke produk yang ada
select add_variant(:'pid','Crunchy','Hijau',4) as vid \gset
select t_assert((select stock from product_variants where id=:'vid')=4,'varian baru stok 4');
select t_assert((select store_id from product_variants where id=:'vid')=:'rea'::uuid,'varian ikut toko produk');
select t_expect_error(format($q$select add_variant(%L,'crunchy','HIJAU',1)$q$,:'pid'),'sudah ada');
select t_expect_error($q$select add_variant(gen_random_uuid(),'a','b',1)$q$,'admin');
-- retur ke pemilik: mengurangi stok, perlu alasan, tidak boleh minus
select t_assert(adjust_stock(:'vid','return_owner',-4,'Retur ke pemilik')=0,'retur semua');
select t_expect_error(format($q$select adjust_stock(%L,'return_owner',-1,'x')$q$,:'vid'),'minus');
select t_expect_error(format($q$select adjust_stock(%L,'return_owner',2,'x')$q$,:'vid'),'check');
-- nonaktifkan: hilang dari penjualan
update products set is_active=false where id=:'pid';
select t_assert((select bool_and(not is_sellable) and bool_and(not product_active) from v_catalog where product_id=:'pid'),'nonaktif tidak sellable');
update product_variants set warna='Merah' where id=:'vid';
select t_expect_error(format($q$update product_variants set warna='Biru', varian=null where id=%L$q$,:'vid'),'duplicate key');
select t_expect_error(format($q$select checkout(%L,gen_random_uuid(),'cash',true,jsonb_build_array(jsonb_build_object('variant_id',%L,'qty',1)))$q$,:'rea',(select id from product_variants where product_id=:'pid' and warna='Biru')),'nonaktif');
update products set price=50000, name='Squishy Baru 2' where id=:'pid';
select t_assert((select price from products where id=:'pid')=50000,'harga berubah');
-- store_id tidak bisa dipindah lewat update
select t_expect_error(format($q$update products set store_id=%L where id=%L$q$,:'soso',:'pid'),'permission denied');

-- bulk opname (admin REA)
select t_vid(:'rea','A12','Ungu') as ungu \gset
select t_vid(:'rea','A12','Biru') as biru \gset
select t_vid(:'rea','A12','Hijau') as hijau \gset
select stock as ungu0 from product_variants where id=:'ungu' \gset
select stock as hijau0 from product_variants where id=:'hijau' \gset
select bulk_opname(:'rea', jsonb_build_array(
    jsonb_build_object('variant_id',:'ungu','counted',:ungu0 + 3),
    jsonb_build_object('variant_id',:'biru','counted',(select stock from product_variants where id=:'biru')),
    jsonb_build_object('variant_id',:'hijau','counted',0)),'Stok opname') as changed \gset
select t_assert(:changed = 2,'opname: hanya yang selisih dicatat (2 dari 3)');
select t_assert((select stock from product_variants where id=:'ungu')=:ungu0 + 3 and (select stock from product_variants where id=:'hijau')=0,'stok sesuai hasil hitung');
select t_assert((select reason from stock_movements where variant_id=:'ungu' order by id desc limit 1) = format('Stok opname (hitung %s, sistem %s)', :ungu0 + 3, :ungu0),'alasan opname memuat hitung & sistem');
-- atomik: satu varian tidak valid membatalkan semuanya
select stock as ungu1 from product_variants where id=:'ungu' \gset
select t_expect_error(format($q$select bulk_opname(%L, jsonb_build_array(jsonb_build_object('variant_id',%L,'counted',99), jsonb_build_object('variant_id','99999999-9999-9999-9999-999999999999','counted',1)),'x')$q$,:'rea',:'ungu'),'tidak ditemukan');
select t_assert((select stock from product_variants where id=:'ungu')=:ungu1,'opname gagal tidak mengubah apa pun');
select t_expect_error(format($q$select bulk_opname(%L, jsonb_build_array(jsonb_build_object('variant_id',%L,'counted',-1)),'x')$q$,:'rea',:'ungu'),'>= 0');
select t_expect_error(format($q$select bulk_opname(%L, jsonb_build_array(jsonb_build_object('variant_id',%L,'counted',5)),'  ')$q$,:'rea',:'ungu'),'Alasan');
select t_expect_error(format($q$select bulk_opname(%L,'[]'::jsonb,'x')$q$,:'rea'),'Tidak ada');

-- kasir TIDAK boleh
select t_as('00000000-0000-0000-0000-0000000000d1');
select t_expect_error(format($q$select create_product(%L,'K1','Kasir','1000','[{"warna":"x"}]')$q$,:'rea'),'admin');
select t_expect_error(format($q$select add_variant(%L,'a','b',1)$q$,:'pid'),'admin');
select t_expect_error(format($q$select adjust_stock(%L,'return_owner',-1,'x')$q$,:'vid'),'admin');
select t_expect_error(format($q$select bulk_opname(%L, jsonb_build_array(jsonb_build_object('variant_id',%L,'counted',5)),'x')$q$,:'rea',:'ungu'),'admin');
update products set price=1 where id=:'pid';
select t_assert((select price from products where id=:'pid')=50000,'kasir tidak bisa ubah harga');
select t_expect_error($q$delete from products$q$,'permission denied');
select t_expect_error($q$delete from product_variants$q$,'permission denied');
reset role;
select t_assert(not exists(select 1 from product_variants v where v.stock <> (select coalesce(sum(qty_delta),0) from stock_movements m where m.variant_id=v.id)),'ledger = saldo');
select 'TES BARU LOLOS' as hasil;
