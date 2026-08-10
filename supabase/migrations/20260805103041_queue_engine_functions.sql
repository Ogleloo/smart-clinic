-- Migration 0004: The Queue Engine (ADR-008)
-- Prediction runs in the database so every client sees the same number.

-- ---------- helper: caller's clinic ----------
create or replace function public.auth_clinic_id()
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$
  select clinic_id from public.profiles where auth_user_id = auth.uid() limit 1;
$$;
revoke execute on function public.auth_clinic_id() from public, anon;
grant execute on function public.auth_clinic_id() to authenticated;

-- ---------- available nurses (the divisor) ----------
create or replace function public.available_nurses(p_service_id uuid)
returns int language sql stable security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
  from public.profiles
  where role = 'nurse'
    and is_active
    and is_on_duty
    and current_service_id = p_service_id;
$$;

-- ---------- consultation statistics ----------
-- Excludes implausible durations (a nurse who forgot to press "End"
-- would otherwise poison every average — M6 §6).
create or replace function public.service_consultation_stats(p_service_id uuid)
returns table (sample_count int, avg_minutes numeric, stddev_minutes numeric)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with s as (
    select extract(epoch from (c.ended_at - c.started_at)) / 60.0 as mins
    from public.consultations c
    join public.services sv on sv.id = c.service_id
    left join public.clinic_settings cs on cs.clinic_id = sv.clinic_id
    where c.service_id = p_service_id
      and c.ended_at is not null
      and extract(epoch from (c.ended_at - c.started_at)) / 60.0
          <= coalesce(cs.max_plausible_consultation_minutes, 90)
  )
  select count(*)::int,
         round(avg(mins), 2),
         round(coalesce(stddev_samp(mins), 0), 2)
  from s;
$$;

-- ---------- confidence label (BR-9) ----------
-- A computed label, never stored: it changes as history accumulates.
create or replace function public.confidence_label(
  p_service_id uuid, p_count int, p_stddev numeric
) returns text
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare cs record;
begin
  select coalesce(s.confidence_high_min_count, 30)              as high_count,
         coalesce(s.confidence_min_count_floor, 10)             as floor_count,
         coalesce(s.confidence_consistent_stddev_minutes, 3)    as consistent,
         coalesce(s.confidence_inconsistent_stddev_minutes, 7)  as inconsistent
    into cs
  from public.services sv
  left join public.clinic_settings s on s.clinic_id = sv.clinic_id
  where sv.id = p_service_id;

  -- Cold start: no history means low confidence, stated honestly.
  if p_count is null or p_count < cs.floor_count then
    return 'low';
  elsif p_count >= cs.high_count and p_stddev <= cs.consistent then
    return 'high';
  elsif p_stddev <= cs.inconsistent then
    return 'medium';
  else
    return 'low';
  end if;
end;
$$;

-- ---------- get_wait_estimate (the patient-facing RPC) ----------
-- SECURITY DEFINER so it can COUNT other patients' entries to derive
-- position, while RLS still forbids READING those rows (ADR-011).
create or replace function public.get_wait_estimate(p_queue_entry_id uuid)
returns table (
  queue_position int,
  estimated_wait_minutes int,
  confidence text,
  status text,
  token text,
  service_name text
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  e            record;
  ahead        int;
  nurses       int;
  stats        record;
  avg_mins     numeric;
  caller       uuid;
  caller_role  public.user_role;
begin
  select * into e from public.queue_entries where id = p_queue_entry_id;
  if not found then
    raise exception 'Queue entry not found';
  end if;

  -- Authorisation is explicit here: a definer function bypasses RLS,
  -- so it must check for itself who is allowed to see this entry.
  caller := public.auth_profile_id();
  caller_role := public.auth_role();
  if caller is null then raise exception 'Not authenticated'; end if;
  if caller_role = 'patient' and e.patient_id <> caller then
    raise exception 'Not authorised';
  end if;
  if caller_role in ('nurse','receptionist','admin')
     and public.auth_clinic_id() is distinct from e.clinic_id then
    raise exception 'Not authorised';
  end if;

  select sv.name into service_name from public.services sv where sv.id = e.service_id;
  token := e.token;

  -- Already being seen, or finished: no estimate to give.
  if e.status <> 'waiting' then
    queue_position := 0;
    estimated_wait_minutes := null;
    confidence := null;
    status := e.status::text;
    return next;
    return;
  end if;

  -- Position: emergency first, then check-in time (BR-3).
  select count(*)::int into ahead
  from public.queue_entries q
  where q.service_id = e.service_id
    and q.queue_date = e.queue_date
    and q.status = 'waiting'
    and (q.priority > e.priority
         or (q.priority = e.priority and q.checked_in_at < e.checked_in_at));

  queue_position := ahead + 1;

  nurses := public.available_nurses(e.service_id);

  -- FR-5.4: with nobody on duty there is no honest number to give.
  if nurses = 0 then
    estimated_wait_minutes := null;
    confidence := null;
    status := 'not_being_served';
    return next;
    return;
  end if;

  select * into stats from public.service_consultation_stats(e.service_id);

  -- Cold start falls back to the service's configured default.
  if stats.sample_count = 0 or stats.avg_minutes is null then
    select default_consultation_minutes into avg_mins
    from public.services where id = e.service_id;
  else
    avg_mins := stats.avg_minutes;
  end if;

  -- ADR-005: (patients ahead / nurses) x average consultation time.
  estimated_wait_minutes := ceil((ahead::numeric / nurses) * avg_mins)::int;
  confidence := public.confidence_label(e.service_id, stats.sample_count, stats.stddev_minutes);
  status := e.status::text;
  return next;
end;
$$;

-- ---------- get_service_queue (staff-facing RPC) ----------
create or replace function public.get_service_queue(p_service_id uuid)
returns table (
  queue_entry_id uuid,
  queue_position int,
  token text,
  patient_name text,
  priority smallint,
  status public.queue_entry_status,
  checked_in_at timestamptz,
  waiting_minutes int
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  caller_role public.user_role;
  svc_clinic  uuid;
begin
  caller_role := public.auth_role();
  if caller_role not in ('nurse','receptionist','admin') then
    raise exception 'Not authorised';
  end if;

  select clinic_id into svc_clinic from public.services where id = p_service_id;
  if svc_clinic is distinct from public.auth_clinic_id() then
    raise exception 'Not authorised';
  end if;

  return query
  select q.id,
         row_number() over (
           order by q.priority desc, q.checked_in_at asc
         )::int,
         q.token,
         p.full_name,
         q.priority,
         q.status,
         q.checked_in_at,
         (extract(epoch from (now() - q.checked_in_at)) / 60)::int
  from public.queue_entries q
  join public.profiles p on p.id = q.patient_id
  where q.service_id = p_service_id
    and q.queue_date = current_date
    and q.status in ('waiting','in_progress')
  order by q.priority desc, q.checked_in_at asc;
end;
$$;

-- Only signed-in users may call the engine.
revoke execute on function public.available_nurses(uuid)             from public, anon;
revoke execute on function public.service_consultation_stats(uuid)   from public, anon;
revoke execute on function public.confidence_label(uuid,int,numeric) from public, anon;
revoke execute on function public.get_wait_estimate(uuid)            from public, anon;
revoke execute on function public.get_service_queue(uuid)            from public, anon;
grant execute on function public.get_wait_estimate(uuid)  to authenticated;
grant execute on function public.get_service_queue(uuid)  to authenticated;
