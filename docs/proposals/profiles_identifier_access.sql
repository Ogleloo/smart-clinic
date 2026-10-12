-- PROPOSAL — NOT APPLIED, NOT A MIGRATION. Separate from clinical_records_access.sql so each can be approved
-- on its own. Rationale, regression review and Stage 2 design: docs/proposals/clinical_records_access.md §5.
--
-- Stage 1 (this file): remove the two GLOBAL admin policies on public.profiles.
--
--   profiles_select_admin  using (auth_role() = 'admin')   -> an admin reads every profile in every clinic,
--                                                           including ID number, date of birth and phone.
--   profiles_update_admin  using (auth_role() = 'admin')   -> an admin can rewrite full_name, phone,
--                                                           date_of_birth and id_number of ANY profile in ANY
--                                                           clinic (the column grants allow those four), unaudited.
--
-- After this, an admin reads exactly what reception and nurses of the same clinic read, through the existing
-- profiles_staff_read_clinic_patients (clinic_id match, or a queue entry / appointment at the admin's clinic),
-- plus their own row (profiles_select_own). Staff changes keep going through admin_set_staff_status(), which is
-- SECURITY DEFINER and already clinic-scoped. No app code updates another user's profile directly (checked).
--
-- Stage 2 (identifier minimisation by column) is NOT in this file: it needs app changes in the same release.

begin;

drop policy if exists profiles_select_admin on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;

commit;

-- ROLLBACK (exactly the definitions from 20260804164222_auth_profiles.sql):
--   create policy profiles_select_admin on public.profiles for select to authenticated
--     using (public.auth_role() = 'admin');
--   create policy profiles_update_admin on public.profiles for update to authenticated
--     using (public.auth_role() = 'admin') with check (public.auth_role() = 'admin');
