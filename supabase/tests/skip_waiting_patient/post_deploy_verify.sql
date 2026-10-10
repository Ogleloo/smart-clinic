-- READ-ONLY verification for 20261010231805_skip_waiting_patient. Every row must have ok = true.
-- Safe to run against production after the migration is applied (it only reads catalogs); also run before
-- applying, where the function rows are expected to be false and the "unchanged" rows true.
-- Uses no table data, calls no function under test, writes nothing.

with f as (
  select p.oid, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) as def,
         pg_get_function_result(p.oid) as result
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'skip_waiting_patient'
     and pg_get_function_identity_arguments(p.oid) = 'p_queue_entry_id uuid'
)
select * from (values
  ('function exists with signature (uuid)',              (select count(*) = 1 from f)),
  ('exactly one overload',                               (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'skip_waiting_patient')),
  ('returns public.queue_entries',                       coalesce((select result = 'queue_entries' from f), false)),
  ('SECURITY DEFINER',                                   coalesce((select prosecdef from f), false)),
  ('search_path pinned to public, pg_temp',              coalesce((select 'search_path=public, pg_temp' = any(proconfig) from f), false)),
  ('locks the row: FOR UPDATE OF q',                     coalesce((select position('for update of q' in def) > 0 from f), false)),
  ('waiting-only check present',                         coalesce((select position('elsif entry.status <> ''waiting''' in def) > 0 from f), false)),
  ('active-profile check present',                       coalesce((select position('not caller.is_active' in def) > 0 from f), false)),
  ('staff-role check present',                           coalesce((select position('caller.role not in (''nurse'', ''receptionist'', ''admin'')' in def) > 0 from f), false)),
  ('clinic isolation (entry and service)',               coalesce((select position('q.clinic_id = caller.clinic_id' in def) > 0 and position('s.clinic_id = caller.clinic_id' in def) > 0 from f), false)),
  ('never updates consultations',                        coalesce((select position('update public.consultations' in def) = 0 from f), false)),
  ('anon cannot EXECUTE',                                coalesce((select not has_function_privilege('anon', oid, 'execute') from f), false)),
  ('PUBLIC has no EXECUTE grant',                        not exists (select 1 from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'skip_waiting_patient' and grantee = 'PUBLIC')),
  ('authenticated can EXECUTE',                          coalesce((select has_function_privilege('authenticated', oid, 'execute') from f), false)),
  -- Trigger and event-trigger functions cannot be invoked by SQL or PostgREST, so they are not "callable".
  ('only get_public_queue_display is anon-callable',     (select coalesce(string_agg(p.proname, ',' order by p.proname), '') = 'get_public_queue_display' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') and pg_get_function_result(p.oid) not in ('trigger', 'event_trigger'))),
  -- CR-insensitive: a replay from a Windows (autocrlf) checkout stores CRLF bodies; the SQL is the same.
  ('skip_patient(uuid, boolean) unchanged (md5 of 2026-10-10 definition)',
                                                         (select md5(replace(pg_get_functiondef('public.skip_patient(uuid,boolean)'::regprocedure), E'\r', '')) = '01bf37f9f7ad9217225c03ea921e2179'))
) as checks(check_name, ok);
