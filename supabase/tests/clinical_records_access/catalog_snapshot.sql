-- READ-ONLY, normalised catalog snapshot used to prove a rollback restores the exact prior state (and, on production,
-- as the pre-deploy record for gate G1). Reads pg_catalog only. Output: one sorted line per fact, no row data, no
-- secrets, no cron command text.
--
--   psql "$DB_URL" -At -F '|' -v ON_ERROR_STOP=1 -f supabase/tests/clinical_records_access/catalog_snapshot.sql
--
-- Scope: schemas public and private — table / column / function / schema privileges, RLS flags, policies, triggers,
-- function bodies (md5) and security attributes. Object *existence* is part of the snapshot, so a rollback that leaves
-- an added object behind shows up as a difference.

begin transaction isolation level repeatable read read only;

select line from (
  -- table privileges (default ACL expanded when relacl is null)
  select format('T|%s|%s|%s|%s', c.relname,
                case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, a.privilege_type, a.is_grantable) as line
  from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  where c.relnamespace in ('public'::regnamespace, to_regnamespace('private')) and c.relkind in ('r', 'p', 'v', 'm', 'S')
  union all
  -- column privileges
  select format('C|%s.%s|%s|%s', c.relname, att.attname,
                case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, a.privilege_type)
  from pg_class c
  join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped and att.attacl is not null
  cross join lateral aclexplode(att.attacl) a
  where c.relnamespace in ('public'::regnamespace, to_regnamespace('private'))
  union all
  -- RLS flags and ownership
  select format('R|%s|rls=%s|force=%s|owner=%s', c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner))
  from pg_class c
  where c.relnamespace in ('public'::regnamespace, to_regnamespace('private')) and c.relkind in ('r', 'p')
  union all
  -- policies
  select format('P|%s|%s|%s|%s|%s|%s|%s', tablename, policyname, cmd, permissive, roles::text,
                regexp_replace(coalesce(qual, ''), '\s+', ' ', 'g'), regexp_replace(coalesce(with_check, ''), '\s+', ' ', 'g'))
  from pg_policies where schemaname in ('public', 'private')
  union all
  -- functions: identity, security attributes, body fingerprint, EXECUTE grantees
  select format('F|%s.%s(%s)|owner=%s|definer=%s|cfg=%s|md5=%s|exec=%s', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
                pg_get_userbyid(p.proowner), p.prosecdef, coalesce(array_to_string(p.proconfig, ';'), ''), md5(p.prosrc),
                coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, ',' order by 1)
                          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.privilege_type = 'EXECUTE'), ''))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
  union all
  -- triggers
  select format('G|%s|%s|%s|%s', c.relname, t.tgname, p.proname, t.tgenabled)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
  where c.relnamespace in ('public'::regnamespace, to_regnamespace('private')) and not t.tgisinternal
  union all
  -- schemas
  select format('S|%s|%s', n.nspname, coalesce(n.nspacl::text, '(default)'))
  from pg_namespace n where n.nspname in ('public', 'private')
  union all
  -- types (enums added by proposals)
  select format('Y|%s.%s', n.nspname, t.typname)
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname in ('public', 'private') and t.typtype = 'e'
) s order by line;

rollback;
