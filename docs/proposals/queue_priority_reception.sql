-- PROPOSAL — NOT APPLIED, NOT A MIGRATION. Supervisor requirement: queue priority belongs to Reception (revised
-- BR-10). Rationale: docs/proposals/supervisor_requirements.md §2. Fixes F12 (set_emergency_priority has no clinic
-- check) as part of the same coordinated change.
--
-- MUST ship together with the Reception V3 Queue control and the removal of the Nurse emergency toggle. Part 1
-- alone is additive and safe for deployed code; Part 2 (cutover) breaks the deployed Nurse toggle by design and
-- must not be applied before the UI change is deployed.
--
-- Model:
--   * queue_entries.priority stays the ordering input (0 normal, 1 priority) — next_patient(), get_service_queue()
--     and the notify triggers are unchanged.
--   * Every change is a row in queue_priority_events (who, when, old -> new, reason, note, escalation).
--   * reason distinguishes a CLINICALLY ASSESSED emergency (must cite an open nurse escalation for that entry)
--     from an ADMINISTRATIVE priority (Reception's own decision; a note is required).
--   * Nurses keep a way to communicate urgency: request_priority_escalation() — Reception decides.

begin;

-- ============================================================ PART 1 — additive
create type public.queue_priority_reason as enum ('clinical_emergency', 'administrative');
create type public.priority_escalation_status as enum ('open', 'accepted', 'declined');

create table public.queue_priority_escalations (
  id             uuid primary key default gen_random_uuid(),
  queue_entry_id uuid not null references public.queue_entries(id) on delete cascade,
  clinic_id      uuid not null references public.clinics(id),
  requested_by   uuid not null references public.profiles(id),
  note           text not null check (length(btrim(note)) between 3 and 500),
  status         public.priority_escalation_status not null default 'open',
  resolved_by    uuid references public.profiles(id),
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);
-- At most one open escalation per entry (a double-click or two nurses cannot stack them).
create unique index queue_priority_escalations_one_open on public.queue_priority_escalations (queue_entry_id)
  where status = 'open';

create table public.queue_priority_events (
  id             uuid primary key default gen_random_uuid(),
  queue_entry_id uuid not null references public.queue_entries(id) on delete cascade,
  clinic_id      uuid not null references public.clinics(id),
  old_priority   smallint not null,
  new_priority   smallint not null check (new_priority in (0, 1) and new_priority <> old_priority),
  reason         public.queue_priority_reason,
  note           text check (note is null or length(note) <= 500),
  escalation_id  uuid references public.queue_priority_escalations(id),
  changed_by     uuid not null references public.profiles(id),
  changed_at     timestamptz not null default now(),
  check ((new_priority = 1) = (reason is not null))
);
create index queue_priority_events_entry on public.queue_priority_events (queue_entry_id, changed_at);

alter table public.queue_priority_escalations enable row level security;
alter table public.queue_priority_events enable row level security;
revoke all on public.queue_priority_escalations from public, anon, authenticated;
revoke all on public.queue_priority_events from public, anon, authenticated;
grant select on public.queue_priority_escalations to authenticated;
grant select on public.queue_priority_events to authenticated;
-- Read: staff of the entry's clinic. No write policy: rows come only from the functions below.
create policy queue_priority_escalations_staff_read on public.queue_priority_escalations
  for select to authenticated
  using (public.auth_role() in ('receptionist', 'nurse', 'admin') and clinic_id = public.auth_clinic_id());
create policy queue_priority_events_staff_read on public.queue_priority_events
  for select to authenticated
  using (public.auth_role() in ('receptionist', 'nurse', 'admin') and clinic_id = public.auth_clinic_id());

-- Reception sets or clears priority on a WAITING entry of its own clinic.
create or replace function public.set_queue_priority(
  p_queue_entry_id uuid,
  p_priority       smallint,
  p_reason         public.queue_priority_reason default null,
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
begin
  select p.id, p.clinic_id into me from public.profiles p
  where p.auth_user_id = auth.uid() and p.role = 'receptionist' and p.is_active and p.clinic_id is not null;
  if me.id is null then
    raise exception 'Only reception can change queue priority' using errcode = '42501';
  end if;
  if p_priority not in (0, 1) then
    raise exception 'Priority must be 0 or 1' using errcode = '22023';
  end if;

  -- Row lock for the read-check-write; same lock strength next_patient() uses, held for microseconds.
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

  if p_priority = 1 then
    if p_reason is null then
      raise exception 'A reason is required to prioritise a patient' using errcode = '22023';
    end if;
    if p_reason = 'clinical_emergency' then
      select * into esc from public.queue_priority_escalations
       where id = p_escalation_id and queue_entry_id = entry.id and status = 'open' for update;
      if not found then
        raise exception 'A clinical emergency must come from an open nurse escalation for this patient' using errcode = '22023';
      end if;
    elsif nullif(btrim(coalesce(p_note, '')), '') is null then
      raise exception 'Administrative priority needs a note' using errcode = '22023';
    end if;
  elsif p_reason is not null or p_escalation_id is not null then
    raise exception 'Clearing priority takes no reason or escalation' using errcode = '22023';
  end if;

  update public.queue_entries
     set priority = p_priority, priority_set_by = me.id, priority_set_at = now()
   where id = entry.id
  returning * into entry;

  insert into public.queue_priority_events
    (queue_entry_id, clinic_id, old_priority, new_priority, reason, note, escalation_id, changed_by)
  values (entry.id, entry.clinic_id, 1 - p_priority, p_priority, p_reason, nullif(btrim(p_note), ''),
          case when p_reason = 'clinical_emergency' then esc.id end, me.id);

  if p_reason = 'clinical_emergency' then
    update public.queue_priority_escalations
       set status = 'accepted', resolved_by = me.id, resolved_at = now()
     where id = esc.id;
  end if;

  return entry;
end;
$$;

-- A nurse tells Reception a waiting patient may need priority. Does not change the queue.
create or replace function public.request_priority_escalation(p_queue_entry_id uuid, p_note text)
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
  select * into entry from public.queue_entries where id = p_queue_entry_id;
  if not found or entry.clinic_id <> me.clinic_id then
    raise exception 'Queue entry not found';
  end if;
  if entry.status <> 'waiting' then
    raise exception 'Only a waiting patient can be escalated';
  end if;
  insert into public.queue_priority_escalations (queue_entry_id, clinic_id, requested_by, note)
  values (entry.id, entry.clinic_id, me.id, btrim(p_note))
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
revoke all on function public.request_priority_escalation(uuid, text) from public, anon;
revoke all on function public.decline_priority_escalation(uuid) from public, anon;
grant execute on function public.set_queue_priority(uuid, smallint, public.queue_priority_reason, text, uuid) to authenticated;
grant execute on function public.request_priority_escalation(uuid, text) to authenticated;
grant execute on function public.decline_priority_escalation(uuid) to authenticated;

-- ============================================================ PART 2 — cutover (only with the UI change)
-- The Nurse emergency toggle (app/actions/nurse.ts -> set_emergency_priority) is removed in the same release.
-- set_emergency_priority() is kept (expand/contract) but no longer executable by app roles — this also closes
-- F12 (no clinic check) and the in_progress/no-audit behaviour.
revoke all on function public.set_emergency_priority(uuid, boolean) from public, anon, authenticated;

-- check_in_patient(): priority is no longer set at check-in (Reception uses set_queue_priority afterwards, which
-- records a reason). No deployed screen passes p_priority (app/actions/reception.ts omits it). Body otherwise
-- identical to 20260805171321.
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
-- 20260805171321. Part 1 — drop the three functions, both tables and both enum types.
