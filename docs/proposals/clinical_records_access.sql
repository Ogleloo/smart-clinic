-- PROPOSAL (revision 2) — NOT APPLIED, NOT A MIGRATION. Kept outside supabase/migrations on purpose.
-- Findings, design and decisions: docs/proposals/clinical_records_access.md.
-- Verified only on a disposable local stack: supabase/tests/clinical_records_access/.
--
-- What it does:
--   A. Treatment-linked read access to consultation_notes / patient_vitals (D1).
--   B. Writes only into the nurse's own ACTIVE consultation, for that consultation's patient (D3).
--   C. Integrity of the treatment link itself: authenticated users can no longer write consultations or
--      queue_entries directly (both were writable, which would let a nurse forge "currently treating").
--      Every legitimate writer is a SECURITY DEFINER function owned by postgres and is unaffected.
--   D. Least-privilege grants on all four tables, including TRUNCATE (D4).
--   E. get_patient_clinical_history(): paginated history query, without broadening the consultations policy.
--   F. Revoke the two legacy RPCs that open/claim consultations outside next_patient().
--
-- Every statement below is a production change the moment it is applied (shared database). Apply only after
-- the read-only production check in supabase/tests/clinical_records_access/assert_catalog.sql, and commit it
-- under supabase/migrations/ in the same change.

begin;

-- ---------------------------------------------------------------------------------------------------------
-- 0. Private schema for policy helpers. Not in the PostgREST/GraphQL exposed schemas, so the helpers cannot be
--    called as RPCs (no oracle). Policies still evaluate them as the caller, hence USAGE + EXECUTE.
-- ---------------------------------------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- The caller, if and only if they are an ACTIVE nurse with a clinic. Identity always comes from auth.uid();
-- no helper takes a nurse id, clinic id or role as a parameter.
create or replace function private.active_nurse()
returns table (profile_id uuid, clinic_id uuid)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.id, p.clinic_id
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and p.role = 'nurse'
    and p.is_active
    and p.clinic_id is not null
  limit 1;
$$;

-- True when the caller is currently treating p_patient_id: they own an open consultation whose queue entry
-- is in progress, for that patient, at the caller's clinic.
create or replace function private.nurse_treats_patient(p_patient_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from private.active_nurse() me
    join public.consultations c on c.nurse_id = me.profile_id
    join public.queue_entries q on q.id = c.queue_entry_id
    where c.ended_at is null
      and q.status = 'in_progress'
      and q.clinic_id = me.clinic_id
      and q.patient_id = p_patient_id
  );
$$;

-- Read rule for one clinical row (D1). Granted when the consultation belongs to the caller's clinic AND either
--   (a) the caller authored the row or conducted the consultation, or
--   (b) the caller is currently treating that consultation's patient (previous records of a current patient).
-- Nothing is granted for merely belonging to the clinic.
create or replace function private.nurse_can_read_clinical(p_consultation_id uuid, p_author_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from private.active_nurse() me
    join public.consultations c on c.id = p_consultation_id
    join public.queue_entries q on q.id = c.queue_entry_id
    where q.clinic_id = me.clinic_id
      and (   p_author_id = me.profile_id
           or c.nurse_id  = me.profile_id
           or private.nurse_treats_patient(q.patient_id))
  );
$$;

-- Write rule (D3): the caller's own consultation, still open, queue entry in progress, caller's clinic, and —
-- when p_patient_id is given — for exactly that patient.
create or replace function private.nurse_owns_active_consultation(p_consultation_id uuid, p_patient_id uuid default null)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from private.active_nurse() me
    join public.consultations c on c.id = p_consultation_id and c.nurse_id = me.profile_id
    join public.queue_entries q on q.id = c.queue_entry_id
    where c.ended_at is null
      and q.status = 'in_progress'
      and q.clinic_id = me.clinic_id
      and (p_patient_id is null or q.patient_id = p_patient_id)
  );
$$;

revoke all on function private.active_nurse() from public, anon;
revoke all on function private.nurse_treats_patient(uuid) from public, anon;
revoke all on function private.nurse_can_read_clinical(uuid, uuid) from public, anon;
revoke all on function private.nurse_owns_active_consultation(uuid, uuid) from public, anon;
grant execute on function private.active_nurse() to authenticated;
grant execute on function private.nurse_treats_patient(uuid) to authenticated;
grant execute on function private.nurse_can_read_clinical(uuid, uuid) to authenticated;
grant execute on function private.nurse_owns_active_consultation(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- A + B. Clinical tables: replace every policy.
-- ---------------------------------------------------------------------------------------------------------
drop policy if exists notes_read   on public.consultation_notes;
drop policy if exists notes_write  on public.consultation_notes;
drop policy if exists notes_update on public.consultation_notes;
drop policy if exists vitals_read   on public.patient_vitals;
drop policy if exists vitals_write  on public.patient_vitals;
drop policy if exists vitals_update on public.patient_vitals;

-- Receptionists, admins, patients and anon: deliberately no policy.
create policy notes_read_treatment_linked on public.consultation_notes
  for select to authenticated using (private.nurse_can_read_clinical(consultation_id, nurse_id));
create policy vitals_read_treatment_linked on public.patient_vitals
  for select to authenticated using (private.nurse_can_read_clinical(consultation_id, nurse_id));

create policy notes_insert_active on public.consultation_notes
  for insert to authenticated
  with check (nurse_id = public.auth_profile_id() and private.nurse_owns_active_consultation(consultation_id));
create policy notes_update_active on public.consultation_notes
  for update to authenticated
  using      (nurse_id = public.auth_profile_id() and private.nurse_owns_active_consultation(consultation_id))
  with check (nurse_id = public.auth_profile_id() and private.nurse_owns_active_consultation(consultation_id));

create policy vitals_insert_active on public.patient_vitals
  for insert to authenticated
  with check (nurse_id = public.auth_profile_id()
              and private.nurse_owns_active_consultation(consultation_id, patient_id));
create policy vitals_update_active on public.patient_vitals
  for update to authenticated
  using      (nurse_id = public.auth_profile_id()
              and private.nurse_owns_active_consultation(consultation_id, patient_id))
  with check (nurse_id = public.auth_profile_id()
              and private.nurse_owns_active_consultation(consultation_id, patient_id));

-- A record never moves between encounters, patients or authors (WITH CHECK cannot see OLD).
create or replace function private.clinical_link_is_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.consultation_id is distinct from old.consultation_id
     or new.nurse_id is distinct from old.nurse_id
     or to_jsonb(new) -> 'patient_id' is distinct from to_jsonb(old) -> 'patient_id' then
    raise exception 'consultation_id, nurse_id and patient_id cannot be changed on a clinical record';
  end if;
  return new;
end;
$$;
revoke all on function private.clinical_link_is_immutable() from public, anon, authenticated;

create trigger consultation_notes_link_immutable before update on public.consultation_notes
  for each row execute function private.clinical_link_is_immutable();
create trigger patient_vitals_link_immutable before update on public.patient_vitals
  for each row execute function private.clinical_link_is_immutable();

-- ---------------------------------------------------------------------------------------------------------
-- C. Integrity of the treatment link. Today a nurse can INSERT/UPDATE any consultation with nurse_id = self
--    (consultations_nurse_write is FOR ALL) and UPDATE any column of any queue entry in their clinic
--    (queue_staff_update + table-level UPDATE). Either would let them claim to be treating any patient:
--    insert a consultation on someone's waiting entry, re-open an old consultation, or change patient_id on
--    the entry they are serving. No deployed app code writes either table directly (all writes go through
--    next_patient / undo / complete / end_shift / skip / check-in / merge / reset, all SECURITY DEFINER,
--    owned by postgres, which bypass RLS and table grants) — see the .md for the list checked.
-- ---------------------------------------------------------------------------------------------------------
drop policy if exists consultations_nurse_write on public.consultations;
create policy consultations_nurse_read_own on public.consultations
  for select to authenticated using (nurse_id = public.auth_profile_id());
-- consultations_staff_read (receptionist/admin, by service clinic) is unchanged.

drop policy if exists queue_staff_update on public.queue_entries;

-- ---------------------------------------------------------------------------------------------------------
-- D. Grants. RLS never governed TRUNCATE, REFERENCES or TRIGGER; anon needs nothing on any of these (the public
--    display reads through get_public_queue_display(), SECURITY DEFINER, and anon never had a SELECT policy).
-- ---------------------------------------------------------------------------------------------------------
revoke all on public.consultation_notes from public, anon, authenticated;
revoke all on public.patient_vitals     from public, anon, authenticated;
revoke all on public.consultations      from public, anon, authenticated;
revoke all on public.queue_entries      from public, anon, authenticated;
grant select, insert, update on public.consultation_notes to authenticated;
grant select, insert, update on public.patient_vitals     to authenticated;
grant select on public.consultations to authenticated;
grant select on public.queue_entries to authenticated;
-- service_role keeps its own grants (admin tooling, local test seeding).

-- ---------------------------------------------------------------------------------------------------------
-- E. History query (D1: every available visit at the patient's current clinic, paginated, no date cutoff).
--    Metadata only; clinical content is then read through the RLS policies above, so there is one rule for
--    clinical rows. Same 42501 for "no such patient" and "not your patient" (not an existence oracle).
--
--    Excluded as administrative / not a clinical encounter:
--      * queue entry skipped or no_show (the patient was not seen; skip_patient() closes such consultations
--        with exclusion_reason patient_skipped / patient_no_show);
--      * exclusion_reason 'demo_reset' (closed by reset_demo_state()).
--    Kept: 'staff_break' (a real encounter whose duration is only excluded from the wait-time average).
--    Undone calls leave no row: undo_next_patient() deletes the consultation.
--
--    Keyset pagination, newest first: pass the last row's (started_at, consultation_id) to get the next page.
--    Page size 1..50 (default 20).
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.get_patient_clinical_history(
  p_patient_id        uuid,
  p_before_started_at timestamptz default null,
  p_before_id         uuid        default null,
  p_page_size         int         default 20
)
returns table (
  consultation_id uuid,
  started_at      timestamptz,
  ended_at        timestamptz,
  service_name    text,
  nurse_name      text,
  is_current      boolean
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  me record;
begin
  select * into me from private.active_nurse();
  if me.profile_id is null or not private.nurse_treats_patient(p_patient_id) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if (p_before_started_at is null) <> (p_before_id is null) then
    raise exception 'Pass both p_before_started_at and p_before_id, or neither' using errcode = '22023';
  end if;
  if p_page_size is null or p_page_size < 1 or p_page_size > 50 then
    raise exception 'p_page_size must be between 1 and 50' using errcode = '22023';
  end if;

  return query
  select c.id, c.started_at, c.ended_at, s.name, n.full_name, (c.ended_at is null and c.nurse_id = me.profile_id)
  from public.consultations c
  join public.queue_entries q on q.id = c.queue_entry_id
  join public.services s on s.id = c.service_id
  join public.profiles n on n.id = c.nurse_id
  where q.patient_id = p_patient_id
    and q.clinic_id = me.clinic_id
    and q.status not in ('skipped', 'no_show')
    and coalesce(c.exclusion_reason, '') not in ('patient_skipped', 'patient_no_show', 'demo_reset')
    and (p_before_started_at is null or (c.started_at, c.id) < (p_before_started_at, p_before_id))
  order by c.started_at desc, c.id desc
  limit p_page_size;
end;
$$;
revoke all on function public.get_patient_clinical_history(uuid, timestamptz, uuid, int) from public, anon;
grant execute on function public.get_patient_clinical_history(uuid, timestamptz, uuid, int) to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- F. One way to open a consultation: next_patient(). Two legacy RPCs are still executable by every
--    authenticated user and are not called by the app (or by any database function):
--      * start_consultation(queue_entry_id): ANY nurse can open a consultation on ANY in-progress entry — no
--        clinic check, no check that they called the patient. That is a second "Begin Consultation" path and a
--        way to manufacture a treatment link.
--      * call_next_patient(): marks an entry in_progress WITHOUT creating a consultation (the pre-next_patient
--        two-step flow), leaving entries that start_consultation can then claim.
--    Revoke EXECUTE (expand/contract: the functions stay, so nothing that might still reference them breaks at
--    definition time; dropping them is a later clean-up).
-- ---------------------------------------------------------------------------------------------------------
revoke all on function public.start_consultation(uuid) from public, anon, authenticated;
revoke all on function public.call_next_patient()      from public, anon, authenticated;

commit;

-- ROLLBACK: see the Rollback section of the .md (re-creates the six clinical policies from 20261002003441,
-- consultations_nurse_write and queue_staff_update from 20260805103110, the previous grants, and drops the
-- private schema objects, the two triggers and get_patient_clinical_history).
