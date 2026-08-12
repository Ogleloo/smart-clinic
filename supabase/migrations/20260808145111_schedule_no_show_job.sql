-- Migration 0020: run the BR-5 no-show rule on a schedule.
--
-- pg_cron runs inside Postgres, so there is no external service to keep
-- alive and nothing to deploy — the rule cannot silently stop working
-- because a serverless function was never invoked. Every 5 minutes is
-- well under the smallest sensible grace period (10 min here), so an
-- appointment is never left overdue for long.
--
-- The function is idempotent, so a missed run costs nothing: the next
-- run catches up, and it can also be invoked manually to repair state.

create extension if not exists pg_cron with schema cron;

select cron.schedule(
  'mark-overdue-no-shows',
  '*/5 * * * *',
  $$select public.mark_overdue_no_shows();$$
);
