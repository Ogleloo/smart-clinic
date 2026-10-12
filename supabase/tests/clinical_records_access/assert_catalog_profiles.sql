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
  select 'find_duplicate_patients / search_patients / merge_patient_profiles are clinic-scoped',
         (select count(*) = 3 and bool_and(prosrc ~ 'private\.patient_scope') from fn),
         coalesce((select string_agg(proname, ', ') from fn where prosrc !~ 'private\.patient_scope'), 'none')
  union all
  select 'search_patients refuses nurses',
         coalesce((select prosrc ~ 'not in \(''receptionist'', ''admin''\)' from fn where proname = 'search_patients'), false),
         'search_patients'
  union all
  select 'merge_patient_profiles requires patient profiles',
         coalesce((select prosrc ~ 'Only patient profiles can be merged' from fn where proname = 'merge_patient_profiles'), false),
         'merge_patient_profiles'
  union all
  select 'the three functions: SECURITY DEFINER, pinned search_path, not anon-executable',
         (select count(*) = 3 and bool_and(prosecdef and cfg like '%search_path=%' and not has_function_privilege('anon', oid, 'EXECUTE')) from fn),
         'pg_proc'
  union all
  select 'private.patient_scope: SECURITY DEFINER, not anon/PUBLIC-executable',
         coalesce((select p.prosecdef and not has_function_privilege('anon', p.oid, 'EXECUTE')
                          and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)
                   from pg_proc p where p.oid = to_regprocedure('private.patient_scope(uuid)')), false),
         'pg_proc'
)
select pass, check_name, detail from checks order by pass, check_name;
