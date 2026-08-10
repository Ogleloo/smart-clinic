-- Migration 0018: get_available_slots must not offer times already gone
--
-- Found during Slice 3 frontend work: for today's date the function
-- listed past times with is_taken = false. book_appointment correctly
-- refuses them ("That time is in the past"), so nothing could be booked
-- wrongly — but the UI was offering a choice the database would always
-- reject. An option that cannot succeed should not be presented.
--
-- Adds min_booking_lead_minutes so a clinic can also refuse bookings
-- made moments before the slot (default 0 = only exclude the past,
-- preserving current behaviour).

alter table public.clinic_settings
  add column if not exists min_booking_lead_minutes int not null default 0;

create or replace function public.get_available_slots(
  p_service_id uuid,
  p_date       date,
  p_open       time default '08:00',
  p_close      time default '16:00',
  p_step_mins  int  default 15
)
returns table (slot_time timestamptz, is_taken boolean)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  tz        text;
  lead_mins int;
  cutoff    timestamptz;
begin
  select c.timezone,
         coalesce(cs.min_booking_lead_minutes, 0)
    into tz, lead_mins
  from public.services s
  join public.clinics c on c.id = s.clinic_id
  left join public.clinic_settings cs on cs.clinic_id = c.id
  where s.id = p_service_id;

  if tz is null then raise exception 'Service not found'; end if;

  cutoff := now() + (lead_mins || ' minutes')::interval;

  return query
  with grid as (
    select generate_series(
      ((p_date + p_open)  at time zone tz),
      ((p_date + p_close) at time zone tz) - (p_step_mins || ' minutes')::interval,
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
  where g.t > cutoff          -- never offer a slot that cannot be booked
  order by g.t;
end;
$$;

revoke execute on function public.get_available_slots(uuid,date,time,time,int) from public, anon;
grant execute on function public.get_available_slots(uuid,date,time,time,int) to authenticated;

notify pgrst, 'reload schema';
