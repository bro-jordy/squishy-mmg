-- =====================================================================
-- Transfer stok antar toko (HANYA owner platform).
-- Satu transfer = pergerakan keluar 'transfer_out' di toko asal + masuk 'transfer_in' di
-- toko tujuan, atomik, terikat satu transfer_id. Pencocokan barang eksplisit: owner memilih
-- barang asal dan barang tujuan (SKU/nama/varian/warna boleh berbeda). Satu sisi bisa
-- dirinci per varian (mis. per warna), sisi lain cukup total; jumlah kedua sisi harus sama.
-- Barang tujuan boleh dibuat baru (satu varian "Random"). Riwayat transfer append-only.
-- Aman dijalankan berulang (idempotent). Jalankan di Supabase SQL Editor.
-- =====================================================================

create table if not exists stock_transfers (
  id              uuid primary key default gen_random_uuid(),
  from_store_id   uuid not null references stores(id) on delete restrict,
  to_store_id     uuid not null references stores(id) on delete restrict,
  note            text,
  detail          jsonb not null,                       -- per baris: barang asal/tujuan + jumlah (snapshot)
  created_by      uuid default auth.uid(),
  created_by_name text,
  created_at      timestamptz not null default now(),
  check (from_store_id <> to_store_id)
);
drop trigger if exists trg_stock_transfers_immutable on stock_transfers;
create trigger trg_stock_transfers_immutable before update or delete on stock_transfers
  for each row execute function forbid_change();
alter table stock_transfers enable row level security;
drop policy if exists stock_transfers_select on stock_transfers;
create policy stock_transfers_select on stock_transfers for select to authenticated
  using (is_owner());

alter table stock_movements add column if not exists transfer_id uuid;
do $$ begin
  alter table stock_movements add constraint stock_movements_transfer_fk
    foreign key (transfer_id) references stock_transfers(id) on delete restrict
    deferrable initially deferred;       -- baris riwayat dibuat sebelum header transfer
exception when duplicate_object then null; end $$;

alter table stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table stock_movements add constraint stock_movements_movement_type_check check (movement_type in
  ('opening', 'sale', 'void', 'restock', 'damaged', 'return_owner', 'adjustment',
   'transfer_out', 'transfer_in'));
alter table stock_movements drop constraint if exists stock_movements_transfer_rules;
alter table stock_movements add constraint stock_movements_transfer_rules check (
  (movement_type not in ('transfer_out', 'transfer_in') or transfer_id is not null)
  and (movement_type <> 'transfer_out' or qty_delta < 0)
  and (movement_type <> 'transfer_in'  or qty_delta > 0));

-- p_lines: [{
--   "from": [{"variant_id": "<uuid>", "qty": 2}, ...],        -- varian toko asal (boleh banyak)
--   "to":   [{"variant_id": "<uuid>", "qty": 6}, ...],        -- varian toko tujuan (boleh banyak)
--   "new_product": {"sku": "A35", "name": "...", "price": 35000}   -- opsional: buat barang baru
-- }]                                                                 di tujuan (satu varian "Random")
-- Jumlah "from" harus sama dengan jumlah "to" (dengan new_product, "to" diabaikan).
create or replace function transfer_stock(
  p_from_store uuid, p_to_store uuid, p_lines jsonb, p_note text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id        uuid := gen_random_uuid();
  v_from_name text;
  v_to_name   text;
  v_detail    jsonb := '[]'::jsonb;
  v_user      text;
  line        jsonb;
  it          jsonb;
  v_sum_from  integer;
  v_sum_to    integer;
  v_new_vid   uuid;
  v_new_pid   uuid;
  v_qty       integer;
  v_vid       uuid;
  r           record;
  v_label     text;
  v_from_desc jsonb;
  v_to_desc   jsonb;
  v_note      text := nullif(btrim(p_note), '');
begin
  if not is_owner() then
    raise exception 'Hanya owner yang boleh transfer stok' using errcode = '42501';
  end if;
  if p_from_store is null or p_to_store is null or p_from_store = p_to_store then
    raise exception 'Pilih dua toko yang berbeda';
  end if;
  select nama into v_from_name from stores where id = p_from_store;
  select nama into v_to_name   from stores where id = p_to_store;
  if v_from_name is null or v_to_name is null then raise exception 'Toko tidak ditemukan'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Tidak ada barang yang ditransfer';
  end if;

  for line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(line->'from') <> 'array' or jsonb_array_length(line->'from') = 0 then
      raise exception 'Setiap baris butuh barang asal';
    end if;
    if exists (select 1 from jsonb_array_elements(line->'from') e
               where (e->>'variant_id') is null or coalesce((e->>'qty')::integer, 0) <= 0) then
      raise exception 'Jumlah barang asal harus lebih dari 0';
    end if;
    if (select count(*) from jsonb_array_elements(line->'from') e)
       <> (select count(distinct e->>'variant_id') from jsonb_array_elements(line->'from') e) then
      raise exception 'Varian asal yang sama tidak boleh muncul dua kali dalam satu baris';
    end if;
    select sum((e->>'qty')::integer) into v_sum_from from jsonb_array_elements(line->'from') e;

    v_to_desc := '[]'::jsonb;
    if line->'new_product' is not null and jsonb_typeof(line->'new_product') = 'object' then
      if nullif(btrim(line->'new_product'->>'sku'), '') is null or nullif(btrim(line->'new_product'->>'name'), '') is null then
        raise exception 'Barang baru butuh SKU dan nama';
      end if;
      if coalesce((line->'new_product'->>'price')::integer, -1) < 0 then
        raise exception 'Harga barang baru harus bilangan bulat >= 0';
      end if;
      begin
        insert into products (store_id, sku, name, price)
        values (p_to_store, btrim(line->'new_product'->>'sku'), btrim(line->'new_product'->>'name'),
                (line->'new_product'->>'price')::integer)
        returning id into v_new_pid;
      exception when unique_violation then
        raise exception 'Barang dengan SKU dan nama itu sudah ada di %: pilih barang yang sudah ada', v_to_name;
      end;
      insert into product_variants (store_id, product_id, varian, warna, stock_awal)
      values (p_to_store, v_new_pid, null, 'Random', 0) returning id into v_new_vid;
      line := jsonb_set(line, '{to}', jsonb_build_array(jsonb_build_object('variant_id', v_new_vid, 'qty', v_sum_from)));
    end if;

    if jsonb_typeof(line->'to') <> 'array' or jsonb_array_length(line->'to') = 0 then
      raise exception 'Setiap baris butuh barang tujuan';
    end if;
    if exists (select 1 from jsonb_array_elements(line->'to') e
               where (e->>'variant_id') is null or coalesce((e->>'qty')::integer, 0) <= 0) then
      raise exception 'Jumlah barang tujuan harus lebih dari 0';
    end if;
    if (select count(*) from jsonb_array_elements(line->'to') e)
       <> (select count(distinct e->>'variant_id') from jsonb_array_elements(line->'to') e) then
      raise exception 'Varian tujuan yang sama tidak boleh muncul dua kali dalam satu baris';
    end if;
    select sum((e->>'qty')::integer) into v_sum_to from jsonb_array_elements(line->'to') e;
    if v_sum_from <> v_sum_to then
      raise exception 'Jumlah asal (%) dan tujuan (%) harus sama', v_sum_from, v_sum_to;
    end if;

    -- keluar dari toko asal
    v_from_desc := '[]'::jsonb;
    for it in select value from jsonb_array_elements(line->'from') loop
      v_vid := (it->>'variant_id')::uuid;
      v_qty := (it->>'qty')::integer;
      select v.stock, p.sku, p.name, v.varian, v.warna into r
        from product_variants v join products p on p.id = v.product_id
       where v.id = v_vid and v.store_id = p_from_store for update of v;
      if not found then raise exception 'Ada barang asal yang tidak ditemukan di %', v_from_name; end if;
      v_label := coalesce(nullif(concat_ws(' · ', r.varian, r.warna), ''), 'Standar');
      if r.stock < v_qty then
        raise exception 'Stok tidak cukup di %: % (%): sisa %, diminta %', v_from_name, r.name, v_label, r.stock, v_qty
          using errcode = 'P0001';
      end if;
      insert into stock_movements (store_id, variant_id, movement_type, qty_delta, reason, transfer_id)
      values (p_from_store, v_vid, 'transfer_out', -v_qty,
              'Transfer ke ' || v_to_name || coalesce(': ' || v_note, ''), v_id);
      v_from_desc := v_from_desc || jsonb_build_object('variant_id', v_vid, 'sku', r.sku, 'name', r.name, 'label', v_label, 'qty', v_qty);
    end loop;

    -- masuk ke toko tujuan
    v_to_desc := '[]'::jsonb;
    for it in select value from jsonb_array_elements(line->'to') loop
      v_vid := (it->>'variant_id')::uuid;
      v_qty := (it->>'qty')::integer;
      select v.stock, p.sku, p.name, v.varian, v.warna into r
        from product_variants v join products p on p.id = v.product_id
       where v.id = v_vid and v.store_id = p_to_store for update of v;
      if not found then raise exception 'Ada barang tujuan yang tidak ditemukan di %', v_to_name; end if;
      v_label := coalesce(nullif(concat_ws(' · ', r.varian, r.warna), ''), 'Standar');
      insert into stock_movements (store_id, variant_id, movement_type, qty_delta, reason, transfer_id)
      values (p_to_store, v_vid, 'transfer_in', v_qty,
              'Transfer dari ' || v_from_name || coalesce(': ' || v_note, ''), v_id);
      v_to_desc := v_to_desc || jsonb_build_object('variant_id', v_vid, 'sku', r.sku, 'name', r.name, 'label', v_label, 'qty', v_qty);
    end loop;

    v_detail := v_detail || jsonb_build_object('from', v_from_desc, 'to', v_to_desc, 'qty', v_sum_from);
  end loop;

  select nama into v_user from profiles where id = auth.uid();
  insert into stock_transfers (id, from_store_id, to_store_id, note, detail, created_by_name)
  values (v_id, p_from_store, p_to_store, v_note, v_detail, v_user);
  return v_id;
end $$;

revoke all on table stock_transfers from anon, authenticated;
grant select on stock_transfers to authenticated;
revoke all on function transfer_stock(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function transfer_stock(uuid, uuid, jsonb, text) to authenticated;
