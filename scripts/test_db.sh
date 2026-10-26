#!/usr/bin/env bash
# Menguji db/schema.sql + db/seed.sql di PostgreSQL SEMENTARA (bukan Supabase):
# aturan stok, checkout, void, RLS, master barang, setoran, dan checkout bersamaan.
#   scripts/test_db.sh            # butuh PostgreSQL terpasang (brew install postgresql@17)
#   PGBIN=/path/ke/bin scripts/test_db.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${PGBIN:-}" ]; then
  for d in /opt/homebrew/opt/postgresql@17/bin /opt/homebrew/opt/postgresql@16/bin \
           /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/*/bin; do
    if [ -x "$d/initdb" ]; then PGBIN="$d"; break; fi
  done
fi
[ -n "${PGBIN:-}" ] || { echo "PostgreSQL (initdb) tidak ditemukan. Set PGBIN=/path/ke/bin"; exit 1; }
export PATH="$PGBIN:$PATH" LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

PORT="${PGPORT:-55432}"
TMP="$(mktemp -d)"
cleanup() { pg_ctl -D "$TMP/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

initdb -D "$TMP/data" -U postgres --auth=trust >/dev/null
pg_ctl -D "$TMP/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
  -l "$TMP/pg.log" -w start >/dev/null

q() { psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -t -A "$@"; }
q postgres -c "create database t"

for f in db/tests/00_stub_supabase.sql db/schema.sql db/seed.sql db/seed.sql; do
  q t -f "$f"
done
echo "skema + seed (dua kali) OK"

for f in db/tests/01_core.sql db/tests/02_master.sql db/tests/03_reports.sql db/tests/04_tenancy.sql db/tests/05_edit_sale.sql db/tests/06_transfer_stock.sql; do
  out="$(q t -f "$f" 2>&1 | grep -v '^$' | grep -v '^00000000' || true)"
  echo "$f -> $out"
  case "$out" in *LOLOS*) ;; *) echo "GAGAL di $f"; exit 1 ;; esac
done

# Concurrency: dua kasir membeli stok terakhir; dan klik ganda dengan key sama.
REA="$(q t -c "select id from stores where kode='REA'")"
VID="$(q t -c "select variant_id from v_catalog where store_id='$REA' and sku='A88' and variant_label='Pink' limit 1")"
VID2="$(q t -c "select variant_id from v_catalog where store_id='$REA' and sku='A40' limit 1")"
run() { # key variant  (sebagai kasir toko REA)
  q t -c "begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',true); select checkout('$REA','$1','cash',true,'[{\"variant_id\":\"$2\",\"qty\":1}]'::jsonb); select pg_sleep(1); commit;" 2>&1 | tr '\n' ' '
}
# Pastikan stok varian uji tepat 1 (tinggal satu unit).
STOCK="$(q t -c "select stock from product_variants where id='$VID'")"
if [ "$STOCK" -gt 1 ]; then
  q t -c "insert into stock_movements(store_id,variant_id,movement_type,qty_delta,reason) values ('$REA','$VID','damaged',-($STOCK-1),'uji')" >/dev/null
elif [ "$STOCK" -lt 1 ]; then
  q t -c "insert into stock_movements(store_id,variant_id,movement_type,qty_delta,reason) values ('$REA','$VID','restock',1,'uji')" >/dev/null
fi
run aaaaaaaa-0000-0000-0000-000000000001 "$VID" > "$TMP/r1" & run aaaaaaaa-0000-0000-0000-000000000002 "$VID" > "$TMP/r2" & wait
OK=$(cat "$TMP/r1" "$TMP/r2" | grep -c "Stok tidak cukup" || true)
SALES=$(q t -c "select count(*) from sale_items where variant_id='$VID' and sale_id in (select id from sales where idempotency_key::text like 'aaaaaaaa-%')")
[ "$OK" = "1" ] && [ "$SALES" = "1" ] || { echo "GAGAL: dua checkout stok terakhir (ditolak=$OK, terjual=$SALES)"; exit 1; }
echo "dua kasir, stok terakhir: satu berhasil, satu ditolak OK"

BEFORE="$(q t -c "select stock from product_variants where id='$VID2'")"
run bbbbbbbb-0000-0000-0000-000000000009 "$VID2" > "$TMP/r3" & run bbbbbbbb-0000-0000-0000-000000000009 "$VID2" > "$TMP/r4" & wait
AFTER="$(q t -c "select stock from product_variants where id='$VID2'")"
N="$(q t -c "select count(*) from sales where idempotency_key='bbbbbbbb-0000-0000-0000-000000000009'")"
[ "$N" = "1" ] && [ "$AFTER" = "$((BEFORE-1))" ] || { echo "GAGAL: klik ganda (sale=$N, stok $BEFORE->$AFTER)"; exit 1; }
echo "klik ganda dengan key sama: satu transaksi, stok berkurang sekali OK"
echo "SEMUA TES DATABASE LOLOS"
