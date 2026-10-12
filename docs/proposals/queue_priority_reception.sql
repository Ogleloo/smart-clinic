-- PROPOSAL (revision 5) — NOT APPLIED, NOT A MIGRATION. Supervisor requirement: queue priority belongs to Reception
-- (revised BR-10). Rationale: docs/proposals/supervisor_requirements.md §2. Fixes F12 as part of the coordinated change.
--
-- Decisions applied (PR #36 review): D-P1 Reception only (admins have read-only oversight); D-P2 Reception does not
-- classify clinical emergencies — they call a nurse, and only a nurse escalation can make a "clinical" priority;
-- D-P3 Reception-visible content is structured reason codes, no free-text clinical detail.
--
-- MUST ship together with the Reception V3 Queue control and the removal of the Nurse emergency toggle. Part 1 alone
-- is additive and safe for deployed code; Part 2 (cutover) breaks the deployed Nurse toggle by design.
--
-- Revision 5 changes: audit rows survive deletion/archiving of the queue entry (no FK cascade; snapshot columns;
-- append-only trigger); clearing priority requires a reason code too; escalations carry a reason CODE only.

begin;

create schema if not exists private;
revoke all on schema private from public, anon;

-- ============================================================ PART 1 — additive

-- Why priority was set or cleared. Codes only — no clinical vocabulary for Reception to choose from.
create type public.queue_priority_reason as enum (
  -- raising
  'nurse_escalation_accepted',   -- clinical: requires an open nurse escalation for this entry
  'accessibility_need',          -- e.g. wheelchair, cannot wait standing (administrative)
  'safeguarding',                -- e.g. unaccompanied minor, vulnerable person (administrative)
  'operational',                 -- e.g. returning for a result only; note required
  -- clearing
  'no_longer_required',
  'entered_in_error',
  'escalation_withdrawn'
);
-- What a nurse may tell Reception. Deliberately no symptoms, diagnoses or observations.
create type public.priority_escalation_reason as enum (
  'nurse_assessed_urgent',       -- the nurse has assessed the patient and asks for priority
  'nurse_requests_early_review'  -- the nurse wants to see the patient sooner
);
create type public.priority_escalation_status as enum ('open', 'accepted', 'declined');

-- Escalations and events keep queue_entry_id WITHOUT a foreign key, plus a snapshot of what identifies the entry,
-- so the record survives undo, merge, archiving or deletion of the queue entry.
create table public.queue_priority_escalations (
  id             uuid primary key default gen_random_uuid(),
  queue_entry_id uuid not null,
  clinic_id      uuid not null references public.clinics(id),
  token          text not null,
  queue_date     date not null,
  requested_by   uuid not null,
  reason         public.priority_escalation_reason not null,
  status         public.priority_escalation_status not null default 'open',
  resolved_by    uuid,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);
create unique index queue_priority_escalations_one_open on public.queue_priority_escalations (queue_entry_id)
  where status = 'open';

create table public.queue_priority_events (
  id             uuid primary key default gen_random_uuid(),
  queue_entry_id uuid not null,
  clinic_id      uuid not null references public.clinics(id),
  service_id     uuid not null,
  token          text not null,
  queue_date     date not null,
  old_priority   smallint not null,
  new_priority   smallint not null check (new_priority in (0, 1) and new_priority <> old_priority),
  reason         public.queue_priority_reason not null,
  note           text check (note is null or length(note) <= 200),
  escalation_id  uuid,
  changed_by     uuid not null,
  changed_at     timestamptz not null default now(),
  constraint raise_reason_matches check (
    (new_priority = 1 and reason in ('nurse_escalation_accepted', 'accessibility_need', 'safeguarding', 'operational'))
    or (new_priority = 0 and reason in ('no_longer_required', 'entered_in_error', 'escalation_withdrawn'))),
  constraint escalation_iff_clinical check ((reason = 'nurse_escalation_accepted') = (escalation_id is not null))
);
create index queue_priority_events_entry on public.queue_priority_events (queue_entry_id, changed_at);
create index queue_priority_events_clinic_day on public.queue_priority_events (clinic_id, queue_date);

-- Append-only history: no UPDATE or DELETE for anyone, including the service role. Escalations may only change
-- status once (open -> accepted/declined) and are never deleted.
create or replace function private.queue_priority_events_append_only()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'queue_priority_events is append-only';
end;
$$;
create trigger queue_priority_events_no_update_delete before update or delete on public.queue_priority_events
  for each row execute function private.queue_priority_events_append_only();

create or replace function private.queue_priority_escalation_transition()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'queue_priority_escalations rows are retained';
  end if;
  if old.status <> 'open'
     or (new.queue_entry_id, new.clinic_id, new.token, new.queue_date, new.requested_by, new.reason, new.created_at)
        is distinct from (old.queue_entry_id, old.clinic_id, old.token, old.queue_date, old.requested_by, old.reason, old.created_at) then
    raise exception 'an escalation can only be resolved once, and its request cannot be edited';
  end if;
  return new;
end;
$$;
create trigger queue_priority_escalations_guard before update or delete on public.queue_priority_escalations
  for each row execute function private.queue_priority_escalation_transition();
revoke all on function private.queue_priority_events_append_only() from public, anon, authenticated;
revoke all on function private.queue_priority_escalation_transition() from public, anon, authenticated;

alter table public.queue_priority_escalations enable row level security;
alter table public.queue_priority_events enable row level security;
revoke all on public.queue_priority_escalations from public, anon, authenticated;
revoke all on public.queue_priority_events from public, anon, authenticated;
grant select on public.queue_priority_escalations to authenticated;
grant select on public.queue_priority_events to authenticated;
-- Read: staff of the clinic (admins: oversight). No write policy — rows come only from the functions below.
create policy queue_priority_escalations_staff_read on public.queue_priority_escalations
  for select to authenticated
  using (public.auth_role() in ('receptionist', 'nurse', 'admin') and clinic_id = public.auth_clinic_id());
create policy queue_priority_events_staff_read on public.queue_priority_events
  for select to authenticated
  using (public.auth_role() in ('receptionist', 'nurse', 'admin') and clinic_id = public.auth_clinic_id());

-- Reception sets or clears priority on a WAITING entry of its own clinic. A reason code is always required.
create or replace function public.set_queue_priority(
  p_queue_entry_id uuid,
  p_priority       smallint,
  p_reason         public.queue_priority_reason,
  p_note           text default null,
  p_escalation_id  uuid default null
)
returns public.queue_entries
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me    record;
  entry public.queue_entries;
  esc   public.queue_priority_escalations;
  note_clean text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select p.id, p.clinic_id into me from public.profiles p
  where p.auth_user_id = auth.uid() and p.role = 'receptionist' and p.is_active and p.clinic_id is not null;
  if me.id is null then
    raise exception 'Only reception can change queue priority' using errcode = '42501';
  end if;
  if p_priority is null or p_priority not in (0, 1) then
    raise exception 'Priority must be 0 or 1' using errcode = '22023';
  end if;
  if p_reason is null then
    raise exception 'A reason is required to change priority' using errcode = '22023';
  end if;
  if p_priority = 1 and p_reason not in ('nurse_escalation_accepted', 'accessibility_need', 'safeguarding', 'operational') then
    raise exception 'That reason cannot be used to prioritise a patient' using errcode = '22023';
  end if;
  if p_priority = 0 and p_reason not in ('no_longer_required', 'entered_in_error', 'escalation_withdrawn') then
    raise exception 'That reason cannot be used to clear priority' using errcode = '22023';
  end if;
  if p_reason = 'operational' and note_clean is null then
    raise exception 'An operational priority needs a short note' using errcode = '22023';
  end if;
  if p_reason <> 'nurse_escalation_accepted' and p_escalation_id is not null then
    raise exception 'Only an accepted nurse escalation cites an escalation' using errcode = '22023';
  end if;

  -- Row lock for the read-check-write; the strength next_patient() uses, held for microseconds.
  select * into entry from public.queue_entries where id = p_queue_entry_id for no key update;
  if not found or entry.clinic_id <> me.clinic_id then
    raise exception 'Queue entry not found';   -- same message for "other clinic": no cross-clinic oracle
  end if;
  if entry.status <> 'waiting' then
    raise exception 'Priority can only be changed while the patient is waiting';
  end if;
  if entry.priority = p_priority then
    raise exception 'Priority is already set to that value';
  end if;

  if p_reason = 'nurse_escalation_accepted' then
    select * into esc from public.queue_priority_escalations
     where id = p_escalation_id and queue_entry_id = entry.id and status = 'open' for update;
    if not found then
      raise exception 'A clinical priority must come from an open nurse escalation for this patient' using errcode = '22023';
    end if;
  end if;

  update public.queue_entries
     set priority = p_priority, priority_set_by = me.id, priority_set_at = now()
   where id = entry.id
  returning * into entry;

  insert into public.queue_priority_events
    (queue_entry_id, clinic_id, service_id, token, queue_date, old_priority, new_priority, reason, note, escalation_id, changed_by)
  values (entry.id, entry.clinic_id, entry.service_id, entry.token, entry.queue_date, 1 - p_priority, p_priority,
          p_reason, note_clean, esc.id, me.id);

  if p_reason = 'nurse_escalation_accepted' then
    update public.queue_priority_escalations
       set status = 'accepted', resolved_by = me.id, resolved_at = now()
     where id = esc.id;
  end if;

  return entry;
end;
$$;

-- A nurse tells Reception a waiting patient needs priority, by reason code only. Does not change the queue.
create or replace function public.request_priority_escalation(
  p_queue_entry_id uuid,
  p_reason public.priority_escalation_reason
)
returns public.queue_priority_escalations
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me    record;
  entry public.queue_entries;
  esc   public.queue_priority_escalations;
begin
  select p.id, p.clinic_id into me from public.profiles p
  where p.auth_user_id = auth.uid() and p.role = 'nurse' and p.is_active and p.clinic_id is not null;
  if me.id is null then
    raise exception 'Only nurses can request a priority escalation' using errcode = '42501';
  end if;
  if p_reason is null then
    raise exception 'A reason code is required' using errcode = '22023';
  end if;
  select * into entry from public.queue_entries where id = p_queue_entry_id;
  if not found or entry.clinic_id <> me.clinic_id then
    raise exception 'Queue entry not found';
  end if;
  if entry.status <> 'waiting' then
    raise exception 'Only a waiting patient can be escalated';
  end if;
  insert into public.queue_priority_escalations (queue_entry_id, clinic_id, token, queue_date, requested_by, reason)
  values (entry.id, entry.clinic_id, entry.token, entry.queue_date, me.id, p_reason)
  returning * into esc;   -- a second open escalation for the entry hits the partial unique index (23505)
  return esc;
end;
$$;

-- Reception declines an escalation (accepting happens through set_queue_priority).
create or replace function public.decline_priority_escalation(p_escalation_id uuid)
returns public.queue_priority_escalations
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me  record;
  esc public.queue_priority_escalations;
begin
  select p.id, p.clinic_id into me from public.profiles p
  where p.auth_user_id = auth.uid() and p.role = 'receptionist' and p.is_active and p.clinic_id is not null;
  if me.id is null then
    raise exception 'Only reception can decline an escalation' using errcode = '42501';
  end if;
  update public.queue_priority_escalations
     set status = 'declined', resolved_by = me.id, resolved_at = now()
   where id = p_escalation_id and clinic_id = me.clinic_id and status = 'open'
  returning * into esc;
  if not found then raise exception 'Escalation not found'; end if;
  return esc;
end;
$$;

revoke all on function public.set_queue_priority(uuid, smallint, public.queue_priority_reason, text, uuid) from public, anon;
revoke all on function public.request_priority_escalation(uuid, public.priority_escalation_reason) from public, anon;
revoke all on function public.decline_priority_escalation(uuid) from public, anon;
grant execute on function public.set_queue_priority(uuid, smallint, public.queue_priority_reason, text, uuid) to authenticated;
grant execute on function public.request_priority_escalation(uuid, public.priority_escalation_reason) to authenticated;
grant execute on function public.decline_priority_escalation(uuid) to authenticated;

-- ============================================================ PART 2 — cutover (only with the UI change)
-- The Nurse emergency toggle (app/actions/nurse.ts -> set_emergency_priority) is removed in the same release.
-- set_emergency_priority() is kept (expand/contract) but no longer executable by app roles — closes F12.
revoke all on function public.set_emergency_priority(uuid, boolean) from public, anon, authenticated;

-- check_in_patient(): priority is no longer set at check-in (Reception uses set_queue_priority afterwards, with a
-- reason). No deployed screen passes p_priority. Body otherwise identical to 20260805171321.
create or replace function public.check_in_patient(
  p_service_id uuid, p_patient_id uuid, p_priority smallint default 0
)
returns public.queue_entries
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  svc         record;
  caller_role public.user_role;
  next_num    int;
  entry       public.queue_entries;
begin
  caller_role := public.auth_role();
  if caller_role not in ('receptionist','nurse','admin') then
    raise exception 'Only clinic staff can check patients in';
  end if;

  select id, clinic_id, token_prefix into svc
  from public.services where id = p_service_id and is_active;
  if not found then raise exception 'Service not found or inactive'; end if;
  if svc.clinic_id is distinct from public.auth_clinic_id() then
    raise exception 'Not authorised for this clinic';
  end if;
  if coalesce(p_priority, 0) <> 0 then
    raise exception 'Priority is set by reception after check-in (set_queue_priority)';
  end if;

  if exists (
    select 1 from public.queue_entries q
    where q.patient_id = p_patient_id
      and q.service_id = p_service_id
      and q.queue_date = current_date
      and q.status in ('waiting','in_progress')
  ) then
    raise exception 'This patient is already in the queue for this service today.'
      using errcode = '23505';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(svc.clinic_id::text || p_service_id::text || current_date::text, 0)
  );

  select coalesce(max(token_number), 0) + 1 into next_num
  from public.queue_entries
  where clinic_id = svc.clinic_id and service_id = p_service_id and queue_date = current_date;

  insert into public.queue_entries (
    clinic_id, service_id, patient_id, token, token_number,
    queue_date, priority, status, checked_in_at
  ) values (
    svc.clinic_id, p_service_id, p_patient_id,
    svc.token_prefix || '-' || lpad(next_num::text, 3, '0'),
    next_num, current_date, 0, 'waiting', clock_timestamp()
  )
  returning * into entry;

  return entry;
end;
$$;

commit;

-- ROLLBACK: Part 2 — grant execute on set_emergency_priority to authenticated; restore check_in_patient from
-- 20260805171321. Part 1 — drop the three functions, the two trigger functions, both tables and the three enum types
-- (export the two tables first: they are audit records).
