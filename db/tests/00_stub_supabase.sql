-- Tiruan minimal skema auth Supabase, HANYA untuk database uji sementara.
-- JANGAN dijalankan di Supabase asli.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
-- sama dengan auth.uid() Supabase: baca klaim JWT (request.jwt.claim.sub atau request.jwt.claims)
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
grant usage on schema auth to authenticated, anon;
grant usage on schema public to authenticated, anon;
