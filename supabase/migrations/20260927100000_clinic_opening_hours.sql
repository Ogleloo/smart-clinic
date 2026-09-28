-- Migration 0052: opening hours become clinic configuration.
--
-- Found because the landing page footer said "Mon-Fri" while booking
-- happily offered Sunday slots. Opening hours were function parameter
-- defaults on get_available_slots (08:00-16:00), applied to every day of
-- the week, with no concept of a closed day. The footer text enforced
-- nothing.
--
-- Hours differ per clinic and per day: a clinic that opens Saturday
-- mornings should be a settings change, not a code change. This is the
-- same argument already made for services being admin-editable rather
-- than fixed in the schema.
--
-- Stored per day rather than as two columns on clinic_settings, because a
-- clinic closed on Sunday and open late on Thursday cannot be expressed by
-- a single open/close pair.
--
-- day_of_week follows PostgreSQL extract(dow): 0 = Sunday .. 6 = Saturday.

create table if not exists public.clinic_hours (
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  opens_at    time,
  closes_at   time,
  is_closed   boolean not null default false,
  primary key (clinic_id, day_of_week),
  constraint hours_present_when_open
    check (is_closed or (opens_at is not null and closes_at is not null and closes_at > opens_at))
);

alter table public.clinic_hours enable row level security;

-- Opening hours are public information: they are on the door of the clinic
-- and on the landing page, which is visible to people without an account.
-- This is a table grant, not a new anon-callable function, so ADR-028 and
-- its assertion are unaffected.
drop policy if exists hours_read on public.clinic_hours;
create policy hours_read on public.clinic_hours
  for select to anon, authenticated using (true);

drop policy if exists hours_admin_write on public.clinic_hours;
create policy hours_admin_write on public.clinic_hours
  for all to authenticated
  using      (public.auth_role() = 'admin' and clinic_id = public.auth_clinic_id())
  with check (public.auth_role() = 'admin' and clinic_id = public.auth_clinic_id());

grant select on public.clinic_hours to anon, authenticated;
grant insert, update, delete on public.clinic_hours to authenticated;

-- Seed Riverside: weekdays full day, Saturday mornings, closed Sunday.
insert into public.clinic_hours (clinic_id, day_of_week, opens_at, closes_at, is_closed)
values
  ('11111111-1111-1111-1111-111111111111', 1, '07:30', '16:30', false),
  ('11111111-1111-1111-1111-111111111111', 2, '07:30', '16:30', false),
  ('11111111-1111-1111-1111-111111111111', 3, '07:30', '16:30', false),
  ('11111111-1111-1111-1111-111111111111', 4, '07:30', '16:30', false),
  ('11111111-1111-1111-1111-111111111111', 5, '07:30', '16:30', false),
  ('11111111-1111-1111-1111-111111111111', 6, '08:00', '12:00', false),
  ('11111111-1111-1111-1111-111111111111', 0, null,    null,    true)
on conflict (clinic_id, day_of_week) do nothing;

-- ---------------------------------------------------------------------
-- get_available_slots now reads the clinic's hours for the requested day.
-- p_open / p_close default to NULL and fall back to the configured hours,
-- so an explicit caller can still override, but nothing has to.
-- ---------------------------------------------------------------------
create or replace function public.get_available_slots(
  p_service_id uuid,
  p_date       date,
  p_open       time default null,
  p_close      time default null,
  p_step_mins  int  default 15
)
returns table(slot_time timestamptz, is_taken boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  tz        text;
  cl        uuid;
  lead_mins int;
  cutoff    timestamptz;
  dow       smallint;
  h         public.clinic_hours;
  o_time    time;
  c_time    time;
begin
  select c.timezone, c.id, coalesce(cs.min_booking_lead_minutes, 0)
    into tz, cl, lead_mins
  from public.services s
  join public.clinics c on c.id = s.clinic_id
  left join public.clinic_settings cs on cs.clinic_id = c.id
  where s.id = p_service_id;

  if tz is null then raise exception 'Service not found'; end if;

  -- Day of week in the CLINIC's timezone, not the server's.
  dow := extract(dow from p_date)::smallint;

  select * into h from public.clinic_hours
   where clinic_id = cl and day_of_week = dow;

  -- Closed that day: no slots at all. The booking screen must say the
  -- clinic is closed rather than showing an empty grid.
  if found and h.is_closed then
    return;
  end if;

  o_time := coalesce(p_open,  h.opens_at,  '08:00'::time);
  c_time := coalesce(p_close, h.closes_at, '16:00'::time);

  cutoff := now() + (lead_mins || ' minutes')::interval;

  return query
  with grid as (
    select generate_series(
      ((p_date + o_time) at time zone tz),
      ((p_date + c_time) at time zone tz) - (p_step_mins || ' minutes')::interval,
      (p_step_mins || ' minutes')::interval
    ) as t
  )
  select g.t,
         exists (
           select 1 from public.appointments a
           where a.service_id = p_service_id
             and a.scheduled_time = g.t
             and a.status in ('booked','checked_in')
         )
  from grid g
  where g.t > cutoff
  order by g.t;
end;
$$;

notify pgrst, 'reload schema';
