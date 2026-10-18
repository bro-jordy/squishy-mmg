-- Dibuat oleh scripts/generate_seed.py dari db/data/master_barang_snapshot.csv
-- Aman dijalankan ulang (ON CONFLICT DO NOTHING). Stok awal otomatis jadi movement 'opening'.
-- Penjualan 16-17 Okt BELUM diimpor: stok toko REA = Stock Awal sheet.
-- Dua toko dengan master barang TERPISAH. Toko pertama berisi master dari sheet; toko kedua KOSONG.
-- Nama toko bisa diubah:
--   update stores set nama = '...' where kode = 'REA';
begin;

insert into stores (kode, nama) values ('REA', 'Toko Rea'), ('SOSO', 'Toko Soso')
on conflict (kode) do nothing;

-- Toko REA: master barang + stok awal dari sheet
insert into products (store_id, sku, name, price)
select (select id from stores where kode = 'REA'), v.sku, v.name, v.price
from (values
  ('A23', 'Butter Squishy Super Soft', 120000),
  ('A13', 'Squishy Pudding', 50000),
  ('A26', 'Squishy Fruit', 50000),
  ('A39', 'Squishy Kiwi', 50000),
  ('A29', 'Squishy Cheese', 35000),
  ('A9', 'Squishy Kacang', 50000),
  ('A95', 'Squishy Cheese Cube', 50000),
  ('A25', 'Squishy Pizza Cheese', 35000),
  ('A35', 'Squishy Soap', 50000),
  ('A17', 'Squishy Cheese Cube', 35000),
  ('A12', 'Squishy Ice Cube', 35000),
  ('A12.1', 'Squishy QQ Candy', 35000),
  ('A37', 'Squishy Gummy Bear', 35000),
  ('A3.1', 'Squishy Cube Clear', 35000),
  ('A3', 'Squishy Cube Glitter', 35000),
  ('A18', 'Squishy Butter', 35000),
  ('A33', 'Squishy Coklat', 40000),
  ('A19', 'Squishy Butter Square', 50000),
  ('A15', 'Squishy Butter - Big', 75000),
  ('A1', 'Squishy Roti', 22000),
  ('A22', 'Squishy Toothpaste - Glitter', 35000),
  ('A22.1', 'Squishy Toothpaste - Clear', 35000),
  ('A27', 'Squishy Dumpling Mini', 5000),
  ('A88', 'Squishy Face DIY', 120000),
  ('A40', 'Squishy Manggo', 50000)
) as v(sku, name, price)
on conflict (store_id, lower(sku), lower(name)) do nothing;

insert into product_variants (store_id, product_id, varian, warna, stock_awal)
select p.store_id, p.id, v.varian, v.warna, v.stock_awal
from (values
  ('A23', 'Butter Squishy Super Soft', 'Vaseline', 'Kuning', 6),
  ('A13', 'Squishy Pudding', 'Crunchy', 'Orange', 12),
  ('A26', 'Squishy Fruit', 'Coconut Oil', 'Hijau', 6),
  ('A26', 'Squishy Fruit', 'Coconut Oil', 'Pink', 6),
  ('A39', 'Squishy Kiwi', 'Smooties', 'Putih', 4),
  ('A39', 'Squishy Kiwi', 'Smooties', 'Pink', 4),
  ('A39', 'Squishy Kiwi', 'Smooties', 'Biru', 4),
  ('A29', 'Squishy Cheese', null::text, 'Kuning', 6),
  ('A9', 'Squishy Kacang', 'Crunchy', 'Krem', 6),
  ('A9', 'Squishy Kacang', 'Coconut Oil', 'Coklat', 6),
  ('A95', 'Squishy Cheese Cube', 'Coconut Oil', 'Kuning', 5),
  ('A25', 'Squishy Pizza Cheese', null::text, 'Kuning', 12),
  ('A35', 'Squishy Soap', 'Crunchy', 'Putih', 6),
  ('A17', 'Squishy Cheese Cube', null::text, 'Kuning', 6),
  ('A12', 'Squishy Ice Cube', 'Maltose', 'Ungu', 2),
  ('A12', 'Squishy Ice Cube', 'Maltose', 'Biru', 2),
  ('A12', 'Squishy Ice Cube', 'Maltose', 'Hijau', 1),
  ('A12', 'Squishy Ice Cube', 'Maltose', 'Merah', 1),
  ('A12.1', 'Squishy QQ Candy', 'Maltose', 'Kuning', 1),
  ('A12.1', 'Squishy QQ Candy', 'Maltose', 'Ungu', 1),
  ('A12.1', 'Squishy QQ Candy', 'Maltose', 'Pink', 2),
  ('A12.1', 'Squishy QQ Candy', 'Maltose', 'Biru', 2),
  ('A37', 'Squishy Gummy Bear', 'Maltose', 'Orange', 2),
  ('A37', 'Squishy Gummy Bear', 'Maltose', 'Kuning', 4),
  ('A37', 'Squishy Gummy Bear', 'Maltose', 'Hijau', 3),
  ('A37', 'Squishy Gummy Bear', 'Maltose', 'Biru', 3),
  ('A3.1', 'Squishy Cube Clear', 'Maltose', 'Biru', 3),
  ('A3.1', 'Squishy Cube Clear', 'Maltose', 'Merah', 3),
  ('A3.1', 'Squishy Cube Clear', 'Maltose', 'Kuning', 3),
  ('A3.1', 'Squishy Cube Clear', 'Maltose', 'Ungu', 2),
  ('A3', 'Squishy Cube Glitter', 'Maltose', 'Ungu', 3),
  ('A3', 'Squishy Cube Glitter', 'Maltose', 'Biru', 3),
  ('A3', 'Squishy Cube Glitter', 'Maltose', 'Orange', 3),
  ('A3', 'Squishy Cube Glitter', 'Maltose', 'Pink', 3),
  ('A18', 'Squishy Butter', null::text, 'Pink', 4),
  ('A18', 'Squishy Butter', 'Maltose', 'Kuning', 4),
  ('A18', 'Squishy Butter', null::text, 'Kuning', 4),
  ('A33', 'Squishy Coklat', 'Sneakers', null::text, 1),
  ('A33', 'Squishy Coklat', 'Kit Kat', null::text, 1),
  ('A33', 'Squishy Coklat', 'Hersey', null::text, 1),
  ('A33', 'Squishy Coklat', 'KKUNKK', null::text, 1),
  ('A33', 'Squishy Coklat', 'Reeses', null::text, 1),
  ('A33', 'Squishy Coklat', 'Bar', null::text, 1),
  ('A19', 'Squishy Butter Square', null::text, 'Kuning', 6),
  ('A19', 'Squishy Butter Square', null::text, 'Pink', 6),
  ('A15', 'Squishy Butter - Big', null::text, 'Kuning', 6),
  ('A15', 'Squishy Butter - Big', null::text, 'Kuning Muda', 6),
  ('A1', 'Squishy Roti', 'Croissant', null::text, 9),
  ('A1', 'Squishy Roti', 'Beruang', null::text, 9),
  ('A1', 'Squishy Roti', 'Bunga', null::text, 3),
  ('A1', 'Squishy Roti', 'Bun', null::text, 6),
  ('A1', 'Squishy Roti', 'Creaker', null::text, 3),
  ('A1', 'Squishy Roti', 'Spiral', null::text, 3),
  ('A1', 'Squishy Roti', 'Paw', null::text, 3),
  ('A1', 'Squishy Roti', 'Hotdog', null::text, 3),
  ('A1', 'Squishy Roti', 'Roti Sobek', null::text, 3),
  ('A1', 'Squishy Roti', 'Love', null::text, 6),
  ('A1', 'Squishy Roti', 'Soes', null::text, 3),
  ('A1', 'Squishy Roti', 'Donat', null::text, 3),
  ('A1', 'Squishy Roti', 'Kenari', null::text, 3),
  ('A22', 'Squishy Toothpaste - Glitter', 'Maltose', 'Ungu', 3),
  ('A22', 'Squishy Toothpaste - Glitter', 'Maltose', 'Pink', 3),
  ('A22', 'Squishy Toothpaste - Glitter', 'Maltose', 'Pearl', 3),
  ('A22.1', 'Squishy Toothpaste - Clear', 'Maltose', 'Clear', 3),
  ('A22.1', 'Squishy Toothpaste - Clear', 'Maltose', 'Ungu', 3),
  ('A22.1', 'Squishy Toothpaste - Clear', 'Maltose', 'Biru', 3),
  ('A22.1', 'Squishy Toothpaste - Clear', 'Maltose', 'Merah', 3),
  ('A22.1', 'Squishy Toothpaste - Clear', 'Maltose', 'Pink', 3),
  ('A27', 'Squishy Dumpling Mini', null::text, null::text, 120),
  ('A88', 'Squishy Face DIY', 'Clay', 'Ungu', 1),
  ('A88', 'Squishy Face DIY', 'Clay', 'Putih', 1),
  ('A88', 'Squishy Face DIY', 'Clay', 'Pink', 1),
  ('A40', 'Squishy Manggo', 'Crunchy', 'Kuning', 6)
) as v(sku, name, varian, warna, stock_awal)
join products p on p.store_id = (select id from stores where kode = 'REA') and p.sku = v.sku and p.name = v.name
on conflict (product_id, coalesce(lower(varian), ''), coalesce(lower(warna), '')) do nothing;

commit;
