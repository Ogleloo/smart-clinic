-- Migration 0010: Staff may read the patients they are serving
--
-- Gap found in Slice 3 testing: staff could read appointments but not
-- the patient profiles they join to, so "Today's Appointments" would
-- render rows with no names.
--
-- Patients have no clinic_id (that column is for staff), so access is
-- expressed RELATIONALLY, exactly as the M6 review specified: a staff
-- member may read a patient who has an appointment or queue entry in
-- their clinic. Not "all patients".

create policy profiles_staff_read_clinic_patients
  on public.profiles for select to authenticated
  using (
    public.auth_role() in ('receptionist','nurse','admin')
    and (
      exists (
        select 1
        from public.queue_entries q
        where q.patient_id = profiles.id
          and q.clinic_id = public.auth_clinic_id()
      )
      or exists (
        select 1
        from public.appointments a
        join public.services s on s.id = a.service_id
        where a.patient_id = profiles.id
          and s.clinic_id = public.auth_clinic_id()
      )
      -- staff may also see colleagues in their own clinic
      or profiles.clinic_id = public.auth_clinic_id()
    )
  );
