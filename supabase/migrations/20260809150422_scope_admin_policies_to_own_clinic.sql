-- Migration 0038: scope admin authority to the admin's OWN clinic.
--
-- Found while fixing an unrelated .single() bug. Every admin policy on
-- clinic_settings, clinics and services tested only `auth_role() =
-- 'admin'`, with no clinic predicate. An administrator at clinic A could
-- therefore read AND WRITE clinic B's services, settings and details.
--
-- This was invisible because the database contains exactly one clinic —
-- the defect is masked by data, not prevented by code. The schema carries
-- clinic_id throughout and the architecture claims per-clinic isolation,
-- so this is a gap between what the system says it does and what it
-- enforces.
--
-- "admin" is a role WITHIN a clinic, not a global superuser. Cross-clinic
-- administration would be a separate, deliberate capability.

-- ---------- clinic_settings ----------
drop policy if exists settings_read on public.clinic_settings;
create policy settings_read on public.clinic_settings
  for select to authenticated
  using (clinic_id = public.auth_clinic_id());

drop policy if exists settings_admin_write on public.clinic_settings;
create policy settings_admin_write on public.clinic_settings
  for all to authenticated
  using      (public.auth_role() = 'admin' and clinic_id = public.auth_clinic_id())
  with check (public.auth_role() = 'admin' and clinic_id = public.auth_clinic_id());

-- ---------- clinics ----------
-- Read stays open: patients need clinic name and timezone, and hold no
-- clinic_id themselves (ADR-021). Nothing sensitive lives here.
drop policy if exists clinics_admin_write on public.clinics;
create policy clinics_admin_write on public.clinics
  for all to authenticated
  using      (public.auth_role() = 'admin' and id = public.auth_clinic_id())
  with check (public.auth_role() = 'admin' and id = public.auth_clinic_id());

-- ---------- services ----------
-- Read stays open: any authenticated user must be able to browse services
-- to book. Writes are now clinic-scoped.
drop policy if exists services_admin_write on public.services;
create policy services_admin_write on public.services
  for all to authenticated
  using      (public.auth_role() = 'admin' and clinic_id = public.auth_clinic_id())
  with check (public.auth_role() = 'admin' and clinic_id = public.auth_clinic_id());

notify pgrst, 'reload schema';
