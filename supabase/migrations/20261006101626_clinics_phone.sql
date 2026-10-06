-- Patient V3's sidebar "Need help?" card shows a clinic contact number.
-- Nullable: not every clinic has one recorded yet, and the UI must tolerate
-- that (omit the line) rather than fabricate a number — no number is shown
-- unless the backend actually has one.

alter table public.clinics
  add column if not exists phone text;

notify pgrst, 'reload schema';
