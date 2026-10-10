-- Minimal Supabase-shaped stub for testing docs/proposals/avatar_storage.sql in a throwaway
-- Postgres. Never run against the shared project. Mirrors, from the live project (read-only,
-- 2026-10-10): the profiles columns, grants and policies relevant here, and Storage's helper
-- functions with the semantics Supabase documents (foldername = path segments minus the file;
-- filename = last segment). Storage tables are reduced to the columns the policy reads.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner_id text,
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
-- Supabase grants the API roles full table privileges on storage.objects and relies on RLS.
grant all on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
create function storage.filename(name text) returns text language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end $$;

grant usage on schema public to anon, authenticated, service_role;
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  full_name text not null,
  phone text,
  role text not null default 'patient',
  date_of_birth date,
  id_number text
);
alter table public.profiles enable row level security;
create policy profiles_select_own on public.profiles for select to authenticated using (auth_user_id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated
  using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());
grant select, insert on public.profiles to authenticated;
grant update (full_name, phone, date_of_birth, id_number) on public.profiles to authenticated;
grant all on public.profiles to service_role;
