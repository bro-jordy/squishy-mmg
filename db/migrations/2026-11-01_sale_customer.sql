-- =====================================================================
-- Ubah nama pembeli pada transaksi (HANYA owner platform), tanpa mengubah barang/harga/stok.
-- Tercatat di sale_edits (sebelum/sesudah). Aman dijalankan berulang.
-- =====================================================================
create or replace function set_sale_customer(p_sale_id uuid, p_customer_name text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s sales%rowtype;
  v_new text := nullif(btrim(p_customer_name), '');
begin
  if not is_owner() then
    raise exception 'Hanya owner yang boleh mengedit transaksi' using errcode = '42501';
  end if;
  select * into s from sales where id = p_sale_id for update;
  if not found then raise exception 'Transaksi tidak ditemukan'; end if;
  if s.customer_name is not distinct from v_new then return; end if;

  update sales set customer_name = v_new, edited_at = now() where id = p_sale_id;
  insert into sale_edits (store_id, sale_id, edited_by_name, reason, before, after)
  values (s.store_id, p_sale_id, (select nama from profiles where id = auth.uid()), 'Ubah nama pembeli',
          jsonb_build_object('customer_name', s.customer_name), jsonb_build_object('customer_name', v_new));
end $$;

revoke all on function set_sale_customer(uuid, text) from public, anon;
grant execute on function set_sale_customer(uuid, text) to authenticated;
