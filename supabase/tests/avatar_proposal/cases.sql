-- Assertions for docs/proposals/avatar_storage.sql. Each case prints "PASS [...]" or raises
-- "FAIL [...]"; run.sh requires exactly the expected number of PASS lines and no other errors.
-- User A = 1111..., user B = 2222...; object/file uuids are aaaa..., bbbb..., etc.

insert into public.profiles (auth_user_id, full_name, role) values
  ('11111111-1111-4111-8111-111111111111', 'User A', 'receptionist'),
  ('22222222-2222-4222-8222-222222222222', 'User B', 'patient'),
  (null, 'Walk-in no login', 'patient');

-- Objects as the server (service role) would create them, plus two malformed ones.
insert into storage.objects (bucket_id, name) values
  ('avatars', '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp'),
  ('avatars', '22222222-2222-4222-8222-222222222222/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp'),
  ('avatars', '11111111-1111-4111-8111-111111111111/nested/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp'),
  ('avatars', '11111111-1111-4111-8111-111111111111/avatar.png');

create schema test;

create function test.visible(p_sub text, p_role text) returns setof text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_sub, ''), true);
  execute format('set local role %I', p_role);
  return query select name from storage.objects where bucket_id = 'avatars' order by name;
end $$;

-- ---------- bucket ----------
do $$ begin
  if (select public from storage.buckets where id = 'avatars') is not false then raise exception 'FAIL [bucket is private]'; end if;
  if (select allowed_mime_types from storage.buckets where id = 'avatars') <> array['image/webp'] then raise exception 'FAIL [bucket only accepts image/webp]'; end if;
  if (select file_size_limit from storage.buckets where id = 'avatars') <> 1048576 then raise exception 'FAIL [bucket 1 MB limit]'; end if;
  raise notice 'PASS [bucket is private, accepts image/webp only, 1 MB limit]';
end $$;

-- ---------- reads ----------
begin;
do $$ declare got text[]; begin
  select array_agg(v) into got from test.visible('11111111-1111-4111-8111-111111111111', 'authenticated') v;
  if got is distinct from array['11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp'] then
    raise exception 'FAIL [owner sees exactly their one well-formed avatar] got %', got; end if;
  raise notice 'PASS [owner sees only their own well-formed avatar (not B''s, not a nested path, not a non-uuid name)]';
end $$;
rollback;

begin;
do $$ declare n int; begin
  select count(*) into n from test.visible(null, 'anon');
  if n <> 0 then raise exception 'FAIL [anon sees nothing] saw %', n; end if;
  raise notice 'PASS [anon sees nothing]';
end $$;
rollback;

begin;
do $$ declare n int; begin
  select count(*) into n from test.visible(null, 'authenticated');
  if n <> 0 then raise exception 'FAIL [a token with no subject sees nothing] saw %', n; end if;
  raise notice 'PASS [a token with no subject sees nothing]';
end $$;
rollback;

-- ---------- users cannot write the bucket at all: what makes re-encoding unbypassable ----------
create function test.expect_denied(p_case text, p_sql text) returns void language plpgsql as $$
declare before_count int; affected int; outcome text;
begin
  select count(*) into before_count from storage.objects;
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  begin
    set local role authenticated;
    execute p_sql;
    get diagnostics affected = row_count;
    reset role;
    if affected > 0 then raise exception 'FAIL [%]: statement affected % row(s)', p_case, affected using errcode = 'XX001'; end if;
    outcome := 'filtered by RLS: 0 rows';
  exception
    when sqlstate 'XX001' then raise;
    when others then outcome := sqlerrm;
  end;
  reset role;
  if (select count(*) from storage.objects) <> before_count then raise exception 'FAIL [%]: object count changed', p_case; end if;
  raise notice 'PASS [%] (%)', p_case, outcome;
end $$;

select test.expect_denied('user cannot upload into their own folder',
  $q$insert into storage.objects (bucket_id, name) values ('avatars', '11111111-1111-4111-8111-111111111111/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp')$q$);
select test.expect_denied('user cannot overwrite their own avatar',
  $q$update storage.objects set name = name where bucket_id = 'avatars' and name like '11111111-1111-4111-8111-111111111111/%'$q$);
select test.expect_denied('user cannot delete their own avatar directly',
  $q$delete from storage.objects where bucket_id = 'avatars' and name like '11111111-1111-4111-8111-111111111111/%'$q$);
select test.expect_denied('user cannot delete another user''s avatar',
  $q$delete from storage.objects where bucket_id = 'avatars' and name like '22222222-2222-4222-8222-222222222222/%'$q$);

-- ---------- profiles.avatar_path shape (CHECK) ----------
create function test.expect_check(p_case text, p_auth uuid, p_path text, p_ok boolean) returns void language plpgsql as $$
begin
  begin
    if p_auth is null then
      update public.profiles set avatar_path = p_path where full_name = 'Walk-in no login';
    else
      update public.profiles set avatar_path = p_path where auth_user_id = p_auth;
    end if;
    if not p_ok then raise exception 'FAIL [%]: accepted %', p_case, p_path using errcode = 'XX001'; end if;
    raise notice 'PASS [%] (accepted)', p_case;
  exception
    when sqlstate 'XX001' then raise;
    when check_violation then
      if p_ok then raise exception 'FAIL [%]: rejected %', p_case, p_path; end if;
      raise notice 'PASS [%] (rejected by profiles_avatar_path_shape)', p_case;
  end;
end $$;

begin; select test.expect_check('server sets a well-formed path in the user''s own folder', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp', true); rollback;
begin; select test.expect_check('a path in another user''s folder is rejected', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp', false); rollback;
begin; select test.expect_check('a nested path is rejected', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/x/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp', false); rollback;
begin; select test.expect_check('a .png name is rejected (only re-encoded .webp)', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png', false); rollback;
begin; select test.expect_check('a non-uuid file name is rejected', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/avatar.webp', false); rollback;
begin; select test.expect_check('path traversal is rejected', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/../22222222-2222-4222-8222-222222222222/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp', false); rollback;
begin; select test.expect_check('upper-case hex in the name is rejected (server only writes lower case)', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD.webp', false); rollback;
begin; select test.expect_check('a profile with no login cannot hold an avatar', null, 'x/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp', false); rollback;
begin; select test.expect_check('clearing the avatar (null) is allowed', '11111111-1111-4111-8111-111111111111', null, true); rollback;

-- ---------- column grant ----------
do $$ declare err text; begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  begin
    set local role authenticated;
    update public.profiles set avatar_path = null where auth_user_id = auth.uid();
    reset role;
    raise exception 'FAIL [user cannot write avatar_path via the API]: update succeeded' using errcode = 'XX001';
  exception
    when sqlstate 'XX001' then raise;
    when insufficient_privilege then err := sqlerrm;
  end;
  reset role;
  raise notice 'PASS [user cannot write avatar_path through the API, even on their own row] (%)', err;
end $$;

begin;
do $$ declare n int; begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  set local role authenticated;
  update public.profiles set full_name = 'User A renamed' where auth_user_id = auth.uid();
  get diagnostics n = row_count;
  reset role;
  if n <> 1 then raise exception 'FAIL [existing self-edit of full_name still works] rows=%', n; end if;
  raise notice 'PASS [existing self-edit of full_name still works (no regression)]';
end $$;
rollback;

-- ---------- compare-and-set: how the server serialises Upload vs Upload and Upload vs Remove ----------
begin;
do $$ declare first_rows int; second_rows int; final text; begin
  update public.profiles set avatar_path = '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp'
   where auth_user_id = '11111111-1111-4111-8111-111111111111';
  -- Two requests read the same "expected" value, then race; each writes only if it is still current.
  update public.profiles set avatar_path = '11111111-1111-4111-8111-111111111111/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.webp'
   where auth_user_id = '11111111-1111-4111-8111-111111111111'
     and avatar_path is not distinct from '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp';
  get diagnostics first_rows = row_count;
  update public.profiles set avatar_path = null
   where auth_user_id = '11111111-1111-4111-8111-111111111111'
     and avatar_path is not distinct from '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp';
  get diagnostics second_rows = row_count;
  select avatar_path into final from public.profiles where auth_user_id = '11111111-1111-4111-8111-111111111111';
  if first_rows <> 1 or second_rows <> 0 or final not like '%eeeeeeee%' then
    raise exception 'FAIL [compare-and-set] first=% second=% final=%', first_rows, second_rows, final; end if;
  raise notice 'PASS [compare-and-set: the first of two racing writes wins; the stale one changes nothing and gets 0 rows]';
end $$;
rollback;
