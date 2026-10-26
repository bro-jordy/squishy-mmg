#!/usr/bin/env python3
"""Ubah dump production (.clone/prod-dump.json) jadi data MODE LOKAL (src/data/prod-clone.json).
Keduanya di-gitignore: berisi transaksi dan nama pembeli asli.
Pakai:  python3 -I scripts/build_prod_clone.py
Lalu:   npm run dev:local  ->  buka http://localhost:5173/?data=prod  (kembali: ?data=contoh)
"""
import json, sys
from collections import defaultdict

d = json.load(open('.clone/prod-dump.json'))
profiles = {p['id']: p for p in d['profiles']}
stores = sorted(d['stores'], key=lambda s: (s['kode'] != 'REA', s['nama']))

# pengguna lokal: owner platform = u-owner; admin/kasir Soso -> u-soso / u-kasirsoso; Rea -> u-rea / u-kasir
def local_id(uid, store_kode, role):
    p = profiles.get(uid, {})
    if p.get('is_platform_owner'):
        return 'u-owner'
    if store_kode == 'SOSO':
        return 'u-soso' if role == 'admin' else 'u-kasirsoso'
    return 'u-rea' if role == 'admin' else 'u-kasir'

members_by_store = defaultdict(list)
uid_map = {}
kode_of = {s['id']: s['kode'] for s in stores}
for m in d['store_members']:
    kode = kode_of[m['store_id']]
    lid = local_id(m['user_id'], kode, m['role'])
    uid_map[m['user_id']] = lid
    p = profiles.get(m['user_id'], {})
    members_by_store[m['store_id']].append({
        'user_id': lid, 'nama': p.get('nama', lid), 'email': f"{lid[2:]}@clone.test",
        'role': m['role'], 'is_active': m['is_active']})
for p in d['profiles']:
    if p['is_platform_owner']:
        uid_map[p['id']] = 'u-owner'

def _group(rows, key):
    g = defaultdict(list)
    for r in rows:
        g[r[key]].append(r)
    return g

products = _group(d['products'], 'store_id')
variants = _group(d['product_variants'], 'store_id')
sales = _group(d['sales'], 'store_id')
items = _group(d['sale_items'], 'sale_id')
moves = _group(d['stock_movements'], 'store_id')
counters = _group(d['sale_counters'], 'store_id')
settlements = _group(d['settlements'], 'store_id')

states = {}
for s in stores:
    sid = s['id']
    mv = sorted(moves[sid], key=lambda m: m['id'])
    sl = []
    for x in sorted(sales[sid], key=lambda r: r['sold_at']):
        sl.append({
            **{k: x.get(k) for k in ['id', 'sale_no', 'idempotency_key', 'sold_at', 'customer_name', 'payment_method',
                                      'payment_status', 'payment_confirmed_at', 'status', 'total', 'note', 'void_reason',
                                      'voided_at', 'voided_by_name', 'cashier_name', 'edited_at']},
            'created_by': uid_map.get(x['created_by'], x['created_by']),
            'sale_items': [{k: i[k] for k in ['id', 'variant_id', 'qty', 'unit_price', 'line_total', 'sku', 'product_name', 'variant_label']}
                           for i in items[x['id']]],
        })
    states[sid] = {
        'nextId': (max([m['id'] for m in mv]) if mv else 0) + 1,
        'nextProductNo': 100000, 'nextVariantNo': 100000, 'nextSaleNo': 100000, 'nextSettlementNo': 100000,
        'saleCounters': {str(c['day'])[:10]: c['last_no'] for c in counters[sid]},
        'sales': sl,
        'settlements': settlements[sid],
        'products': [{k: p[k] for k in ['id', 'sku', 'name', 'price', 'is_active']} for p in products[sid]],
        'variants': [{k: v[k] for k in ['id', 'product_id', 'varian', 'warna', 'stock_awal', 'is_active']} for v in variants[sid]],
        'movements': [{k: m.get(k) for k in ['id', 'variant_id', 'movement_type', 'qty_delta', 'reason', 'sale_id', 'created_at']} for m in mv],
        'members': members_by_store[sid],
    }

out = {'dibuat_dari': d['diambil_pada'], 'stores': [{'id': s['id'], 'kode': s['kode'], 'nama': s['nama']} for s in stores],
       'states': states, 'transfers': []}
json.dump(out, open('src/data/prod-clone.json', 'w'), ensure_ascii=False)
for s in stores:
    st = states[s['id']]
    print(s['kode'], 'produk', len(st['products']), 'varian', len(st['variants']), 'transaksi', len(st['sales']),
          'pergerakan', len(st['movements']), 'anggota', [m['user_id'] for m in st['members']])
