-- Uji transfer stok di SALINAN data production (dipakai scripts/dryrun_migration.sh, bukan test_db.sh).
-- Rea A12.1 Squishy QQ Candy -> Soso "SQUISHY QQ CANDY" (SKU beda, nama sama), sebagai owner asli.
\set ON_ERROR_STOP on
select id as owner from profiles where is_platform_owner limit 1 \gset
select id as rea  from stores where kode = 'REA'  \gset
select id as soso from stores where kode = 'SOSO' \gset
select v.id as rv, v.stock as rs from product_variants v join products p on p.id = v.product_id
 where p.store_id = :'rea' and p.sku = 'A12.1' and v.stock > 0 order by v.stock desc limit 1 \gset
select v.id as sv, v.stock as ss from product_variants v join products p on p.id = v.product_id
 where p.store_id = :'soso' and lower(p.name) = 'squishy qq candy' limit 1 \gset
select sum(stock) as total0 from product_variants \gset

set role authenticated;
select set_config('request.jwt.claim.sub', :'owner', false);
select transfer_stock(:'rea', :'soso',
  jsonb_build_array(jsonb_build_object(
    'from', jsonb_build_array(jsonb_build_object('variant_id', :'rv', 'qty', 1)),
    'to',   jsonb_build_array(jsonb_build_object('variant_id', :'sv', 'qty', 1)))), 'dry-run') as t \gset
-- pembagi nol = pemeriksaan gagal
select 1 / (case when (select stock from product_variants where id = :'rv') = :rs - 1 then 1 else 0 end) as stok_rea_turun;
select 1 / (case when (select stock from product_variants where id = :'sv') = :ss + 1 then 1 else 0 end) as stok_soso_naik;
select 1 / (case when (select count(*) from stock_movements where transfer_id = :'t') = 2 then 1 else 0 end) as dua_pergerakan;
select 1 / (case when (select count(*) from stock_transfers) = 1 then 1 else 0 end) as riwayat_tercatat;
reset role;
select 1 / (case when (select sum(stock) from product_variants) = :total0 then 1 else 0 end) as total_stok_tetap;
select 1 / (case when not exists (select 1 from product_variants v where v.stock <> (select coalesce(sum(qty_delta), 0) from stock_movements m where m.variant_id = v.id)) then 1 else 0 end) as ledger_sama_saldo;
select 'SEMUA TES LOLOS' as hasil;
