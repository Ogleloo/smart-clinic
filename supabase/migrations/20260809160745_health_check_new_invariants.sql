-- Migration 0039: assert the invariants discovered since the original
-- health check was written.
--
-- Principle: an invariant that can be expressed as a database fact should
-- be ASSERTED, not clicked through. A manual test proves the system was
-- correct once, on one machine, on one day. An assertion proves it is
-- correct every time anyone runs it — including in front of an examiner.
--
-- Manual testing is then reserved for what genuinely cannot be automated:
-- interface behaviour, realtime propagation, and hostile use.

create or replace function public.system_health_check_v2()
returns table (category text, check_name text, status text, detail text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare n int; m int;
begin
  -- INVARIANT: one queue entry is never served by two nurses at once.
  -- This is what FOR UPDATE SKIP LOCKED in call_next_patient/next_patient
  -- exists to guarantee.
  select count(*) into n from (
    select queue_entry_id from public.consultations
    group by queue_entry_id having count(distinct nurse_id) > 1) x;
  return query select 'concurrency', 'One entry never served by two nurses',
    case when n = 0 then 'PASS' else 'FAIL' end,
    n || ' entries with multiple nurses';

  -- INVARIANT: a consultation never outlives its queue entry's completion.
  select count(*) into n
  from public.consultations c
  join public.queue_entries q on q.id = c.queue_entry_id
  where c.ended_at is null and q.status in ('done','skipped','no_show');
  return query select 'data', 'No open consultation on a closed entry',
    case when n = 0 then 'PASS' else 'FAIL' end,
    n || ' orphaned (skip_patient/end_shift should prevent this)';

  -- INVARIANT: excluded durations never reach the prediction average.
  select count(*) into n
  from public.consultations c
  where c.exclude_from_prediction
    and public.consultation_counts_towards_average(c.id);
  return query select 'engine', 'Excluded durations stay out of the average',
    case when n = 0 then 'PASS' else 'FAIL' end,
    n || ' excluded rows still counted';

  -- INVARIANT: no nurse on duty means no estimate. The honesty rule.
  select count(*) into n
  from public.services s
  where s.is_active
    and public.available_nurses(s.id) = 0
    and exists (select 1 from public.queue_entries q
                 where q.service_id = s.id and q.queue_date = current_date
                   and q.status = 'waiting');
  select count(*) into m
  from public.services s
  cross join lateral public.get_public_queue_display(s.id) d
  where s.is_active and public.available_nurses(s.id) = 0
    and d.estimated_wait_minutes is not null;
  return query select 'engine', 'No nurse on duty produces NO estimate',
    case when m = 0 then 'PASS' else 'FAIL' end,
    n || ' services unserved; ' || m || ' wrongly showing a number';

  -- INVARIANT: admin authority is clinic-scoped (migration 0038).
  select count(*) into n
  from pg_policy p join pg_class c on c.oid = p.polrelid
  where c.relname in ('clinic_settings','clinics','services')
    and p.polcmd = '*'
    and pg_get_expr(p.polqual, p.polrelid) not like '%clinic_id%'
    and pg_get_expr(p.polqual, p.polrelid) not like '%id = %auth_clinic_id%';
  return query select 'security', 'Admin write policies are clinic-scoped',
    case when n = 0 then 'PASS' else 'FAIL' end,
    n || ' unscoped admin write policies';

  -- INVARIANT: the public display function is the ONLY anon-executable one.
  select count(*) into n
  from pg_proc pr
  join pg_namespace ns on ns.oid = pr.pronamespace and ns.nspname = 'public'
  where has_function_privilege('anon', pr.oid, 'EXECUTE')
    and pr.proname <> 'get_public_queue_display';
  return query select 'security', 'Only the display board is anon-callable',
    case when n = 0 then 'PASS' else 'FAIL' end,
    n || ' other functions executable by anon';

  -- INVARIANT: every profile maps to at most one auth user, and vice
  -- versa. Two profiles for one login is the duplicate-account defect.
  select count(*) into n from (
    select auth_user_id from public.profiles
    where auth_user_id is not null
    group by auth_user_id having count(*) > 1) x;
  return query select 'data', 'One profile per login',
    case when n = 0 then 'PASS' else 'FAIL' end,
    n || ' logins with multiple profiles';

  -- INVARIANT: the no-show sweep is actually scheduled.
  select count(*) into n from cron.job
   where jobname = 'mark-overdue-no-shows' and active;
  return query select 'integrity', 'No-show sweep scheduled (BR-5)',
    case when n = 1 then 'PASS' else 'FAIL' end,
    n || ' active cron job';

  -- INVARIANT: idempotency ledger has no duplicate action ids.
  select count(*) into n from (
    select nurse_id, action_id from public.nurse_actions
    group by nurse_id, action_id having count(*) > 1) x;
  return query select 'concurrency', 'Idempotency ledger has no duplicates',
    case when n = 0 then 'PASS' else 'FAIL' end,
    n || ' duplicate (nurse, action) pairs';
end;
$$;

revoke execute on function public.system_health_check_v2() from public, anon;
grant execute on function public.system_health_check_v2() to authenticated;

notify pgrst, 'reload schema';
