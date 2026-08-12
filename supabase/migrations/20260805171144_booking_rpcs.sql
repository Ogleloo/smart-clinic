-- Migration 0009: Booking + appointment check-in RPCs

-- ---------- available slots ----------
-- Generates the slot grid for a service on a date and marks which are
-- taken. Slot generation lives in the database so the grid definition
-- has ONE home (the same reason prediction does — ADR-008).
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
declare tz text;
begin
  select c.timezone into tz
  from public.services s join public.clinics c on c.id = s.clinic_id
  where s.id = p_service_id;
  if tz is null then raise exception 'Service not found'; end if;

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
  order by g.t;
end;
$$;

-- ---------- book ----------
create or replace function public.book_appointment(
  p_service_id uuid,
  p_slot       timestamptz,
  p_patient_id uuid default null
)
returns public.appointments
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  caller_role public.user_role;
  caller      uuid;
  target      uuid;
  appt        public.appointments;
begin
  caller := public.auth_profile_id();
  caller_role := public.auth_role();
  if caller is null then raise exception 'Not authenticated'; end if;

  -- Patients book only for themselves; staff may book for others.
  if caller_role = 'patient' then
    target := caller;
  elsif caller_role in ('receptionist','admin') then
    target := coalesce(p_patient_id, caller);
  else
    raise exception 'Nurses do not book appointments';
  end if;

  if p_slot < now() then
    raise exception 'That time is in the past';
  end if;

  begin
    insert into public.appointments (patient_id, service_id, scheduled_time)
    values (target, p_service_id, p_slot)
    returning * into appt;
  exception
    when unique_violation then
      -- BR-4 / BR-6 enforced by partial unique indexes. Distinguish
      -- the two so the UI can say something useful.
      if position('slot_unique' in SQLERRM) > 0 then
        raise exception 'That slot was just taken. Please choose another time.'
          using errcode = '23505';
      else
        raise exception 'You already have an appointment for this service that day.'
          using errcode = '23505';
      end if;
    when check_violation then
      raise exception 'Appointments must start on a 15-minute boundary.';
  end;

  return appt;
end;
$$;

-- ---------- cancel ----------
create or replace function public.cancel_appointment(p_appointment_id uuid)
returns public.appointments
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  caller      uuid := public.auth_profile_id();
  caller_role public.user_role := public.auth_role();
  appt        public.appointments;
begin
  select * into appt from public.appointments where id = p_appointment_id;
  if not found then raise exception 'Appointment not found'; end if;

  if caller_role = 'patient' and appt.patient_id <> caller then
    raise exception 'Not authorised';
  end if;
  if appt.status <> 'booked' then
    raise exception 'Only a booked appointment can be cancelled';
  end if;

  update public.appointments
  set status = 'cancelled', cancelled_at = now(), cancelled_by = caller
  where id = p_appointment_id
  returning * into appt;

  return appt;   -- the slot is freed: the partial index ignores 'cancelled'
end;
$$;

-- ---------- check in an appointment ----------
-- Turns a booking into a queue entry with a token, reusing the same
-- transactional allocation as walk-ins.
create or replace function public.check_in_appointment(p_appointment_id uuid)
returns public.queue_entries
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  caller_role public.user_role := public.auth_role();
  appt        public.appointments;
  svc         record;
  next_num    int;
  entry       public.queue_entries;
begin
  if caller_role not in ('receptionist','nurse','admin') then
    raise exception 'Only clinic staff can check patients in';
  end if;

  select * into appt from public.appointments where id = p_appointment_id;
  if not found then raise exception 'Appointment not found'; end if;
  if appt.status <> 'booked' then
    raise exception 'This appointment is % and cannot be checked in', appt.status;
  end if;

  select s.id, s.clinic_id, s.token_prefix into svc
  from public.services s where s.id = appt.service_id and s.is_active;
  if not found then raise exception 'Service not found or inactive'; end if;
  if svc.clinic_id is distinct from public.auth_clinic_id() then
    raise exception 'Not authorised for this clinic';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(svc.clinic_id::text || svc.id::text || current_date::text, 0)
  );

  select coalesce(max(token_number), 0) + 1 into next_num
  from public.queue_entries
  where clinic_id = svc.clinic_id and service_id = svc.id and queue_date = current_date;

  insert into public.queue_entries (
    clinic_id, service_id, patient_id, appointment_id, token, token_number,
    queue_date, priority, status, checked_in_at
  ) values (
    svc.clinic_id, svc.id, appt.patient_id, appt.id,
    svc.token_prefix || '-' || lpad(next_num::text, 3, '0'),
    next_num, current_date, 0, 'waiting', clock_timestamp()
  )
  returning * into entry;

  update public.appointments set status = 'checked_in' where id = appt.id;

  return entry;
end;
$$;

revoke execute on function public.get_available_slots(uuid,date,time,time,int) from public, anon;
revoke execute on function public.book_appointment(uuid,timestamptz,uuid) from public, anon;
revoke execute on function public.cancel_appointment(uuid) from public, anon;
revoke execute on function public.check_in_appointment(uuid) from public, anon;
grant execute on function public.get_available_slots(uuid,date,time,time,int) to authenticated;
grant execute on function public.book_appointment(uuid,timestamptz,uuid) to authenticated;
grant execute on function public.cancel_appointment(uuid) to authenticated;
grant execute on function public.check_in_appointment(uuid) to authenticated;
