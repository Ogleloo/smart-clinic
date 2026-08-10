-- Migration 0016: system_health_check()
--
-- A permanent, repeatable verification of the system's invariants.
-- Run `select * from public.system_health_check();` at any time —
-- SQL editor, psql, a CI job, or an admin screen.
--
-- It checks STRUCTURE (are the guarantees still in place?) and DATA
-- (has anything violated them?). It is read-only and safe to run in
-- production.

create or replace function public.system_health_check()
returns table (category text, check_name text, status text, detail text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  n int;
  txt text;
begin
  -- ---------- RLS coverage ----------
  select count(*) into n
  from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  category := 'security'; check_name := 'RLS enabled on all public tables';
  status := case when n = 0 then 'PASS' else 'FAIL' end;
  detail := n || ' table(s) without RLS';
  return next;

  -- A table with RLS but no policy denies everything — usually a bug.
  select count(*) into n
  from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
    and not exists (select 1 from pg_policies p
                    where p.schemaname='public' and p.tablename = c.relname);
  category := 'security'; check_name := 'Every RLS table has policies';
  status := case when n = 0 then 'PASS' else 'WARN' end;
  detail := n || ' table(s) with RLS but no policy';
  return next;

  -- ---------- function hardening ----------
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig,'{}'::text[])) cfg
                    where cfg like 'search_path=%');
  category := 'security'; check_name := 'SECURITY DEFINER functions pin search_path';
  status := case when n = 0 then 'PASS' else 'FAIL' end;
  detail := n || ' unpinned function(s)';
  return next;

  -- anon must not be able to execute the engine
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname='public'
    and p.proname in ('check_in_patient','book_appointment','set_emergency_priority',
                      'create_walkin_patient','call_next_patient','get_wait_estimate')
    and has_function_privilege('anon', p.oid, 'execute');
  category := 'security'; check_name := 'anon cannot execute privileged RPCs';
  status := case when n = 0 then 'PASS' else 'FAIL' end;
  detail := n || ' RPC(s) callable by anon';
  return next;

  -- patients must not be able to grant themselves a role
  select count(*) into n
  from information_schema.column_privileges
  where table_schema='public' and table_name='profiles'
    and column_name in ('role','clinic_id','is_active')
    and grantee='authenticated' and privilege_type='UPDATE';
  category := 'security'; check_name := 'Privilege-escalation columns not updatable';
  status := case when n = 0 then 'PASS' else 'FAIL' end;
  detail := n || ' sensitive column(s) updatable by authenticated';
  return next;

  -- ---------- structural guarantees ----------
  select count(*) into n from pg_indexes
  where schemaname='public' and indexname in
    ('queue_entries_token_unique','queue_entries_one_active',
     'appointments_slot_unique','appointments_one_per_patient_day');
  category := 'integrity'; check_name := 'Business-rule indexes present (BR-4/6/7)';
  status := case when n = 4 then 'PASS' else 'FAIL' end;
  detail := n || ' of 4 present';
  return next;

  -- ---------- data invariants ----------
  select count(*) into n from (
    select clinic_id, service_id, queue_date, token_number
    from public.queue_entries
    group by 1,2,3,4 having count(*) > 1) d;
  category := 'data'; check_name := 'No duplicate tokens (BR-7)';
  status := case when n = 0 then 'PASS' else 'FAIL' end;
  detail := n || ' duplicate token group(s)';
  return next;

  select count(*) into n from (
    select service_id, scheduled_time from public.appointments
    where status in ('booked','checked_in')
    group by 1,2 having count(*) > 1) d;
  category := 'data'; check_name := 'No double-booked slots (BR-4)';
  status := case when n = 0 then 'PASS' else 'FAIL' end;
  detail := n || ' conflicting slot(s)';
  return next;

  select count(*) into n from public.consultations
  where ended_at is not null and ended_at <= started_at;
  category := 'data'; check_name := 'Consultation durations positive';
  status := case when n = 0 then 'PASS' else 'FAIL' end;
  detail := n || ' invalid duration(s)';
  return next;

  -- an emergency must always record who set it (BR-10 audit)
  select count(*) into n from public.queue_entries
  where priority = 1 and priority_set_by is null;
  category := 'data'; check_name := 'Emergency priority always audited (BR-10)';
  status := case when n = 0 then 'PASS' else 'FAIL' end;
  detail := n || ' unaudited emergency entr(ies)';
  return next;

  -- consultations left open from a previous day = forgotten "End"
  select count(*) into n from public.consultations
  where ended_at is null and started_at < current_date;
  category := 'data'; check_name := 'No stale open consultations';
  status := case when n = 0 then 'PASS' else 'WARN' end;
  detail := n || ' consultation(s) open since before today';
  return next;

  -- ---------- realtime ----------
  select count(*) into n
  from pg_class c join pg_inherits i on i.inhrelid = c.oid
  join pg_class p on p.oid = i.inhparent
  join pg_namespace ns on ns.oid = p.relnamespace
  where ns.nspname='realtime' and p.relname='messages'
    and c.relname = 'messages_' || to_char(current_date,'YYYY_MM_DD');
  category := 'realtime'; check_name := 'Broadcast partition exists for today';
  status := case when n > 0 then 'PASS' else 'FAIL' end;
  detail := case when n > 0 then 'present'
                 else 'MISSING — realtime.send() will fail silently' end;
  return next;

  select count(*) into n from pg_publication_tables
  where pubname='supabase_realtime' and schemaname='public'
    and tablename in ('queue_entries','queue_events');
  category := 'realtime'; check_name := 'Queue tables published to Realtime';
  status := case when n >= 1 then 'PASS' else 'FAIL' end;
  detail := n || ' table(s) published';
  return next;

  -- ---------- engine sanity ----------
  select string_agg(s.name || ': ' || st.sample_count || ' samples, ' ||
                    coalesce(st.avg_minutes::text,'—') || ' min, ' ||
                    public.confidence_label(s.id, st.sample_count, st.stddev_minutes),
                    ' | ')
  into txt
  from public.services s
  cross join lateral public.service_consultation_stats(s.id) st
  where s.is_active;
  category := 'engine'; check_name := 'Prediction inputs per service';
  status := 'INFO'; detail := coalesce(txt,'no active services');
  return next;

  return;
end;
$$;

revoke execute on function public.system_health_check() from public, anon;
grant execute on function public.system_health_check() to authenticated;

notify pgrst, 'reload schema';
