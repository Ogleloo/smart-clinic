-- Assertion cases for skip_patient(). Each case prints "PASS [...]" or
-- fails with "FAIL [...]". Successful-skip cases run inside BEGIN/ROLLBACK
-- so every case starts from the same fixture state.
--
-- GUC test.check_messages: 'on' (default) also checks the error text;
-- run.sh sets it 'off' for the baseline run against the OLD function, so
-- that run reports only "should have been rejected but wasn't".

create schema if not exists test;

-- Fingerprint of every queue entry and consultation, optionally excluding
-- one entry (and its consultation) — used to prove nothing else changed.
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
  p_case text, p_auth uuid, p_entry uuid, p_no_show boolean, p_expected text, p_role text default 'authenticated'
) returns void language plpgsql as $$
declare
  before text := test.snapshot();
  err    text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_auth::text, ''), true);
  begin
    execute format('set local role %I', p_role);
    perform public.skip_patient(p_entry, p_no_show);
    reset role;
    raise exception 'FAIL [%]: call SUCCEEDED but must be rejected', p_case using errcode = 'XX001';
  exception
    when sqlstate 'XX001' then raise;
    when others then err := sqlerrm;
  end;
  reset role;

  if coalesce(current_setting('test.check_messages', true), 'on') = 'on' and position(p_expected in err) = 0 then
    raise exception 'FAIL [%]: rejected with "%" — expected text "%"', p_case, err, p_expected;
  end if;
  if test.snapshot() <> before then
    raise exception 'FAIL [%]: rejected call changed database state', p_case;
  end if;
  raise notice 'PASS [%] (rejected: %)', p_case, err;
end $$;

create or replace function test.expect_ok(
  p_case text, p_auth uuid, p_entry uuid, p_no_show boolean,
  p_expected_status public.queue_entry_status, p_expected_reason text default null
) returns void language plpgsql as $$
declare
  others_before text := test.snapshot(p_entry);
  ret    public.queue_entries;
  row_   public.queue_entries;
  cons   public.consultations;
begin
  perform set_config('request.jwt.claim.sub', p_auth::text, true);
  set local role authenticated;
  ret := public.skip_patient(p_entry, p_no_show);
  reset role;

  select * into row_ from public.queue_entries where id = p_entry;
  if row_.status <> p_expected_status or ret.status <> p_expected_status or row_.completed_at is null then
    raise exception 'FAIL [%]: status % (returned %), completed_at % — expected %',
      p_case, row_.status, ret.status, row_.completed_at, p_expected_status;
  end if;
  if test.snapshot(p_entry) <> others_before then
    raise exception 'FAIL [%]: other queue entries or consultations changed', p_case;
  end if;

  select * into cons from public.consultations where queue_entry_id = p_entry;
  if found then
    if cons.ended_at is null or not cons.exclude_from_prediction or cons.exclusion_reason is distinct from p_expected_reason then
      raise exception 'FAIL [%]: consultation not closed correctly (ended_at %, excluded %, reason %)',
        p_case, cons.ended_at, cons.exclude_from_prediction, cons.exclusion_reason;
    end if;
  elsif p_expected_reason is not null then
    raise exception 'FAIL [%]: expected a consultation to close, none exists', p_case;
  end if;
  raise notice 'PASS [%] (status -> %)', p_case, row_.status;
end $$;

-- ---------------------------------------------------------------------------
-- Identity / role
select test.expect_reject('anon role cannot execute',                 null, 'e0000000-0000-4000-8000-000000000001', false, 'permission denied', 'anon');
select test.expect_reject('authenticated but no JWT subject',         null, 'e0000000-0000-4000-8000-000000000001', false, 'Not authorised');
select test.expect_reject('auth user with no profile (NULL role)',    '10000000-0000-4000-8000-000000000009', 'e0000000-0000-4000-8000-000000000001', false, 'Not authorised');
select test.expect_reject('patient account',                          '10000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000001', false, 'Not authorised');
select test.expect_reject('deactivated receptionist',                 '10000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', false, 'Not authorised');
select test.expect_reject('receptionist with no clinic',              '10000000-0000-4000-8000-000000000008', 'e0000000-0000-4000-8000-000000000001', false, 'Not authorised');

-- Clinic isolation
select test.expect_reject('receptionist A -> clinic B waiting',       '10000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000011', false, 'Queue entry not found');
select test.expect_reject('receptionist A -> clinic B in_progress',   '10000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000012', false, 'Queue entry not found');
select test.expect_reject('receptionist B -> clinic A waiting',       '10000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000001', false, 'Queue entry not found');
select test.expect_reject('nurse A -> clinic B in_progress',          '10000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000012', false, 'Queue entry not found');
select test.expect_reject('admin A -> clinic B waiting',              '10000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000011', true,  'Queue entry not found');
select test.expect_reject('entry clinic A but service in clinic B',   '10000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000021', false, 'Queue entry not found');

-- Forged / nonexistent IDs
select test.expect_reject('nonexistent queue entry UUID',             '10000000-0000-4000-8000-000000000001', 'deadbeef-0000-4000-8000-000000000000', false, 'Queue entry not found');
select test.expect_reject('NULL queue entry id',                      '10000000-0000-4000-8000-000000000001', null,                                   false, 'Queue entry not found');

-- Receptionist status rules
select test.expect_reject('receptionist -> own in_progress',          '10000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003', false, 'already in consultation');
select test.expect_reject('receptionist -> own done',                 '10000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000004', false, 'no longer waiting');
select test.expect_reject('receptionist -> own already skipped',      '10000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000005', false, 'no longer waiting');
select test.expect_reject('receptionist -> own no_show',              '10000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000006', false, 'no longer waiting');
select test.expect_reject('receptionist cannot mark no-show',         '10000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', true,  'not mark a no-show');

-- Nurse/admin status rules (existing behaviour preserved)
select test.expect_reject('nurse -> own done',                        '10000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000004', false, 'not in an active state');
select test.expect_reject('admin -> own already skipped',             '10000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000005', false, 'not in an active state');

-- ---------------------------------------------------------------------------
-- Permitted operations (each rolled back afterwards)
begin; select test.expect_ok('receptionist A skips own waiting',      '10000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', false, 'skipped'); rollback;
begin; select test.expect_ok('receptionist B skips own waiting',      '10000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000011', false, 'skipped'); rollback;
begin; select test.expect_ok('nurse A skips own waiting',             '10000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000002', false, 'skipped'); rollback;
begin; select test.expect_ok('nurse A skips own in_progress (closes consultation)', '10000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000003', false, 'skipped', 'patient_skipped'); rollback;
begin; select test.expect_ok('nurse A no-shows own in_progress',      '10000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000003', true,  'no_show', 'patient_no_show'); rollback;
begin; select test.expect_ok('admin A no-shows own waiting',          '10000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', true,  'no_show'); rollback;
