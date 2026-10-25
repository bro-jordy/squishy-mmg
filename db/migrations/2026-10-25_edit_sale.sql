-- =====================================================================
-- Edit transaksi selesai (HANYA owner platform).
-- Boleh mengubah metode pembayaran, status konfirmasi QRIS, dan item (qty, harga satuan,
-- tambah/hapus barang). Total dihitung ulang; selisih stok dicatat sebagai movement
-- 'adjustment' (ledger tetap append-only); tiap edit disimpan di sale_edits (sebelum/sesudah).
-- Aman dijalankan berulang (idempotent). Jalankan di Supabase SQL Editor.
-- =====================================================================

alter table sales add column if not exists edited_at timestamptz;

-- Item transaksi tetap tidak bisa diubah dari luar; hanya edit_sale() yang menyalakan
-- penanda transaksi-lokal 'app.sale_edit'.
create or replace function sale_items_guard() returns trigger
language plpgsql as $$
begin
  if current_setting('app.sale_edit', true) = 'on' then
    return coalesce(new, old);
  end if;
  raise exception 'Tabel % bersifat append-only (% tidak diizinkan)', tg_table_name, tg_op
    using errcode = '42501';
end $$;
drop trigger if exists trg_sale_items_immutable on sale_items;
create trigger trg_sale_items_immutable before update or delete on sale_items
  for each row execute function sale_items_guard();

-- Riwayat edit (append-only): siapa, kapan, alasan, isi sebelum dan sesudah.
create table if not exists sale_edits (
  id             bigint generated always as identity primary key,
  store_id       uuid not null references stores(id) on delete restrict,
  sale_id        uuid not null references sales(id) on delete restrict,
  edited_by      uuid default auth.uid(),
  edited_by_name text,
  reason         text not null check (btrim(reason) <> ''),
  before         jsonb not null,
  after          jsonb not null,
  created_at     timestamptz not null default now()
);
create index if not exists idx_sale_edits_sale on sale_edits (sale_id);
drop trigger if exists trg_sale_edits_immutable on sale_edits;
create trigger trg_sale_edits_immutable before update or delete on sale_edits
  for each row execute function forbid_change();
alter table sale_edits enable row level security;
drop policy if exists sale_edits_select on sale_edits;
create policy sale_edits_select on sale_edits for select to authenticated
  using (is_admin(store_id));

-- p_items: [{"variant_id": "<uuid>", "qty": 2, "unit_price": 35000}, ...]
-- Barang yang sudah ada di transaksi mempertahankan nama/SKU aslinya (snapshot);
-- barang baru memakai nama/SKU produk sekarang. Harga satuan selalu dari p_items.
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
  if p_payment_method not in ('cash', 'qris') then
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
  insert into sale_items (store_id, sale_id, variant_id, qty, unit_price, line_total,
                          sku, product_name, variant_label)
  select s.store_id, p_sale_id, v.id, (e->>'qty')::integer, (e->>'unit_price')::integer,
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
     set payment_method = p_payment_method,
         payment_status = case when v_confirmed then 'confirmed' else 'unconfirmed' end,
         payment_confirmed_at = case when v_confirmed then coalesce(s.payment_confirmed_at, now()) end,
         total = v_total,
         edited_at = now()
   where id = p_sale_id;

  select jsonb_build_object(
           'payment_method', p_payment_method,
           'payment_status', case when v_confirmed then 'confirmed' else 'unconfirmed' end,
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

-- Hak akses: fungsi baru bisa otomatis terbuka untuk anon di Supabase, jadi tutup dulu.
revoke all on table sale_edits from anon, authenticated;
grant select on sale_edits to authenticated;
revoke all on function edit_sale(uuid, text, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function edit_sale(uuid, text, boolean, jsonb, text) to authenticated;
revoke all on function sale_items_guard() from public, anon, authenticated;
