# Proposal: profile photos (NOT applied — awaiting approval)

Status: **proposal only.** Nothing here has been run against the shared Supabase project
(`bffhjvpkfivtbzqielve`), and the SQL is deliberately **not** in `supabase/migrations/` so it
cannot be mistaken for, or accidentally picked up as, an applied migration. When approved, it
becomes a migration file in the same change that applies it (CLAUDE.md).

## What exists today (read-only inspection, 2026-10-10)

| Thing | State |
|---|---|
| Storage buckets | **none** (`storage.buckets` is empty) |
| Storage policies on `storage.objects` | **none**; 0 objects |
| Photo / avatar column on `profiles` | **none** (columns: id, auth_user_id, full_name, phone, role, is_active, created_at, updated_at, clinic_id, current_service_id, is_on_duty, date_of_birth, id_number) |
| Existing photo code | none; every avatar in the app is initials (`lib/initials.ts`) |
| Profile update path | `profiles_update_own` (own row, any role) + column UPDATE grants limited to full_name, phone, date_of_birth, id_number |

So the Reception Profile Settings page ships with Upload / Change Photo and Remove Photo
**disabled**, labelled "Photo upload isn't available yet", and the initials fallback. The client-side
validation (`lib/avatarFile.ts`: JPEG/PNG only, 5 MB, real magic bytes) and the upload UI are built and
tested, and light up when `photoUploadAvailable` is true and a backend exists.

## Goals

- Only the account owner can upload, replace or remove their own photo.
- JPEG and PNG only, 5 MB maximum, validated on the **server** by content, not only name/MIME.
- Private storage. No public bucket.
- The profile stores only a safe storage path, never a URL.
- One design that Patient, Receptionist, Nurse and Admin avatars can all use later.

## Proposed change (one migration)

```sql
-- 1. A private bucket. file_size_limit and allowed_mime_types are enforced by Storage itself,
--    independent of the app.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- 2. Ownership-scoped Storage policies: an object lives under a folder named for its owner's
--    auth user id, and only that user can touch it. (INSERT also requires the exact file name
--    avatar.jpg / avatar.png so a user holds at most two objects and can't store arbitrary files.)
create policy avatars_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars'
              and (storage.foldername(name))[1] = auth.uid()::text
              and storage.filename(name) in ('avatar.jpg', 'avatar.png'));

create policy avatars_owner_update on storage.objects for update to authenticated
  using      (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
              and storage.filename(name) in ('avatar.jpg', 'avatar.png'));

create policy avatars_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 3. The reference on the profile. Nullable; null means "show initials".
alter table public.profiles add column avatar_path text;

-- The path must point inside the owner's own folder, so a user can never set their avatar to
-- someone else's object even if a future policy let others read it.
alter table public.profiles add constraint profiles_avatar_path_own_folder
  check (avatar_path is null
         or (auth_user_id is not null
             and avatar_path in (auth_user_id::text || '/avatar.jpg',
                                 auth_user_id::text || '/avatar.png')));

-- 4. Let a user write that one column on their own row (profiles_update_own already scopes it).
grant update (avatar_path) on public.profiles to authenticated;
```

## App changes that go with it (separate PR, after the migration is approved and deployed)

- A Server Action `uploadAvatar(formData)` using the **user's own session** (never a service role):
  1. read the file; reject unless size is 1 byte – 5 MB;
  2. check the leading bytes (`FF D8 FF` / `89 50 4E 47 0D 0A 1A 0A`) and that they match the claimed type;
  3. upload to `avatars/{auth.uid()}/avatar.{jpg|png}` with `upsert`;
  4. update `profiles.avatar_path` (`.eq('auth_user_id', user.id).select()`, one row or error);
  5. if step 4 fails, delete the object just written, so no orphan is left behind;
  6. only then report success.
  `removeAvatar()` deletes the object, then nulls the column.
- Reading: the server creates a short-lived **signed URL** for the viewer's own photo and passes it to
  `ProfileSettingsView` (`photoUrl`). Nothing is public.
- `next.config.ts` needs `serverActions.bodySizeLimit: '6mb'` (the default is 1 MB, so a 5 MB photo would be
  refused by the framework before the action runs).
- Re-encoding the image (to strip EXIF/GPS metadata and defuse polyglot files) is recommended and needs an
  image library; that is a dependency decision and is **not** assumed here.

## Open decisions for you

1. **Who may see a photo?** The policies above are owner-only. If patients should see a nurse's photo (or
   staff each other's), that needs an additional SELECT policy scoped by clinic/relationship, plus a server-side
   way to mint signed URLs for other users' objects (a `SECURITY DEFINER` function that checks the
   relationship). Proposed default: owner-only now; widen later with its own review.
2. **Re-encode to strip metadata?** (adds a dependency such as `sharp`.)
3. **Roles:** all four roles from day one, or Receptionist first? The SQL above is role-agnostic.

## Tests required before it ships

- A second, isolated Supabase project or branch for write tests (never the shared one): owner can
  upload/replace/remove; another user cannot read, overwrite or delete the object; a user cannot set
  `avatar_path` to another user's folder (CHECK); a 5 MB + 1 byte file and a `.svg`/`.exe` renamed `.png` are
  rejected; Remove disabled when `avatar_path` is null; failure in step 4 leaves no orphan.
- `system_health_check()` extended (or a new check) to assert: bucket `avatars` is not public, and no
  `storage.objects` policy for it grants `anon` anything.

## Rollback

```sql
drop policy if exists avatars_owner_select on storage.objects;
drop policy if exists avatars_owner_insert on storage.objects;
drop policy if exists avatars_owner_update on storage.objects;
drop policy if exists avatars_owner_delete on storage.objects;
alter table public.profiles drop constraint if exists profiles_avatar_path_own_folder;
revoke update (avatar_path) on public.profiles from authenticated;
alter table public.profiles drop column if exists avatar_path;   -- only once no deployed code reads it
-- delete the bucket's objects first, then:
delete from storage.buckets where id = 'avatars';
```

Per CLAUDE.md, a migration cannot be previewed: it is live in production the moment it is applied, so the
expand-then-remove order above matters (deployed code must stop reading `avatar_path` before the column is dropped).
