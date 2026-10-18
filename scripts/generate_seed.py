"""Bangun db/seed.sql dari snapshot Master Barang (CSV).

Pakai:  python3 -I scripts/generate_seed.py db/data/master_barang_snapshot.csv db/seed.sql [src/data/local-seed.json]

Argumen ketiga (opsional) menulis data yang sama sebagai JSON untuk mode lokal aplikasi.

Aturan pembersihan:
  * trim spasi; "-" atau kosong -> NULL
  * baris duplikat (sku, nama, varian, warna) digabung jadi satu (stok TIDAK dijumlah)
  * SKU di SPLIT_NAME_SKUS: "Nama - Bentuk" dipecah -> produk "Nama", varian "Bentuk"
  * satu produk (sku, nama) harus punya satu harga
"""
import csv
import json
import sys
from collections import OrderedDict, defaultdict

SPLIT_NAME_SKUS = {"A33"}

# Dua toko dengan master barang terpisah. Toko pertama menerima master + Stock Awal dari sheet;
# toko kedua dibuat KOSONG (barangnya ditambahkan nanti, lewat Master Barang atau impor).
# Ubah NAMA di sini lalu jalankan ulang skrip (atau di Supabase:
# update stores set nama = '...' where kode = '...').
STORES = [("REA", "Toko Rea"), ("SOSO", "Toko Soso")]


def clean(value):
    value = (value or "").strip()
    return None if value in ("", "-") else value


def lit(value):
    if value is None:
        return "null::text"
    return "'" + value.replace("'", "''") + "'"


def main(src, dst, json_dst=None):
    products = OrderedDict()   # (sku, name) -> price
    variants = OrderedDict()   # (sku, name, varian, warna) -> (stock_awal, qty_stock)
    warnings = []

    with open(src, newline="", encoding="utf-8") as f:
        for line_no, row in enumerate(csv.DictReader(f), start=2):
            sku = row["sku"].strip()
            name = row["nama_barang"].strip()
            varian = clean(row["varian"])
            warna = clean(row["warna"])
            stock_awal = int(row["stock_awal"])
            qty_stock = int(row["qty_stock"])
            price = int(row["harga"])

            if sku in SPLIT_NAME_SKUS and " - " in name:
                name, bentuk = name.split(" - ", 1)
                if varian is not None:
                    warnings.append(f"baris {line_no}: varian '{varian}' ditimpa bentuk '{bentuk}'")
                varian = bentuk.strip()

            if products.setdefault((sku, name), price) != price:
                raise SystemExit(f"baris {line_no}: harga beda dalam produk {sku} {name}")

            key = (sku, name, varian, warna)
            if key in variants:
                if variants[key] != (stock_awal, qty_stock):
                    raise SystemExit(f"baris {line_no}: duplikat {key} dengan stok berbeda")
                warnings.append(f"baris {line_no}: duplikat {key} digabung (stok tidak dijumlah)")
                continue
            variants[key] = (stock_awal, qty_stock)

    by_sku = defaultdict(set)
    for sku, name in products:
        by_sku[sku].add(name)

    (k1, _) = STORES[0]
    rea = f"(select id from stores where kode = '{k1}')"
    out = []
    out.append("-- Dibuat oleh scripts/generate_seed.py dari db/data/master_barang_snapshot.csv")
    out.append("-- Aman dijalankan ulang (ON CONFLICT DO NOTHING). Stok awal otomatis jadi movement 'opening'.")
    out.append("-- Penjualan 16-17 Okt BELUM diimpor: stok toko REA = Stock Awal sheet.")
    out.append("-- Dua toko dengan master barang TERPISAH. Toko pertama berisi master dari sheet; toko kedua KOSONG.")
    out.append("-- Nama toko bisa diubah:")
    out.append(f"--   update stores set nama = '...' where kode = '{k1}';")
    out.append("begin;")
    out.append("")
    out.append("insert into stores (kode, nama) values " + ", ".join(f"({lit(k)}, {lit(n)})" for k, n in STORES))
    out.append("on conflict (kode) do nothing;")
    out.append("")
    out.append("-- Toko REA: master barang + stok awal dari sheet")
    out.append("insert into products (store_id, sku, name, price)")
    out.append(f"select {rea}, v.sku, v.name, v.price")
    out.append("from (values")
    out.append(",\n".join(f"  ({lit(sk)}, {lit(n)}, {p})" for (sk, n), p in products.items()))
    out.append(") as v(sku, name, price)")
    out.append("on conflict (store_id, lower(sku), lower(name)) do nothing;")
    out.append("")
    out.append("insert into product_variants (store_id, product_id, varian, warna, stock_awal)")
    out.append("select p.store_id, p.id, v.varian, v.warna, v.stock_awal")
    out.append("from (values")
    out.append(",\n".join(
        f"  ({lit(sk)}, {lit(n)}, {lit(va)}, {lit(w)}, {awal})"
        for (sk, n, va, w), (awal, _) in variants.items()))
    out.append(") as v(sku, name, varian, warna, stock_awal)")
    out.append(f"join products p on p.store_id = {rea} and p.sku = v.sku and p.name = v.name")
    out.append("on conflict (product_id, coalesce(lower(varian), ''), coalesce(lower(warna), '')) do nothing;")
    out.append("")
    out.append("commit;")

    with open(dst, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")

    if json_dst:
        ids = {key: f"p{i}" for i, key in enumerate(products, start=1)}
        data = {
            "stores": [{"id": f"s{i}", "kode": k, "nama": n} for i, (k, n) in enumerate(STORES, start=1)],
            "products": [
                {"id": ids[key], "sku": key[0], "name": key[1], "price": price, "is_active": True}
                for key, price in products.items()
            ],
            "variants": [
                {"id": f"v{i}", "product_id": ids[(s, n)], "varian": va, "warna": w,
                 "stock": awal, "is_active": True}
                for i, ((s, n, va, w), (awal, _)) in enumerate(variants.items(), start=1)
            ],
        }
        with open(json_dst, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.write("\n")

    print(f"produk: {len(products)}  varian: {len(variants)}  SKU unik: {len(by_sku)}")
    print(f"total stok awal: {sum(a for a, _ in variants.values())}  "
          f"total qty stock sheet: {sum(q for _, q in variants.values())}")
    multi = {s: sorted(n) for s, n in by_sku.items() if len(n) > 1}
    print("SKU dengan >1 produk:", multi or "tidak ada")
    for w in warnings:
        print("catatan:", w)


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        raise SystemExit(__doc__)
    main(*sys.argv[1:])
