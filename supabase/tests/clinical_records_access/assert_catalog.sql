-- READ-ONLY catalog assertions for the clinical-records proposal (docs/proposals/clinical_records_access.sql).
-- Reads pg_catalog / information_schema only; writes nothing, so it is safe to run on production for the D4
-- pre-deployment check. Every row should be pass = true AFTER the proposal is applied; on today's schema the
-- failing rows are the findings.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/clinical_records_access/assert_catalog.sql

with
tbl_grants as (
  select table_name, grantee, privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('consultation_notes', 'patient_vitals', 'consultations', 'queue_entries')
    and grantee in ('public', 'anon', 'authenticated')
),
pol as (
  select tablename, policyname, cmd, roles::text as roles, coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
  from pg_policies
  where schemaname = 'public'
    and tablename in ('consultation_notes', 'patient_vitals', 'consultations', 'queue_entries')
),
checks(check_name, pass, detail) as (
  -- grants: anon / PUBLIC hold nothing on the four tables
  select 'anon/public hold no privilege on clinical, consultation or queue tables',
         not exists (select 1 from tbl_grants where grantee in ('anon', 'public')),
         coalesce((select string_agg(distinct table_name || ':' || grantee || ':' || privilege_type, ', ')
                   from tbl_grants where grantee in ('anon', 'public')), 'none')
  union all
  select 'authenticated holds only SELECT/INSERT/UPDATE on consultation_notes and patient_vitals',
         not exists (select 1 from tbl_grants where grantee = 'authenticated'
                       and table_name in ('consultation_notes', 'patient_vitals')
                       and privilege_type not in ('SELECT', 'INSERT', 'UPDATE')),
         coalesce((select string_agg(distinct table_name || ':' || privilege_type, ', ') from tbl_grants
                   where grantee = 'authenticated' and table_name in ('consultation_notes', 'patient_vitals')
                     and privilege_type not in ('SELECT', 'INSERT', 'UPDATE')), 'none')
  union all
  select 'authenticated holds only SELECT on consultations and queue_entries',
         not exists (select 1 from tbl_grants where grantee = 'authenticated'
                       and table_name in ('consultations', 'queue_entries') and privilege_type <> 'SELECT'),
         coalesce((select string_agg(distinct table_name || ':' || privilege_type, ', ') from tbl_grants
                   where grantee = 'authenticated' and table_name in ('consultations', 'queue_entries')
                     and privilege_type <> 'SELECT'), 'none')
  union all
  select 'no column-level write grant to authenticated on consultations/queue_entries',
         not exists (select 1 from information_schema.column_privileges
                     where table_schema = 'public' and table_name in ('consultations', 'queue_entries')
                       and grantee in ('anon', 'authenticated', 'public') and privilege_type <> 'SELECT'),
         'column_privileges'
  union all
  -- policies
  select 'clinical tables have no policy mentioning receptionist/admin',
         not exists (select 1 from pol where tablename in ('consultation_notes', 'patient_vitals')
                       and (qual || with_check) ~ '(receptionist|admin)'),
         coalesce((select string_agg(policyname, ', ') from pol where tablename in ('consultation_notes', 'patient_vitals')
                     and (qual || with_check) ~ '(receptionist|admin)'), 'none')
  union all
  select 'clinical SELECT policies are treatment-linked only',
         (select count(*) = 2 and bool_and(qual ~ 'nurse_can_read_clinical') from pol
            where tablename in ('consultation_notes', 'patient_vitals') and cmd = 'SELECT'),
         coalesce((select string_agg(tablename || '.' || policyname, ', ') from pol
                   where tablename in ('consultation_notes', 'patient_vitals') and cmd = 'SELECT'), 'none')
  union all
  select 'clinical INSERT/UPDATE policies require an owned active consultation',
         (select count(*) = 4
                 and bool_and((case when cmd = 'INSERT' then with_check else qual || with_check end) ~ 'nurse_owns_active_consultation')
            from pol where tablename in ('consultation_notes', 'patient_vitals') and cmd in ('INSERT', 'UPDATE')),
         coalesce((select string_agg(tablename || '.' || policyname || '(' || cmd || ')', ', ') from pol
                   where tablename in ('consultation_notes', 'patient_vitals') and cmd in ('INSERT', 'UPDATE')), 'none')
  union all
  select 'clinical UPDATE policies have WITH CHECK',
         not exists (select 1 from pol where tablename in ('consultation_notes', 'patient_vitals')
                       and cmd = 'UPDATE' and with_check = ''),
         'pg_policies.with_check'
  union all
  select 'no DELETE or ALL policy on clinical, consultation or queue tables',
         not exists (select 1 from pol where cmd in ('DELETE', 'ALL')),
         coalesce((select string_agg(tablename || '.' || policyname || '(' || cmd || ')', ', ') from pol
                   where cmd in ('DELETE', 'ALL')), 'none')
  union all
  select 'no write policy on consultations or queue_entries',
         not exists (select 1 from pol where tablename in ('consultations', 'queue_entries') and cmd <> 'SELECT'),
         coalesce((select string_agg(tablename || '.' || policyname || '(' || cmd || ')', ', ') from pol
                   where tablename in ('consultations', 'queue_entries') and cmd <> 'SELECT'), 'none')
  union all
  select 'link-immutability triggers present on both clinical tables',
         (select count(*) = 2 from pg_trigger t join pg_class c on c.oid = t.tgrelid
            where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
              and c.relname in ('consultation_notes', 'patient_vitals') and t.tgname like '%link_immutable'),
         'pg_trigger'
  union all
  -- functions
  select 'private schema exists and is not usable by anon/public',
         coalesce((select not has_schema_privilege('anon', n.oid, 'USAGE')
                          and not exists (select 1 from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a where a.grantee = 0)
                   from pg_namespace n where n.nspname = 'private'), false),
         'schema private'
  union all
  select 'private helpers are SECURITY DEFINER with a fixed search_path',
         (select count(*) >= 4 and bool_and(p.prosecdef and p.proconfig::text like '%search_path=%')
            from pg_proc p where p.pronamespace = to_regnamespace('private')
              and p.proname in ('active_nurse', 'nurse_treats_patient', 'nurse_can_read_clinical', 'nurse_owns_active_consultation')),
         'pg_proc'
  union all
  -- SECURITY DEFINER helper inputs are ROW data only (an allow-list); the caller is always derived from auth.uid()
  -- inside. Scope: SECURITY DEFINER helpers that app roles can EXECUTE (the ones RLS policies evaluate). Internal
  -- definer functions that take a staff id (identity prototype, merge core) are not executable by app roles — asserted
  -- separately — and are callable only from wrappers that derive the caller from auth.uid().
  -- p_author_id receives the row's nurse_id and is only ever compared with the caller's own profile id.
  select 'private helper inputs are row data only (allow-list) and identity comes from auth.uid()',
         not exists (select 1 from pg_proc p,
                       unnest(coalesce(p.proargnames, '{}'), coalesce(p.proargmodes, array_fill('i'::"char", array[coalesce(array_length(p.proargnames, 1), 0)]))) as a(name, mode)
                     where p.pronamespace = to_regnamespace('private') and p.prosecdef and has_function_privilege('authenticated', p.oid, 'EXECUTE') and a.mode in ('i', 'b')
                       and a.name not in ('p_consultation_id', 'p_patient_id', 'p_author_id'))
         and not exists (select 1 from pg_proc p where p.pronamespace = to_regnamespace('private') and p.prosecdef and has_function_privilege('authenticated', p.oid, 'EXECUTE')
                           and p.prorettype <> 'trigger'::regtype
                           and p.prosrc !~ '(auth\.uid\(\)|private\.active_nurse\(\))'),
         coalesce((select string_agg(p.proname || '(' || array_to_string(p.proargnames, ',') || ')', ', ') from pg_proc p
                   where p.pronamespace = to_regnamespace('private') and p.prosecdef and has_function_privilege('authenticated', p.oid, 'EXECUTE') and p.prorettype <> 'trigger'::regtype), 'none')
  union all
  select 'no private function executable by anon or PUBLIC',
         not exists (select 1 from pg_proc p where p.pronamespace = to_regnamespace('private')
                       and (has_function_privilege('anon', p.oid, 'EXECUTE')
                            or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))),
         'pg_proc.proacl'
  union all
  select 'get_patient_clinical_history(uuid, timestamptz, uuid, int): authenticated only, SECURITY DEFINER, paginated',
         coalesce((select p.prosecdef and not has_function_privilege('anon', p.oid, 'EXECUTE')
                          and has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   from pg_proc p where p.oid = to_regprocedure('public.get_patient_clinical_history(uuid,timestamptz,uuid,integer)')), false)
         and to_regprocedure('public.get_patient_clinical_history(uuid)') is null,
         'pg_proc'
  union all
  select 'legacy start_consultation / call_next_patient not executable by authenticated, anon or PUBLIC',
         not exists (select 1 from pg_proc p
                     where p.pronamespace = 'public'::regnamespace and p.proname in ('start_consultation', 'call_next_patient')
                       and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
                            or has_function_privilege('anon', p.oid, 'EXECUTE'))),
         coalesce((select string_agg(p.proname, ', ') from pg_proc p
                   where p.pronamespace = 'public'::regnamespace and p.proname in ('start_consultation', 'call_next_patient')
                     and has_function_privilege('authenticated', p.oid, 'EXECUTE')), 'none')
  union all
  select 'still exactly one anon-callable public RPC (get_public_queue_display)',
         (select count(*) = 1 and bool_and(p.proname = 'get_public_queue_display') from pg_proc p
            where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')
              and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)),
         coalesce((select string_agg(p.proname, ', ') from pg_proc p
                   where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')
                     and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)), 'none')
  union all
  select 'every writer of consultations/queue_entries/clinical tables in public is SECURITY DEFINER',
         not exists (select 1 from pg_proc p
                     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and not p.prosecdef
                       and p.prorettype <> 'trigger'::regtype
                       and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(consultations|queue_entries|consultation_notes|patient_vitals)\M'),
         coalesce((select string_agg(p.proname, ', ') from pg_proc p
                   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and not p.prosecdef
                     and p.prorettype <> 'trigger'::regtype
                     and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(consultations|queue_entries|consultation_notes|patient_vitals)\M'), 'none')
)
select pass, check_name, detail from checks order by pass, check_name;
