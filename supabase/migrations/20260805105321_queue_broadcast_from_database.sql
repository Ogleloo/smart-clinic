-- Broadcast-from-Database for live queue updates (ADR-009 follow-up).
--
-- Patients can only SELECT their own queue_entries row (queue_select_own),
-- so plain postgres_changes never fires for another patient's check-in --
-- Realtime enforces RLS per subscriber. This trigger instead sends a
-- content-free "this service's queue changed" ping on a per-service topic.
-- The payload carries only service_id, never patient_id/token/name, so it
-- is safe for any authenticated user to receive regardless of whether they
-- could SELECT the underlying row. Clients that receive the ping re-derive
-- their own position/estimate via get_wait_estimate(), which is itself
-- RLS-scoped to the caller.

create or replace function public.notify_queue_change()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
declare
  v_service_id uuid := coalesce(new.service_id, old.service_id);
begin
  perform realtime.send(
    jsonb_build_object('service_id', v_service_id),
    'queue_changed',
    'queue-service:' || v_service_id::text,
    true
  );
  return coalesce(new, old);
end;
$$;

create trigger queue_entries_notify_change
after insert or update or delete on public.queue_entries
for each row
execute function public.notify_queue_change();

create policy "authenticated_can_receive_queue_broadcasts"
on realtime.messages
for select
to authenticated
using (true);

