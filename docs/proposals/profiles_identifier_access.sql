-- PROPOSAL (revision 2) — NOT APPLIED, NOT A MIGRATION. Independent of clinical_records_access.sql (either can be
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
--   4. search_patients(): receptionist/admin only (no nurse screen uses it); substring search within scope;
--      a patient known only to OTHER clinics is returned only on an exact phone-number match (identity
--      verification for a returning patient), never by partial name.
--   5. merge_patient_profiles(): both profiles must be patients, neither may have history at another clinic,
--      and at least one must belong to the caller's clinic. Today any admin can merge any two profiles in any
--      clinic — including a staff profile — moving other clinics' records and deleting a profile.
--
-- Scope of a patient profile for the calling staff member:
--   linked       — profile.clinic_id is the caller's clinic, or it has a queue entry / appointment there
--   foreign      — it has a clinic_id, queue entry or appointment at ANOTHER clinic (and is not linked)
--   unaffiliated — neither (e.g. registered online, never visited anywhere)
--
-- Stage 2 (column-level identifier minimisation) is designed in the .md and is NOT in this file.

begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- 'linked' | 'foreign' | 'unaffiliated' | null (no such profile, or caller is not clinic staff with a clinic).
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
  p as (select id, clinic_id from public.profiles where id = p_patient_id)
  select case
           when p.clinic_id = me.clinic_id
             or exists (select 1 from public.queue_entries q where q.patient_id = p.id and q.clinic_id = me.clinic_id)
             or exists (select 1 from public.appointments a join public.services s on s.id = a.service_id
                        where a.patient_id = p.id and s.clinic_id = me.clinic_id)
             then 'linked'
           when p.clinic_id is not null
             or exists (select 1 from public.queue_entries q where q.patient_id = p.id)
             or exists (select 1 from public.appointments a where a.patient_id = p.id)
             then 'foreign'
           else 'unaffiliated'
         end
  from me, p;
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
  q_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
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
    and (
      (sc.scope in ('linked', 'unaffiliated')
        and (p.full_name ilike '%' || q || '%' or p.phone ilike '%' || q || '%'))
      or (sc.scope = 'foreign' and length(q_digits) >= 9
        and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = q_digits)
    )
  order by p.full_name
  limit 20;
end;
$$;
revoke all on function public.search_patients(text) from public, anon;
grant execute on function public.search_patients(text) to authenticated;

-- 5. Merge: the deployed body (20260808154202) with the scope checks added after the role check.
create or replace function public.merge_patient_profiles(p_keep_id uuid, p_merge_id uuid)
returns table (queue_entries_moved int, appointments_moved int, notifications_moved int, audit_refs_moved int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  keep_auth uuid; merge_auth uuid;
  keep_role public.user_role; merge_role public.user_role;
  keep_scope text; merge_scope text;
  n_q int; n_a int; n_n int; n_x int; n_tmp int;
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Only an administrator may merge patient profiles';
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
  keep_scope := private.patient_scope(p_keep_id);
  merge_scope := private.patient_scope(p_merge_id);
  if keep_scope is null or merge_scope is null
     or 'foreign' in (keep_scope, merge_scope)
     or 'linked' not in (keep_scope, merge_scope) then
    -- Same message whatever the reason, so this is not a probe for other clinics' patients.
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

  delete from public.profiles where id = p_merge_id;

  queue_entries_moved := n_q;
  appointments_moved  := n_a;
  notifications_moved := n_n;
  audit_refs_moved    := n_x;
  return next;
end;
$$;
revoke all on function public.merge_patient_profiles(uuid, uuid) from public, anon;
grant execute on function public.merge_patient_profiles(uuid, uuid) to authenticated;

commit;

-- ROLLBACK: re-create profiles_select_admin / profiles_update_admin (20260804164222) and
-- profiles_staff_read_clinic_patients (20260805171242) verbatim; restore find_duplicate_patients,
-- search_patients (20260805171801) and merge_patient_profiles (20260808154202) from their migrations; drop
-- private.patient_scope.
