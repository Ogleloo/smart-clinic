-- Migration 0033: reset_demo_state() — restore a known-good scenario.
--
-- PURPOSE: rehearsals and the live demo need the SAME starting state
-- every time. Recreating it by hand is slow and, worse, inconsistent —
-- a rehearsal that differs from the performance is not a rehearsal.
--
-- SCOPE NOTE: this is presentation tooling, not a product feature. It is
-- admin-only and destructive to TODAY's queue. A production deployment
-- would drop this function; it is documented here rather than hidden so
-- that its presence is a deliberate, visible choice.
--
-- The scenario it builds is chosen to demonstrate the project's central
-- principle: three services, one of which has NO nurse on duty, so the
-- display board must refuse to state a wait rather than invent one.

create or replace function public.reset_demo_state()
returns table (service text, waiting int, nurses int, tokens text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  gc uuid := '22222222-2222-2222-2222-222222222221';
  im uuid := '22222222-2222-2222-2222-222222222222';
  ph uuid := '22222222-2222-2222-2222-222222222223';
  thabo uuid := '44444444-4444-4444-4444-444444444441';
  ids uuid[]; e public.queue_entries; i int;
begin
  if public.auth_role() <> 'admin' then
    raise exception 'Only an administrator may reset demo state';
  end if;

  -- Close anything open. Marked excluded so rehearsal churn never
  -- contaminates the consultation averages the engine learns from.
  update public.consultations
     set ended_at = clock_timestamp(),
         exclude_from_prediction = true,
         exclusion_reason = 'demo_reset'
   where ended_at is null;

  update public.queue_entries set status = 'done', completed_at = now()
   where queue_date = current_date and status in ('waiting','in_progress');

  delete from public.notifications where created_at::date = current_date;
  delete from public.nurse_actions where created_at::date = current_date;

  update public.profiles set is_on_duty = false, current_service_id = null
   where role = 'nurse';
  update public.profiles set is_on_duty = true, current_service_id = gc
   where full_name = 'Sr. Mabaso';
  update public.profiles set is_on_duty = true, current_service_id = ph
   where full_name = 'Sr. Botha';
  -- Sr. Pillay is left free on purpose: she is the second nurse for the
  -- concurrency demonstration.

  select array_agg(p.id order by p.full_name) into ids
  from public.profiles p
  where p.role = 'patient' and p.id <> thabo and p.auth_user_id is null;

  if coalesce(array_length(ids, 1), 0) < 7 then
    raise exception 'Need at least 7 no-login patient profiles for the demo; found %',
      coalesce(array_length(ids, 1), 0);
  end if;

  -- Check-ins run through the REAL RPC, not direct inserts, so the demo
  -- state is produced by the same code path a receptionist uses.
  e := public.check_in_patient(gc, ids[1]);
  e := public.check_in_patient(gc, ids[2]);
  e := public.check_in_patient(gc, thabo);      -- Thabo third: his number can move

  for i in 3..5 loop e := public.check_in_patient(im, ids[i]); end loop;  -- no nurse

  e := public.check_in_patient(ph, ids[6]);
  e := public.check_in_patient(ph, ids[7]);

  return query
  select s.name::text,
         count(*) filter (where q.status = 'waiting')::int,
         public.available_nurses(s.id),
         coalesce(string_agg(q.token, ', ' order by q.token_number), '—')::text
  from public.services s
  left join public.queue_entries q
    on q.service_id = s.id and q.queue_date = current_date and q.status = 'waiting'
  where s.is_active
  group by s.id, s.name
  order by s.name;
end;
$$;

revoke execute on function public.reset_demo_state() from public, anon;
grant execute on function public.reset_demo_state() to authenticated;

notify pgrst, 'reload schema';
