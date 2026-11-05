-- Nurse naming: "Sr. Mabaso" -> "Nurse Mabaso".
--
-- The seeded clinical staff were named with the South African hospital
-- convention "Sr." (Sister). The system's own vocabulary is "nurse"
-- everywhere else -- profiles.role = 'nurse', the V3 terminology table in
-- docs/V3_REQUIREMENTS.md, every screen label -- so a patient reading
-- "Sr. Mabaso" on the public display sees a title the rest of the product
-- never explains. Renaming to "Nurse Mabaso" makes the person's shown name
-- agree with the role the interface already names.
--
-- Scope: only profiles whose name actually carries the "Sr. " title. Nurses
-- who registered under their own name keep it; this migration is not in the
-- business of prefixing a real person's name with their job.
--
-- Why reset_demo_state() is in the same migration: it puts nurses on duty by
-- matching full_name literally. Renaming the rows without touching the
-- function would leave the function matching names that no longer exist --
-- a reset would then put NO nurse on duty, and the prediction engine
-- (correctly) refuses to estimate a wait with no nurse available. The demo
-- would show "no estimate" on every service and nothing would look broken
-- until someone asked why. The two changes are one change.

begin;

-- 1. The rename. Idempotent: a second run matches nothing.
update public.profiles
   set full_name = 'Nurse ' || substring(full_name from 5)
 where role = 'nurse'
   and full_name like 'Sr. %';

-- 2. reset_demo_state(), matching either spelling.
--
-- Identical to 20260809004301_fix_reset_demo_state_no_jwt.sql except for the
-- two on-duty updates, which now accept the old name and the new one. That
-- makes the function order-independent: it is correct before this file's
-- UPDATE runs, after it, and if the names are ever changed back. Matching a
-- set rather than a literal is also why this is not a behaviour regression
-- for currently-deployed code -- the function's contract (two nurses on duty,
-- Pillay free) is unchanged.
create or replace function public.reset_demo_state()
 returns table(service text, waiting integer, nurses integer, tokens text)
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
   where role = 'nurse' and full_name in ('Nurse Mabaso', 'Sr. Mabaso');
  update public.profiles set is_on_duty = true, current_service_id = ph
   where role = 'nurse' and full_name in ('Nurse Botha', 'Sr. Botha');
  -- Nurse Pillay stays free: she is the second nurse for the concurrency demo.

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
$function$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, and CREATE OR REPLACE
-- keeps whatever the original had -- but restate it so this file is correct
-- on a fresh database too, where the replace becomes a create.
revoke execute on function public.reset_demo_state() from public, anon;
grant execute on function public.reset_demo_state() to authenticated;

commit;
