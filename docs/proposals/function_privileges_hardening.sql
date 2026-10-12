-- PROPOSAL — NOT APPLIED, NOT A MIGRATION. F13 / F14 (docs/proposals/clinical_records_access.md §0).
--
-- F13 reset_demo_state(): executable by every authenticated user; refuses non-admins, but ANY admin of ANY clinic
--     can run it, and it resets state in every clinic (closes all open consultations, clears today's waiting /
--     in-progress entries, notifications and nurse actions, puts every nurse off duty). Intended callers: an
--     operator in the SQL editor (ARCHITECTURE.md) and the live Playwright helper e2e/helpers.ts, which signs in
--     as the demo admin. Proposal: service role / SQL editor only.
--     DEPENDENCY: e2e/helpers.ts resetDemoState() would then fail. Those live suites already mutate the shared
--     production database (CLAUDE.md); they should move to the local stack (service role) or be retired. This
--     is a decision, not an oversight — see the .md.
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
