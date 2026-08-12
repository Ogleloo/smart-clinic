-- Migration 0019: BR-5 / FR-2.4 — automatic no-show marking.
--
-- A booked appointment whose start time has passed by more than the
-- clinic's grace period, and which was never checked in, becomes
-- 'no_show'. Until now this rule existed only in the requirements.
--
-- Written, not computed at read time: reports need a stable historical
-- fact. A read-time rule would let the same report disagree about the
-- same past day depending on when it is run.
--
-- The function is idempotent and safe to run repeatedly: it only ever
-- touches rows still in 'booked', so a second run is a no-op. That
-- matters because it is scheduled AND manually invocable — if the
-- scheduler fails, running it by hand fully repairs the state.

create or replace function public.mark_overdue_no_shows()
returns table (marked_count int, marked_ids uuid[])
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ids uuid[];
begin
  with overdue as (
    select a.id
    from public.appointments a
    join public.services s        on s.id = a.service_id
    join public.clinics  c        on c.id = s.clinic_id
    left join public.clinic_settings cs on cs.clinic_id = c.id
    where a.status = 'booked'
      and a.scheduled_time
          + make_interval(mins => coalesce(cs.no_show_grace_minutes, 15))
          < now()
      -- never contradict reality: if they were checked in, they showed up
      and not exists (
        select 1 from public.queue_entries q where q.appointment_id = a.id
      )
  ), updated as (
    update public.appointments a
       set status = 'no_show', updated_at = now()
      from overdue o
     where a.id = o.id
    returning a.id
  )
  select coalesce(array_agg(id), '{}') into ids from updated;

  marked_count := coalesce(array_length(ids, 1), 0);
  marked_ids   := ids;
  return next;
end;
$$;

-- Not callable by patients or staff; this is a system rule, not a user action.
revoke execute on function public.mark_overdue_no_shows() from public, anon, authenticated;

notify pgrst, 'reload schema';
