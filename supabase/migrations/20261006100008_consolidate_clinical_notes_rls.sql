-- Two versions of "consultation_notes_and_vitals" (20261001211949 and
-- 20261002003441) were both applied to this table. Because both used
-- `create table if not exists`, the table structure came from the first
-- one and never changed, but both sets of RLS policies were created and
-- left active, OR'd together (Postgres combines permissive policies with
-- OR). Net effect: SELECT access on consultation_notes/patient_vitals was
-- already the broader (nurse, receptionist, admin at same clinic) read
-- policy, with the narrower nurse-only policy redundant but still present.
--
-- This migration removes the first migration's now-redundant policies,
-- leaving exactly the later, intended policy set (notes_read/write/update,
-- vitals_read/write/update). This does not change effective access —
-- it removes dead, confusing duplication so the policy list on these
-- tables matches what is actually enforced.

drop policy if exists notes_nurse_read on public.consultation_notes;
drop policy if exists notes_nurse_write on public.consultation_notes;
drop policy if exists notes_nurse_update on public.consultation_notes;

drop policy if exists vitals_nurse_read on public.patient_vitals;
drop policy if exists vitals_nurse_write on public.patient_vitals;
drop policy if exists vitals_nurse_update on public.patient_vitals;

notify pgrst, 'reload schema';
