-- Migration 0055 (second pass): consultation notes and patient vitals.
--
-- These are clinical records. The access model is deliberately narrow:
-- only nurses may write them, and only staff at the same clinic may read
-- them. Patients cannot see their own clinical notes in this release —
-- that decision requires a POPIA review of health data as special
-- personal information (sections 26-33), which has not been done.
--
-- Vitals are stored per consultation rather than per patient, because a
-- patient's vitals change between visits. A "previous vitals" view is a
-- query across consultations for the same patient, not a separate table.
--
-- NOTE: this migration's CREATE TABLE statements were no-ops against the
-- live database — both tables already existed from migration
-- 20261001211949, under its original column names (temperature, bp_systolic,
-- bp_diastolic, pulse, weight, height, oxygen_saturation), not the renamed
-- columns this migration's text describes (temperature_c, blood_pressure,
-- pulse_bpm, weight_kg, height_cm, oxygen_sat). Those renames never
-- happened. Its policies, however, were new names and did apply, so both
-- migrations' policies coexisted until migration
-- 20261006100008_consolidate_clinical_notes_rls removed the earlier,
-- redundant ones. The SQL below is verbatim what ran; only this NOTE and
-- the "(second pass)" in the header were added afterwards.

-- ---- consultation notes ----
create table if not exists public.consultation_notes (
  id               uuid primary key default gen_random_uuid(),
  consultation_id  uuid not null references public.consultations(id) on delete cascade,
  nurse_id         uuid not null references public.profiles(id),
  chief_complaint  text,
  diagnosis        text,
  treatment        text,
  additional_notes text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint one_note_per_consultation unique (consultation_id)
);

alter table public.consultation_notes enable row level security;

-- only staff at the same clinic can read
drop policy if exists notes_read on public.consultation_notes;
create policy notes_read on public.consultation_notes
  for select to authenticated
  using (
    public.auth_role() in ('nurse','receptionist','admin')
    and public.auth_clinic_id() = (
      select p.clinic_id from public.profiles p where p.id = nurse_id
    )
  );

-- only nurses can write, and only their own notes
drop policy if exists notes_write on public.consultation_notes;
create policy notes_write on public.consultation_notes
  for insert to authenticated
  with check (
    public.auth_role() = 'nurse'
    and nurse_id = public.auth_profile_id()
  );

drop policy if exists notes_update on public.consultation_notes;
create policy notes_update on public.consultation_notes
  for update to authenticated
  using (
    public.auth_role() = 'nurse'
    and nurse_id = public.auth_profile_id()
  );

grant select, insert, update on public.consultation_notes to authenticated;

-- ---- patient vitals ----
create table if not exists public.patient_vitals (
  id               uuid primary key default gen_random_uuid(),
  consultation_id  uuid not null references public.consultations(id) on delete cascade,
  patient_id       uuid not null references public.profiles(id),
  nurse_id         uuid not null references public.profiles(id),
  temperature_c    numeric(4,1),
  blood_pressure   text,          -- "120/80" format, validated in app
  pulse_bpm        smallint,
  respiratory_rate smallint,
  weight_kg        numeric(5,1),
  height_cm        numeric(5,1),
  oxygen_sat       smallint,
  recorded_at      timestamptz not null default now(),
  constraint one_vitals_per_consultation unique (consultation_id)
);

alter table public.patient_vitals enable row level security;

-- same access model as notes: clinic staff only
drop policy if exists vitals_read on public.patient_vitals;
create policy vitals_read on public.patient_vitals
  for select to authenticated
  using (
    public.auth_role() in ('nurse','receptionist','admin')
    and public.auth_clinic_id() = (
      select p.clinic_id from public.profiles p where p.id = nurse_id
    )
  );

drop policy if exists vitals_write on public.patient_vitals;
create policy vitals_write on public.patient_vitals
  for insert to authenticated
  with check (
    public.auth_role() = 'nurse'
    and nurse_id = public.auth_profile_id()
  );

drop policy if exists vitals_update on public.patient_vitals;
create policy vitals_update on public.patient_vitals
  for update to authenticated
  using (
    public.auth_role() = 'nurse'
    and nurse_id = public.auth_profile_id()
  );

grant select, insert, update on public.patient_vitals to authenticated;

notify pgrst, 'reload schema';
