-- Migration 0044: fix confidence thresholds and enforce a cold-start floor.
--
-- Found while preparing to show patients the working behind an estimate.
-- Two defects, both invisible until the numbers were put side by side:
--
-- 1. confidence_min_count_floor was 0, so a service with ONE recorded
--    consultation reported "medium" confidence. Its stddev is 0.00 —
--    but zero variance from a single observation is not consistency,
--    it is an absence of evidence. Pharmacy was doing exactly this.
--
-- 2. confidence_high_min_count was 500. At roughly 40 consultations a
--    day for one service, "high" would take three months to reach.
--    High confidence was effectively unreachable.
--
-- Both were left at test values. The label is computed at read time and
-- never stored (ADR-006), so correcting the thresholds immediately
-- corrects every historical display too — nothing to backfill.

update public.clinic_settings
   set confidence_min_count_floor = 10,   -- below this: always Low
       confidence_high_min_count  = 30,   -- at/above this + consistent: High
       updated_at = now()
 where clinic_id = '11111111-1111-1111-1111-111111111111';

-- Make the cold-start rule explicit in the function rather than relying
-- on a threshold value being sane.
create or replace function public.confidence_label(
  p_service_id uuid,
  p_count      integer,
  p_stddev     numeric
)
returns text
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare cfg public.clinic_settings;
begin
  select cs.* into cfg
  from public.clinic_settings cs
  join public.services s on s.clinic_id = cs.clinic_id
  where s.id = p_service_id;

  -- Cold start dominates everything else. With too few consultations
  -- there is no basis for a confident estimate, however tight the
  -- observed variance happens to look.
  if p_count is null
     or p_count < greatest(coalesce(cfg.confidence_min_count_floor, 10), 2) then
    return 'low';
  end if;

  if p_count >= coalesce(cfg.confidence_high_min_count, 30)
     and p_stddev <= coalesce(cfg.confidence_consistent_stddev_minutes, 3) then
    return 'high';
  end if;

  if p_stddev >= coalesce(cfg.confidence_inconsistent_stddev_minutes, 7) then
    return 'low';
  end if;

  return 'medium';
end;
$$;

notify pgrst, 'reload schema';
