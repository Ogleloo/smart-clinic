-- Migration 0050: return the inputs behind the estimate, not just the answer.
--
-- The patient screen is to show how the estimate was reached. Every number in
-- that explanation must come from the SAME call that produced the estimate. If
-- the frontend recomputed any of them the displayed working could disagree with
-- the displayed answer, and an explanation that fails to reproduce its own
-- result is worse than no explanation at all.
--
-- soonest_free_minutes reuses service_wait_minutes with ahead = 0: the moment
-- the first nurse becomes available, before anyone in the queue is assigned. For
-- a single nurse this makes the arithmetic exact and checkable by hand:
--
--     soonest_free + (patients_ahead × average) = estimate
--
-- That identity does NOT hold for two or more nurses, because the queue is
-- distributed across differing next-free times. The interface therefore states
-- the method in words in that case rather than presenting a false equation.

drop function if exists public.get_wait_estimate(uuid);

create function public.get_wait_estimate(p_queue_entry_id uuid)
returns table(
  queue_position          integer,
  estimated_wait_minutes  integer,
  confidence              text,
  status                  text,
  token                   text,
  service_name            text,
  patients_ahead          integer,
  nurses_serving          integer,
  average_minutes         integer,
  soonest_free_minutes    integer,
  sample_count            integer
)
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
    estimated_wait_minutes := null; confidence := null;
    patients_ahead := null; nurses_serving := null;
    average_minutes := null; soonest_free_minutes := null; sample_count := null;
    status := e.status::text;
    return next; return;
  end if;

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
  patients_ahead := ahead;
  nurses := public.available_nurses(e.service_id);
  nurses_serving := nurses;

  if nurses = 0 then
    estimated_wait_minutes := null; confidence := null;
    average_minutes := null; soonest_free_minutes := null; sample_count := null;
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

  estimated_wait_minutes := public.service_wait_minutes(e.service_id, ahead, avg_mins);
  soonest_free_minutes   := public.service_wait_minutes(e.service_id, 0,     avg_mins);
  average_minutes        := round(avg_mins)::int;
  sample_count           := stats.sample_count;
  confidence := public.confidence_label(e.service_id, stats.sample_count, stats.stddev_minutes);
  status := e.status::text;
  return next;
end;
$$;

revoke execute on function public.get_wait_estimate(uuid) from public, anon;
grant  execute on function public.get_wait_estimate(uuid) to authenticated;

notify pgrst, 'reload schema';
