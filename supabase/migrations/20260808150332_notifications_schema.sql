-- Migration 0023: notifications (FR-6) — schema, policies, read RPC.
--
-- Rows are written ONLY by SECURITY DEFINER triggers (next migration).
-- There is deliberately no INSERT policy: a client must never be able to
-- fabricate a notification, and nothing in the product requires it.

create table if not exists public.notifications (
  id             uuid primary key default gen_random_uuid(),
  recipient_id   uuid not null references public.profiles(id) on delete cascade,
  kind           text not null check (kind in (
                   'queue_position','you_are_next','called',
                   'appointment_reminder','appointment_cancelled','emergency_ahead')),
  title          text not null,
  body           text,
  queue_entry_id uuid references public.queue_entries(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete cascade,
  read_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);

-- Supports the once-ever dedup guard on 'you_are_next'.
create index if not exists notifications_entry_kind_idx
  on public.notifications (queue_entry_id, kind);

alter table public.notifications enable row level security;

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications
  for select to authenticated
  using (recipient_id = public.auth_profile_id());

-- Read state is the only thing a client may change, and only on its own rows.
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (recipient_id = public.auth_profile_id())
  with check (recipient_id = public.auth_profile_id());

revoke insert, delete on public.notifications from authenticated, anon;
grant select, update (read_at) on public.notifications to authenticated;

create or replace function public.mark_notifications_read(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare me uuid := public.auth_profile_id(); n int;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  update public.notifications
     set read_at = now()
   where recipient_id = me
     and read_at is null
     and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

alter publication supabase_realtime add table public.notifications;

notify pgrst, 'reload schema';
