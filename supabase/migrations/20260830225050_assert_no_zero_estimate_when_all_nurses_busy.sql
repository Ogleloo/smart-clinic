-- Migration 0049: assert the invariant migration 0048 establishes.
--
-- Note the precise wording. It is NOT "never zero when a nurse is busy" —
-- zero is CORRECT when another nurse is genuinely free, and asserting
-- otherwise would forbid right answers. The invariant is that zero is
-- impossible only when every on-duty nurse is occupied.

create or replace function public.assert_no_zero_estimate_when_busy()
returns table (services_all_busy int, violations int)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with svc as (
    select s.id,
           public.available_nurses(s.id) as nurses,
           (select count(*) from public.profiles p
             join public.consultations c
               on c.nurse_id = p.id and c.ended_at is null and c.service_id = s.id
            where p.role='nurse' and p.is_active and p.is_on_duty
              and p.current_service_id = s.id) as busy,
           coalesce(
             (select avg_minutes from public.service_consultation_stats(s.id)),
             s.default_consultation_minutes) as avg_m
    from public.services s where s.is_active
  ), all_busy as (
    select * from svc where nurses > 0 and busy >= nurses
  )
  select (select count(*)::int from all_busy),
         (select count(*)::int from all_busy
           where public.service_wait_minutes(id, 0, avg_m) = 0);
$$;

revoke execute on function public.assert_no_zero_estimate_when_busy() from public, anon;
grant execute on function public.assert_no_zero_estimate_when_busy() to authenticated;

notify pgrst, 'reload schema';
