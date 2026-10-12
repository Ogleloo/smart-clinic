-- READ-ONLY catalog inventory for the clinical-records / profiles proposals (D4).
-- NOT YET RUN ON PRODUCTION — requires separate authorisation. Runs inside a READ ONLY transaction that is
-- rolled back, and reads only pg_catalog / information_schema / supabase_migrations, so it cannot change data
-- or schema even if edited by mistake to include a write (Postgres rejects writes in a read-only transaction).
--
--   psql "$PROD_DB_URL" -At -F '|' -v ON_ERROR_STOP=1 -f supabase/tests/clinical_records_access/production_inventory.sql > inventory.txt
--
-- Compare the output with the same script run on a local replay of supabase/migrations (no proposal applied).
-- Any difference is drift that must be understood before a migration is written. Then run assert_catalog.sql and
-- assert_catalog_profiles.sql (also read-only) to record the "before" state.

begin transaction isolation level repeatable read read only;

\echo '== 1. tables: RLS, FORCE RLS, owner'
select c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner)
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
order by 1;

\echo '== 2. RLS policies (public)'
select tablename, policyname, cmd, permissive, roles::text, coalesce(qual, ''), coalesce(with_check, '')
from pg_policies where schemaname = 'public'
order by 1, 2;

\echo '== 3. table privileges (anon, authenticated, PUBLIC, service_role)'
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC', 'service_role')
group by 1, 2 order by 1, 2;

\echo '== 4. column-only privileges (granted on a column, not on the whole table)'
select cp.table_name, cp.column_name, cp.grantee, string_agg(cp.privilege_type, ',' order by cp.privilege_type)
from information_schema.column_privileges cp
where cp.table_schema = 'public' and cp.grantee in ('anon', 'authenticated', 'PUBLIC')
  and not exists (select 1 from information_schema.role_table_grants tg
                  where tg.table_schema = 'public' and tg.table_name = cp.table_name
                    and tg.grantee = cp.grantee and tg.privilege_type = cp.privilege_type)
group by 1, 2, 3 order by 1, 2, 3;

\echo '== 5. functions (public, private): definer, owner, search_path, ACL, callable by anon/authenticated, body md5'
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef, pg_get_userbyid(p.proowner),
       coalesce(array_to_string(p.proconfig, ';'), ''), coalesce(p.proacl::text, '(default: PUBLIC execute)'),
       has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE'),
       p.prorettype::regtype, md5(p.prosrc)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
order by 1, 2, 3;

\echo '== 6. writer dependencies: functions whose body writes a sensitive table'
select t.tbl, p.proname, p.prosecdef, pg_get_userbyid(p.proowner), p.prorettype::regtype,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')
from pg_proc p
cross join (values ('consultations'), ('queue_entries'), ('consultation_notes'), ('patient_vitals'), ('profiles'),
                   ('appointments')) as t(tbl)
where p.pronamespace in ('public'::regnamespace)
  and p.prosrc ~* ('(insert\s+into|update|delete\s+from)\s+(public\.)?' || t.tbl || '\M')
order by 1, 2;

\echo '== 7. triggers on sensitive tables'
select c.relname, t.tgname, p.proname, p.prosecdef, t.tgenabled
from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
  and c.relname in ('consultations', 'queue_entries', 'consultation_notes', 'patient_vitals', 'profiles', 'appointments')
order by 1, 2;

\echo '== 8. schema privileges'
select n.nspname, coalesce(n.nspacl::text, '(default)'),
       has_schema_privilege('anon', n.oid, 'USAGE'), has_schema_privilege('authenticated', n.oid, 'USAGE')
from pg_namespace n where n.nspname in ('public', 'private', 'extensions')
order by 1;

\echo '== 9. default privileges'
select pg_get_userbyid(d.defaclrole), coalesce(d.defaclnamespace::regnamespace::text, '(all)'), d.defaclobjtype, d.defaclacl::text
from pg_default_acl d order by 1, 2, 3;

\echo '== 10. realtime publication'
select pubname, schemaname, tablename from pg_publication_tables order by 1, 2, 3;

\echo '== 10b. extensions (pgcrypto and supabase_vault are prerequisites of the identity design)'
select extname, extversion, extnamespace::regnamespace from pg_extension order by 1;

\echo '== 10c. Vault secret NAMES only (never values) — is identity_document_hmac_key_v1 present?'
select name, created_at from vault.secrets order by 1;

\echo '== 11. event triggers'
select evtname, evtevent, evtenabled, p.proname from pg_event_trigger e join pg_proc p on p.oid = e.evtfoid order by 1;

\echo '== 12. recorded migrations'
select version, name from supabase_migrations.schema_migrations order by version;

rollback;
