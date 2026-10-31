-- =====================================================================
-- Pesanan ditahan ("belum bayar"): pesanan sudah dicatat dan stok sudah dikurangi,
-- tapi pembayaran belum diterima. Status pembayaran baru 'unpaid' (metode bayar masih
-- kosong). Belum dihitung sebagai penjualan/bagi hasil sampai ditandai sudah bayar.
-- Di bawah ini ada hold_sale() (buat pesanan ditahan) dan pay_hold() (tandai sudah bayar).
-- Aman dijalankan berulang. Jalankan di Supabase SQL Editor.
-- =====================================================================

alter table sales alter column payment_method drop not null;

-- Ganti semua aturan CHECK lama soal metode/status bayar dengan versi yang mengenal 'unpaid'.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'sales'::regclass and contype = 'c'
              and (pg_get_constraintdef(oid) ilike '%payment_method%'
                   or pg_get_constraintdef(oid) ilike '%payment_status%')
  loop
    execute format('alter table sales drop constraint %I', c.conname);
  end loop;
end $$;

alter table sales
  add constraint sales_payment_method_chk check (payment_method is null or payment_method in ('cash', 'qris')),
  add constraint sales_payment_status_chk check (payment_status in ('unpaid', 'unconfirmed', 'confirmed')),
  add constraint sales_unpaid_no_method_chk check ((payment_status = 'unpaid') = (payment_method is null)),
  add constraint sales_cash_confirmed_chk check (payment_method is distinct from 'cash' or payment_status = 'confirmed'),
  add constraint sales_confirmed_at_chk check (payment_status <> 'confirmed' or payment_confirmed_at is not null);

-- Buat pesanan ditahan. Memakai checkout() (stok dicek & dikurangi), lalu menandainya belum bayar.
create or replace function hold_sale(
  p_store_id        uuid,
  p_idempotency_key uuid,
  p_items           jsonb,
  p_customer_name   text default null,
  p_note            text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sale_id uuid;
begin
  if not can_access(p_store_id) then
    raise exception 'Tidak diizinkan' using errcode = '42501';
  end if;
  -- key yang sama = pesanan yang sama (retry aman), jangan diubah lagi
  select id into v_sale_id from sales where idempotency_key = p_idempotency_key and store_id = p_store_id;
  if found then return v_sale_id; end if;

  v_sale_id := checkout(p_store_id, p_idempotency_key, 'qris', false, p_items, p_customer_name, p_note);
  update sales
     set payment_method = null, payment_status = 'unpaid', payment_confirmed_at = null
   where id = v_sale_id;
  return v_sale_id;
end $$;

-- Tandai pesanan ditahan sudah dibayar: pilih metode. Tunai langsung lunas;
-- QRIS lunas bila p_confirmed (sudah cek GoPay Merchant), kalau tidak = belum dikonfirmasi.
-- Admin toko, atau kasir pembuat pesanan.
create or replace function pay_hold(p_sale_id uuid, p_method text, p_confirmed boolean default false)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s sales%rowtype;
  v_confirmed boolean;
begin
  select * into s from sales where id = p_sale_id for update;
  if not found or not can_access(s.store_id)
     or not (is_admin(s.store_id) or s.created_by = auth.uid()) then
    raise exception 'Tidak diizinkan' using errcode = '42501';
  end if;
  if p_method not in ('cash', 'qris') then
    raise exception 'Metode pembayaran tidak valid: %', p_method;
  end if;
  if s.status <> 'completed' or s.payment_status <> 'unpaid' then
    raise exception 'Pesanan ini tidak sedang menunggu pembayaran';
  end if;
  v_confirmed := (p_method = 'cash') or coalesce(p_confirmed, false);
  update sales
     set payment_method = p_method,
         payment_status = case when v_confirmed then 'confirmed' else 'unconfirmed' end,
         payment_confirmed_at = case when v_confirmed then now() end
   where id = p_sale_id;
end $$;

revoke all on function hold_sale(uuid, uuid, jsonb, text, text) from public, anon;
revoke all on function pay_hold(uuid, text, boolean) from public, anon;
grant execute on function hold_sale(uuid, uuid, jsonb, text, text) to authenticated;
grant execute on function pay_hold(uuid, text, boolean) to authenticated;
