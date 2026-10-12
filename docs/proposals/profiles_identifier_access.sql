-- PROPOSAL (revision 5) — NOT APPLIED, NOT A MIGRATION. Independent of clinical_records_access.sql (either can be
-- approved and applied first). Rationale and test evidence: docs/proposals/clinical_records_access.md §7.
--
-- Stage 1 — keep administrators (and all staff) to their own clinic for patient identity data:
--   1. Drop profiles_select_admin / profiles_update_admin (no clinic scope at all).
--   2. profiles_staff_read_clinic_patients: the "has a queue entry / appointment here" branches apply to PATIENT
--      profiles only. Today a clinic-B nurse who was ever checked in or booked at clinic A as a patient
--      (check_in_patient() accepts any profile) is readable by clinic-A staff — and appears on clinic A's Admin
--      Staff page, whose query has no clinic filter. Staff profiles are visible through clinic_id only.
--   3. find_duplicate_patients(): only pairs this clinic can act on (see "scope" below), not every clinic's
--      patients' names, phones and visit counts.
--   4. search_patients(): receptionist/admin only (no nurse screen uses it); substring search over patients
--      linked to the caller's clinic (incl. shared) and unaffiliated patients. A patient known ONLY to other
--      clinics is never returned — not even on an exact phone match (rev 4: a phone number is not proof of
--      identity). Returning patients from another clinic will be found by identity document once mandatory
--      identification exists (identity_documents_prototype.sql / supervisor_requirements.md).
--   5. merge_patient_profiles(): exceptional and audited. Both profiles must be patients; every record either
--      profile touches (queue entries, appointments, notifications, cancelled_by / priority_set_by audit refs)
--      must belong to the caller's clinic; at least one profile must be linked to it. Each merge writes a row to
--      patient_merge_audit. Rev 4 fixes a rev-3 hole: a patient with history at clinics A AND B was classified
--      'linked' by A, so A could merge it and rewrite B's records.
--
-- Scope of a patient profile for the calling staff member:
--   linked       — known to the caller's clinic (clinic_id, queue entry or appointment there) and to no other
--   shared       — known to the caller's clinic AND to another clinic
--   foreign      — known only to other clinics
--   unaffiliated — known to no clinic (e.g. registered online, never visited)
--
-- Stage 2 (column-level identifier minimisation) is designed in the .md and is NOT in this file.

begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- 'linked' | 'shared' | 'foreign' | 'unaffiliated' | null (no such profile, or caller is not active clinic staff).
-- Boolean-ish classification only; derives the caller's clinic from auth.uid(); returns no profile data.
create or replace function private.patient_scope(p_patient_id uuid)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  with me as (
    select clinic_id from public.profiles
    where auth_user_id = auth.uid() and role in ('receptionist', 'nurse', 'admin') and is_active and clinic_id is not null
    limit 1
  ),
  p as (select id, clinic_id from public.profiles where id = p_patient_id),
  k as (
    select
      (p.clinic_id = me.clinic_id
        or exists (select 1 from public.queue_entries q where q.patient_id = p.id and q.clinic_id = me.clinic_id)
        or exists (select 1 from public.appointments a join public.services s on s.id = a.service_id
                   where a.patient_id = p.id and s.clinic_id = me.clinic_id)) as here,
      ((p.clinic_id is not null and p.clinic_id <> me.clinic_id)
        or exists (select 1 from public.queue_entries q where q.patient_id = p.id and q.clinic_id <> me.clinic_id)
        or exists (select 1 from public.appointments a join public.services s on s.id = a.service_id
                   where a.patient_id = p.id and s.clinic_id <> me.clinic_id)) as elsewhere
    from me, p
  )
  select case when here and elsewhere then 'shared'
              when here then 'linked'
              when elsewhere then 'foreign'
              else 'unaffiliated' end
  from k;
$$;
revoke all on function private.patient_scope(uuid) from public, anon;
grant execute on function private.patient_scope(uuid) to authenticated;

-- 1. Global admin policies.
drop policy if exists profiles_select_admin on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;

-- 2. Staff read: unchanged except that the visit-based branches only reveal PATIENT profiles.
drop policy if exists profiles_staff_read_clinic_patients on public.profiles;
create policy profiles_staff_read_clinic_patients on public.profiles
  for select to authenticated
  using (
    public.auth_role() in ('receptionist', 'nurse', 'admin')
    and (
      profiles.clinic_id = public.auth_clinic_id()
      or (
        profiles.role = 'patient'
        and (
          exists (select 1 from public.queue_entries q
                  where q.patient_id = profiles.id and q.clinic_id = public.auth_clinic_id())
          or exists (select 1 from public.appointments a join public.services s on s.id = a.service_id
                     where a.patient_id = profiles.id and s.clinic_id = public.auth_clinic_id())
        )
      )
    )
  );

-- 3. Duplicates this clinic can resolve: neither side foreign, at least one side linked.
create or replace function public.find_duplicate_patients()
returns table (profile_a uuid, name_a text, phone_a text, has_login_a boolean, history_a bigint,
               profile_b uuid, name_b text, phone_b text, has_login_b boolean, history_b bigint, match_reason text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with pts as (
    select p.id, p.full_name, p.phone, p.auth_user_id is not null as has_login,
           (select count(*) from public.queue_entries q where q.patient_id = p.id)
         + (select count(*) from public.appointments a where a.patient_id = p.id) as history,
           private.patient_scope(p.id) as scope
    from public.profiles p
    where p.role = 'patient'
      and public.auth_role() = 'admin'
  )
  select a.id, a.full_name, a.phone, a.has_login, a.history,
         b.id, b.full_name, b.phone, b.has_login, b.history,
         case when a.phone is not null and a.phone = b.phone
                and lower(a.full_name) = lower(b.full_name) then 'same name and phone'
              when a.phone is not null and a.phone = b.phone then 'same phone'
              else 'same name' end
  from pts a
  join pts b
    on a.id < b.id
   and ( (a.phone is not null and a.phone = b.phone)
      or lower(a.full_name) = lower(b.full_name) )
   and not (a.has_login and b.has_login)
  -- Only pairs this clinic could merge (see merge rules): shared and foreign profiles never qualify.
  where a.scope in ('linked', 'unaffiliated') and b.scope in ('linked', 'unaffiliated')
    and 'linked' in (a.scope, b.scope);
$$;
revoke all on function public.find_duplicate_patients() from public, anon;
grant execute on function public.find_duplicate_patients() to authenticated;

-- 4. Patient search for check-in.
create or replace function public.search_patients(p_query text)
returns table (id uuid, full_name text, phone text, has_account boolean)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  caller_role public.user_role := public.auth_role();
  q text := nullif(trim(p_query), '');
begin
  if caller_role is null or caller_role not in ('receptionist', 'admin') then
    raise exception 'Not authorised';
  end if;
  if q is null or length(q) < 2 then
    return;   -- refuse to dump the patient list on an empty search
  end if;

  return query
  select p.id, p.full_name, p.phone, (p.auth_user_id is not null)
  from public.profiles p
  cross join lateral (select private.patient_scope(p.id) as scope) sc
  where p.role = 'patient'
    and p.is_active
    and sc.scope in ('linked', 'shared', 'unaffiliated')
    and (p.full_name ilike '%' || q || '%' or p.phone ilike '%' || q || '%')
  order by p.full_name
  limit 20;
end;
$$;
revoke all on function public.search_patients(text) from public, anon;
grant execute on function public.search_patients(text) to authenticated;

-- 5. Exceptional merge, audited, with a mandatory justification.
--    The Admin V3 UI is planned WITHOUT routine duplicate detection or merge (supervisor: prevent duplicates at
--    registration). Coordinated replacement (rev 5):
--      * private.merge_patient_profiles_core(...)  — the single implementation (scope checks, rewrite, audit row);
--        not executable by any app role, callable only from the two SECURITY DEFINER wrappers below.
--      * public.merge_patient_profiles_with_reason(keep, merge, reason_code, reason_note) — the replacement: an
--        active admin, a reason code AND a note (10–500 characters) are mandatory.
--      * public.merge_patient_profiles(keep, merge) — UNCHANGED signature for the deployed admin screen until the
--        Admin UI cutover; it records reason_code 'legacy_unspecified' so no audit row is ever without a reason.
--        At the cutover: revoke EXECUTE on the 2-argument function from authenticated (see end of file).
create type public.patient_merge_reason as enum (
  'same_person_document_verified',   -- staff saw the identity document(s) proving both profiles are one person
  'registration_error_verified',     -- a duplicate created in error, confirmed with the patient
  'legacy_unspecified'               -- written only by the legacy 2-argument function
);

create table if not exists public.patient_merge_audit (
  id               uuid primary key default gen_random_uuid(),
  merged_at        timestamptz not null default now(),
  merged_by        uuid not null,                -- staff profile id (no FK: audit rows must outlive profiles)
  clinic_id        uuid not null references public.clinics(id),
  keep_id          uuid not null,                -- no FK: the kept profile may itself be merged later
  merged_id        uuid not null,                -- the deleted profile (no FK: it no longer exists)
  merged_full_name text,                         -- minimal snapshot; no ID number, DOB or phone
  moved            jsonb not null,
  reason_code      public.patient_merge_reason not null,
  reason_note      text check (reason_note is null or length(reason_note) <= 500),
  constraint reasoned_merge_has_note check (reason_code = 'legacy_unspecified' or length(btrim(coalesce(reason_note, ''))) >= 10)
);
alter table public.patient_merge_audit enable row level security;
revoke all on public.patient_merge_audit from public, anon, authenticated;
grant select on public.patient_merge_audit to authenticated;
create policy patient_merge_audit_admin_read on public.patient_merge_audit
  for select to authenticated
  using (public.auth_role() = 'admin' and clinic_id = public.auth_clinic_id());
-- No write policy; rows only from the merge core. Append-only for everyone, including the service role.
create or replace function private.patient_merge_audit_append_only()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'patient_merge_audit is append-only';
end;
$$;
revoke all on function private.patient_merge_audit_append_only() from public, anon, authenticated;
create trigger patient_merge_audit_no_update_delete before update or delete on public.patient_merge_audit
  for each row execute function private.patient_merge_audit_append_only();

create or replace function private.merge_patient_profiles_core(
  p_keep_id uuid, p_merge_id uuid, p_reason_code public.patient_merge_reason, p_reason_note text
)
returns table (queue_entries_moved int, appointments_moved int, notifications_moved int, audit_refs_moved int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me record;
  keep_auth uuid; merge_auth uuid;
  keep_role public.user_role; merge_role public.user_role;
  keep_scope text; merge_scope text;
  me_clinic uuid;
  merged_name text;
  n_q int; n_a int; n_n int; n_x int; n_tmp int;
begin
  -- Active administrator with a clinic (auth_role() alone ignores is_active).
  select p.id, p.clinic_id into me from public.profiles p
  where p.auth_user_id = auth.uid() and p.role = 'admin' and p.is_active and p.clinic_id is not null;
  if me.id is null then
    raise exception 'Only an administrator may merge patient profiles' using errcode = '42501';
  end if;
  if p_keep_id = p_merge_id then
    raise exception 'Cannot merge a profile into itself';
  end if;

  select auth_user_id, role into keep_auth, keep_role from public.profiles where id = p_keep_id for update;
  if not found then raise exception 'Profile not found'; end if;
  select auth_user_id, role into merge_auth, merge_role from public.profiles where id = p_merge_id for update;
  if not found then raise exception 'Profile not found'; end if;

  if keep_role <> 'patient' or merge_role <> 'patient' then
    raise exception 'Only patient profiles can be merged';
  end if;
  me_clinic := me.clinic_id;
  keep_scope := private.patient_scope(p_keep_id);
  merge_scope := private.patient_scope(p_merge_id);
  -- Same message whatever the reason, so this is not a probe for other clinics' patients.
  if me_clinic is null or keep_scope is null or merge_scope is null
     or keep_scope in ('foreign', 'shared') or merge_scope in ('foreign', 'shared')
     or 'linked' not in (keep_scope, merge_scope)
     -- Every row the merge rewrites must belong to this clinic (patient_scope covers patient_id; these cover the
     -- audit references and notifications too).
     or exists (select 1 from public.queue_entries q
                where (q.patient_id in (p_keep_id, p_merge_id) or q.priority_set_by = p_merge_id)
                  and q.clinic_id <> me_clinic)
     or exists (select 1 from public.appointments a join public.services s on s.id = a.service_id
                where (a.patient_id in (p_keep_id, p_merge_id) or a.cancelled_by = p_merge_id)
                  and s.clinic_id <> me_clinic)
     or exists (select 1 from public.notifications n
                left join public.queue_entries q on q.id = n.queue_entry_id
                left join public.appointments a on a.id = n.appointment_id
                left join public.services s on s.id = a.service_id
                where n.recipient_id = p_merge_id
                  and (q.clinic_id <> me_clinic or s.clinic_id <> me_clinic)) then
    raise exception 'These profiles cannot be merged from your clinic';
  end if;

  -- Two real accounts is not a duplicate. A human must decide which is
  -- correct; silently discarding one person's login is not a merge.
  if keep_auth is not null and merge_auth is not null then
    raise exception 'Both profiles have logins — this needs a human decision, not a merge';
  end if;

  update public.queue_entries set patient_id = p_keep_id where patient_id = p_merge_id;
  get diagnostics n_q = row_count;

  update public.appointments set patient_id = p_keep_id where patient_id = p_merge_id;
  get diagnostics n_a = row_count;

  update public.notifications set recipient_id = p_keep_id where recipient_id = p_merge_id;
  get diagnostics n_n = row_count;

  update public.appointments set cancelled_by = p_keep_id where cancelled_by = p_merge_id;
  get diagnostics n_x = row_count;
  update public.queue_entries set priority_set_by = p_keep_id where priority_set_by = p_merge_id;
  get diagnostics n_tmp = row_count;
  n_x := n_x + n_tmp;

  if keep_auth is null and merge_auth is not null then
    update public.profiles set auth_user_id = null  where id = p_merge_id;
    update public.profiles set auth_user_id = merge_auth, updated_at = now()
     where id = p_keep_id;
  end if;

  select full_name into merged_name from public.profiles where id = p_merge_id;
  delete from public.profiles where id = p_merge_id;

  insert into public.patient_merge_audit
    (merged_by, clinic_id, keep_id, merged_id, merged_full_name, moved, reason_code, reason_note)
  values (me.id, me_clinic, p_keep_id, p_merge_id, merged_name,
          jsonb_build_object('queue_entries', n_q, 'appointments', n_a, 'notifications', n_n, 'audit_refs', n_x),
          p_reason_code, p_reason_note);

  queue_entries_moved := n_q;
  appointments_moved  := n_a;
  notifications_moved := n_n;
  audit_refs_moved    := n_x;
  return next;
end;
$$;
revoke all on function private.merge_patient_profiles_core(uuid, uuid, public.patient_merge_reason, text) from public, anon, authenticated;

-- The replacement RPC: mandatory reason code and note.
create or replace function public.merge_patient_profiles_with_reason(
  p_keep_id uuid, p_merge_id uuid, p_reason_code public.patient_merge_reason, p_reason_note text
)
returns table (queue_entries_moved int, appointments_moved int, notifications_moved int, audit_refs_moved int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_reason_code is null or p_reason_code = 'legacy_unspecified' then
    raise exception 'A merge reason is required' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason_note, ''))) not between 10 and 500 then
    raise exception 'Describe the evidence for this merge (10–500 characters)' using errcode = '22023';
  end if;
  return query select * from private.merge_patient_profiles_core(p_keep_id, p_merge_id, p_reason_code, btrim(p_reason_note));
end;
$$;
revoke all on function public.merge_patient_profiles_with_reason(uuid, uuid, public.patient_merge_reason, text) from public, anon;
grant execute on function public.merge_patient_profiles_with_reason(uuid, uuid, public.patient_merge_reason, text) to authenticated;

-- Legacy 2-argument RPC: same core, recorded as 'legacy_unspecified'. Kept only until the Admin UI cutover.
create or replace function public.merge_patient_profiles(p_keep_id uuid, p_merge_id uuid)
returns table (queue_entries_moved int, appointments_moved int, notifications_moved int, audit_refs_moved int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query select * from private.merge_patient_profiles_core(p_keep_id, p_merge_id, 'legacy_unspecified', null);
end;
$$;
revoke all on function public.merge_patient_profiles(uuid, uuid) from public, anon;
grant execute on function public.merge_patient_profiles(uuid, uuid) to authenticated;

-- ADMIN UI CUTOVER (separate, later step — not applied with this file):
--   revoke all on function public.merge_patient_profiles(uuid, uuid) from authenticated;

commit;

-- ROLLBACK: export then drop table patient_merge_audit (audit record), type patient_merge_reason,
-- merge_patient_profiles_with_reason and the private core; re-create profiles_select_admin / profiles_update_admin (20260804164222) and
-- profiles_staff_read_clinic_patients (20260805171242) verbatim; restore find_duplicate_patients,
-- search_patients (20260805171801) and merge_patient_profiles (20260808154202) from their migrations; drop
-- private.patient_scope.
