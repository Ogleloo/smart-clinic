-- Migration 0014: Consultation timing guards
--
-- Bug found in testing: start_consultation and end_consultation both
-- used now() (transaction time), so within one transaction the two
-- timestamps were identical and the ended_at > started_at constraint
-- fired. Same root cause as the earlier queue-ordering bug.
--
-- Fix 1: clock_timestamp() for real wall-clock time.
-- Fix 2: a MINIMUM plausible duration in the statistics, mirroring the
--        existing maximum. A mis-clicked 3-second "consultation" would
--        otherwise drag the average down just as a forgotten End button
--        drags it up. Guard both ends.

alter table public.clinic_settings
  add column min_plausible_consultation_minutes numeric(5,2) not null default 1;

create or replace function public.start_consultation(p_queue_entry_id uuid)
returns public.consultations
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := public.auth_profile_id();
  entry  public.queue_entries;
  cons   public.consultations;
begin
  if public.auth_role() <> 'nurse' then
    raise exception 'Only nurses conduct consultations';
  end if;

  select * into entry from public.queue_entries where id = p_queue_entry_id;
  if not found then raise exception 'Queue entry not found'; end if;
  if entry.status <> 'in_progress' then
    raise exception 'Call this patient before starting the consultation';
  end if;

  insert into public.consultations (queue_entry_id, nurse_id, service_id, started_at)
  values (entry.id, caller, entry.service_id, clock_timestamp())
  returning * into cons;

  return cons;
end;
$$;

create or replace function public.end_consultation(p_queue_entry_id uuid)
returns table (consultation_id uuid, duration_minutes numeric,
               new_service_average numeric, new_confidence text)
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := public.auth_profile_id();
  cons   public.consultations;
  stats  record;
begin
  if public.auth_role() <> 'nurse' then
    raise exception 'Only nurses conduct consultations';
  end if;

  select * into cons from public.consultations
  where queue_entry_id = p_queue_entry_id and ended_at is null;
  if not found then raise exception 'No open consultation for this patient'; end if;
  if cons.nurse_id <> caller then
    raise exception 'This is another nurse''s consultation';
  end if;

  update public.consultations
  set ended_at = greatest(clock_timestamp(), cons.started_at + interval '1 second')
  where id = cons.id returning * into cons;

  update public.queue_entries
  set status = 'done', completed_at = clock_timestamp()
  where id = p_queue_entry_id;

  select * into stats from public.service_consultation_stats(cons.service_id);

  consultation_id := cons.id;
  duration_minutes := round(extract(epoch from (cons.ended_at - cons.started_at))/60.0, 2);
  new_service_average := stats.avg_minutes;
  new_confidence := public.confidence_label(cons.service_id, stats.sample_count, stats.stddev_minutes);
  return next;
end;
$$;

-- Statistics now exclude BOTH implausibly long and implausibly short
-- consultations. Data quality is protected at both ends.
create or replace function public.service_consultation_stats(p_service_id uuid)
returns table (sample_count int, avg_minutes numeric, stddev_minutes numeric)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with s as (
    select extract(epoch from (c.ended_at - c.started_at)) / 60.0 as mins,
           coalesce(cs.max_plausible_consultation_minutes, 90) as max_m,
           coalesce(cs.min_plausible_consultation_minutes, 1)  as min_m
    from public.consultations c
    join public.services sv on sv.id = c.service_id
    left join public.clinic_settings cs on cs.clinic_id = sv.clinic_id
    where c.service_id = p_service_id
      and c.ended_at is not null
  )
  select count(*)::int,
         round(avg(mins), 2),
         round(coalesce(stddev_samp(mins), 0), 2)
  from s
  where mins between min_m and max_m;
$$;

revoke execute on function public.start_consultation(uuid) from public, anon;
revoke execute on function public.end_consultation(uuid) from public, anon;
revoke execute on function public.service_consultation_stats(uuid) from public, anon;
grant execute on function public.start_consultation(uuid) to authenticated;
grant execute on function public.end_consultation(uuid) to authenticated;
