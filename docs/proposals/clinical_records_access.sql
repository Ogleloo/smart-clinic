-- PROPOSAL — NOT APPLIED, NOT A MIGRATION. For review (Nurse V3 Phase 3 security gate).
-- See docs/proposals/clinical_records_access.md for the findings this answers and the decisions needed.
--
-- Scope: consultation_notes and patient_vitals only. Additive in effect for the one flow that exists today
-- (nobody writes these tables from the app yet), but it TIGHTENS policies and REVOKES grants on a shared
-- production database, so it must be approved and applied deliberately, then committed under
-- supabase/migrations/ in the same change.

begin;

-- 1. Boolean-only helpers. SECURITY DEFINER so they can look through consultations/queue_entries (which a nurse
--    cannot read for other nurses' visits) without exposing those rows; they answer yes/no and nothing else.

-- True when the caller is a nurse of the clinic that owns the consultation.
create or replace function public.nurse_can_read_clinical(p_consultation_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.auth_role() = 'nurse'
     and exists (
       select 1
       from public.consultations c
       join public.queue_entries q on q.id = c.queue_entry_id
       where c.id = p_consultation_id
         and q.clinic_id = public.auth_clinic_id()
     );
$$;

-- True when the consultation is the caller's own and (when p_patient_id is given) is for that patient.
create or replace function public.nurse_owns_consultation(p_consultation_id uuid, p_patient_id uuid default null)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.auth_role() = 'nurse'
     and exists (
       select 1
       from public.consultations c
       join public.queue_entries q on q.id = c.queue_entry_id
       where c.id = p_consultation_id
         and c.nurse_id = public.auth_profile_id()
         and q.clinic_id = public.auth_clinic_id()
         and (p_patient_id is null or q.patient_id = p_patient_id)
     );
$$;

revoke all on function public.nurse_can_read_clinical(uuid) from public, anon;
revoke all on function public.nurse_owns_consultation(uuid, uuid) from public, anon;
grant execute on function public.nurse_can_read_clinical(uuid) to authenticated;
grant execute on function public.nurse_owns_consultation(uuid, uuid) to authenticated;

-- 2. Replace every policy on the two tables.
drop policy if exists notes_read   on public.consultation_notes;
drop policy if exists notes_write  on public.consultation_notes;
drop policy if exists notes_update on public.consultation_notes;
drop policy if exists vitals_read   on public.patient_vitals;
drop policy if exists vitals_write  on public.patient_vitals;
drop policy if exists vitals_update on public.patient_vitals;

-- Read: nurses of the clinic that owns the consultation (continuity of care — DECISION D1 in the .md; replace
-- the predicate with `nurse_owns_consultation(consultation_id)` for author-only). Receptionists, admins,
-- patients and anon get nothing: there is deliberately no policy for them.
create policy notes_read_nurse on public.consultation_notes
  for select to authenticated using (public.nurse_can_read_clinical(consultation_id));
create policy vitals_read_nurse on public.patient_vitals
  for select to authenticated using (public.nurse_can_read_clinical(consultation_id));

-- Write: only the nurse who owns the consultation, authoring as themselves; vitals must be for the
-- consultation's own patient.
create policy notes_insert_own on public.consultation_notes
  for insert to authenticated
  with check (nurse_id = public.auth_profile_id() and public.nurse_owns_consultation(consultation_id));
create policy notes_update_own on public.consultation_notes
  for update to authenticated
  using (nurse_id = public.auth_profile_id() and public.nurse_owns_consultation(consultation_id))
  with check (nurse_id = public.auth_profile_id() and public.nurse_owns_consultation(consultation_id));

create policy vitals_insert_own on public.patient_vitals
  for insert to authenticated
  with check (nurse_id = public.auth_profile_id() and public.nurse_owns_consultation(consultation_id, patient_id));
create policy vitals_update_own on public.patient_vitals
  for update to authenticated
  using (nurse_id = public.auth_profile_id() and public.nurse_owns_consultation(consultation_id, patient_id))
  with check (nurse_id = public.auth_profile_id() and public.nurse_owns_consultation(consultation_id, patient_id));

-- 3. A record never moves between visits, patients or authors. (RLS WITH CHECK alone cannot see OLD.)
create or replace function public.clinical_row_is_immutable_link()
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
revoke all on function public.clinical_row_is_immutable_link() from public, anon, authenticated;

create trigger consultation_notes_immutable_link before update on public.consultation_notes
  for each row execute function public.clinical_row_is_immutable_link();
create trigger patient_vitals_immutable_link before update on public.patient_vitals
  for each row execute function public.clinical_row_is_immutable_link();

-- 4. Grants. RLS never governed TRUNCATE (or REFERENCES/TRIGGER), and anon should hold nothing here.
revoke all on public.consultation_notes from public, anon, authenticated;
revoke all on public.patient_vitals     from public, anon, authenticated;
grant select, insert, update on public.consultation_notes to authenticated;
grant select, insert, update on public.patient_vitals     to authenticated;
-- service_role keeps its own privileges (reset_demo_state and admin tooling run as owner / service_role).

commit;

-- ROLLBACK (the policies and grants in force before this proposal): re-create notes_read / vitals_read /
-- notes_write / notes_update / vitals_write / vitals_update exactly as in 20261002003441, drop the two triggers
-- and three functions above, and re-grant the previous privileges. Kept in the .md.
