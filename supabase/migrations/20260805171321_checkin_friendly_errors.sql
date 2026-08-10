-- Migration 0011: Human-readable errors on check-in
-- Found in testing: checking in a patient who is already queued raised
-- a raw unique_violation. Correct behaviour, unusable message.

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

  -- Check before inserting so the message is human, not a constraint dump.
  if exists (
    select 1 from public.queue_entries q
    where q.patient_id = appt.patient_id
      and q.service_id = svc.id
      and q.queue_date = current_date
      and q.status in ('waiting','in_progress')
  ) then
    raise exception 'This patient is already in the queue for this service today.'
      using errcode = '23505';
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

-- Same guard for walk-ins.
create or replace function public.check_in_patient(
  p_service_id uuid, p_patient_id uuid, p_priority smallint default 0
)
returns public.queue_entries
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  svc         record;
  caller_role public.user_role;
  next_num    int;
  entry       public.queue_entries;
begin
  caller_role := public.auth_role();
  if caller_role not in ('receptionist','nurse','admin') then
    raise exception 'Only clinic staff can check patients in';
  end if;

  select id, clinic_id, token_prefix into svc
  from public.services where id = p_service_id and is_active;
  if not found then raise exception 'Service not found or inactive'; end if;
  if svc.clinic_id is distinct from public.auth_clinic_id() then
    raise exception 'Not authorised for this clinic';
  end if;
  if p_priority = 1 and caller_role not in ('nurse','admin') then
    raise exception 'Only clinical staff can assign emergency priority';
  end if;

  if exists (
    select 1 from public.queue_entries q
    where q.patient_id = p_patient_id
      and q.service_id = p_service_id
      and q.queue_date = current_date
      and q.status in ('waiting','in_progress')
  ) then
    raise exception 'This patient is already in the queue for this service today.'
      using errcode = '23505';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(svc.clinic_id::text || p_service_id::text || current_date::text, 0)
  );

  select coalesce(max(token_number), 0) + 1 into next_num
  from public.queue_entries
  where clinic_id = svc.clinic_id and service_id = p_service_id and queue_date = current_date;

  insert into public.queue_entries (
    clinic_id, service_id, patient_id, token, token_number,
    queue_date, priority, status, checked_in_at, priority_set_by, priority_set_at
  ) values (
    svc.clinic_id, p_service_id, p_patient_id,
    svc.token_prefix || '-' || lpad(next_num::text, 3, '0'),
    next_num, current_date, p_priority, 'waiting', clock_timestamp(),
    case when p_priority = 1 then public.auth_profile_id() end,
    case when p_priority = 1 then now() end
  )
  returning * into entry;

  return entry;
end;
$$;

revoke execute on function public.check_in_appointment(uuid) from public, anon;
revoke execute on function public.check_in_patient(uuid,uuid,smallint) from public, anon;
grant execute on function public.check_in_appointment(uuid) to authenticated;
grant execute on function public.check_in_patient(uuid,uuid,smallint) to authenticated;
