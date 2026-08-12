-- Migration 0006: Deterministic queue ordering
--
-- Bug found in testing: entries sharing a checked_in_at (same
-- transaction, or a genuine millisecond tie) all computed the same
-- position, because the comparison was strictly on time.
--
-- Fix 1: use clock_timestamp() so each check-in gets real wall-clock
--        time even inside one transaction.
-- Fix 2: add token_number as a tiebreaker, making the ordering TOTAL.
--        token_number is allocation order, so ties resolve to
--        first-come-first-served — which is what BR-3 actually means.

create or replace function public.check_in_patient(
  p_service_id uuid,
  p_patient_id uuid,
  p_priority   smallint default 0
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

  perform pg_advisory_xact_lock(
    hashtextextended(svc.clinic_id::text || p_service_id::text || current_date::text, 0)
  );

  select coalesce(max(token_number), 0) + 1 into next_num
  from public.queue_entries
  where clinic_id  = svc.clinic_id
    and service_id = p_service_id
    and queue_date = current_date;

  insert into public.queue_entries (
    clinic_id, service_id, patient_id, token, token_number,
    queue_date, priority, status, checked_in_at,
    priority_set_by, priority_set_at
  ) values (
    svc.clinic_id, p_service_id, p_patient_id,
    svc.token_prefix || '-' || lpad(next_num::text, 3, '0'),
    next_num, current_date, p_priority, 'waiting',
    clock_timestamp(),                       -- real wall-clock time
    case when p_priority = 1 then public.auth_profile_id() end,
    case when p_priority = 1 then now() end
  )
  returning * into entry;

  return entry;
end;
$$;

-- Position with a total ordering: priority, then time, then token number.
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
  if not found then raise exception 'Queue entry not found'; end if;

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

  if e.status <> 'waiting' then
    queue_position := 0;
    estimated_wait_minutes := null;
    confidence := null;
    status := e.status::text;
    return next; return;
  end if;

  -- TOTAL ordering: (priority desc, checked_in_at asc, token_number asc)
  select count(*)::int into ahead
  from public.queue_entries q
  where q.service_id = e.service_id
    and q.queue_date = e.queue_date
    and q.status = 'waiting'
    and (q.priority, q.checked_in_at, q.token_number)
        < (e.priority, e.checked_in_at, e.token_number)
    and q.priority >= e.priority;

  -- Emergencies always precede normal priority regardless of time.
  select count(*)::int into ahead
  from public.queue_entries q
  where q.service_id = e.service_id
    and q.queue_date = e.queue_date
    and q.status = 'waiting'
    and (
      q.priority > e.priority
      or (q.priority = e.priority
          and (q.checked_in_at, q.token_number) < (e.checked_in_at, e.token_number))
    );

  queue_position := ahead + 1;
  nurses := public.available_nurses(e.service_id);

  if nurses = 0 then
    estimated_wait_minutes := null;
    confidence := null;
    status := 'not_being_served';
    return next; return;
  end if;

  select * into stats from public.service_consultation_stats(e.service_id);

  if stats.sample_count = 0 or stats.avg_minutes is null then
    select default_consultation_minutes into avg_mins
    from public.services where id = e.service_id;
  else
    avg_mins := stats.avg_minutes;
  end if;

  estimated_wait_minutes := ceil((ahead::numeric / nurses) * avg_mins)::int;
  confidence := public.confidence_label(e.service_id, stats.sample_count, stats.stddev_minutes);
  status := e.status::text;
  return next;
end;
$$;

-- Same total ordering for the staff queue view.
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
           order by q.priority desc, q.checked_in_at asc, q.token_number asc
         )::int,
         q.token, p.full_name, q.priority, q.status, q.checked_in_at,
         (extract(epoch from (now() - q.checked_in_at)) / 60)::int
  from public.queue_entries q
  join public.profiles p on p.id = q.patient_id
  where q.service_id = p_service_id
    and q.queue_date = current_date
    and q.status in ('waiting','in_progress')
  order by q.priority desc, q.checked_in_at asc, q.token_number asc;
end;
$$;

revoke execute on function public.get_wait_estimate(uuid) from public, anon;
revoke execute on function public.get_service_queue(uuid) from public, anon;
revoke execute on function public.check_in_patient(uuid,uuid,smallint) from public, anon;
grant execute on function public.get_wait_estimate(uuid) to authenticated;
grant execute on function public.get_service_queue(uuid) to authenticated;
grant execute on function public.check_in_patient(uuid,uuid,smallint) to authenticated;
