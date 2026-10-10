-- PROPOSAL — NOT APPLIED. Reviewed design: docs/PROPOSAL_profile_photos.md.
-- Deliberately outside supabase/migrations/. When approved it becomes a migration file in the same
-- change that applies it (CLAUDE.md). Every statement is additive ("expand"): currently deployed code
-- ignores the new column, bucket and policy, so applying it cannot break production.
--
-- Core property: authenticated users get NO insert/update/delete on the avatars bucket and NO write
-- grant on profiles.avatar_path. The only writer is the app's server (a server-only secret key, which
-- bypasses RLS by design). So every stored object went through the server's decode + re-encode step:
-- the direct Storage REST API and the S3-protocol endpoint both enforce these same RLS policies and
-- have nothing that allows a write.

-- 1. Private bucket. Defence in depth for the server's own writes: only the re-encoded format, small.
--    (Buckets are private by default; stated explicitly so a reviewer can't miss it.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Read-only, owner-only. Exactly one folder level named for the caller's auth user id, and a
--    server-generated file name (uuid.webp). A nested path such as '<uid>/x/<uuid>.webp' has
--    foldername length 2 and is refused; so is anything not matching the file-name pattern.
--    No INSERT / UPDATE / DELETE policies exist for this bucket: RLS denies those for every
--    non-service role.
create policy avatars_owner_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and array_length(storage.foldername(name), 1) = 1
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and storage.filename(name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
  );

-- 3. One avatar reference for every role (patients, receptionists, nurses, admins all live in
--    profiles). Null = show initials. Only accounts with a login can have one, and the path must be
--    exactly '<their auth_user_id>/<uuid>.webp' — never another user's folder, never nested.
alter table public.profiles
  add column avatar_path text,
  add column avatar_updated_at timestamptz;

alter table public.profiles
  add constraint profiles_avatar_path_shape check (
    avatar_path is null
    or (
      auth_user_id is not null
      and avatar_path ~ (
        '^' || auth_user_id::text
        || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
      )
    )
  );

-- 4. No column grant. `authenticated` holds UPDATE only on full_name, phone, date_of_birth and
--    id_number (column-level grants, migration 20261006151206), so the new columns are not writable
--    by users through PostgREST. This revoke is a no-op today and only documents intent. (`anon`
--    keeps Supabase's default table-level privileges, which a column REVOKE cannot narrow; as for
--    every profile column, anon is stopped by RLS — profiles has no policy for anon.)
revoke update (avatar_path, avatar_updated_at) on public.profiles from authenticated;

notify pgrst, 'reload schema';
