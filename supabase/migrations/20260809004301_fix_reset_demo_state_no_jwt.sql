-- Migration 0034: make reset_demo_state() usable from the SQL editor.
--
-- Two defects in 0033, both found by running it for real:
--
-- 1. NULL-unsafe guard. In the SQL editor there is no JWT, so
--    auth_role() is NULL and `auth_role() <> 'admin'` evaluates to NULL
--    rather than true — the check silently passed instead of refusing.
--    This is the same three-valued-logic trap as (NULL = 'break') in
--    migration 0029. Comparisons against possibly-NULL values need
--    `is distinct from`, not `<>`.
--
-- 2. check_in_patient() authorises against the CALLER's clinic, and with
--    no JWT auth_clinic_id() is NULL, so every check-in was rejected.
--    Rather than bypassing the RPC with direct inserts — which would
--    make the demo state a fiction produced by a different code path —
--    the function now assumes the receptionist's identity for the
--    duration of the check-ins. The state is still built by exactly the
--    code a real receptionist runs.

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
  caller_role public.user_role := public.auth_role();
  saved_claims text := current_setting('request.jwt.claims', true);
  recep_auth uuid;
begin
  -- NULL-safe: an authenticated non-admin is refused; no JWT at all
  -- (SQL editor / service role) is allowed, since that already implies
  -- full database access.
  if caller_role is not null and caller_role is distinct from 'admin' then
    raise exception 'Only an administrator may reset demo state';
  end if;

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
  -- Sr. Pillay stays free: she is the second nurse for the concurrency demo.

  select array_agg(p.id order by p.full_name) into ids
  from public.profiles p
  where p.role = 'patient' and p.id <> thabo and p.auth_user_id is null;

  if coalesce(array_length(ids, 1), 0) < 7 then
    raise exception 'Need at least 7 no-login patient profiles; found %',
      coalesce(array_length(ids, 1), 0);
  end if;

  -- Become the receptionist so check_in_patient's clinic authorisation
  -- resolves. The demo state is then genuinely produced by the real
  -- check-in path, advisory lock and token allocation included.
  select auth_user_id into recep_auth
  from public.profiles where role = 'receptionist' and auth_user_id is not null
  limit 1;
  if recep_auth is null then raise exception 'No receptionist with a login found'; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', recep_auth, 'role', 'authenticated')::text, true);

  e := public.check_in_patient(gc, ids[1]);
  e := public.check_in_patient(gc, ids[2]);
  e := public.check_in_patient(gc, thabo);

  for i in 3..5 loop e := public.check_in_patient(im, ids[i]); end loop;

  e := public.check_in_patient(ph, ids[6]);
  e := public.check_in_patient(ph, ids[7]);

  -- Restore whatever the caller had, so this leaves no trace on the session.
  perform set_config('request.jwt.claims', coalesce(saved_claims, ''), true);

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
