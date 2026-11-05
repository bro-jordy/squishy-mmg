-- =====================================================================
-- Harga dasar pemilik (2026-11-05). Pemilik menurunkan harga, toko boleh menjual lebih tinggi:
-- setoran pemilik (75%) dihitung dari HARGA DASAR, selisih harga jual di atas harga dasar milik toko.
--  * products.base_price (boleh kosong = sama dengan harga jual)
--  * sale_items.base_unit_price = snapshot harga dasar saat transaksi (data lama diisi = unit_price,
--    jadi angka 25/75 lama TIDAK berubah)
--  * checkout() / edit_sale() / v_catalog / v_daily_summary diperbarui
-- Aman dijalankan berulang. Jalankan di Supabase SQL Editor.
-- =====================================================================
alter table products add column if not exists base_price integer check (base_price >= 0);
alter table sale_items add column if not exists base_unit_price integer check (base_unit_price >= 0);

-- Isi data lama (sale_items append-only: trigger dimatikan hanya selama pengisian ini).
alter table sale_items disable trigger trg_sale_items_immutable;
update sale_items set base_unit_price = unit_price where base_unit_price is null;
alter table sale_items enable trigger trg_sale_items_immutable;
alter table sale_items alter column base_unit_price set not null;

grant update (sku, name, price, base_price, description, image_url, is_active) on products to authenticated;

create or replace view v_catalog with (security_invoker = true) as
select v.id                                   as variant_id,
       p.id                                   as product_id,
       p.store_id,
       p.sku,
       case when s.shared_varian is not null
            then p.name || ' · ' || s.shared_varian
            else p.name end                   as display_name,
       case when s.shared_varian is not null
            then coalesce(v.warna, 'Standar')
            else coalesce(nullif(concat_ws(' · ', v.varian, v.warna), ''), 'Standar')
       end                                    as variant_label,
       p.price,
       v.stock,
       (p.is_active and v.is_active)          as is_sellable,
       p.name                                 as product_name,
       v.varian,
       v.warna,
       p.is_active                            as product_active,
       v.is_active                            as variant_active,
       p.base_price
from product_variants v
join products p on p.id = v.product_id
cross join lateral (
  select case when count(distinct coalesce(x.varian, '')) = 1 and max(x.varian) is not null
              then max(x.varian) end as shared_varian
  from product_variants x
  where x.product_id = p.id
) s;

create or replace view v_daily_summary with (security_invoker = true) as
with per_day as (
  select s.store_id,
         (s.sold_at at time zone 'Asia/Jakarta')::date as day,
         count(*)::integer                              as transaksi,
         sum(s.total)::integer                          as total_penjualan,
         sum(d.dasar)::integer                          as total_dasar
  from sales s
  cross join lateral (select coalesce(sum(i.qty * i.base_unit_price), 0) as dasar
                      from sale_items i where i.sale_id = s.id) d
  where s.status = 'completed' and s.payment_status = 'confirmed'
  group by s.store_id, 2
)
-- Bagian 75% (setoran pemilik) dihitung dari HARGA DASAR; Bagian 25% (bagian toko) = penjualan - setoran,
-- jadi selisih harga jual di atas harga dasar seluruhnya milik toko. Tanpa selisih hasilnya sama dengan 25/75 biasa.
select p.store_id, p.day, p.transaksi, p.total_penjualan,
       (p.total_penjualan - (p.total_dasar - ((p.total_dasar * st.pct_bagian_25 + 50) / 100)))::integer as bagian_25,
       (p.total_dasar - ((p.total_dasar * st.pct_bagian_25 + 50) / 100))::integer                       as bagian_75
from per_day p
join stores st on st.id = p.store_id;

create or replace function checkout(
  p_store_id          uuid,
  p_idempotency_key   uuid,
  p_payment_method    text,
  p_payment_confirmed boolean,
  p_items             jsonb,
  p_customer_name     text default null,
  p_note              text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sale_id   uuid;
  v_total     integer := 0;
  v_confirmed boolean;
  v_expected  integer;
  v_found     integer := 0;
  v_label     text;
  v_cashier   text;
  v_store     uuid;
  r           record;
begin
  if not can_access(p_store_id) then
    raise exception 'Tidak diizinkan' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency_key wajib diisi';
  end if;

  select id, store_id into v_sale_id, v_store from sales where idempotency_key = p_idempotency_key;
  if found then
    if v_store <> p_store_id then
      raise exception 'Kunci transaksi sudah dipakai di toko lain' using errcode = '42501';
    end if;
    return v_sale_id;
  end if;

  if p_payment_method not in ('cash', 'qris') then
    raise exception 'Metode pembayaran tidak valid: %', p_payment_method;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Keranjang kosong';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
             where coalesce((e->>'qty')::integer, 0) <= 0 or (e->>'variant_id') is null) then
    raise exception 'Setiap item wajib punya variant_id dan qty > 0';
  end if;

  v_confirmed := (p_payment_method = 'cash') or coalesce(p_payment_confirmed, false);
  select nama into v_cashier from profiles where id = auth.uid();

  begin
    insert into sales (store_id, sale_no, idempotency_key, customer_name, payment_method,
                       payment_status, payment_confirmed_at, note, cashier_name)
    values (p_store_id, next_sale_no(p_store_id), p_idempotency_key, nullif(btrim(p_customer_name), ''),
            p_payment_method,
            case when v_confirmed then 'confirmed' else 'unconfirmed' end,
            case when v_confirmed then now() end,
            nullif(btrim(p_note), ''), v_cashier)
    returning id into v_sale_id;
  exception when unique_violation then
    -- request ganda yang berjalan bersamaan: pakai transaksi pemenang
    select id into v_sale_id from sales
     where idempotency_key = p_idempotency_key and store_id = p_store_id;
    if v_sale_id is null then raise; end if;
    return v_sale_id;
  end;

  select count(distinct (e->>'variant_id')::uuid) into v_expected
  from jsonb_array_elements(p_items) e;

  -- Kunci baris varian (urut id → tidak deadlock), lalu validasi stok terbaru.
  -- Varian dari toko lain tidak ikut (v.store_id = p_store_id) → dianggap tidak ditemukan.
  for r in
    select v.id as variant_id, v.stock, v.is_active as v_active, v.varian, v.warna,
           p.is_active as p_active, p.price, coalesce(p.base_price, p.price) as base_price, p.name, p.sku, i.qty
    from (select (e->>'variant_id')::uuid as variant_id,
                 sum((e->>'qty')::integer)::integer as qty
          from jsonb_array_elements(p_items) e
          group by 1) i
    join product_variants v on v.id = i.variant_id and v.store_id = p_store_id
    join products p on p.id = v.product_id
    order by v.id
    for update of v
  loop
    v_found := v_found + 1;
    v_label := coalesce(nullif(concat_ws(' · ', r.varian, r.warna), ''), 'Standar');

    if not (r.v_active and r.p_active) then
      raise exception 'Barang nonaktif: % (%)', r.name, v_label;
    end if;
    if r.stock < r.qty then
      raise exception 'Stok tidak cukup: % (%): sisa %, diminta %', r.name, v_label, r.stock, r.qty
        using errcode = 'P0001';
    end if;

    insert into sale_items (store_id, sale_id, variant_id, qty, unit_price, base_unit_price, line_total,
                            sku, product_name, variant_label)
    values (p_store_id, v_sale_id, r.variant_id, r.qty, r.price, r.base_price, r.qty * r.price,
            r.sku, r.name, v_label);

    insert into stock_movements (store_id, variant_id, movement_type, qty_delta, reason, sale_id)
    values (p_store_id, r.variant_id, 'sale', -r.qty, 'Penjualan', v_sale_id);

    v_total := v_total + r.qty * r.price;
  end loop;

  if v_found <> v_expected then
    raise exception 'Ada varian yang tidak ditemukan di keranjang';
  end if;

  update sales set total = v_total where id = v_sale_id;
  return v_sale_id;
end $$;

create or replace function edit_sale(
  p_sale_id         uuid,
  p_payment_method  text,
  p_payment_confirmed boolean,
  p_items           jsonb,
  p_reason          text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s          sales%rowtype;
  v_before   jsonb;
  v_base     jsonb;   -- {variant_id: harga dasar} snapshot lama
  v_after    jsonb;
  v_total    integer := 0;
  v_confirmed boolean;
  v_name     text;
  v_label    text;
  v_delta    integer;
  r          record;
begin
  if not is_owner() then
    raise exception 'Hanya owner yang boleh mengedit transaksi' using errcode = '42501';
  end if;
  select * into s from sales where id = p_sale_id for update;
  if not found then raise exception 'Transaksi tidak ditemukan'; end if;
  if s.status <> 'completed' then
    raise exception 'Hanya transaksi selesai yang bisa diedit (transaksi void tidak)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Alasan edit wajib diisi';
  end if;
  if p_payment_method not in ('cash', 'qris', 'unpaid') then
    raise exception 'Metode pembayaran tidak valid: %', p_payment_method;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Transaksi harus punya minimal satu barang';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
             where (e->>'variant_id') is null
                or coalesce((e->>'qty')::integer, 0) <= 0
                or coalesce((e->>'unit_price')::integer, -1) < 0) then
    raise exception 'Setiap item wajib punya variant_id, qty > 0, dan harga >= 0';
  end if;
  if (select count(*) from jsonb_array_elements(p_items) e)
     <> (select count(distinct e->>'variant_id') from jsonb_array_elements(p_items) e) then
    raise exception 'Barang yang sama tidak boleh muncul dua kali';
  end if;

  select jsonb_build_object(
           'payment_method', s.payment_method, 'payment_status', s.payment_status, 'total', s.total,
           'items', coalesce(jsonb_agg(jsonb_build_object(
             'variant_id', i.variant_id, 'sku', i.sku, 'product_name', i.product_name,
             'variant_label', i.variant_label, 'qty', i.qty, 'unit_price', i.unit_price)
             order by i.product_name, i.variant_label), '[]'::jsonb))
    into v_before from sale_items i where i.sale_id = p_sale_id;
  select coalesce(jsonb_object_agg(i.variant_id::text, i.base_unit_price), '{}'::jsonb)
    into v_base from sale_items i where i.sale_id = p_sale_id;

  perform set_config('app.sale_edit', 'on', true);

  -- Selisih stok per varian (kunci baris varian berurutan id supaya tidak deadlock).
  for r in
    select v.id as variant_id, v.stock, v.is_active as v_active, p.is_active as p_active,
           p.name, p.sku, v.varian, v.warna,
           coalesce(o.qty, 0) as old_qty, coalesce(n.qty, 0) as new_qty
    from product_variants v
    join products p on p.id = v.product_id
    left join (select variant_id, qty from sale_items where sale_id = p_sale_id) o on o.variant_id = v.id
    left join (select (e->>'variant_id')::uuid as variant_id, (e->>'qty')::integer as qty
               from jsonb_array_elements(p_items) e) n on n.variant_id = v.id
    where v.store_id = s.store_id and (o.variant_id is not null or n.variant_id is not null)
    order by v.id
    for update of v
  loop
    v_label := coalesce(nullif(concat_ws(' · ', r.varian, r.warna), ''), 'Standar');
    v_delta := r.old_qty - r.new_qty;           -- > 0: stok kembali; < 0: stok keluar
    if r.old_qty = 0 and not (r.v_active and r.p_active) then
      raise exception 'Barang nonaktif: % (%)', r.name, v_label;
    end if;
    if v_delta < 0 and r.stock < -v_delta then
      raise exception 'Stok tidak cukup: % (%): sisa %, tambahan diminta %', r.name, v_label, r.stock, -v_delta
        using errcode = 'P0001';
    end if;
    if v_delta <> 0 then
      insert into stock_movements (store_id, variant_id, movement_type, qty_delta, reason, sale_id)
      values (s.store_id, r.variant_id, 'adjustment', v_delta,
              'Edit transaksi ' || s.sale_no || ': ' || btrim(p_reason), p_sale_id);
    end if;
  end loop;

  if (select count(*) from product_variants v
       where v.store_id = s.store_id
         and v.id in (select (e->>'variant_id')::uuid from jsonb_array_elements(p_items) e))
     <> jsonb_array_length(p_items) then
    raise exception 'Ada barang yang tidak ditemukan di toko ini';
  end if;

  -- Ganti isi transaksi: snapshot lama (v_before) dipertahankan untuk barang yang sudah ada.
  delete from sale_items where sale_id = p_sale_id;
  -- Harga dasar: barang yang sudah ada mempertahankan snapshot lama; barang baru pakai harga dasar produk.
  insert into sale_items (store_id, sale_id, variant_id, qty, unit_price, base_unit_price, line_total,
                          sku, product_name, variant_label)
  select s.store_id, p_sale_id, v.id, (e->>'qty')::integer, (e->>'unit_price')::integer,
         coalesce((v_base->>(v.id::text))::integer, p.base_price, p.price),
         (e->>'qty')::integer * (e->>'unit_price')::integer,
         coalesce(o->>'sku', p.sku), coalesce(o->>'product_name', p.name),
         coalesce(o->>'variant_label', coalesce(nullif(concat_ws(' · ', v.varian, v.warna), ''), 'Standar'))
  from jsonb_array_elements(p_items) e
  join product_variants v on v.id = (e->>'variant_id')::uuid and v.store_id = s.store_id
  join products p on p.id = v.product_id
  left join jsonb_array_elements(v_before->'items') o on (o->>'variant_id')::uuid = v.id;

  select coalesce(sum(line_total), 0)::integer into v_total from sale_items where sale_id = p_sale_id;

  v_confirmed := (p_payment_method = 'cash') or coalesce(p_payment_confirmed, false);
  update sales
     set payment_method = case when p_payment_method = 'unpaid' then null else p_payment_method end,
         payment_status = case when p_payment_method = 'unpaid' then 'unpaid'
                               when v_confirmed then 'confirmed' else 'unconfirmed' end,
         payment_confirmed_at = case when p_payment_method = 'unpaid' then null
                                     when v_confirmed then coalesce(s.payment_confirmed_at, now()) end,
         total = v_total,
         edited_at = now()
   where id = p_sale_id;

  select jsonb_build_object(
           'payment_method', case when p_payment_method = 'unpaid' then null else p_payment_method end,
           'payment_status', case when p_payment_method = 'unpaid' then 'unpaid'
                                  when v_confirmed then 'confirmed' else 'unconfirmed' end,
           'total', v_total,
           'items', coalesce(jsonb_agg(jsonb_build_object(
             'variant_id', i.variant_id, 'sku', i.sku, 'product_name', i.product_name,
             'variant_label', i.variant_label, 'qty', i.qty, 'unit_price', i.unit_price)
             order by i.product_name, i.variant_label), '[]'::jsonb))
    into v_after from sale_items i where i.sale_id = p_sale_id;

  select nama into v_name from profiles where id = auth.uid();
  insert into sale_edits (store_id, sale_id, edited_by_name, reason, before, after)
  values (s.store_id, p_sale_id, v_name, btrim(p_reason), v_before, v_after);
end $$;
