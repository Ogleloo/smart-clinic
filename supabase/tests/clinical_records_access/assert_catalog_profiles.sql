-- READ-ONLY catalog assertions for docs/proposals/profiles_identifier_access.sql. Reads pg_catalog only; safe to
-- run on production. All rows should be pass = true after the proposal is applied.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/clinical_records_access/assert_catalog_profiles.sql

with
pol as (
  select policyname, cmd, coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
  from pg_policies where schemaname = 'public' and tablename = 'profiles'
),
fn as (
  select p.proname, p.prosrc, p.prosecdef, p.proconfig::text as cfg, p.oid
  from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('find_duplicate_patients', 'search_patients', 'merge_patient_profiles')
),
core as (
  select p.prosrc, p.prosecdef, p.oid from pg_proc p
  where p.oid = to_regprocedure('private.merge_patient_profiles_core(uuid,uuid,public.patient_merge_reason,text)')
),
checks(check_name, pass, detail) as (
  select 'no profiles policy grants admins unscoped access',
         not exists (select 1 from pol where (qual || with_check) ~ 'auth_role\(\) = ''admin''::user_role\)?$'
                       or policyname in ('profiles_select_admin', 'profiles_update_admin')),
         coalesce((select string_agg(policyname, ', ') from pol
                   where policyname in ('profiles_select_admin', 'profiles_update_admin')), 'none')
  union all
  select 'no UPDATE policy on profiles other than the owner''s',
         not exists (select 1 from pol where cmd in ('UPDATE', 'ALL') and policyname <> 'profiles_update_own'),
         coalesce((select string_agg(policyname || '(' || cmd || ')', ', ') from pol
                   where cmd in ('UPDATE', 'ALL') and policyname <> 'profiles_update_own'), 'none')
  union all
  select 'staff read: visit-based branches limited to patient profiles',
         coalesce((select qual ~ 'role = ''patient''' from pol where policyname = 'profiles_staff_read_clinic_patients'), false),
         'profiles_staff_read_clinic_patients'
  union all
  select 'find_duplicate_patients / search_patients scoped; both merge RPCs go through the scoped private core',
         (select count(*) = 2 and bool_and(prosrc ~ 'private\.patient_scope') from fn where proname <> 'merge_patient_profiles')
         and coalesce((select prosrc ~ 'private\.merge_patient_profiles_core' from fn where proname = 'merge_patient_profiles'), false)
         and coalesce((select prosrc ~ 'private\.merge_patient_profiles_core' from pg_proc
                       where oid = to_regprocedure('public.merge_patient_profiles_with_reason(uuid,uuid,public.patient_merge_reason,text)')), false)
         and coalesce((select prosrc ~ 'private\.patient_scope' from core), false),
         'find_duplicate_patients, search_patients, merge wrappers, merge core'
  union all
  select 'search_patients refuses nurses',
         coalesce((select prosrc ~ 'not in \(''receptionist'', ''admin''\)' from fn where proname = 'search_patients'), false),
         'search_patients'
  union all
  select 'merge_patient_profiles requires patient profiles',
         coalesce((select prosrc ~ 'Only patient profiles can be merged' from core), false),
         'merge_patient_profiles'
  union all
  select 'the three functions: SECURITY DEFINER, pinned search_path, not anon-executable',
         (select count(*) = 3 and bool_and(prosecdef and cfg like '%search_path=%' and not has_function_privilege('anon', oid, 'EXECUTE')) from fn),
         'pg_proc'
  union all
  select 'search_patients never returns patients known only to other clinics (rev 4)',
         coalesce((select prosrc !~ 'foreign' and prosrc ~ '''linked'', ''shared'', ''unaffiliated''' from fn where proname = 'search_patients'), false),
         'search_patients'
  union all
  select 'merge refuses shared/foreign profiles and other-clinic audit references, and writes patient_merge_audit',
         coalesce((select prosrc ~ '''shared''' and prosrc ~ 'cancelled_by = p_merge_id' and prosrc ~ 'priority_set_by = p_merge_id'
                          and prosrc ~ 'insert into public\.patient_merge_audit' from core), false),
         'merge_patient_profiles'
  union all
  select 'patient_merge_audit: RLS on, clinic-scoped admin read, no write privilege for app roles',
         coalesce((select c.relrowsecurity
                          and not has_table_privilege('authenticated', c.oid, 'INSERT') and not has_table_privilege('authenticated', c.oid, 'UPDATE')
                          and not has_table_privilege('authenticated', c.oid, 'DELETE') and not has_table_privilege('anon', c.oid, 'SELECT')
                   from pg_class c where c.oid = to_regclass('public.patient_merge_audit')), false),
         'patient_merge_audit'
  union all
  select 'private.patient_scope distinguishes shared (known to this and another clinic)',
         coalesce((select p.prosrc ~ '''shared''' from pg_proc p where p.oid = to_regprocedure('private.patient_scope(uuid)')), false),
         'private.patient_scope'
  union all
  select 'merge audit: reason_code NOT NULL, append-only trigger present',
         coalesce((select a.attnotnull from pg_attribute a where a.attrelid = to_regclass('public.patient_merge_audit') and a.attname = 'reason_code'), false)
         and exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.patient_merge_audit') and not t.tgisinternal and t.tgname like '%no_update_delete'),
         'patient_merge_audit'
  union all
  select 'merge core not executable by app roles; merge_patient_profiles_with_reason: definer, authenticated only',
         coalesce((select prosecdef and not has_function_privilege('authenticated', oid, 'EXECUTE') and not has_function_privilege('anon', oid, 'EXECUTE') from core), false)
         and coalesce((select p.prosecdef and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
                       from pg_proc p where p.oid = to_regprocedure('public.merge_patient_profiles_with_reason(uuid,uuid,public.patient_merge_reason,text)')), false),
         'merge functions'
  union all
  select 'private.patient_scope: SECURITY DEFINER, not anon/PUBLIC-executable',
         coalesce((select p.prosecdef and not has_function_privilege('anon', p.oid, 'EXECUTE')
                          and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)
                   from pg_proc p where p.oid = to_regprocedure('private.patient_scope(uuid)')), false),
         'pg_proc'
)
select pass, check_name, detail from checks order by pass, check_name;
