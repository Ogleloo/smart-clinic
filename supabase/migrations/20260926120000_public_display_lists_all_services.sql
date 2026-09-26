-- Migration 0051: let the public display function answer "which services?"
--
-- Found while building the public landing page. get_public_queue_display()
-- is the single anon-callable function (ADR-028), but it required a
-- service_id, and anon cannot discover one: services_read is granted to
-- `authenticated`, so an anonymous caller reads zero rows.
--
-- The obvious fix — a second anon function, list_active_services() — was
-- rejected. ADR-028 permits exactly ONE anon surface, and
-- system_health_check_v2() asserts it by counting functions where anon
-- holds EXECUTE. Adding a second would fail that assertion on the next run,
-- and the narrow anon surface is the reason the assertion caught a real
-- data leak in migration 0040.
--
-- Instead the existing function takes a nullable argument: given a service
-- id it behaves exactly as before; given null it returns one row per active
-- service. One function, one grant, same assertion, no new surface.
--
-- service_id is added to the returned shape so a caller can link to the
-- per-service display board. What this exposes to an anonymous visitor is
-- what a person standing in the waiting room can already read off the
-- screen: service names, tokens, waiting counts and an aggregate estimate.
-- No patient identifiers.

drop function if exists public.get_public_queue_display(uuid);

create function public.get_public_queue_display(
  p_service_id uuid default null
)
returns table(service_id uuid, service_name text, now_serving_token text,
              next_token text, waiting_count integer,
              estimated_wait_minutes integer, confidence text,
              is_being_served boolean,
              updated_at timestamp with time zone)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  svc      public.services;
  nurses   int;
  stats    record;
  avg_mins numeric;
begin
  for svc in
    select * from public.services
    where is_active
      and (p_service_id is null or id = p_service_id)
    order by name
  loop
    service_id   := svc.id;
    service_name := svc.name;
    nurses := public.available_nurses(svc.id);
    select * into stats from public.service_consultation_stats(svc.id);

    select q.token into now_serving_token
    from public.queue_entries q
    where q.service_id = svc.id and q.queue_date = current_date
      and q.status = 'in_progress'
    order by q.called_at desc nulls last limit 1;

    select q.token into next_token
    from public.queue_entries q
    where q.service_id = svc.id and q.queue_date = current_date
      and q.status = 'waiting'
    order by q.priority desc, q.checked_in_at asc, q.token_number asc limit 1;

    select count(*)::int into waiting_count
    from public.queue_entries q
    where q.service_id = svc.id and q.queue_date = current_date
      and q.status = 'waiting';

    is_being_served := nurses > 0;

    if nurses > 0 then
      avg_mins := coalesce(stats.avg_minutes, svc.default_consultation_minutes);
      estimated_wait_minutes := public.service_wait_minutes(
        svc.id, waiting_count, avg_mins);
      confidence := public.confidence_label(
        svc.id, stats.sample_count, stats.stddev_minutes);
    else
      -- No nurse on duty: no number, for the board as for the patient screen.
      estimated_wait_minutes := null;
      confidence := null;
    end if;

    updated_at := now();
    return next;
  end loop;

  -- A specific id that matched nothing active returns no rows rather than
  -- raising, so the display board renders "unavailable" instead of an error.
  return;
end;
$$;

grant execute on function public.get_public_queue_display(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
