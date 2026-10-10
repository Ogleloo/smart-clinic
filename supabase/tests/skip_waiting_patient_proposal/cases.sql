-- Assertion cases for the PROPOSED skip_waiting_patient() (docs/proposals/skip_waiting_patient.sql).
-- Disposable database only. Each case prints "PASS [...]" or raises "FAIL [...]". Successful skips run inside
-- BEGIN/ROLLBACK so every case starts from the same fixture state.

create schema if not exists test;

-- Fingerprint of every queue entry and consultation, optionally excluding one entry (and its consultation).
create or replace function test.snapshot(p_exclude uuid default null) returns text
language sql as $$
  select md5(
    coalesce((select string_agg(row(q.id, q.status, q.completed_at, q.updated_at)::text, ',' order by q.id)
                from public.queue_entries q where p_exclude is null or q.id <> p_exclude), '') || '|' ||
    coalesce((select string_agg(row(c.id, c.ended_at, c.exclude_from_prediction, c.exclusion_reason)::text, ',' order by c.id)
                from public.consultations c where p_exclude is null or c.queue_entry_id <> p_exclude), '')
  )
$$;

create or replace function test.expect_reject(
  p_case text, p_auth uuid, p_entry uuid, p_expected text, p_role text default 'authenticated'
) returns void language plpgsql as $$
declare
  before text := test.snapshot();
  err    text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_auth::text, ''), true);
  begin
    execute format('set local role %I', p_role);
    perform public.skip_waiting_patient(p_entry);
    reset role;
    raise exception 'FAIL [%]: call SUCCEEDED but must be rejected', p_case using errcode = 'XX001';
  exception
    when sqlstate 'XX001' then raise;
    when others then err := sqlerrm;
  end;
  reset role;
  if position(p_expected in err) = 0 then
    raise exception 'FAIL [%]: rejected with "%" — expected text "%"', p_case, err, p_expected;
  end if;
  if test.snapshot() <> before then
    raise exception 'FAIL [%]: rejected call changed database state', p_case;
  end if;
  raise notice 'PASS [%] (rejected: %)', p_case, err;
end $$;

create or replace function test.expect_ok(p_case text, p_auth uuid, p_entry uuid) returns void
language plpgsql as $$
declare
  others_before text := test.snapshot(p_entry);
  cons_before   text := (select string_agg(row(c.id, c.ended_at)::text, ',') from public.consultations c where c.queue_entry_id = p_entry);
  ret  public.queue_entries;
  row_ public.queue_entries;
begin
  perform set_config('request.jwt.claim.sub', p_auth::text, true);
  set local role authenticated;
  ret := public.skip_waiting_patient(p_entry);
  reset role;
  select * into row_ from public.queue_entries where id = p_entry;
  if ret.id is distinct from p_entry or ret.status <> 'skipped' then
    raise exception 'FAIL [%]: returned % / %', p_case, ret.id, ret.status;
  end if;
  if row_.status <> 'skipped' or row_.completed_at is null then
    raise exception 'FAIL [%]: stored status % completed_at %', p_case, row_.status, row_.completed_at;
  end if;
  if (select string_agg(row(c.id, c.ended_at)::text, ',') from public.consultations c where c.queue_entry_id = p_entry) is distinct from cons_before then
    raise exception 'FAIL [%]: a consultation was changed', p_case;
  end if;
  if test.snapshot(p_entry) <> others_before then
    raise exception 'FAIL [%]: other rows changed', p_case;
  end if;
  raise notice 'PASS [%]', p_case;
end $$;

create or replace function test.expect_true(p_case text, p_value boolean) returns void language plpgsql as $$
begin
  if p_value is not true then raise exception 'FAIL [%]: expected true, got %', p_case, p_value; end if;
  raise notice 'PASS [%]', p_case;
end $$;

-- ---------------------------------------------------------------- allowed: a waiting patient, own clinic
begin; select test.expect_ok('nurse skips a waiting patient', '10000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001'); rollback;
begin; select test.expect_ok('receptionist skips a waiting patient', '10000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001'); rollback;
begin; select test.expect_ok('admin skips a waiting patient', '10000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001'); rollback;

-- ---------------------------------------------------------------- expected status: anything but waiting is refused
select test.expect_reject('nurse: in_progress is refused, consultation stays open', '10000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000003', 'already in consultation');
select test.expect_reject('receptionist: in_progress is refused', '10000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003', 'already in consultation');
select test.expect_reject('admin: in_progress is refused', '10000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000003', 'already in consultation');
select test.expect_reject('done is refused', '10000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000004', 'no longer waiting');
select test.expect_reject('already skipped is refused', '10000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000005', 'no longer waiting');
select test.expect_reject('no_show is refused', '10000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000006', 'no longer waiting');
begin; insert into public.consultations (queue_entry_id, nurse_id, service_id) values ('e0000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000003', '5a000000-0000-4000-8000-000000000000'); select test.expect_reject('waiting but with an open consultation (inconsistent) is refused, not closed', '10000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000008', 'open consultation'); rollback;

-- ---------------------------------------------------------------- clinic isolation (same message as "missing")
select test.expect_reject('nurse A cannot skip a clinic B entry', '10000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000011', 'Queue entry not found');
select test.expect_reject('nurse B cannot skip a clinic A entry', '10000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000001', 'Queue entry not found');
select test.expect_reject('entry whose service belongs to another clinic', '10000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000021', 'Queue entry not found');
select test.expect_reject('nonexistent entry', '10000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-0000000000ff', 'Queue entry not found');

-- ---------------------------------------------------------------- authentication and role
select test.expect_reject('patient role', '10000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000001', 'Not authorised');
select test.expect_reject('inactive staff', '10000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'Not authorised');
select test.expect_reject('auth user without a profile', '10000000-0000-4000-8000-000000000009', 'e0000000-0000-4000-8000-000000000001', 'Not authorised');
select test.expect_reject('no JWT subject', null, 'e0000000-0000-4000-8000-000000000001', 'Not authorised');
select test.expect_reject('staff without a clinic', '10000000-0000-4000-8000-000000000008', 'e0000000-0000-4000-8000-000000000001', 'Not authorised');
select test.expect_reject('anon role cannot execute', '10000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'permission denied', 'anon');

-- ---------------------------------------------------------------- grants
select test.expect_true('anon has no EXECUTE', not has_function_privilege('anon', 'public.skip_waiting_patient(uuid)', 'execute'));
select test.expect_true('authenticated has EXECUTE', has_function_privilege('authenticated', 'public.skip_waiting_patient(uuid)', 'execute'));
select test.expect_true('PUBLIC has no EXECUTE', not exists (select 1 from information_schema.routine_privileges where routine_name = 'skip_waiting_patient' and grantee = 'PUBLIC'));
select test.expect_true('skip_patient() is unchanged (still accepts p_no_show)', exists (select 1 from pg_proc where proname = 'skip_patient' and pg_get_function_identity_arguments(oid) = 'p_queue_entry_id uuid, p_no_show boolean'));
