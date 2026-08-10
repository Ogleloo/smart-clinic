-- Migration 0008: Appointments (Vertical Slice 3)
-- Implements FR-2.x, BR-4, BR-6, ADR-017.
--
-- Correction to the M6 spec: it proposed indexing date(scheduled_time),
-- but casting timestamptz -> date is NOT immutable (it depends on the
-- session timezone), so Postgres refuses it in an index. We therefore
-- store scheduled_date explicitly, derived from the CLINIC's timezone.
-- This makes the timezone decision visible instead of implicit.

create type public.appointment_status as enum
  ('booked','checked_in','cancelled','no_show','completed');

create table public.appointments (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references public.profiles(id) on delete restrict,
  service_id     uuid not null references public.services(id) on delete restrict,
  scheduled_time timestamptz not null,
  scheduled_date date not null,          -- derived; see trigger below
  status         public.appointment_status not null default 'booked',
  cancelled_at   timestamptz,
  cancelled_by   uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- ADR-017: constrain the time grid so "a slot" is a real thing.
  -- Without this, 09:00:00 and 09:00:01 are different slots and BR-4
  -- cannot be enforced by any unique index.
  constraint appointments_on_slot_grid check (
    date_part('minute', scheduled_time)::int % 15 = 0
    and date_part('second', scheduled_time) = 0
  )
);

-- Derive scheduled_date from the clinic's own timezone.
create or replace function public.set_appointment_date()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare tz text;
begin
  select c.timezone into tz
  from public.services s
  join public.clinics c on c.id = s.clinic_id
  where s.id = new.service_id;

  new.scheduled_date := (new.scheduled_time at time zone coalesce(tz,'UTC'))::date;
  return new;
end;
$$;

create trigger appointments_set_date
  before insert or update of scheduled_time, service_id on public.appointments
  for each row execute function public.set_appointment_date();

create trigger appointments_touch before update on public.appointments
  for each row execute function public.touch_updated_at();

-- BR-4: at most one live appointment per service per slot.
-- This is what makes AC-1 (concurrent double-booking) fail correctly
-- at the DATABASE, not in application code that races.
create unique index appointments_slot_unique
  on public.appointments (service_id, scheduled_time)
  where status in ('booked','checked_in');

-- BR-6: one live appointment per patient, per service, per day.
create unique index appointments_one_per_patient_day
  on public.appointments (patient_id, service_id, scheduled_date)
  where status in ('booked','checked_in');

create index appointments_service_time_idx on public.appointments (service_id, scheduled_time);
create index appointments_patient_idx      on public.appointments (patient_id, status);

-- Link a queue entry back to the appointment it came from.
-- NULL = walk-in. One table serves both paths.
alter table public.queue_entries
  add column appointment_id uuid unique references public.appointments(id) on delete set null;

-- ---------- RLS ----------
alter table public.appointments enable row level security;

create policy appointments_patient_own on public.appointments for select to authenticated
  using (patient_id = public.auth_profile_id());

create policy appointments_staff_read on public.appointments for select to authenticated
  using (public.auth_role() in ('receptionist','nurse','admin')
         and exists (select 1 from public.services s
                     where s.id = appointments.service_id
                       and s.clinic_id = public.auth_clinic_id()));

create policy appointments_patient_insert on public.appointments for insert to authenticated
  with check (patient_id = public.auth_profile_id()
              and public.auth_role() = 'patient');

create policy appointments_staff_insert on public.appointments for insert to authenticated
  with check (public.auth_role() in ('receptionist','admin')
              and exists (select 1 from public.services s
                          where s.id = appointments.service_id
                            and s.clinic_id = public.auth_clinic_id()));

create policy appointments_patient_update on public.appointments for update to authenticated
  using (patient_id = public.auth_profile_id())
  with check (patient_id = public.auth_profile_id());

create policy appointments_staff_update on public.appointments for update to authenticated
  using (public.auth_role() in ('receptionist','admin')
         and exists (select 1 from public.services s
                     where s.id = appointments.service_id
                       and s.clinic_id = public.auth_clinic_id()))
  with check (true);

grant select, insert, update on public.appointments to authenticated;
