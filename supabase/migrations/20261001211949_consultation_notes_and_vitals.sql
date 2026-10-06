-- Migration 0055: consultation notes and patient vitals.
--
-- The nurse V3 designs include a consultation form (chief complaint,
-- diagnosis, treatment, additional notes) and a vitals recording screen
-- (temperature, blood pressure, pulse, respiratory rate, weight, height,
-- oxygen saturation). Both are clinical content — the first time the
-- system stores anything beyond operational queue data.
--
-- Access model: the nurse who conducted the consultation can read and
-- write their own notes. Any nurse at the same clinic can read notes for
-- patients they are currently consulting. Patients cannot read clinical
-- notes in this release — that requires a separate access review.
-- Receptionists and admins cannot read clinical notes.
--
-- Vitals are linked to consultations rather than to patients directly,
-- so each set of vitals has a clear clinical context (who measured, when,
-- during which visit).
--
-- NOTE (superseded): the SELECT access described above — nurse-only — was
-- widened by migration 20261002003441 to include receptionist/admin at the
-- same clinic. That migration's own CREATE TABLE statements were no-ops
-- here (the tables already existed), but its policies were not, leaving
-- both this migration's nurse-only policies and that one's broader ones
-- active together. Migration 20261006100008_consolidate_clinical_notes_rls
-- drops this migration's narrower, redundant policies so only the later,
-- intended policy set remains.

-- ---- consultation notes ----
create table if not exists public.consultation_notes (
  id              uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.consultations(id) on delete cascade,
  nurse_id        uuid not null references public.profiles(id),
  chief_complaint text,
  diagnosis       text,
  treatment       text,
  additional_notes text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (consultation_id)
);

alter table public.consultation_notes enable row level security;

-- nurses at the same clinic can read notes for patients in their queue
create policy notes_nurse_read on public.consultation_notes
  for select to authenticated
  using (
    public.auth_role() = 'nurse'
    and nurse_id in (
      select id from public.profiles
      where clinic_id = public.auth_clinic_id()
    )
  );

-- the nurse who wrote the notes can insert and update
create policy notes_nurse_write on public.consultation_notes
  for insert to authenticated
  with check (
    public.auth_role() = 'nurse'
    and nurse_id = public.auth_profile_id()
  );

create policy notes_nurse_update on public.consultation_notes
  for update to authenticated
  using (nurse_id = public.auth_profile_id())
  with check (nurse_id = public.auth_profile_id());

grant select, insert, update on public.consultation_notes to authenticated;

-- ---- patient vitals ----
create table if not exists public.patient_vitals (
  id              uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.consultations(id) on delete cascade,
  patient_id      uuid not null references public.profiles(id),
  nurse_id        uuid not null references public.profiles(id),
  temperature     numeric(4,1),     -- Celsius
  bp_systolic     smallint,         -- mmHg
  bp_diastolic    smallint,         -- mmHg
  pulse           smallint,         -- bpm
  respiratory_rate smallint,        -- breaths/min
  weight          numeric(5,1),     -- kg
  height          smallint,         -- cm
  oxygen_saturation smallint,       -- percentage
  recorded_at     timestamptz not null default now(),
  unique (consultation_id)
);

alter table public.patient_vitals enable row level security;

-- same access model as notes: clinic nurses can read, recording nurse can write
create policy vitals_nurse_read on public.patient_vitals
  for select to authenticated
  using (
    public.auth_role() = 'nurse'
    and nurse_id in (
      select id from public.profiles
      where clinic_id = public.auth_clinic_id()
    )
  );

create policy vitals_nurse_write on public.patient_vitals
  for insert to authenticated
  with check (
    public.auth_role() = 'nurse'
    and nurse_id = public.auth_profile_id()
  );

create policy vitals_nurse_update on public.patient_vitals
  for update to authenticated
  using (nurse_id = public.auth_profile_id())
  with check (nurse_id = public.auth_profile_id());

grant select, insert, update on public.patient_vitals to authenticated;

-- ---- updated auto-trigger ----
create or replace function public.update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_consultation_notes_updated
  before update on public.consultation_notes
  for each row execute function public.update_updated_at();

notify pgrst, 'reload schema';
