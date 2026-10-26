#!/usr/bin/env bash
# Uji coba migrasi di SALINAN data production (PostgreSQL sementara di Mac, bukan Supabase).
# Memulihkan .clone/prod-dump.json ke skema yang sama dengan production (db/schema.sql di
# git HEAD), menjalankan migrasi, lalu memeriksa data dan (opsional) skrip uji tambahan.
#   scripts/dryrun_migration.sh db/migrations/2026-10-26_stock_transfer.sql [skrip_uji.sql]
# Butuh: PostgreSQL terpasang (seperti scripts/test_db.sh) dan .clone/prod-dump.json.
set -euo pipefail
cd "$(dirname "$0")/.."
MIGRATION="${1:?isi dengan path file migrasi}"
EXTRA="${2:-}"
[ -f .clone/prod-dump.json ] || { echo "Tidak ada .clone/prod-dump.json (tarik dulu dari production)"; exit 1; }

if [ -z "${PGBIN:-}" ]; then
  for d in /opt/homebrew/opt/postgresql@17/bin /opt/homebrew/opt/postgresql@16/bin \
           /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/*/bin; do
    if [ -x "$d/initdb" ]; then PGBIN="$d"; break; fi
  done
fi
[ -n "${PGBIN:-}" ] || { echo "PostgreSQL (initdb) tidak ditemukan. Set PGBIN=/path/ke/bin"; exit 1; }
export PATH="$PGBIN:$PATH" LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

PORT="${PGPORT:-55433}"
TMP="$(mktemp -d)"
cleanup() { pg_ctl -D "$TMP/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

initdb -D "$TMP/data" -U postgres --auth=trust >/dev/null
pg_ctl -D "$TMP/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
  -l "$TMP/pg.log" -w start >/dev/null
q() { psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -t -A "$@"; }
q postgres -c "create database t"

# 1. skema = persis yang ada di production (sebelum migrasi baru)
git show HEAD:db/schema.sql > "$TMP/schema_prod.sql"
q t -f db/tests/00_stub_supabase.sql
q t -f "$TMP/schema_prod.sql" >/dev/null 2>&1

# 2. pulihkan data (trigger dimatikan lewat replica supaya riwayat tidak terbentuk ulang)
python3 -I - "$TMP/restore.sql" <<'EOF'
import json, sys
d = json.load(open('.clone/prod-dump.json'))
out = ["set session_replication_role = replica;"]
out.append("insert into auth.users (id, email) select id, id::text || '@clone.test' from jsonb_populate_recordset(null::profiles, $j$%s$j$::jsonb);" % json.dumps(d['profiles']))
for t in ['profiles', 'stores', 'store_members', 'products', 'product_variants', 'sales', 'sale_items',
          'stock_movements', 'settlements', 'sale_counters', 'sale_edits']:
    rows = d.get(t) or []
    if not rows:
        continue
    ov = ' overriding system value' if t in ('stock_movements', 'sale_edits') else ''
    out.append("insert into %s%s select * from jsonb_populate_recordset(null::%s, $j$%s$j$::jsonb);" % (t, ov, t, json.dumps(rows, ensure_ascii=False)))
out.append("select setval(pg_get_serial_sequence('stock_movements','id'), coalesce((select max(id) from stock_movements),1));")
out.append("select setval(pg_get_serial_sequence('sale_edits','id'), coalesce((select max(id) from sale_edits),1));")
open(sys.argv[1], 'w').write("\n".join(out))
EOF
q t -f "$TMP/restore.sql" >/dev/null

echo "== salinan production dipulihkan =="
q t -c "select 'toko', count(*) from stores union all select 'produk', count(*) from products union all select 'varian', count(*) from product_variants union all select 'transaksi', count(*) from sales union all select 'pergerakan stok', count(*) from stock_movements"
BAD="$(q t -c "select count(*) from product_variants v where v.stock <> (select coalesce(sum(qty_delta),0) from stock_movements m where m.variant_id = v.id)")"
echo "varian dengan stok <> riwayat (sebelum migrasi): $BAD"
q t -c "select 'total_stok_'||s.kode, sum(v.stock) from product_variants v join stores s on s.id=v.store_id group by s.kode order by 1"
q t -c "select 'omzet_'||s.kode, sum(x.total) from sales x join stores s on s.id=x.store_id where x.status='completed' group by s.kode order by 1"

# 3. jalankan migrasi (dua kali: harus aman diulang)
q t -f "$MIGRATION" >/dev/null 2>"$TMP/mig1.log" || { cat "$TMP/mig1.log"; echo "MIGRASI GAGAL"; exit 1; }
q t -f "$MIGRATION" >/dev/null 2>"$TMP/mig2.log" || { cat "$TMP/mig2.log"; echo "MIGRASI GAGAL saat diulang"; exit 1; }
echo "== migrasi berhasil (dan aman diulang) =="

AFTER="$(q t -c "select count(*) from product_variants v where v.stock <> (select coalesce(sum(qty_delta),0) from stock_movements m where m.variant_id = v.id)")"
echo "varian dengan stok <> riwayat (sesudah migrasi): $AFTER"

if [ -n "$EXTRA" ]; then
  out="$(q t -f "$EXTRA" 2>&1 | grep -v '^$' || true)"
  echo "$EXTRA -> $out"
  case "$out" in *LOLOS*) ;; *) echo "GAGAL di $EXTRA"; exit 1;; esac
fi
echo "DRY-RUN SELESAI"
