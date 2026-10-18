-- Jalankan di Supabase SQL Editor SETELAH schema.sql dan seed.sql.
--
-- Langkah:
--  1. Buat login (email + password) di Authentication > Users untuk: owner, Rea, Soso
--     (dan kasir, kalau sudah ada).
--  2. Ganti email/nama di bawah, lalu jalankan.
--  3. Kasir ditambahkan belakangan dari aplikasi: Pengaturan > Pengguna (admin toko bisa
--     menambah/menonaktifkan kasir tanpa SQL).
--
-- Tanpa baris di profiles + store_members, sebuah login tidak bisa membaca data apa pun.

-- (a) Owner platform: bisa masuk ke SEMUA toko (memilih toko di aplikasi).
insert into profiles (id, nama, is_platform_owner)
select id, 'Nama Owner', true from auth.users where email = 'owner@contoh.com'
on conflict (id) do update set nama = excluded.nama, is_platform_owner = true;

-- (b) Rea = admin Toko Rea (hanya melihat tokonya).
insert into profiles (id, nama)
select id, 'Rea' from auth.users where email = 'rea@contoh.com'
on conflict (id) do nothing;
insert into store_members (store_id, user_id, role)
select s.id, u.id, 'admin' from stores s, auth.users u
where s.kode = 'REA' and u.email = 'rea@contoh.com'
on conflict (store_id, user_id) do update set role = 'admin', is_active = true;

-- (c) Soso = admin Toko Soso (hanya melihat tokonya).
insert into profiles (id, nama)
select id, 'Soso' from auth.users where email = 'soso@contoh.com'
on conflict (id) do nothing;
insert into store_members (store_id, user_id, role)
select s.id, u.id, 'admin' from stores s, auth.users u
where s.kode = 'SOSO' and u.email = 'soso@contoh.com'
on conflict (store_id, user_id) do update set role = 'admin', is_active = true;

-- Ganti nama toko (nama tampil di struk dan pemilih toko):
-- update stores set nama = 'Nama Toko Baru' where kode = 'REA';

-- Cek hasilnya:
-- select s.kode, s.nama, p.nama as pengguna, m.role, u.email
--   from store_members m join stores s on s.id = m.store_id
--   join profiles p on p.id = m.user_id join auth.users u on u.id = m.user_id order by s.kode, m.role;
