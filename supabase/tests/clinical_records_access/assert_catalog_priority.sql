-- READ-ONLY catalog assertions for queue_priority_reception.sql and function_privileges_hardening.sql. Reads
-- pg_catalog only; safe for production once authorised. All rows should be true after both proposals are applied.

with
fn as (
  select p.oid, p.proname, p.prosrc, p.prosecdef, coalesce(p.proconfig::text, '') as cfg
  from pg_proc p where p.pronamespace = 'public'::regnamespace
),
checks(check_name, pass, detail) as (
  select 'set_queue_priority / request_priority_escalation / decline_priority_escalation: definer, pinned, authenticated only',
         (select count(*) = 3 and bool_and(prosecdef and cfg like '%search_path=%' and not has_function_privilege('anon', oid, 'EXECUTE')
                                          and has_function_privilege('authenticated', oid, 'EXECUTE'))
            from fn where proname in ('set_queue_priority', 'request_priority_escalation', 'decline_priority_escalation')),
         'pg_proc'
  union all
  select 'set_queue_priority is reception-only and clinic-checked',
         coalesce((select prosrc ~ 'role = ''receptionist''' and prosrc ~ 'entry\.clinic_id <> me\.clinic_id' from fn where proname = 'set_queue_priority'), false),
         'set_queue_priority'
  union all
  select 'legacy set_emergency_priority not executable by app roles (cutover; closes F12)',
         coalesce((select not has_function_privilege('authenticated', oid, 'EXECUTE') and not has_function_privilege('anon', oid, 'EXECUTE')
                   from fn where proname = 'set_emergency_priority'), false),
         'set_emergency_priority'
  union all
  select 'check_in_patient no longer sets priority',
         coalesce((select prosrc ~ 'coalesce\(p_priority, 0\) <> 0' from fn where proname = 'check_in_patient'), false),
         'check_in_patient'
  union all
  select 'priority events / escalations: RLS on, no write privilege for app roles',
         (select count(*) = 2 and bool_and(c.relrowsecurity
                   and not has_table_privilege('authenticated', c.oid, 'INSERT') and not has_table_privilege('authenticated', c.oid, 'UPDATE')
                   and not has_table_privilege('authenticated', c.oid, 'DELETE') and not has_table_privilege('anon', c.oid, 'SELECT'))
            from pg_class c where c.oid in (to_regclass('public.queue_priority_events'), to_regclass('public.queue_priority_escalations'))),
         'queue_priority_events, queue_priority_escalations'
  union all
  select 'priority audit survives queue-entry deletion: no foreign key from events/escalations to queue_entries',
         not exists (select 1 from pg_constraint c where c.contype = 'f'
                       and c.conrelid in (to_regclass('public.queue_priority_events'), to_regclass('public.queue_priority_escalations'))
                       and c.confrelid = 'public.queue_entries'::regclass)
         and to_regclass('public.queue_priority_events') is not null,
         'pg_constraint'
  union all
  select 'priority events append-only and escalations guarded (triggers present)',
         exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.queue_priority_events') and not t.tgisinternal and t.tgname like '%no_update_delete')
         and exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.queue_priority_escalations') and not t.tgisinternal and t.tgname like '%guard'),
         'pg_trigger'
  union all
  select 'every priority event has a reason (NOT NULL), clearing included',
         coalesce((select a.attnotnull from pg_attribute a where a.attrelid = to_regclass('public.queue_priority_events') and a.attname = 'reason'), false)
         and coalesce((select prosrc ~ 'A reason is required to change priority' from fn where proname = 'set_queue_priority'), false),
         'queue_priority_events.reason'
  union all
  select 'escalations carry a reason code and no free-text column',
         coalesce((select a.attnotnull from pg_attribute a where a.attrelid = to_regclass('public.queue_priority_escalations') and a.attname = 'reason'), false)
         and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'queue_priority_escalations'
                           and data_type in ('text', 'character varying') and column_name <> 'token'),
         'queue_priority_escalations'
  union all
  select 'F13 reset_demo_state: not executable by authenticated/anon; service_role can',
         coalesce((select not has_function_privilege('authenticated', oid, 'EXECUTE') and not has_function_privilege('anon', oid, 'EXECUTE')
                          and has_function_privilege('service_role', oid, 'EXECUTE') from fn where proname = 'reset_demo_state'), false),
         'reset_demo_state'
  union all
  select 'F14 send_appointment_reminders: not executable by authenticated/anon',
         coalesce((select not has_function_privilege('authenticated', oid, 'EXECUTE') and not has_function_privilege('anon', oid, 'EXECUTE')
                   from fn where proname = 'send_appointment_reminders'), false),
         'send_appointment_reminders'
)
select pass, check_name, detail from checks order by pass, check_name;
