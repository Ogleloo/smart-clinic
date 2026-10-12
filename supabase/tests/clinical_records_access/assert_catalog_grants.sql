-- READ-ONLY catalog assertions: explicit, minimal privileges on every public table and function (decision D-R3: keep the
-- current Supabase default privileges for now, and check automatically that nothing relies on them). Reads pg_catalog
-- only; safe on production once authorised. Intended to run after every migration, and in CI against a local replay.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/clinical_records_access/assert_catalog_grants.sql
--
-- Rows prefixed INFO are always pass = true: they list things a reviewer must look at (RLS-only barriers).

with
rels as (
  select c.oid, c.relname, c.relrowsecurity, c.relowner
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
),
acl as (
  select r.relname, case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee, a.privilege_type
  from rels r cross join lateral aclexplode(coalesce((select relacl from pg_class where oid = r.oid), acldefault('r', r.relowner))) a
),
excess as (
  select relname, grantee, privilege_type from acl
  where grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
),
fn as (
  select p.oid, p.proname, n.nspname, p.prorettype, p.proacl, p.proowner
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private')
),
checks(check_name, pass, detail) as (
  select 'no public table grants TRUNCATE / REFERENCES / TRIGGER / MAINTAIN to anon, authenticated or PUBLIC',
         not exists (select 1 from excess),
         coalesce((select string_agg(distinct relname, ', ') from excess), 'none')
  union all
  select 'every public table has row level security enabled',
         not exists (select 1 from rels where not relrowsecurity),
         coalesce((select string_agg(relname, ', ') from rels where not relrowsecurity), 'none')
  union all
  select 'no column-level REFERENCES for anon, authenticated or PUBLIC',
         not exists (select 1 from rels r join pg_attribute att on att.attrelid = r.oid and att.attnum > 0 and att.attacl is not null
                     cross join lateral aclexplode(att.attacl) a
                     where a.privilege_type = 'REFERENCES' and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))),
         'attacl'
  union all
  select 'service_role keeps SELECT / INSERT / UPDATE / DELETE on every public table',
         not exists (select 1 from rels r cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
                     where not exists (select 1 from acl where acl.relname = r.relname and acl.grantee = 'service_role' and acl.privilege_type = p.priv)),
         'acl'
  union all
  select 'only get_public_queue_display is anon-callable among public/private RPCs (trigger functions excluded)',
         (select coalesce(bool_and(proname = 'get_public_queue_display' and nspname = 'public'), true)
            from fn where has_function_privilege('anon', oid, 'EXECUTE') and prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)),
         coalesce((select string_agg(nspname || '.' || proname, ', ') from fn
                   where has_function_privilege('anon', oid, 'EXECUTE') and prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)), 'none')
  union all
  select 'no public/private function is executable by PUBLIC (the CREATE FUNCTION default) other than the allowlist',
         not exists (select 1 from fn where prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
                       and exists (select 1 from aclexplode(coalesce(proacl, acldefault('f', proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
                       and not (nspname = 'public' and proname = 'get_public_queue_display')),
         coalesce((select string_agg(nspname || '.' || proname, ', ') from fn where prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
                   and exists (select 1 from aclexplode(coalesce(proacl, acldefault('f', proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
                   and not (nspname = 'public' and proname = 'get_public_queue_display')), 'none')
  union all
  -- Informational: RLS is then the ONLY barrier. Candidates for a later DML-hygiene migration (decision D-R4).
  select 'INFO anon holds INSERT / UPDATE / DELETE with no policy that applies to anon (RLS-only barrier): '
         || coalesce((select string_agg(distinct a.relname, ', ') from acl a
                      where a.grantee = 'anon' and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
                        and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = a.relname
                                        and (p.roles && array['anon'::name, 'public'::name]) and p.cmd in ('ALL', a.privilege_type))), 'none'),
         true, 'review'
)
select pass, check_name, detail from checks order by pass, check_name;
