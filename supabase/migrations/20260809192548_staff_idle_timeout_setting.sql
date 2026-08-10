alter table public.clinic_settings
  add column staff_idle_timeout_minutes integer not null default 30;

comment on column public.clinic_settings.staff_idle_timeout_minutes is
  'Minutes of inactivity before a staff session (receptionist/nurse/admin) is signed out client-side. Patients are never subject to this. Not currently exposed in the admin settings UI (same as undo_window_seconds).';
