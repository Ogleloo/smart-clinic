-- Migration 0028: single-action nurse workflow.
--
-- WHY: the three-action flow (call / start / end) costs a nurse three
-- interactions per patient. Nurses in busy public clinics are not desk
-- workers; friction risks abandonment, and an abandoned system records
-- no consultation durations — which starves the prediction engine of
-- the data it depends on. Reducing interaction cost is therefore not a
-- convenience change, it protects the core feature.
--
-- Reducing to one tap RAISES the cost of each tap being wrong, so the
-- database must make the action hard to perform incorrectly:
--   * idempotency token — a client-side disabled button does not survive
--     a network retry, a second tab, or a slow connection
--   * long-consultation confirmation — a nurse who takes lunch mid-shift
--     would otherwise silently record a 52-minute consultation; this is
--     systematic (every break, every day), not an edge case, and the
--     90-minute plausibility ceiling does not catch it
--   * ending is separable from calling — otherwise the LAST patient of
--     every session never gets ended, because there is no next patient

-- ---------- 1. Provenance on consultations ----------
alter table public.consultations
  add column if not exists exclude_from_prediction boolean not null default false,
  add column if not exists exclusion_reason text;

-- Raw timestamps are never altered. Reality is preserved; only its
-- eligibility for the average is marked.
comment on column public.consultations.exclude_from_prediction is
  'True when the recorded span does not represent continuous patient care '
  '(e.g. a staff break). Timestamps remain untouched for audit.';

-- ---------- 2. Configurable break threshold ----------
alter table public.clinic_settings
  add column if not exists long_consultation_multiplier numeric not null default 2.0,
  add column if not exists undo_window_seconds int not null default 60;

-- ---------- 3. Idempotency ledger ----------
create table if not exists public.nurse_actions (
  id          uuid primary key default gen_random_uuid(),
  nurse_id    uuid not null references public.profiles(id) on delete cascade,
  action_id   uuid not null,
  result      jsonb not null,
  undone_at   timestamptz,
  created_at  timestamptz not null default now(),
  unique (nurse_id, action_id)
);

alter table public.nurse_actions enable row level security;
drop policy if exists nurse_actions_own on public.nurse_actions;
create policy nurse_actions_own on public.nurse_actions
  for select to authenticated
  using (nurse_id = public.auth_profile_id());
revoke insert, update, delete on public.nurse_actions from authenticated, anon;

-- ---------- 4. Stats must respect the exclusion flag ----------
create or replace function public.service_consultation_stats(p_service_id uuid)
returns table(sample_count integer, avg_minutes numeric, stddev_minutes numeric)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with s as (
    select extract(epoch from (c.ended_at - c.started_at)) / 60.0 as mins,
           coalesce(cs.max_plausible_consultation_minutes, 90) as max_m,
           coalesce(cs.min_plausible_consultation_minutes, 1)  as min_m
    from public.consultations c
    join public.services sv on sv.id = c.service_id
    left join public.clinic_settings cs on cs.clinic_id = sv.clinic_id
    where c.service_id = p_service_id
      and c.ended_at is not null
      and c.exclude_from_prediction = false   -- NEW
  )
  select count(*)::int,
         round(avg(mins), 2),
         round(coalesce(stddev_samp(mins), 0), 2)
  from s
  where mins between min_m and max_m;
$function$;

notify pgrst, 'reload schema';
