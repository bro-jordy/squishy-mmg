-- =====================================================================
-- Squishy MMG — skema database multi-toko (Supabase / PostgreSQL 15+)
-- Satu aplikasi, satu database, BEBERAPA TOKO yang datanya terpisah penuh
-- (barang, stok, transaksi, setoran). Harga = integer Rupiah.
-- Zona waktu bisnis = Asia/Jakarta.
-- Jalankan di SQL Editor Supabase (sebagai postgres), lalu seed.sql.
--
-- Prinsip:
--   * Setiap baris data punya store_id. Akun hanya bisa membaca/menulis toko
--     tempat ia terdaftar (store_members); "owner platform" (profiles.is_platform_owner)
--     bisa masuk ke semua toko. Dijaga RLS di database, bukan cuma di layar.
--   * Peran per toko: admin (semua menu toko itu) dan kasir (hanya kasir +
--     transaksi miliknya sendiri).
--   * Stok HANYA berubah lewat stock_movements (append-only). Kolom
--     product_variants.stock adalah saldo berjalan yang diisi trigger.
--   * Klien (anon/authenticated) tidak bisa menulis sales / sale_items /
--     stock_movements / stok secara langsung — hanya lewat fungsi
--     checkout(), void_sale(), adjust_stock(), bulk_opname(), confirm_payment().
--   * RLS aktif di semua tabel.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Util
-- ---------------------------------------------------------------------
create or replace function jakarta_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Jakarta')::date $$;

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception 'Tabel % bersifat append-only (% tidak diizinkan)', tg_table_name, tg_op
    using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------
-- Pengguna, toko, dan keanggotaan
-- ---------------------------------------------------------------------
create table profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  nama                text not null check (btrim(nama) <> ''),
  is_platform_owner   boolean not null default false,   -- akses ke SEMUA toko
  is_active           boolean not null default true,    -- false = tidak bisa masuk
  created_at          timestamptz not null default now()
);

create table stores (
  id               uuid primary key default gen_random_uuid(),
  kode             text not null unique check (kode ~ '^[A-Z0-9]{2,10}$'),   -- awalan nomor transaksi
  nama             text not null check (btrim(nama) <> ''),
  pct_bagian_25    integer not null default 25 check (pct_bagian_25 between 0 and 100),
  dasar_pembagian  text not null default 'omzet' check (dasar_pembagian in ('omzet', 'laba')), -- BELUM DIKONFIRMASI
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create table store_members (
  store_id    uuid not null references stores(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  role        text not null check (role in ('admin', 'kasir')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  primary key (store_id, user_id)
);
create index idx_members_user on store_members (user_id);

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles p
                 where p.id = auth.uid() and p.is_platform_owner and p.is_active)
$$;

-- Boleh masuk ke toko ini (admin atau kasir, atau owner platform).
create or replace function can_access(p_store uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select is_owner() or exists (
    select 1
    from store_members m
    join profiles p on p.id = m.user_id
    join stores s on s.id = m.store_id
    where m.user_id = auth.uid() and m.store_id = p_store
      and m.is_active and p.is_active and s.is_active)
$$;

-- Admin toko ini (atau owner platform).
create or replace function is_admin(p_store uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select is_owner() or exists (
    select 1
    from store_members m
    join profiles p on p.id = m.user_id
    join stores s on s.id = m.store_id
    where m.user_id = auth.uid() and m.store_id = p_store and m.role = 'admin'
      and m.is_active and p.is_active and s.is_active)
$$;

-- ---------------------------------------------------------------------
-- Master barang (per toko)
-- ---------------------------------------------------------------------
-- Produk = apa yang dicari kasir. SKU berasal dari pemilik barang dan BOLEH sama
-- untuk beberapa produk, juga sama antar toko; yang unik adalah (toko, sku, nama)
-- tanpa membedakan huruf besar/kecil.
create table products (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references stores(id) on delete restrict,
  sku          text not null check (sku = btrim(sku) and sku <> ''),
  name         text not null check (name = btrim(name) and name <> ''),
  price        integer not null check (price >= 0),          -- Rupiah, satu harga per produk
  description  text,
  image_url    text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, store_id)
);
create unique index uq_product_sku_name on products (store_id, lower(sku), lower(name));
create trigger trg_products_updated before update on products
  for each row execute function set_updated_at();

-- Varian = unit yang dijual & dihitung stoknya. Identitas = id (uuid),
-- BUKAN SKU. NULL berarti "tidak ada" (di sheet ditulis "-").
create table product_variants (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null,
  product_id  uuid not null,
  varian      text check (varian is null or (varian = btrim(varian) and varian <> '')),
  warna       text check (warna  is null or (warna  = btrim(warna)  and warna  <> '')),
  stock_awal  integer not null default 0 check (stock_awal >= 0),  -- informasi; saldo awal dicatat sbg movement 'opening'
  stock       integer not null default 0 check (stock >= 0),       -- saldo berjalan, hanya diubah trigger
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, store_id),
  foreign key (product_id, store_id) references products (id, store_id) on delete restrict
);
create unique index uq_variant_per_product
  on product_variants (product_id, coalesce(lower(varian), ''), coalesce(lower(warna), ''));
create index idx_variants_product on product_variants (product_id);
create index idx_variants_store on product_variants (store_id);
create trigger trg_variants_updated before update on product_variants
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Transaksi (per toko)
-- ---------------------------------------------------------------------
create table sale_counters (
  store_id  uuid not null references stores(id) on delete cascade,
  day       date not null,
  last_no   integer not null,
  primary key (store_id, day)
);

create table sales (
  id                    uuid primary key default gen_random_uuid(),
  store_id              uuid not null references stores(id) on delete restrict,
  sale_no               text not null unique,                       -- KODE-YYMMDD-0001 (hari Jakarta, per toko)
  idempotency_key       uuid not null unique,                       -- cegah checkout ganda
  sold_at               timestamptz not null default now(),
  customer_name         text,                                       -- catatan pribadi, opsional
  payment_method        text not null check (payment_method in ('cash', 'qris')),
  payment_status        text not null check (payment_status in ('unconfirmed', 'confirmed')),
  payment_confirmed_at  timestamptz,
  status                text not null default 'completed' check (status in ('completed', 'void')),
  total                 integer not null default 0 check (total >= 0),
  note                  text,
  void_reason           text,
  voided_at             timestamptz,
  voided_by             uuid,
  voided_by_name        text,                                       -- nama saat void (snapshot)
  created_by            uuid default auth.uid(),
  cashier_name          text,                                       -- nama kasir saat transaksi (snapshot; tidak dicetak di struk)
  created_at            timestamptz not null default now(),
  unique (id, store_id),
  check (payment_method <> 'cash' or payment_status = 'confirmed'),
  check (payment_status <> 'confirmed' or payment_confirmed_at is not null),
  check (status <> 'void' or (void_reason is not null and btrim(void_reason) <> '' and voided_at is not null))
);
create index idx_sales_store_time on sales (store_id, sold_at);
create trigger trg_sales_no_delete before delete on sales
  for each row execute function forbid_change();

-- Snapshot nama/harga saat transaksi: riwayat tidak berubah saat produk diedit.
create table sale_items (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null,
  sale_id       uuid not null,
  variant_id    uuid not null,
  qty           integer not null check (qty > 0),
  unit_price    integer not null check (unit_price >= 0),
  line_total    integer not null,
  sku           text not null,
  product_name  text not null,
  variant_label text not null,
  unique (sale_id, variant_id),
  check (line_total = qty * unit_price),
  foreign key (sale_id, store_id)    references sales (id, store_id)            on delete restrict,
  foreign key (variant_id, store_id) references product_variants (id, store_id) on delete restrict
);
create index idx_sale_items_variant on sale_items (variant_id);
create trigger trg_sale_items_immutable before update or delete on sale_items
  for each row execute function forbid_change();

-- ---------------------------------------------------------------------
-- Riwayat stok (append-only)
-- ---------------------------------------------------------------------
create table stock_movements (
  id             bigint generated always as identity primary key,
  store_id       uuid not null,
  variant_id     uuid not null,
  movement_type  text not null check (movement_type in
                   ('opening', 'sale', 'void', 'restock', 'damaged', 'return_owner', 'adjustment')),
  qty_delta      integer not null check (qty_delta <> 0),
  reason         text not null check (btrim(reason) <> ''),
  sale_id        uuid,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  check (movement_type not in ('sale', 'void') or sale_id is not null),
  check (movement_type <> 'sale'                      or qty_delta < 0),
  check (movement_type not in ('void','opening','restock') or qty_delta > 0),
  check (movement_type not in ('damaged', 'return_owner') or qty_delta < 0),
  foreign key (variant_id, store_id) references product_variants (id, store_id) on delete restrict,
  foreign key (sale_id, store_id)    references sales (id, store_id)            on delete restrict
);
-- Stok dikurangi / dikembalikan tepat satu kali per (transaksi, varian).
create unique index uq_movement_once_per_sale
  on stock_movements (sale_id, variant_id, movement_type)
  where movement_type in ('sale', 'void');
create index idx_movements_variant on stock_movements (variant_id, created_at);
create trigger trg_movements_immutable before update or delete on stock_movements
  for each row execute function forbid_change();

create or replace function apply_stock_movement() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- CHECK (stock >= 0) pada product_variants menolak stok minus.
  update product_variants set stock = stock + new.qty_delta where id = new.variant_id;
  return new;
end $$;
create trigger trg_apply_stock after insert on stock_movements
  for each row execute function apply_stock_movement();

-- Varian baru dengan stock_awal > 0 otomatis dicatat sebagai movement 'opening'.
create or replace function record_opening_stock() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.stock_awal > 0 then
    insert into stock_movements (store_id, variant_id, movement_type, qty_delta, reason)
    values (new.store_id, new.id, 'opening', new.stock_awal, 'Stok awal (master barang)');
  end if;
  return new;
end $$;
create trigger trg_variant_opening after insert on product_variants
  for each row execute function record_opening_stock();

-- ---------------------------------------------------------------------
-- Setoran (hanya pencatatan internal, bukan transfer)
-- ---------------------------------------------------------------------
create table settlements (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references stores(id) on delete restrict,
  settled_on    date not null default jakarta_today(),
  amount        integer not null check (amount > 0),
  share         text not null default 'bagian_75' check (share in ('bagian_25', 'bagian_75')),
  recipient     text,                                    -- penerima/tujuan, opsional (label dapat diubah)
  period_start  date,
  period_end    date,
  note          text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  check (period_start is null or period_end is null or period_start <= period_end)
);
create index idx_settlements_store on settlements (store_id, settled_on);

-- ---------------------------------------------------------------------
-- Fungsi bisnis (satu-satunya jalan menulis transaksi & stok)
-- ---------------------------------------------------------------------
create or replace function next_sale_no(p_store uuid) returns text
language plpgsql set search_path = public, pg_temp as $$
declare
  d    date := jakarta_today();
  n    integer;
  k    text;
begin
  select kode into k from stores where id = p_store;
  insert into sale_counters (store_id, day, last_no) values (p_store, d, 1)
  on conflict (store_id, day) do update set last_no = sale_counters.last_no + 1
  returning last_no into n;
  return k || '-' || to_char(d, 'YYMMDD') || '-' || lpad(n::text, 4, '0');
end $$;

-- p_items: [{"variant_id": "<uuid>", "qty": 2}, ...]
-- Dipanggil SETELAH kasir mengonfirmasi pembayaran (QRIS: setelah cek GoPay Merchant).
-- Idempotent: key yang sama mengembalikan transaksi yang sama.
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
           p.is_active as p_active, p.price, p.name, p.sku, i.qty
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

    insert into sale_items (store_id, sale_id, variant_id, qty, unit_price, line_total,
                            sku, product_name, variant_label)
    values (p_store_id, v_sale_id, r.variant_id, r.qty, r.price, r.qty * r.price,
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

-- Void: admin toko; butuh alasan, stok kembali tepat sekali, transaksi tidak dihapus.
create or replace function void_sale(p_sale_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s sales%rowtype;
  r record;
begin
  select * into s from sales where id = p_sale_id for update;
  if not found or not is_admin(s.store_id) then
    raise exception 'Hanya admin toko yang boleh void' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Alasan void wajib diisi';
  end if;
  if s.status = 'void' then
    return;  -- idempotent
  end if;

  for r in select variant_id, qty from sale_items where sale_id = p_sale_id order by variant_id loop
    insert into stock_movements (store_id, variant_id, movement_type, qty_delta, reason, sale_id)
    values (s.store_id, r.variant_id, 'void', r.qty, 'Void: ' || btrim(p_reason), p_sale_id);
  end loop;

  update sales
     set status = 'void', void_reason = btrim(p_reason), voided_at = now(),
         voided_by = auth.uid(), voided_by_name = (select nama from profiles where id = auth.uid())
   where id = p_sale_id;
end $$;

-- Penyesuaian stok manual (admin toko). p_type: restock (+), damaged (-),
-- return_owner (-, retur ke pemilik barang), adjustment (+/-, mis. opname).
create or replace function adjust_stock(
  p_variant_id uuid, p_type text, p_delta integer, p_reason text
) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_stock integer;
  v_store uuid;
begin
  select store_id into v_store from product_variants where id = p_variant_id;
  if v_store is null or not is_admin(v_store) then
    raise exception 'Hanya admin toko yang boleh menyesuaikan stok' using errcode = '42501';
  end if;
  if p_type not in ('restock', 'damaged', 'return_owner', 'adjustment') then
    raise exception 'Jenis penyesuaian tidak valid: %', p_type;
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Alasan penyesuaian wajib diisi';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception 'Jumlah penyesuaian tidak boleh 0';
  end if;

  select stock into v_stock from product_variants where id = p_variant_id for update;
  if v_stock + p_delta < 0 then
    raise exception 'Stok tidak boleh minus (sisa %, perubahan %)', v_stock, p_delta;
  end if;

  insert into stock_movements (store_id, variant_id, movement_type, qty_delta, reason)
  values (v_store, p_variant_id, p_type, p_delta, btrim(p_reason));

  return v_stock + p_delta;
end $$;

-- Opname massal (admin toko): p_items = [{"variant_id": "<uuid>", "counted": 5}, ...].
-- Stok jadi sama dengan hasil hitung; selisih dicatat sebagai 'adjustment' dengan alasan
-- ("<alasan> (hitung X, sistem Y)"). Varian yang selisihnya 0 dilewati. Atomik: satu gagal =
-- semuanya batal. Mengembalikan jumlah varian yang berubah.
create or replace function bulk_opname(p_store_id uuid, p_items jsonb, p_reason text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r        record;
  v_stock  integer;
  v_delta  integer;
  v_n      integer := 0;
  v_expect integer;
  v_seen   integer := 0;
begin
  if not is_admin(p_store_id) then
    raise exception 'Hanya admin toko yang boleh opname' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Alasan opname wajib diisi';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Tidak ada hasil hitung yang dikirim';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
             where (e->>'variant_id') is null or (e->>'counted') is null
                or (e->>'counted')::integer < 0) then
    raise exception 'Setiap item butuh variant_id dan hasil hitung >= 0';
  end if;

  select count(distinct (e->>'variant_id')::uuid) into v_expect from jsonb_array_elements(p_items) e;

  for r in
    select v.id as variant_id, (e->>'counted')::integer as counted
    from jsonb_array_elements(p_items) e
    join product_variants v on v.id = (e->>'variant_id')::uuid and v.store_id = p_store_id
    order by v.id
  loop
    v_seen := v_seen + 1;
    select stock into v_stock from product_variants where id = r.variant_id for update;
    v_delta := r.counted - v_stock;
    if v_delta <> 0 then
      insert into stock_movements (store_id, variant_id, movement_type, qty_delta, reason)
      values (p_store_id, r.variant_id, 'adjustment', v_delta,
              btrim(p_reason) || format(' (hitung %s, sistem %s)', r.counted, v_stock));
      v_n := v_n + 1;
    end if;
  end loop;

  if v_seen <> v_expect then
    raise exception 'Ada varian yang tidak ditemukan di toko ini';
  end if;
  return v_n;
end $$;

-- Konfirmasi pembayaran belakangan (mis. QRIS yang baru dicek). Idempotent.
-- Admin toko, atau kasir untuk transaksinya sendiri.
create or replace function confirm_payment(p_sale_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s sales%rowtype;
begin
  select * into s from sales where id = p_sale_id;
  if not found or not can_access(s.store_id)
     or not (is_admin(s.store_id) or s.created_by = auth.uid()) then
    raise exception 'Tidak diizinkan' using errcode = '42501';
  end if;
  update sales
     set payment_status = 'confirmed', payment_confirmed_at = now()
   where id = p_sale_id and status = 'completed' and payment_status = 'unconfirmed';
end $$;

-- Tambah produk baru + semua variannya dalam satu langkah (atomik), admin toko.
-- p_variants: [{"varian": "Maltose", "warna": "Pink", "stock": 3}, ...]
-- Teks kosong atau "-" dianggap tidak ada. Stok awal otomatis jadi movement 'opening'.
create or replace function create_product(
  p_store_id uuid, p_sku text, p_name text, p_price integer, p_variants jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id    uuid;
  e       jsonb;
  v_stock integer;
  v_c     text;
begin
  if not is_admin(p_store_id) then
    raise exception 'Hanya admin toko yang boleh menambah barang' using errcode = '42501';
  end if;
  if nullif(btrim(p_sku), '') is null or nullif(btrim(p_name), '') is null then
    raise exception 'SKU dan nama wajib diisi';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'Harga harus bilangan bulat >= 0';
  end if;
  if p_variants is null or jsonb_typeof(p_variants) <> 'array' or jsonb_array_length(p_variants) = 0 then
    raise exception 'Minimal satu varian';
  end if;

  begin
    insert into products (store_id, sku, name, price)
    values (p_store_id, btrim(p_sku), btrim(p_name), p_price)
    returning id into v_id;

    for e in select value from jsonb_array_elements(p_variants) loop
      v_stock := coalesce((e->>'stock')::integer, 0);
      if v_stock < 0 then
        raise exception 'Stok awal tidak boleh minus';
      end if;
      insert into product_variants (store_id, product_id, varian, warna, stock_awal)
      values (p_store_id, v_id,
              nullif(nullif(btrim(e->>'varian'), ''), '-'),
              nullif(nullif(btrim(e->>'warna'), ''), '-'),
              v_stock);
    end loop;
  exception when unique_violation then
    get stacked diagnostics v_c = constraint_name;
    if v_c = 'uq_product_sku_name' then
      raise exception 'Produk dengan SKU dan nama itu sudah ada';
    end if;
    raise exception 'Ada varian dan warna yang kembar dalam satu produk';
  end;

  return v_id;
end $$;

-- Tambah satu varian ke produk yang sudah ada (stok awal opsional), admin toko.
create or replace function add_variant(
  p_product_id uuid, p_varian text, p_warna text, p_stock integer default 0
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id    uuid;
  v_store uuid;
begin
  select store_id into v_store from products where id = p_product_id;
  if v_store is null or not is_admin(v_store) then
    raise exception 'Hanya admin toko yang boleh menambah varian' using errcode = '42501';
  end if;
  if coalesce(p_stock, 0) < 0 then
    raise exception 'Stok awal tidak boleh minus';
  end if;

  begin
    insert into product_variants (store_id, product_id, varian, warna, stock_awal)
    values (v_store, p_product_id,
            nullif(nullif(btrim(p_varian), ''), '-'),
            nullif(nullif(btrim(p_warna), ''), '-'),
            coalesce(p_stock, 0))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Varian dan warna itu sudah ada di produk ini';
  end;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Pengelolaan pengguna toko
-- Login (email + password) dibuat di Supabase: Authentication > Users. Setelah itu
-- admin toko menambahkannya ke tokonya di sini. Admin toko hanya mengelola KASIR;
-- menjadikan seseorang admin hanya bisa oleh owner platform.
-- ---------------------------------------------------------------------
create or replace function list_members(p_store_id uuid)
returns table (user_id uuid, nama text, email text, role text, is_active boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not is_admin(p_store_id) then
    raise exception 'Hanya admin toko yang boleh melihat pengguna' using errcode = '42501';
  end if;
  return query
    select m.user_id, p.nama, u.email::text, m.role, (m.is_active and p.is_active)
    from store_members m
    join profiles p on p.id = m.user_id
    left join auth.users u on u.id = m.user_id
    where m.store_id = p_store_id
    order by (m.role = 'admin') desc, p.nama;
end $$;

create or replace function add_member(
  p_store_id uuid, p_email text, p_nama text, p_role text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid      uuid;
  v_existing store_members%rowtype;
  v_target_owner boolean;
begin
  if not is_admin(p_store_id) then
    raise exception 'Hanya admin toko yang boleh menambah pengguna' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'kasir') then
    raise exception 'Peran tidak valid: %', p_role;
  end if;
  if p_role = 'admin' and not is_owner() then
    raise exception 'Hanya owner platform yang boleh menjadikan admin' using errcode = '42501';
  end if;

  select id into v_uid from auth.users where lower(email) = lower(btrim(p_email));
  if v_uid is null then
    raise exception 'Akun dengan email itu belum dibuat. Buat dulu di Supabase (Authentication > Users).';
  end if;

  select is_platform_owner into v_target_owner from profiles where id = v_uid;
  select * into v_existing from store_members where store_id = p_store_id and user_id = v_uid;
  if (coalesce(v_target_owner, false) or (found and v_existing.role = 'admin')) and not is_owner() then
    raise exception 'Akun ini hanya bisa diubah oleh owner platform' using errcode = '42501';
  end if;

  insert into profiles (id, nama)
  values (v_uid, coalesce(nullif(btrim(p_nama), ''), split_part(lower(btrim(p_email)), '@', 1)))
  on conflict (id) do update
     set nama = case when is_owner() then coalesce(nullif(btrim(p_nama), ''), profiles.nama)
                     else profiles.nama end;

  insert into store_members (store_id, user_id, role)
  values (p_store_id, v_uid, p_role)
  on conflict (store_id, user_id) do update set role = excluded.role, is_active = true;
end $$;

create or replace function set_member(
  p_store_id uuid, p_user_id uuid, p_role text, p_active boolean
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing store_members%rowtype;
  v_target_owner boolean;
begin
  if not is_admin(p_store_id) then
    raise exception 'Hanya admin toko yang boleh mengubah pengguna' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'kasir') then
    raise exception 'Peran tidak valid: %', p_role;
  end if;
  select * into v_existing from store_members where store_id = p_store_id and user_id = p_user_id;
  if not found then
    raise exception 'Pengguna tidak terdaftar di toko ini';
  end if;
  select is_platform_owner into v_target_owner from profiles where id = p_user_id;
  if not is_owner() then
    if coalesce(v_target_owner, false) or v_existing.role = 'admin' or p_role = 'admin' then
      raise exception 'Admin hanya bisa mengelola kasir' using errcode = '42501';
    end if;
    if p_user_id = auth.uid() and not p_active then
      raise exception 'Tidak bisa menonaktifkan akun sendiri';
    end if;
  end if;
  update store_members set role = p_role, is_active = coalesce(p_active, is_active)
   where store_id = p_store_id and user_id = p_user_id;
end $$;

-- ---------------------------------------------------------------------
-- View (security_invoker: mengikuti RLS pemanggil)
-- ---------------------------------------------------------------------
-- Katalog kasir. Aturan tampilan: bila SEMUA varian satu produk punya nilai
-- "varian" yang sama, nilai itu ikut judul produk dan kasir cuma memilih warna.
-- Jika varian campur, label pilihan = "varian · warna".
create view v_catalog with (security_invoker = true) as
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
       v.is_active                            as variant_active
from product_variants v
join products p on p.id = v.product_id
cross join lateral (
  select case when count(distinct coalesce(x.varian, '')) = 1 and max(x.varian) is not null
              then max(x.varian) end as shared_varian
  from product_variants x
  where x.product_id = p.id
) s;

-- Rekap harian per toko (hari Jakarta). Dasar hitung = omzet transaksi selesai &
-- pembayaran terkonfirmasi. BELUM FINAL: tergantung konfirmasi omzet vs laba
-- (stores.dasar_pembagian). Persen Bagian 25% = stores.pct_bagian_25.
create view v_daily_summary with (security_invoker = true) as
select s.store_id,
       (s.sold_at at time zone 'Asia/Jakarta')::date                 as day,
       count(*)::integer                                             as transaksi,
       sum(s.total)::integer                                         as total_penjualan,
       ((sum(s.total) * st.pct_bagian_25 + 50) / 100)::integer       as bagian_25,
       (sum(s.total) - ((sum(s.total) * st.pct_bagian_25 + 50) / 100))::integer as bagian_75
from sales s
join stores st on st.id = s.store_id
where s.status = 'completed' and s.payment_status = 'confirmed'
group by s.store_id, 2, st.pct_bagian_25;

-- Saldo setoran Bagian 75% per toko (admin toko saja).
create view v_settlement_balance with (security_invoker = true) as
select st.id as store_id,
       t.total_bagian_75,
       d.sudah_disetor,
       t.total_bagian_75 - d.sudah_disetor as sisa,
       case when d.sudah_disetor > t.total_bagian_75           then 'kelebihan'
            when d.sudah_disetor = 0 and t.total_bagian_75 > 0 then 'belum'
            when d.sudah_disetor < t.total_bagian_75           then 'sebagian'
            else 'lunas' end                                   as status
from stores st
cross join lateral (select coalesce(sum(v.bagian_75), 0)::integer as total_bagian_75
                    from v_daily_summary v where v.store_id = st.id) t
cross join lateral (select coalesce(sum(x.amount), 0)::integer as sudah_disetor
                    from settlements x where x.store_id = st.id and x.share = 'bagian_75') d
where is_admin(st.id);

-- ---------------------------------------------------------------------
-- Keamanan: hak akses + RLS
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on profiles, stores, store_members, products, product_variants,
                sales, sale_items, stock_movements, settlements,
                v_catalog, v_daily_summary, v_settlement_balance
  to authenticated;

-- Master barang: admin toko boleh ubah, TAPI bukan kolom stok maupun toko.
-- Barang/varian baru dibuat lewat create_product() / add_variant().
grant update (sku, name, price, description, image_url, is_active) on products to authenticated;
grant update (varian, warna, is_active)                            on product_variants to authenticated;
grant insert (store_id, settled_on, amount, share, recipient, period_start, period_end, note)
  on settlements to authenticated;
grant update (settled_on, amount, share, recipient, period_start, period_end, note)
  on settlements to authenticated;
grant delete on settlements to authenticated;

grant execute on function is_owner(), can_access(uuid), is_admin(uuid), jakarta_today() to authenticated;
grant execute on function checkout(uuid, uuid, text, boolean, jsonb, text, text) to authenticated;
grant execute on function void_sale(uuid, text)                           to authenticated;
grant execute on function adjust_stock(uuid, text, integer, text)         to authenticated;
grant execute on function bulk_opname(uuid, jsonb, text)                  to authenticated;
grant execute on function confirm_payment(uuid)                           to authenticated;
grant execute on function create_product(uuid, text, text, integer, jsonb) to authenticated;
grant execute on function add_variant(uuid, text, text, integer)          to authenticated;
grant execute on function list_members(uuid)                              to authenticated;
grant execute on function add_member(uuid, text, text, text)              to authenticated;
grant execute on function set_member(uuid, uuid, text, boolean)           to authenticated;

alter table profiles         enable row level security;
alter table stores           enable row level security;
alter table store_members    enable row level security;
alter table products         enable row level security;
alter table product_variants enable row level security;
alter table sale_counters    enable row level security;   -- tanpa policy = tertutup untuk klien
alter table sales            enable row level security;
alter table sale_items       enable row level security;
alter table stock_movements  enable row level security;
alter table settlements      enable row level security;

create policy stores_select on stores for select to authenticated using (can_access(id));

create policy profiles_select on profiles for select to authenticated
  using (id = auth.uid() or is_owner()
         or exists (select 1 from store_members m
                    where m.user_id = profiles.id and is_admin(m.store_id)));

create policy members_select on store_members for select to authenticated
  using (user_id = auth.uid() or is_admin(store_id));

create policy products_select on products for select to authenticated using (can_access(store_id));
create policy products_update on products for update to authenticated
  using (is_admin(store_id)) with check (is_admin(store_id));

create policy variants_select on product_variants for select to authenticated using (can_access(store_id));
create policy variants_update on product_variants for update to authenticated
  using (is_admin(store_id)) with check (is_admin(store_id));

-- Transaksi: admin melihat semua transaksi tokonya; kasir hanya transaksi buatannya sendiri.
-- Tulis hanya via fungsi.
create policy sales_select on sales for select to authenticated
  using (can_access(store_id) and (is_admin(store_id) or created_by = auth.uid()));
create policy sale_items_select on sale_items for select to authenticated
  using (exists (select 1 from sales s where s.id = sale_items.sale_id));  -- mengikuti RLS sales
create policy movements_select on stock_movements for select to authenticated
  using (is_admin(store_id));

create policy settlements_select on settlements for select to authenticated using (is_admin(store_id));
create policy settlements_insert on settlements for insert to authenticated with check (is_admin(store_id));
create policy settlements_update on settlements for update to authenticated
  using (is_admin(store_id)) with check (is_admin(store_id));
create policy settlements_delete on settlements for delete to authenticated using (is_admin(store_id));

-- =====================================================================
-- Migrasi 2026-10-25: edit transaksi selesai (owner). Sama dengan db/migrations/2026-10-25_edit_sale.sql
-- =====================================================================
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
