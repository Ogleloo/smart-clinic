-- PROPOSAL (M1b) — NOT APPLIED, NOT A MIGRATION. Kept outside supabase/migrations on purpose.
-- Plan: docs/proposals/staged_migration_plan.md (stage S1, finding R1). Decision D-R1 (PR #36 review).
--
-- What it does: removes the privileges that RLS never governs from anon, authenticated and PUBLIC on the 10 public
-- tables that the other proposals do not touch:
--   appointments, clinic_hours, clinic_settings, clinics, notifications, nurse_actions, profiles, queue_events,
--   services, staff_invitations
-- Revoked:  TRUNCATE, REFERENCES, TRIGGER   (D-R1)
--           MAINTAIN                        (PostgreSQL 17+; Part B — NOT in D-R1's list, see below)
-- Preserved: every SELECT / INSERT / UPDATE / DELETE privilege (table-level and column-level, e.g. the profiles
--           column UPDATE grants), every privilege of service_role / postgres, RLS, policies, functions.
--
-- Why these: TRUNCATE ignores RLS entirely; TRIGGER lets a role create triggers on the table (PostgreSQL requires only
-- the TRIGGER privilege plus EXECUTE on the function); REFERENCES lets a role create foreign keys that probe or block
-- the table; MAINTAIN (PG17) allows VACUUM/ANALYZE/CLUSTER/REINDEX/LOCK. Not reachable through PostgREST or pg_graphql
-- today (no SQL execution for these roles) — this is least-privilege / defence in depth (staged plan R2).
--
-- Part B (MAINTAIN) is an ADDITION beyond the three privileges named in D-R1. It is included because information_schema
-- does not list MAINTAIN, so the earlier inventory could not show it, and because clinical_records_access.sql
-- (`revoke all` on 4 tables) already removes it there. Delete Part B if it is not approved; the tests and the catalog
-- check treat it separately.
--
-- Side effects: none for deployed code (no client uses these privileges). Existing foreign keys and triggers keep
-- working: FK/trigger enforcement does not require the invoking role to hold REFERENCES/TRIGGER — only creating them does.
--
-- Self-checking: the transaction aborts (and nothing is applied) if a table is missing, if any DML privilege changed,
-- or if any excess privilege remains afterwards.
--
-- Rollback: docs/proposals/rollback/grant_hygiene_m1b_rollback.sql — complete, and cycle-tested locally
-- (apply -> rollback -> catalog snapshot identical to the original -> re-apply).

begin;

-- 0. Preconditions and a snapshot of everything that must NOT change.
do $$
declare t text;
begin
  foreach t in array array['appointments', 'clinic_hours', 'clinic_settings', 'clinics', 'notifications',
                           'nurse_actions', 'profiles', 'queue_events', 'services', 'staff_invitations']
  loop
    if to_regclass('public.' || t) is null then
      raise exception 'M1b precondition failed: public.% does not exist', t;
    end if;
  end loop;
end $$;

create temp table m1b_tables(name text primary key) on commit drop;
insert into m1b_tables values ('appointments'), ('clinic_hours'), ('clinic_settings'), ('clinics'), ('notifications'),
  ('nurse_actions'), ('profiles'), ('queue_events'), ('services'), ('staff_invitations');

create temp table m1b_dml_before on commit drop as
select c.relname, case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee, a.privilege_type
from m1b_tables t
join pg_class c on c.oid = to_regclass('public.' || t.name)
cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
where a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

create temp table m1b_svc_before on commit drop as
select c.relname, a.privilege_type
from m1b_tables t
join pg_class c on c.oid = to_regclass('public.' || t.name)
cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
where pg_get_userbyid(a.grantee) = 'service_role';

create temp table m1b_col_before on commit drop as
select c.relname, att.attname, case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee, a.privilege_type
from m1b_tables t
join pg_class c on c.oid = to_regclass('public.' || t.name)
join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped and att.attacl is not null
cross join lateral aclexplode(att.attacl) a
where a.privilege_type in ('SELECT', 'INSERT', 'UPDATE');

-- Part A — D-R1: TRUNCATE, REFERENCES, TRIGGER.
revoke truncate, references, trigger on table
  public.appointments, public.clinic_hours, public.clinic_settings, public.clinics, public.notifications,
  public.nurse_actions, public.profiles, public.queue_events, public.services, public.staff_invitations
from anon, authenticated, public;

-- Part B — MAINTAIN (PostgreSQL 17+ only; a no-op on older servers).
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on table public.appointments, public.clinic_hours, public.clinic_settings, public.clinics,
             public.notifications, public.nurse_actions, public.profiles, public.queue_events, public.services,
             public.staff_invitations from anon, authenticated, public';
  end if;
end $$;

-- 1. Post-conditions (any failure aborts the whole migration).
do $$
declare
  n int;
begin
  -- no excess privilege left for the three app-facing grantees
  select count(*) into n
  from m1b_tables t
  join pg_class c on c.oid = to_regclass('public.' || t.name)
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  where (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
    and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN');
  if n <> 0 then raise exception 'M1b post-check failed: % excess privilege(s) remain', n; end if;

  -- no column-level REFERENCES left either
  select count(*) into n
  from m1b_tables t
  join pg_class c on c.oid = to_regclass('public.' || t.name)
  join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and att.attacl is not null
  cross join lateral aclexplode(att.attacl) a
  where a.privilege_type = 'REFERENCES' and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'));
  if n <> 0 then raise exception 'M1b post-check failed: % column REFERENCES grant(s) remain', n; end if;

  -- DML privileges unchanged (set equality, both directions)
  select count(*) into n from (
    (select * from m1b_dml_before except
       select c.relname, case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, a.privilege_type
       from m1b_tables t join pg_class c on c.oid = to_regclass('public.' || t.name)
       cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
    union all
    (select c.relname, case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, a.privilege_type
       from m1b_tables t join pg_class c on c.oid = to_regclass('public.' || t.name)
       cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
       except select * from m1b_dml_before)
  ) d;
  if n <> 0 then raise exception 'M1b post-check failed: % DML privilege(s) changed', n; end if;

  -- column-level grants unchanged (profiles keeps its column UPDATE grants for authenticated)
  select count(*) into n from (
    (select * from m1b_col_before except
       select c.relname, att.attname, case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, a.privilege_type
       from m1b_tables t join pg_class c on c.oid = to_regclass('public.' || t.name)
       join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped and att.attacl is not null
       cross join lateral aclexplode(att.attacl) a where a.privilege_type in ('SELECT', 'INSERT', 'UPDATE'))
  ) d;
  if n <> 0 then raise exception 'M1b post-check failed: % column privilege(s) lost', n; end if;

  -- service_role keeps everything it had
  select count(*) into n from (
    select * from m1b_svc_before except
    select c.relname, a.privilege_type
      from m1b_tables t join pg_class c on c.oid = to_regclass('public.' || t.name)
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where pg_get_userbyid(a.grantee) = 'service_role'
  ) d;
  if n <> 0 then raise exception 'M1b post-check failed: service_role lost % privilege(s)', n; end if;
end $$;

commit;
