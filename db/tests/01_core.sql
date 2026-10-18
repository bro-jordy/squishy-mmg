-- Tes inti (toko REA): checkout, stok, void, harga snapshot, QRIS, penyesuaian stok,
-- hak kasir vs admin, setoran. Hanya untuk database uji sementara.
\set ON_ERROR_STOP on

-- ---- pengguna uji ------------------------------------------------------------
-- a1 = owner platform | b1 = Rea (admin toko REA) | c1 = Soso (admin toko SOSO)
-- d1 = kasir toko REA | e1 = punya login tapi belum terdaftar di toko mana pun
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@t.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'rea@t.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'soso@t.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'kasir@t.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'baru@t.test');
insert into profiles (id, nama, is_platform_owner) values
  ('00000000-0000-0000-0000-0000000000a1', 'Owner', true),
  ('00000000-0000-0000-0000-0000000000b1', 'Rea', false),
  ('00000000-0000-0000-0000-0000000000c1', 'Soso', false),
  ('00000000-0000-0000-0000-0000000000d1', 'Kasir Rea', false);
insert into store_members (store_id, user_id, role)
  select id, '00000000-0000-0000-0000-0000000000b1', 'admin' from stores where kode = 'REA';
insert into store_members (store_id, user_id, role)
  select id, '00000000-0000-0000-0000-0000000000c1', 'admin' from stores where kode = 'SOSO';
insert into store_members (store_id, user_id, role)
  select id, '00000000-0000-0000-0000-0000000000d1', 'kasir' from stores where kode = 'REA';

select id as rea  from stores where kode = 'REA'  \gset
select id as soso from stores where kode = 'SOSO' \gset

create or replace function public.t_as(p_uid text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', p_uid, false) $$;
create or replace function public.t_expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if sqlerrm ilike '%'||p_like||'%' then return; end if;
    raise exception 'error salah: % (harap mengandung %)', sqlerrm, p_like;
  end;
  raise exception 'HARUSNYA GAGAL: %', p_sql;
end $$;
create or replace function public.t_assert(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_ok,false) then raise exception 'ASSERT GAGAL: %', p_msg; end if; end $$;
create or replace function public.t_vid(p_store uuid, p_sku text, p_warna text default null) returns uuid
language sql as $$
  select variant_id from v_catalog
  where store_id = p_store and sku = p_sku and (p_warna is null or warna = p_warna) limit 1 $$;
grant execute on function public.t_as(text), public.t_expect_error(text, text),
  public.t_assert(boolean, text), public.t_vid(uuid, text, text) to authenticated;

-- ---- data awal & aturan tampilan katalog (sebagai owner, lihat semua toko) --------
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000a1');
select t_assert((select count(*) from v_catalog where store_id = :'rea') = 73, 'REA: 73 varian');
select t_assert((select count(*) from v_catalog where store_id = :'soso') = 0, 'SOSO: dimulai kosong (belum ada barang)');
select t_assert((select sum(stock) from v_catalog where store_id = :'rea') = 388, 'stok REA = stock awal');
select t_assert((select count(*) from products where store_id = :'soso') = 0, 'SOSO: tanpa produk');
select t_assert((select display_name from v_catalog where store_id=:'rea' and sku='A95' limit 1)='Squishy Cheese Cube · Coconut Oil','A95 judul');
select t_assert((select display_name from v_catalog where store_id=:'rea' and sku='A17' limit 1)='Squishy Cheese Cube','A17 judul');
select t_assert((select count(*) from v_catalog where store_id=:'rea' and sku='A33')=6 and (select count(distinct product_id) from v_catalog where store_id=:'rea' and sku='A33')=1,'A33 satu produk 6 varian');
select t_assert((select variant_label from v_catalog where store_id=:'rea' and sku='A27')='Standar','dumpling label');
select t_assert((select count(*) from v_catalog where store_id=:'rea' and sku='A1')=13,'roti 13 varian');

-- ---- checkout oleh kasir REA ------------------------------------------------------
select t_as('00000000-0000-0000-0000-0000000000d1');
select t_assert((select count(*) from v_catalog) = 73, 'kasir hanya melihat katalog tokonya');
select t_vid(:'rea','A12','Ungu') as ungu \gset
select t_vid(:'rea','A12','Biru') as biru \gset
select t_vid(:'rea','A37','Orange') as gummy \gset
select t_vid(:'rea','A25') as pizza \gset
select checkout(:'rea','11111111-1111-1111-1111-111111111111','cash',true,
  jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',1)),'Tes',null) as sale1 \gset
select t_assert((select stock from product_variants where id=:'ungu')=1,'Ungu 2->1');
select t_assert((select stock from product_variants where id=:'biru')=2,'Biru tetap 2');
select t_assert((select total from sales where id=:'sale1')=35000,'total 35000');
select t_assert((select cashier_name from sales where id=:'sale1')='Kasir Rea','nama kasir tercatat');
select t_assert((select sale_no from sales where id=:'sale1') ~ '^REA-\d{6}-0001$','nomor transaksi berawalan kode toko');

-- idempotent
select checkout(:'rea','11111111-1111-1111-1111-111111111111','cash',true,
  jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',1))) = :'sale1'::uuid as same \gset
select t_assert(:'same','idempotent');
select t_assert((select stock from product_variants where id=:'ungu')=1,'stok tetap 1 setelah retry');
select t_assert((select count(*) from sales)=1,'masih 1 sale');

-- stok kurang ditolak, tidak ada sisa data; item kembar digabung
select t_expect_error(format($q$select checkout(%L,gen_random_uuid(),'cash',true,
  jsonb_build_array(jsonb_build_object('variant_id',%L,'qty',3)))$q$,:'rea',:'gummy'),'Stok tidak cukup');
select t_assert((select count(*) from sales)=1,'sale gagal tidak tersimpan');
select t_expect_error(format($q$select checkout(%L,gen_random_uuid(),'cash',true,
  jsonb_build_array(jsonb_build_object('variant_id',%L,'qty',2),jsonb_build_object('variant_id',%L,'qty',1)))$q$,:'rea',:'gummy',:'gummy'),'Stok tidak cukup');
select t_expect_error(format($q$select checkout(%L,gen_random_uuid(),'cash',true,'[]'::jsonb)$q$,:'rea'),'Keranjang kosong');
select t_expect_error(format($q$select checkout(%L,gen_random_uuid(),'cash',true,
  jsonb_build_array(jsonb_build_object('variant_id','99999999-9999-9999-9999-999999999999','qty',1)))$q$,:'rea'),'tidak ditemukan');

-- QRIS belum dikonfirmasi tidak masuk rekap; setelah konfirmasi masuk
select checkout(:'rea','66666666-6666-6666-6666-666666666666','qris',false,
  jsonb_build_array(jsonb_build_object('variant_id',:'biru','qty',1))) as sale2 \gset
select t_assert((select payment_status from sales where id=:'sale2')='unconfirmed','qris unconfirmed');
select t_assert((select total_penjualan from v_daily_summary where store_id=:'rea')=35000,'rekap hanya yg terkonfirmasi');
select confirm_payment(:'sale2');
select t_assert((select total_penjualan from v_daily_summary where store_id=:'rea')=70000,'rekap setelah konfirmasi 70000');
select t_assert((select bagian_25 from v_daily_summary where store_id=:'rea')=17500 and (select bagian_75 from v_daily_summary where store_id=:'rea')=52500,'25/75');

-- harga snapshot tidak berubah ketika harga produk diedit (admin REA)
select t_as('00000000-0000-0000-0000-0000000000b1');
update products set price=99000 where store_id=:'rea' and sku='A12';
select t_assert((select unit_price from sale_items where sale_id=:'sale1')=35000,'snapshot harga');
update products set price=35000 where store_id=:'rea' and sku='A12';

-- void: kasir ditolak; admin perlu alasan; stok kembali sekali
select t_as('00000000-0000-0000-0000-0000000000d1');
select t_expect_error(format($q$select void_sale(%L,'salah input')$q$,:'sale1'),'admin');
select t_as('00000000-0000-0000-0000-0000000000b1');
select t_expect_error(format($q$select void_sale(%L,'  ')$q$,:'sale1'),'Alasan void');
select void_sale(:'sale1','salah input'); select void_sale(:'sale1','salah input');  -- 2x
select t_assert((select stock from product_variants where id=:'ungu')=2,'stok kembali tepat sekali');
select t_assert((select status from sales where id=:'sale1')='void','status void');
select t_assert((select voided_by_name from sales where id=:'sale1')='Rea','nama pemvoid tercatat');
select t_assert((select total_penjualan from v_daily_summary where store_id=:'rea')=35000,'void keluar dari rekap');
select t_assert((select count(*) from stock_movements where sale_id=:'sale1')=2,'1 sale + 1 void movement');

-- penyesuaian stok: wajib alasan, tidak boleh minus; kasir ditolak
select t_expect_error(format($q$select adjust_stock(%L,'damaged',-1,'')$q$,:'ungu'),'Alasan');
select t_expect_error(format($q$select adjust_stock(%L,'damaged',-99,'rusak')$q$,:'ungu'),'minus');
select t_assert(adjust_stock(:'ungu','damaged',-1,'rusak')=1,'adjust damaged');
select t_assert(adjust_stock(:'ungu','restock',5,'barang masuk')=6,'adjust restock');
select t_as('00000000-0000-0000-0000-0000000000d1');
select t_expect_error(format($q$select adjust_stock(%L,'restock',1,'x')$q$,:'ungu'),'admin');

-- hak kasir: tidak bisa menulis langsung; hanya melihat transaksi sendiri
select t_expect_error($q$update product_variants set stock=999$q$,'permission denied');
select t_expect_error($q$insert into sales(store_id,sale_no,idempotency_key,payment_method,payment_status) select id,'x',gen_random_uuid(),'cash','confirmed' from stores limit 1$q$,'permission denied');
select t_expect_error($q$insert into stock_movements(store_id,variant_id,movement_type,qty_delta,reason) select store_id,id,'restock',5,'x' from product_variants limit 1$q$,'permission denied');
select t_expect_error($q$delete from stock_movements$q$,'permission denied');
update products set price=1 where sku='A12';
select t_assert((select price from products where sku='A12')=35000,'kasir tidak bisa ubah harga (RLS)');
select t_assert((select count(*) from stock_movements)=0,'kasir tidak melihat riwayat stok');
select t_assert((select count(*) from settlements)=0,'kasir tidak melihat setoran');
select t_assert((select count(*) from v_settlement_balance)=0,'kasir tidak lihat saldo setoran');
-- transaksi rekan: dibuat admin, tidak terlihat oleh kasir
select t_as('00000000-0000-0000-0000-0000000000b1');
select checkout(:'rea',gen_random_uuid(),'cash',true,jsonb_build_array(jsonb_build_object('variant_id',:'pizza','qty',1))) as sale_admin \gset
select t_assert((select count(*) from sales where store_id=:'rea')=3,'admin melihat semua transaksi toko');
select t_as('00000000-0000-0000-0000-0000000000d1');
select t_assert((select count(*) from sales)=2,'kasir hanya melihat transaksinya sendiri');
select t_assert((select count(*) from sale_items where sale_id=:'sale_admin')=0,'item transaksi rekan juga tersembunyi');
select t_expect_error(format($q$select confirm_payment(%L)$q$,:'sale_admin'),'Tidak diizinkan');
reset role;
-- anon: tidak ada akses
set role anon;
select t_expect_error($q$select * from products$q$,'permission denied');
select t_expect_error($q$select checkout(gen_random_uuid(),gen_random_uuid(),'cash',true,'[]')$q$,'permission denied');
reset role;
select t_expect_error($q$update stock_movements set reason='x'$q$,'append-only');

-- setoran + saldo (admin REA)
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000b1');
insert into settlements(store_id,amount,recipient,note) values (:'rea',20000,'Pemilik barang','cicil');
select t_assert((select sisa from v_settlement_balance where store_id=:'rea') = 52500 - 20000 and (select status from v_settlement_balance where store_id=:'rea')='sebagian','saldo setoran');
reset role;
select t_assert(not exists(select 1 from product_variants v where v.stock <> (select coalesce(sum(qty_delta),0) from stock_movements m where m.variant_id=v.id)),'ledger = saldo');
select 'SEMUA TES LOLOS' as hasil;
