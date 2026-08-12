-- Migration 0001: Authentication & Profiles (Vertical Slice 1)
-- Implements FR-1.1, FR-1.2, FR-1.3, FR-1.4, BR-1
-- Decisions: ADR-010 (RLS boundary), ADR-015 (person vs auth account), ADR-016 (auth_role helper)

-- 1. Role enum
create type public.user_role as enum ('patient','receptionist','nurse','admin');

-- 2. profiles: a person, not necessarily an account (ADR-015)
create table public.profiles (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users (id) on delete set null,
  full_name     text not null,
  phone         text,
  role          public.user_role not null default 'patient',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is
  'Application data for every person. Extends auth.users without requiring an account (walk-ins).';
comment on column public.profiles.auth_user_id is
  'NULL for walk-in patients with no login. Unique when present.';

create index profiles_auth_user_id_idx on public.profiles (auth_user_id);
create index profiles_role_idx on public.profiles (role);

-- 3. updated_at touch trigger
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- 4. auth_role(): resolves RLS recursion (ADR-016)
create or replace function public.auth_role()
returns public.user_role
language sql stable security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where auth_user_id = auth.uid() limit 1;
$$;

create or replace function public.auth_profile_id()
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select id from public.profiles where auth_user_id = auth.uid() limit 1;
$$;

revoke all on function public.auth_role() from public, anon;
revoke all on function public.auth_profile_id() from public, anon;
grant execute on function public.auth_role() to authenticated;
grant execute on function public.auth_profile_id() to authenticated;

-- 5. Auto-create profile on signup; role FORCED to patient (BR-1, FR-1.2)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (auth_user_id, full_name, phone, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'New patient'),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), ''),
    'patient'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 6. Row Level Security (ADR-010)
alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated
  using (auth_user_id = auth.uid());

create policy profiles_select_admin on public.profiles for select to authenticated
  using (public.auth_role() = 'admin');

create policy profiles_update_own on public.profiles for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.auth_role() = 'admin')
  with check (public.auth_role() = 'admin');

-- 7. Column privileges: prevents privilege escalation via self-update
revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
grant select on public.profiles to authenticated;
