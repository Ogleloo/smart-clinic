-- Migration 0015: queue_events — a self-owned realtime channel
--
-- ADR-019 (supersedes the realtime.send() path in ADR-009 as the
-- PRIMARY mechanism; broadcast is retained as a no-op fallback).
--
-- WHY: realtime.send() writes to realtime.messages, a partitioned table
-- in a schema Supabase reserves. With no partitions the insert fails and
-- realtime.send() swallows the error, so broadcasts vanish silently. We
-- cannot create those partitions (permission denied even as postgres).
--
-- WHY THIS IS SAFE: postgres_changes was rejected for queue_entries
-- because RLS filters events per row — a patient would never hear about
-- ANOTHER patient's check-in, which is the event that changes their
-- position. That objection does not apply here: a queue_events row
-- contains ONLY a service_id and a timestamp. No patient data. So we
-- can let a patient read it under the same rule that governed channel
-- subscription, and they learn "this queue changed" without learning
-- anything about who changed it.

create table public.queue_events (
  id         bigserial primary key,
  service_id uuid not null references public.services(id) on delete cascade,
  clinic_id  uuid not null references public.clinics(id)  on delete cascade,
  created_at timestamptz not null default now()
);

create index queue_events_service_idx on public.queue_events (service_id, created_at desc);

alter table public.queue_events enable row level security;

-- Same authorisation rule as can_subscribe_queue_topic():
--   staff   -> events for services in their clinic
--   patient -> events for a service they are queued in today
create policy queue_events_read on public.queue_events for select to authenticated
using (
  case
    when public.auth_role() in ('receptionist','nurse','admin')
      then clinic_id = public.auth_clinic_id()
    when public.auth_role() = 'patient'
      then exists (
        select 1 from public.queue_entries q
        where q.service_id = queue_events.service_id
          and q.patient_id = public.auth_profile_id()
          and q.queue_date = current_date
      )
    else false
  end
);

-- No insert/update/delete policy: rows are written only by the trigger.
grant select on public.queue_events to authenticated;

-- Emit an event whenever a queue row changes.
create or replace function public.emit_queue_event()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare rec record;
begin
  rec := coalesce(new, old);
  insert into public.queue_events (service_id, clinic_id)
  values (rec.service_id, rec.clinic_id);

  -- Keep the original broadcast too; harmless if it silently no-ops,
  -- and it will start working if partitions ever appear.
  begin
    perform realtime.send(
      jsonb_build_object('service_id', rec.service_id),
      'queue_changed',
      'queue-service:' || rec.service_id::text,
      true
    );
  exception when others then null;
  end;

  return null;
end;
$$;

drop trigger if exists queue_entries_notify_change on public.queue_entries;
create trigger queue_entries_emit_event
  after insert or update or delete on public.queue_entries
  for each row execute function public.emit_queue_event();

-- Publish to Realtime so postgres_changes delivers INSERTs.
alter publication supabase_realtime add table public.queue_events;

-- Housekeeping: these rows are ephemeral signals, not history.
create or replace function public.prune_queue_events()
returns void language sql volatile
set search_path = public, pg_temp
as $$
  delete from public.queue_events where created_at < now() - interval '2 hours';
$$;

notify pgrst, 'reload schema';
