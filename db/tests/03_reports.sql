-- Tes rekap & setoran per toko: kelebihan setor setelah void, hak lihat.
\set ON_ERROR_STOP on
select id as rea  from stores where kode = 'REA'  \gset
select id as soso from stores where kode = 'SOSO' \gset
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000b1');  -- admin REA

select total_bagian_75 as t75 from v_settlement_balance where store_id = :'rea' \gset
select t_assert((select sudah_disetor from v_settlement_balance where store_id=:'rea') = 20000, 'setoran dari tes 01 terbaca');
-- setoran melebihi total -> 'kelebihan' (mis. void sesudah setor), bukan error
insert into settlements(store_id, amount, note) values (:'rea', :t75 + 1000, 'uji kelebihan');
select t_assert((select status from v_settlement_balance where store_id=:'rea') = 'kelebihan', 'status kelebihan');
select t_assert((select sisa from v_settlement_balance where store_id=:'rea') < 0, 'sisa negatif');
delete from settlements where store_id = :'rea';
select t_assert((select status from v_settlement_balance where store_id=:'rea') = 'belum', 'tanpa setoran = belum');
select t_expect_error(format($q$insert into settlements(store_id, amount, period_start, period_end) values (%L,1000,'2026-10-18','2026-10-17')$q$,:'rea'),'check');
select t_expect_error(format($q$insert into settlements(store_id, amount) values (%L,0)$q$,:'rea'),'check');
select t_assert(not exists(select 1 from v_daily_summary where bagian_25 + bagian_75 <> total_penjualan), '25+75 = total');
reset role;
select 'TES REKAP LOLOS' as hasil;
