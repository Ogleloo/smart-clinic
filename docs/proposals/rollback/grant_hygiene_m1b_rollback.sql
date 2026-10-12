-- ROLLBACK for docs/proposals/grant_hygiene_m1b.sql — complete recovery script. NOT APPLIED.
-- Restores the privileges M1b revokes to exactly the state recorded in the local baseline replay AND in the reported
-- production inventory: anon and authenticated each held TRUNCATE, REFERENCES, TRIGGER (and MAINTAIN on PG17) on the
-- 10 tables; PUBLIC held none (so none is granted back).
--
-- REQUIREMENT (staged plan §6): before a production apply, the pre-deploy ACL snapshot taken with
-- supabase/tests/clinical_records_access/catalog_snapshot.sql must be compared with the state this script restores
-- (gate G1). If production differs, regenerate this script from that snapshot and re-run the cycle test.
--
-- Cycle test (local, mandatory): supabase/tests/clinical_records_access/rollback_cycle.mjs
--   snapshot -> apply M1b -> snapshot (must differ) -> this script -> snapshot (must equal the first) -> re-apply.
--
-- Note: restoring these grants re-opens the least-privilege gap. A forward fix is preferred unless a legitimate path
-- is broken (nothing in the deployed application uses these privileges).

begin;

grant truncate, references, trigger on table
  public.appointments, public.clinic_hours, public.clinic_settings, public.clinics, public.notifications,
  public.nurse_actions, public.profiles, public.queue_events, public.services, public.staff_invitations
to anon, authenticated;

do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'grant maintain on table public.appointments, public.clinic_hours, public.clinic_settings, public.clinics,
             public.notifications, public.nurse_actions, public.profiles, public.queue_events, public.services,
             public.staff_invitations to anon, authenticated';
  end if;
end $$;

commit;
