-- Migration 0003: Queue Engine schema (Vertical Slice 2)
-- Tables, constraints and indexes. Functions follow in 0004.
-- Implements M6 §12 items 2-15.

-- ---------- enums ----------
create type public.queue_entry_status as enum
  ('waiting','in_progress','done','skipped','no_show');

-- ---------- clinics ----------
create table public.clinics (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text,
  city        text,
  timezone    text not null default 'Africa/Johannesburg',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger clinics_touch before update on public.clinics
  for each row execute function public.touch_updated_at();

-- ---------- services ----------
create table public.services (
  id                           uuid primary key default gen_random_uuid(),
  clinic_id                    uuid not null references public.clinics(id) on delete cascade,
  name                         text not null,
  token_prefix                 text not null,
  default_consultation_minutes int  not null default 15
    check (default_consultation_minutes between 1 and 240),
  is_active                    boolean not null default true,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  constraint services_prefix_format check (token_prefix ~ '^[A-Z]{2,4}$'),
  constraint services_unique_prefix unique (clinic_id, token_prefix)
);
create trigger services_touch before update on public.services
  for each row execute function public.touch_updated_at();
create index services_clinic_idx on public.services (clinic_id, is_active);

-- ---------- clinic_settings (ADR-018) ----------
-- Thresholds live in the database so admins can tune them without a
-- code change, and so the Queue Engine reads one source of truth.
create table public.clinic_settings (
  clinic_id                            uuid primary key
                                         references public.clinics(id) on delete cascade,
  no_show_grace_minutes                int not null default 10,
  confidence_high_min_count            int not null default 30,
  confidence_min_count_floor           int not null default 10,
  confidence_consistent_stddev_minutes numeric(5,2) not null default 3,
  confidence_inconsistent_stddev_minutes numeric(5,2) not null default 7,
  capacity_threshold                   int not null default 20,
  max_plausible_consultation_minutes   int not null default 90,
  updated_at                           timestamptz not null default now()
);
create trigger clinic_settings_touch before update on public.clinic_settings
  for each row execute function public.touch_updated_at();

-- ---------- profiles: deferred columns from 0001 ----------
alter table public.profiles
  add column clinic_id          uuid references public.clinics(id) on delete set null,
  add column current_service_id uuid references public.services(id) on delete set null,
  add column is_on_duty         boolean not null default false;

-- The "available nurses" divisor for the prediction formula.
create index profiles_duty_idx
  on public.profiles (current_service_id, is_on_duty)
  where role = 'nurse' and is_active;
create index profiles_clinic_role_idx on public.profiles (clinic_id, role);

-- A nurse must not be assigned to a service in another clinic (M6 §2.3).
create or replace function public.check_service_clinic_match()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare svc_clinic uuid;
begin
  if new.current_service_id is null then return new; end if;
  select clinic_id into svc_clinic from public.services where id = new.current_service_id;
  if svc_clinic is distinct from new.clinic_id then
    raise exception 'Service % does not belong to clinic %', new.current_service_id, new.clinic_id;
  end if;
  return new;
end;
$$;
create trigger profiles_service_clinic_match
  before insert or update of current_service_id, clinic_id on public.profiles
  for each row execute function public.check_service_clinic_match();

-- ---------- queue_entries ----------
-- appointment_id is deliberately absent: appointments arrive in Slice 3.
create table public.queue_entries (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id)  on delete cascade,
  service_id      uuid not null references public.services(id) on delete restrict,
  patient_id      uuid not null references public.profiles(id) on delete restrict,
  token           text not null,
  token_number    int  not null check (token_number > 0),
  queue_date      date not null default current_date,
  priority        smallint not null default 0 check (priority in (0,1)),
  status          public.queue_entry_status not null default 'waiting',
  checked_in_at   timestamptz not null default now(),
  called_at       timestamptz,
  completed_at    timestamptz,
  priority_set_by uuid references public.profiles(id) on delete set null,
  priority_set_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger queue_entries_touch before update on public.queue_entries
  for each row execute function public.touch_updated_at();

-- BR-7: tokens unique per clinic, per service, per day.
create unique index queue_entries_token_unique
  on public.queue_entries (clinic_id, service_id, queue_date, token_number);

-- A patient cannot hold two live entries in the same service on one day.
create unique index queue_entries_one_active
  on public.queue_entries (patient_id, service_id, queue_date)
  where status in ('waiting','in_progress');

-- THE Queue Engine index: position, ordering and waiting counts in one.
create index queue_entries_engine_idx
  on public.queue_entries (service_id, queue_date, status, priority desc, checked_in_at asc);

create index queue_entries_patient_idx on public.queue_entries (patient_id, status);
create index queue_entries_clinic_idx  on public.queue_entries (clinic_id, queue_date);

-- ---------- consultations ----------
-- Created here (not Slice 5) because the Queue Engine reads durations
-- to compute averages and confidence. Slice 5 adds the nurse UI.
create table public.consultations (
  id             uuid primary key default gen_random_uuid(),
  queue_entry_id uuid not null unique references public.queue_entries(id) on delete cascade,
  nurse_id       uuid not null references public.profiles(id) on delete restrict,
  service_id     uuid not null references public.services(id) on delete restrict,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  created_at     timestamptz not null default now(),
  constraint consultations_time_order
    check (ended_at is null or ended_at > started_at)
);

-- Per-service averages and stddev; also the reporting index.
create index consultations_stats_idx on public.consultations (service_id, ended_at);
create index consultations_nurse_idx on public.consultations (nurse_id, started_at desc);
