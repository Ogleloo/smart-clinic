-- Migration 0007: Scope Realtime broadcast subscriptions
--
-- The previous policy was `using (true)`: any signed-in user could
-- subscribe to any service's queue channel, including other clinics'.
-- The payload carries only a service_id (no PII), so this was activity
-- metadata leakage rather than a data breach — but it is still wrong.
--
-- Correct rule:
--   staff    -> may subscribe to services in THEIR clinic
--   patient  -> may subscribe to a service they have an entry in today
--
-- Note: patients have no clinic_id (that column is for staff), so a
-- clinic-only policy would have locked patients out of their own queue.

create or replace function public.can_subscribe_queue_topic(p_topic text)
returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_service uuid;
  v_role    public.user_role;
begin
  -- Reject anything that isn't a well-formed queue topic. Doing this
  -- first avoids a cast error on arbitrary topic strings.
  if p_topic is null
     or p_topic !~ '^queue-service:[0-9a-fA-F-]{36}$' then
    return false;
  end if;

  v_service := substring(p_topic from 15)::uuid;
  v_role := public.auth_role();
  if v_role is null then return false; end if;

  -- Staff: the service must belong to their clinic.
  if v_role in ('receptionist','nurse','admin') then
    return exists (
      select 1 from public.services s
      where s.id = v_service
        and s.clinic_id = public.auth_clinic_id()
    );
  end if;

  -- Patient: only a service they are actually queued in today.
  return exists (
    select 1 from public.queue_entries q
    where q.service_id = v_service
      and q.patient_id = public.auth_profile_id()
      and q.queue_date = current_date
  );
end;
$$;

revoke execute on function public.can_subscribe_queue_topic(text) from public, anon;
grant execute on function public.can_subscribe_queue_topic(text) to authenticated;

drop policy if exists authenticated_can_receive_queue_broadcasts on realtime.messages;

create policy queue_broadcast_scoped
  on realtime.messages
  for select
  to authenticated
  using (public.can_subscribe_queue_topic(topic));
