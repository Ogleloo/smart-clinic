-- Migration 0048: the wait estimate must account for consultations already
-- in progress.
--
-- THE BUG. available_nurses() counts every on-duty nurse as capacity,
-- including one eight minutes into a ten-minute consultation. `ahead`
-- correctly excludes in_progress entries — a patient being consulted is
-- not ahead of you in the waiting line — but nothing then represented the
-- fact that the nurse serving them is not free yet.
--
-- At position 1 with one busy nurse this gave ceil(0/1 * avg) = 0 minutes.
-- The patient was told zero and waited for the current consultation to end.
-- The error is systematic: the remaining workload of an active
-- consultation was omitted entirely.
--
-- WHY NOT (total work / nurses). Two nurses with 2 and 8 minutes remaining
-- and nobody ahead would give (10+0)/2 = 5. The truth is 2 — you take
-- whichever nurse frees first. Averaging remaining workloads across nurses
-- is wrong precisely at the front of the queue, where it matters most.
--
-- THE MODEL. Each on-duty nurse has a next-free time: 0 if idle, otherwise
-- the remaining time of their open consultation. Waiting patients are
-- assigned in queue order to whichever nurse frees soonest, and that nurse
-- is then occupied for another average consultation. Your wait is the
-- smallest next-free time once everyone ahead of you has been assigned.
--
-- THE FLOOR. greatest(avg - elapsed, min_plausible_consultation_minutes),
-- using the setting that already exists. Without the floor, a consultation
-- that has run past the average returns 0 remaining and reintroduces the
-- original bug. An open consultation is not a finished one.
--
-- Capacity is built from ON-DUTY NURSES, not from open consultations, so a
-- nurse who went off duty mid-consultation does not appear as capacity she
-- will not provide. Open consultations count regardless of
-- exclude_from_prediction: that flag means "do not learn from this
-- duration", not "this patient is not in the room".

create or replace function public.service_wait_minutes(
  p_service_id uuid,
  p_ahead      int,
  p_avg        numeric
)
returns int
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  flr  numeric;
  arr  numeric[];
  i    int;
  j    int;
  mi   int;
  mv   numeric;
begin
  if p_avg is null or p_ahead < 0 then return null; end if;

  select coalesce(cs.min_plausible_consultation_minutes, 1)
    into flr
  from public.services sv
  left join public.clinic_settings cs on cs.clinic_id = sv.clinic_id
  where sv.id = p_service_id;
  flr := coalesce(flr, 1);

  -- One entry per ON-DUTY nurse for this service: 0 if idle, otherwise the
  -- remaining time of the consultation they are currently running.
  select array_agg(
           case
             when c.id is null then 0::numeric
             else greatest(
                    p_avg - extract(epoch from (now() - c.started_at))/60.0,
                    flr)
           end)
    into arr
  from public.profiles p
  left join public.consultations c
    on c.nurse_id = p.id
   and c.ended_at is null
   and c.service_id = p_service_id
  where p.role = 'nurse'
    and p.is_active
    and p.is_on_duty
    and p.current_service_id = p_service_id;

  -- No serving capacity: no number. Unchanged honesty rule.
  if arr is null or array_length(arr, 1) is null then
    return null;
  end if;

  -- Assign each waiting patient ahead of us to the nurse who frees soonest,
  -- then occupy that nurse for one more average consultation.
  for i in 1..p_ahead loop
    mi := 1; mv := arr[1];
    for j in 2..array_length(arr,1) loop
      if arr[j] < mv then mv := arr[j]; mi := j; end if;
    end loop;
    arr[mi] := mv + p_avg;
  end loop;

  mv := arr[1];
  for j in 2..array_length(arr,1) loop
    if arr[j] < mv then mv := arr[j]; end if;
  end loop;

  return ceil(mv)::int;
end;
$$;

revoke execute on function public.service_wait_minutes(uuid,int,numeric) from public, anon;
grant  execute on function public.service_wait_minutes(uuid,int,numeric) to authenticated;

-- ---------------------------------------------------------------------
-- get_wait_estimate: same queue-order logic, new scheduling model.
-- ---------------------------------------------------------------------
create or replace function public.get_wait_estimate(p_queue_entry_id uuid)
returns table(queue_position integer, estimated_wait_minutes integer,
              confidence text, status text, token text, service_name text)
language plpgsql
stable
security definer
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

  -- Production queue order: priority desc, checked_in_at asc, token_number asc.
  -- (A dead duplicate of this query, immediately overwritten, was removed.)
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

  -- One resolved average feeds BOTH the remaining time of active
  -- consultations and the duration assigned to future slots.
  if stats.sample_count = 0 or stats.avg_minutes is null then
    select default_consultation_minutes into avg_mins
    from public.services where id = e.service_id;
  else
    avg_mins := stats.avg_minutes;
  end if;

  estimated_wait_minutes := public.service_wait_minutes(e.service_id, ahead, avg_mins);
  confidence := public.confidence_label(e.service_id, stats.sample_count, stats.stddev_minutes);
  status := e.status::text;
  return next;
end;
$$;

-- ---------------------------------------------------------------------
-- get_public_queue_display: same model, k = everyone currently waiting.
-- ---------------------------------------------------------------------
create or replace function public.get_public_queue_display(p_service_id uuid)
returns table(service_name text, now_serving_token text, next_token text,
              waiting_count integer, estimated_wait_minutes integer,
              confidence text, is_being_served boolean,
              updated_at timestamp with time zone)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  svc      public.services;
  nurses   int;
  stats    record;
  avg_mins numeric;
begin
  select * into svc from public.services where id = p_service_id and is_active;
  if not found then raise exception 'Service not found'; end if;

  service_name := svc.name;
  nurses := public.available_nurses(p_service_id);
  select * into stats from public.service_consultation_stats(p_service_id);

  select q.token into now_serving_token
  from public.queue_entries q
  where q.service_id = p_service_id and q.queue_date = current_date
    and q.status = 'in_progress'
  order by q.called_at desc nulls last limit 1;

  select q.token into next_token
  from public.queue_entries q
  where q.service_id = p_service_id and q.queue_date = current_date
    and q.status = 'waiting'
  order by q.priority desc, q.checked_in_at asc, q.token_number asc limit 1;

  select count(*)::int into waiting_count
  from public.queue_entries q
  where q.service_id = p_service_id and q.queue_date = current_date
    and q.status = 'waiting';

  is_being_served := nurses > 0;

  if nurses > 0 then
    avg_mins := coalesce(stats.avg_minutes, svc.default_consultation_minutes);
    -- "If you checked in now" — you would be behind everyone waiting.
    estimated_wait_minutes := public.service_wait_minutes(
      p_service_id, waiting_count, avg_mins);
    confidence := public.confidence_label(
      p_service_id, stats.sample_count, stats.stddev_minutes);
  else
    estimated_wait_minutes := null;
    confidence := null;
  end if;

  updated_at := now();
  return next;
end;
$$;

notify pgrst, 'reload schema';
