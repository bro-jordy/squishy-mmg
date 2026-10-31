-- Tes pesanan ditahan (belum bayar): hold_sale, pay_hold, void, idempotensi, izin.
\set ON_ERROR_STOP on
select id as rea from stores where kode = 'REA' \gset
set role authenticated;

select t_as('00000000-0000-0000-0000-0000000000d1');  -- kasir REA
select t_vid(:'rea','A12','Ungu') as ungu \gset
select stock as s0 from product_variants where id = :'ungu' \gset

select hold_sale(:'rea','77777777-7777-7777-7777-777777777777',
  jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',2)),'April',null) as h \gset
select t_assert((select stock from product_variants where id=:'ungu')=:s0-2,'hold: stok langsung berkurang');
select t_assert((select payment_status from sales where id=:'h')='unpaid','hold: status unpaid');
select t_assert((select payment_method from sales where id=:'h') is null,'hold: metode kosong');
select t_assert((select total from sales where id=:'h')=70000,'hold: total benar');

-- key sama = pesanan sama, stok tidak berkurang lagi
select t_assert(hold_sale(:'rea','77777777-7777-7777-7777-777777777777',
  jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',2)),'April',null)=:'h','hold: idempoten');
select t_assert((select stock from product_variants where id=:'ungu')=:s0-2,'hold ulang: stok tetap');

-- belum dihitung sebagai penjualan
select t_assert((select count(*) from sales where id=:'h' and payment_status='confirmed')=0,'hold: belum lunas');

-- metode tidak valid & izin
select t_expect_error(format($q$select pay_hold(%L,'transfer',true)$q$,:'h'),'Metode');
select t_as('00000000-0000-0000-0000-0000000000d2');  -- kasir lain (bukan pembuat)
select t_expect_error(format($q$select pay_hold(%L,'cash',true)$q$,:'h'),'Tidak diizinkan');

-- pembuat menandai sudah bayar (QRIS belum dicek -> unconfirmed; lalu hold lain tunai -> confirmed)
select t_as('00000000-0000-0000-0000-0000000000d1');
select pay_hold(:'h','cash',false);
select t_assert((select payment_status from sales where id=:'h')='confirmed','bayar tunai: lunas');
select t_assert((select payment_method from sales where id=:'h')='cash','bayar tunai: metode cash');
select t_assert((select payment_confirmed_at from sales where id=:'h') is not null,'bayar tunai: waktu terisi');
select t_assert((select stock from product_variants where id=:'ungu')=:s0-2,'bayar: stok tidak berubah');
select t_expect_error(format($q$select pay_hold(%L,'cash',true)$q$,:'h'),'menunggu pembayaran');

-- hold lalu QRIS tanpa centang = unconfirmed
select hold_sale(:'rea','88888888-8888-8888-8888-888888888888',
  jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',1)),null,null) as h2 \gset
select pay_hold(:'h2','qris',false);
select t_assert((select payment_status from sales where id=:'h2')='unconfirmed','qris tanpa cek: belum dikonfirmasi');

-- hold lalu dibatalkan (void oleh admin toko) mengembalikan stok
select hold_sale(:'rea','99999999-9999-9999-9999-999999999999',
  jsonb_build_array(jsonb_build_object('variant_id',:'ungu','qty',1)),null,null) as h3 \gset
select t_as('00000000-0000-0000-0000-0000000000b1');  -- admin REA
select void_sale(:'h3','batal pesan');
select t_assert((select stock from product_variants where id=:'ungu')=:s0-3,'void hold: stok kembali (hanya hold ketiga)');

-- constraint: tunai tidak boleh unconfirmed, unpaid wajib tanpa metode
reset role;
select t_expect_error($q$update sales set payment_status='unpaid' where payment_method='cash' and payment_status='confirmed'$q$,'check');
select 'LOLOS 07_hold_sale';
