-- Migration 0054: add date of birth and ID number to patient profiles.
--
-- Clinics need to identify patients reliably. A name alone is ambiguous —
-- South African ID numbers are unique, and date of birth helps with
-- paediatric and maternal services where age determines eligibility.
--
-- Both are nullable: walk-in patients registered by reception may not
-- have their ID book with them, and requiring it would block care.
-- Online registrants are prompted but not forced.
--
-- id_number is stored as text rather than a numeric type because SA
-- ID numbers have leading zeros and a check digit that is meaningful
-- as a string, not as an integer.

alter table public.profiles
  add column if not exists date_of_birth date,
  add column if not exists id_number text;

-- Unique constraint on id_number where provided, scoped to the clinic
-- so two clinics on the same platform cannot collide.
create unique index if not exists profiles_id_number_clinic_unique
  on public.profiles (clinic_id, id_number)
  where id_number is not null;

-- RLS already covers profiles: patients see their own, staff see their
-- clinic's patients. No new policies needed.

notify pgrst, 'reload schema';
