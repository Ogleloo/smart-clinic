-- Minimal Supabase-shaped schema for testing skip_patient() in a disposable
-- Postgres container. Only the objects skip_patient() reads or writes are
-- modelled; column names, types, NOT NULLs, enums and the consultation
-- time-order check mirror the deployed schema (verified read-only against
-- project bffhjvpkfivtbzqielve on 2026-10-10). Never run this against the
-- shared Supabase project.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

-- Same resolution order Supabase uses: request.jwt.claim.sub, then the
-- JSON claims blob. Tests set request.jwt.claim.sub per session.
create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create type public.user_role as enum ('patient', 'receptionist', 'nurse', 'admin');
create type public.queue_entry_status as enum ('waiting', 'in_progress', 'done', 'skipped', 'no_show');

create table public.clinics (
  id   uuid primary key,
  name text not null
);

create table public.profiles (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  full_name    text not null,
  role         public.user_role not null default 'patient',
  clinic_id    uuid references public.clinics(id),
  is_active    boolean not null default true
);

create table public.services (
  id        uuid primary key,
  clinic_id uuid not null references public.clinics(id),
  name      text not null,
  is_active boolean not null default true
);

create table public.queue_entries (
  id            uuid primary key,
  clinic_id     uuid not null references public.clinics(id),
  service_id    uuid not null references public.services(id),
  patient_id    uuid not null references public.profiles(id),
  token         text not null,
  token_number  int  not null check (token_number > 0),
  queue_date    date not null default current_date,
  priority      smallint not null default 0 check (priority in (0, 1)),
  status        public.queue_entry_status not null default 'waiting',
  checked_in_at timestamptz not null default now(),
  called_at     timestamptz,
  completed_at  timestamptz,
  updated_at    timestamptz not null default now()
);

-- Helpers exactly as deployed (pg_get_functiondef, 2026-10-10). The old
-- skip_patient() depends on auth_role(); the new one reads profiles itself.
create or replace function public.auth_role()
returns public.user_role language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$ select role from public.profiles where auth_user_id = auth.uid() limit 1; $$;

create or replace function public.auth_clinic_id()
returns uuid language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$ select clinic_id from public.profiles where auth_user_id = auth.uid() limit 1; $$;

revoke all on function public.auth_role() from public, anon;
revoke all on function public.auth_clinic_id() from public, anon;
grant execute on function public.auth_role() to authenticated;
grant execute on function public.auth_clinic_id() to authenticated;

create table public.consultations (
  id                      uuid primary key default gen_random_uuid(),
  queue_entry_id          uuid not null unique references public.queue_entries(id) on delete cascade,
  nurse_id                uuid not null references public.profiles(id),
  service_id              uuid not null references public.services(id),
  started_at              timestamptz not null default now(),
  ended_at                timestamptz,
  exclude_from_prediction boolean not null default false,
  exclusion_reason        text,
  constraint consultations_time_order check (ended_at is null or ended_at > started_at)
);
