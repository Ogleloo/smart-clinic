-- PROPOSAL — NOT APPLIED, NOT A MIGRATION. F13 / F14 (docs/proposals/clinical_records_access.md §0).
--
-- F13 reset_demo_state(): executable by every authenticated user; refuses non-admins, but ANY admin of ANY clinic
--     can run it, and it resets state in every clinic (closes all open consultations, clears today's waiting /
--     in-progress entries, notifications and nurse actions, puts every nurse off duty).
--     DECIDED (D-F13): destructive tests move to isolated infrastructure (staged plan stage S1-T). Nobody runs this
--     function on the shared/production database — not an admin, not a test, not from the SQL editor. This file only
--     removes the app roles' EXECUTE; service_role keeps it so local fixtures and disposable stacks can use it.
--     A later step (S5b, decision D-F13b) proposes dropping the function from production entirely.
--     DEPENDENCY: e2e/helpers.ts resetDemoState() calls it as the demo admin; apply this only after S1-T is merged.
--
-- F14 send_appointment_reminders(): executable by every authenticated user with no role check (anyone signed in
--     can trigger reminder notifications to every patient with an upcoming booking, in every clinic). Intended
--     caller: the pg_cron job 'send-appointment-reminders', which runs as the job owner (postgres) and does not
--     need the authenticated grant.

begin;

revoke all on function public.reset_demo_state() from public, anon, authenticated;
grant execute on function public.reset_demo_state() to service_role;

revoke all on function public.send_appointment_reminders() from public, anon, authenticated;
grant execute on function public.send_appointment_reminders() to service_role;

commit;

-- ROLLBACK: grant execute on function public.reset_demo_state(), public.send_appointment_reminders() to authenticated;
