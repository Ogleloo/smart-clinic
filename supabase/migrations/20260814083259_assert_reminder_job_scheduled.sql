-- Migration 0046: assert BOTH scheduled jobs, not just the no-show sweep.
--
-- The reminder gap existed because a notification kind was defined and
-- nothing ever produced one. The assertion that would have caught it is
-- not "does the function exist" but "is the job that calls it running".
-- A scheduled job that is silently unscheduled looks identical to a
-- feature nobody has used yet.

create or replace function public.system_health_check_v2()
returns table (category text, check_name text, status text, detail text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare n int; m int;
begin
  select count(*) into n from (
    select queue_entry_id from public.consultations
    group by queue_entry_id having count(distinct nurse_id) > 1) x;
  return query select 'concurrency', 'One entry never served by two nurses',
    case when n = 0 then 'PASS' else 'FAIL' end, n || ' entries with multiple nurses';

  select count(*) into n
  from public.consultations c
  join public.queue_entries q on q.id = c.queue_entry_id
  where c.ended_at is null and q.status in ('done','skipped','no_show');
  return query select 'data', 'No open consultation on a closed entry',
    case when n = 0 then 'PASS' else 'FAIL' end, n || ' orphaned';

  select count(*) into n
  from public.consultations c
  where c.exclude_from_prediction
    and public.consultation_counts_towards_average(c.id);
  return query select 'engine', 'Excluded durations stay out of the average',
    case when n = 0 then 'PASS' else 'FAIL' end, n || ' excluded rows still counted';

  select count(*) into n
  from public.services s
  where s.is_active and public.available_nurses(s.id) = 0
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

  select count(*) into n
  from pg_policy p join pg_class c on c.oid = p.polrelid
  where c.relname in ('clinic_settings','clinics','services')
    and p.polcmd = '*'
    and pg_get_expr(p.polqual, p.polrelid) not like '%clinic_id%'
    and pg_get_expr(p.polqual, p.polrelid) not like '%id = %auth_clinic_id%';
  return query select 'security', 'Admin write policies are clinic-scoped',
    case when n = 0 then 'PASS' else 'FAIL' end, n || ' unscoped admin write policies';

  select count(*) into n
  from pg_proc pr
  join pg_namespace ns on ns.oid = pr.pronamespace and ns.nspname = 'public'
  where has_function_privilege('anon', pr.oid, 'EXECUTE')
    and pr.proname <> 'get_public_queue_display';
  return query select 'security', 'Only the display board is anon-callable',
    case when n = 0 then 'PASS' else 'FAIL' end, n || ' other functions executable by anon';

  select count(*) into n from (
    select auth_user_id from public.profiles
    where auth_user_id is not null
    group by auth_user_id having count(*) > 1) x;
  return query select 'data', 'One profile per login',
    case when n = 0 then 'PASS' else 'FAIL' end, n || ' logins with multiple profiles';

  -- Both scheduled jobs. The reminder requirement sat unimplemented
  -- behind a defined-but-unused notification kind; the assertion that
  -- catches that is whether the job actually runs.
  select count(*) into n from cron.job
   where jobname = 'mark-overdue-no-shows' and active;
  return query select 'integrity', 'No-show sweep scheduled (BR-5)',
    case when n = 1 then 'PASS' else 'FAIL' end, n || ' active cron job';

  select count(*) into n from cron.job
   where jobname = 'send-appointment-reminders' and active;
  return query select 'integrity', 'Appointment reminder sweep scheduled',
    case when n = 1 then 'PASS' else 'FAIL' end, n || ' active cron job';

  select count(*) into n from (
    select nurse_id, action_id from public.nurse_actions
    group by nurse_id, action_id having count(*) > 1) x;
  return query select 'concurrency', 'Idempotency ledger has no duplicates',
    case when n = 0 then 'PASS' else 'FAIL' end, n || ' duplicate (nurse, action) pairs';
end;
$$;

revoke execute on function public.system_health_check_v2() from public, anon;
grant execute on function public.system_health_check_v2() to authenticated;

notify pgrst, 'reload schema';
