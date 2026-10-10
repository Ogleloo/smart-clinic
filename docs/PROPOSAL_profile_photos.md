# Proposal: profile photos (revision 2, NOT applied, awaiting approval)

Status: **proposal only.** None of this has been run against the shared Supabase project
(`bffhjvpkfivtbzqielve`). The exact SQL lives in
[`docs/proposals/avatar_storage.sql`](proposals/avatar_storage.sql). It is kept out of
`supabase/migrations/` on purpose, so nobody mistakes it for an applied migration. Once approved, it
becomes a migration file in the same change that applies it (CLAUDE.md).

In production the Profile Settings photo buttons stay **disabled** (`photoUploadAvailable={false}`)
until this backend is approved, built and verified.

Revision 1 is replaced by this one. Revision 1 let users upload straight into their own folder. That
allowed a user to skip validation and re-encoding by calling the Storage API directly, so it could
not honestly claim that stored photos are free of metadata. Revision 2 removes every user write path.

## Decisions already made (PR #29 review)

1. Private avatars, readable by the owner only for now.
2. One data model for all four roles (Patient, Receptionist, Nurse, Admin).
3. Uploaded images are re-encoded to remove metadata. The design must not claim this if it can be
   bypassed.
4. Email stays read-only (a separate future task).

## What exists today (read-only inspection, 2026-10-10)

| Thing | State |
|---|---|
| Storage buckets | none |
| Policies on `storage.objects` | none; 0 objects |
| Avatar column on `profiles` | none |
| Profile write path | `profiles_update_own` plus column UPDATE grants on full_name, phone, date_of_birth and id_number only |
| Server credentials in the app | publishable/anon key only (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`); **no secret key** |
| Client-side checks | `lib/avatarFile.ts`: JPEG/PNG only, at most 5 MB, magic bytes (UX only, never trusted) |

## 1. Core property: the server is the only writer

| Who | Read avatars | Write avatars bucket | Write `profiles.avatar_path` |
|---|---|---|---|
| `anon` | no | no | no |
| `authenticated` (any role) | own file only | **no** (no INSERT, UPDATE or DELETE policy) | **no** (no column grant) |
| App server (secret key, server-only) | yes | yes | yes |

This is why re-encoding can't be bypassed:

- With no INSERT, UPDATE or DELETE policy, RLS denies every write to `storage.objects` from user
  tokens ([Storage access control][ac]: "Storage does not allow any uploads to buckets without RLS
  policies").
- The Storage REST API, the TUS resumable endpoint and the S3-protocol endpoint all apply the same RLS
  policies. A user who skips our UI and calls them directly with their own JWT gets nothing.
- `profiles.avatar_path` has no UPDATE grant for `authenticated`. A user therefore can't point their
  profile at some other object.
- So every object in the bucket was written by the server, after the server decoded and re-encoded it.

Only then is the claim "stored avatars contain no EXIF/GPS/ICC metadata" true. **If anyone later adds a
user write policy to this bucket, the claim stops being true.** A negative control proves this (§10),
and a health check guards it (§9).

### Prerequisite decision: a server-only secret key

The server has to write with a key that bypasses RLS. This is a **new privileged capability**, so it
needs explicit approval.

- **Option A (recommended): Next.js Server Action plus `SUPABASE_SECRET_KEY`.**
  - The key is a Vercel env var with **no** `NEXT_PUBLIC_` prefix, and is never sent to the browser.
  - It is used only inside `lib/supabase/admin.ts`. That module starts with `import 'server-only'`,
    so a client import fails the build.
  - The key is used only for the avatar bucket and the two avatar columns. Every other query keeps
    using the user's own client and RLS.
- **Option B: a Supabase Edge Function.** The secret is injected automatically and never stored in
  Vercel. The downside is that Deno image libraries are much weaker than `sharp`: decoding is slower
  and less hardened, and EXIF orientation handling is limited.

Either way, the caller's identity comes from `supabase.auth.getUser()` using the **user's** session,
never from the request body.

## 2. Exact paths and names

```
avatars/<auth_user_id>/<uuid v4, lower-case>.webp
```

- **Exactly one folder level**, named after the owner's `auth.users.id`. Nested paths like
  `<uid>/x/<uuid>.webp` are refused in two places:
  - the read policy requires `array_length(storage.foldername(name), 1) = 1`;
  - the `profiles` CHECK anchors the regex with `^…$`.
- **The server generates the file name** (`crypto.randomUUID()`), never the client. Uploaded file
  names are ignored. That rules out traversal (`..`), Unicode tricks, upper/lower-case duplicates and
  guessable names.
- **The extension is always `.webp`**, whatever the upload was (see §4).
- `profiles_avatar_path_shape` (CHECK) enforces the path inside the database:
  - `avatar_path` is null, **or** the profile has a login and the path matches
    `^<its own auth_user_id>/<uuid>\.webp$`;
  - the server cannot store another user's folder by mistake;
  - a walk-in profile with no login cannot hold an avatar.

## 3. Exact SQL

The file below is the single source of truth. It is copied here for review.

```sql
-- 1. Private bucket. Defence in depth for the server's own writes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Read-only, owner-only. No INSERT / UPDATE / DELETE policies exist for this bucket.
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

-- 3. One avatar reference for every role.
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

-- 4. No column grant (no-op today; documents intent).
revoke update (avatar_path, avatar_updated_at) on public.profiles from authenticated;

notify pgrst, 'reload schema';
```

### Policy by operation

| Operation | Policy | Effect for user tokens |
|---|---|---|
| SELECT | `avatars_owner_read` | Owner reads `<own uid>/<uuid>.webp` only. That's all `createSignedUrl` needs. |
| INSERT | **none** | Denied: no direct upload, no upsert. |
| UPDATE | **none** | Denied: no overwrite, no `move`. |
| DELETE | **none** | Denied: no direct remove. The server deletes. |

Notes:

- `upsert: true` would need INSERT, SELECT **and** UPDATE ([access control][ac]). The server never
  upserts. It always writes a new uuid name.
- RLS on `storage.objects` is already enabled by Supabase. The SQL only adds a policy. Per the
  Supabase docs, storage tables themselves are never altered.
- Helper semantics ([helper functions][hf]):
  - `storage.foldername('a/b/c.webp')` returns `{a,b}`;
  - `storage.filename(...)` returns `c.webp`.
- Both `CHECK` and `allowed_mime_types` guard the **server's** own writes against a coding mistake.
  They are not the security boundary. The absence of write policies is.
- Every statement is additive ("expand"). Currently deployed code ignores the bucket, the policy and
  the columns.

## 4. Server-side decoding, re-encoding and metadata removal

The library is `sharp` (libvips). Next.js already uses it, but only as an optional dependency of
`next`. We'd add it as a **direct** dependency, pinned.

```ts
// app/actions/avatar.ts ('use server'), outline only, not implemented
const MAX_BYTES = 5 * 1024 * 1024
const img = sharp(buf, { limitInputPixels: 25_000_000, failOn: 'error', animated: false })
const meta = await img.metadata()                      // decodes headers, no full decode
if (meta.format !== 'jpeg' && meta.format !== 'png') reject('JPEG or PNG only')
const out = await img
  .rotate()                                            // apply EXIF orientation, then drop it
  .resize(512, 512, { fit: 'cover', position: 'attention' })
  .webp({ quality: 80, effort: 4 })                    // sharp writes no metadata unless .withMetadata()/.keepMetadata()
  .toBuffer()
if (out.length > 1_048_576) reject('Could not process image')
```

| Threat | Mitigation |
|---|---|
| Oversized request | Check `file.size` before reading; `serverActions.bodySizeLimit: '6mb'` in `next.config` (default 1 MB) |
| Decompression bomb | `limitInputPixels` 25 MP; output fixed at 512 × 512 |
| Mislabelled file (e.g. SVG/HTML named .png) | The format comes from **decoded content** (`metadata().format`); the client's MIME type and extension are ignored. SVG, GIF, TIFF and HEIC are refused. |
| Truncated or corrupt file | `failOn: 'error'` throws, and the request is refused with no write |
| Animated PNG | `animated: false`: only the first frame is kept |
| EXIF/GPS/XMP/ICC/comments | Never copied. Output is a new WebP with no metadata. A test asserts `metadata(out)` has no `exif`, `icc`, `xmp` or `iptc`. |
| Polyglot / trailing payload | Re-encoding writes only pixels, so appended bytes are gone |

**Switching between JPEG and PNG.** The server always stores WebP, so switching changes nothing about
storage. There's no `.jpg`/`.png` sibling to clean up, no content-type mismatch, and no stale file
under another extension.

## 5. Flows (all inside one Server Action, server client = secret key)

`expected` = the `avatar_path` the server read at the start of the request.

### Upload or replace

1. `getUser()` from the user's session. No user means refuse.
2. Validate and re-encode (§4). Failure means refuse, and **nothing is written**.
3. Read `profiles.avatar_path` for `auth_user_id = user.id`, and keep it as `expected`.
4. `storage.from('avatars').upload('<uid>/<new uuid>.webp', out, { contentType: 'image/webp', upsert: false })`.
   Failure means refuse; nothing else changed.
5. Compare-and-set:
   `update profiles set avatar_path = new, avatar_updated_at = now() where auth_user_id = uid and avatar_path is not distinct from expected`.
6. **If 0 rows or an error** (DB failure after a successful upload, or a concurrent request won):
   delete the **new** object, tell the user "Your photo changed in another tab, try again" or show a
   generic error, and stop.
7. **If 1 row:** delete the **old** object (`expected`), if there was one.
   - If that delete fails, the old object is an orphan. The sweeper removes it (§6).
   - The user still sees success, because their profile is already correct.
8. `revalidatePath` the profile pages, then return a fresh signed URL.

### Remove

1. `getUser()`, read `expected`. If it is already null, succeed (idempotent).
2. Compare-and-set to `avatar_path = null`.
3. If 1 row, delete the `expected` object (failure leaves an orphan for the sweeper). If 0 rows,
   another request changed it first: report "changed elsewhere", and delete nothing.

### Why this ordering

- **The database row is the truth.** A user can only see an object through `avatar_path` plus a
  signed URL.
- Uploading before the CAS means a failure leaves, at worst, an **unreferenced** object (an orphan).
  It never leaves a profile pointing at a missing file.
- Deleting the old object only after the CAS succeeds means a failed replace never loses the existing
  photo.

### Concurrency (proved in the harness, §10)

- **Two uploads race.** Both read the same `expected` and both upload new uuids. Only the first CAS
  matches. The loser deletes its own new object. Result: exactly one current avatar, with the old one
  and the loser's file both deleted.
- **Upload and Remove race.** Whichever CAS lands first wins. The other gets 0 rows and deletes only
  what it created, which is nothing in the case of Remove. There's never a profile pointing at a
  deleted object, because every delete happens either after its own CAS succeeds or targets an object
  that no row references.
- **Double-submit.** The UI disables both buttons while `photoBusy`. On the server, a repeat request is
  just another CAS race, as above.

## 6. Orphans

Orphans come from three places: a crash between steps 4 and 5, a failed delete in step 7, or a
cleanup failure in step 6.

**Sweeper.** It runs as a scheduled task (Vercel cron or manually) using the server key.

1. **Read-only discovery** in SQL:
   ```sql
   select o.name from storage.objects o
   where o.bucket_id = 'avatars'
     and o.created_at < now() - interval '1 hour'           -- never race an in-flight upload
     and not exists (select 1 from public.profiles p where p.avatar_path = o.name);
   ```
2. **Delete through the Storage API** (`storage.from('avatars').remove(names)`), never with
   `delete from storage.objects`. SQL deletes leave the file behind in the underlying S3 store.

The 1-hour grace period is far longer than any request (the body is limited to 6 MB).

## 7. Signed URLs

- Created on the server with the **user's own client** (`createSignedUrl(path, 600)`), so RLS SELECT
  applies:
  - a user can only sign their own file;
  - a guessed or other user's path fails.
- Expiry is **600 s** (10 min). The page re-signs on every render, so an expired URL only affects a
  tab left open more than 10 minutes, which falls back to initials on image error.
- Signed URLs are bearer links. Anyone holding one can view that one file until it expires. They are
  never logged, stored, or put in the DB. Only the path is stored.
- Signing **after** a Remove fails, because the object is gone. A URL signed **before** the Remove stops
  working once the object is deleted, apart from any cached CDN copy that may last until expiry. That
  is acceptable for a 10-minute link.
- Staff seeing patients' photos (or the reverse) is **out of scope**. It would need a new, separately
  reviewed SELECT policy.

## 8. One model for all four roles

- `profiles` holds every role, so `avatar_path` and `avatar_updated_at` on `profiles` serve Patient,
  Receptionist, Nurse and Admin with **no per-role tables, buckets or policies**.
- The policy keys on `auth.uid()`, not on role.
- A reusable `<Avatar path initials />` server component signs the URL and falls back to initials.
  Each role's V3 phase adds it to its own profile page. Only Reception is wired up now, and even
  that stays disabled.

## 9. Health assertions (added to `system_health_check_v2()` in the same migration)

1. `storage.buckets` row `avatars` has `public = false`.
2. There's no INSERT, UPDATE or DELETE (or ALL) policy on `storage.objects` whose expression mentions
   `'avatars'`. That is the unbypassable-re-encoding invariant.
3. Constraint `profiles_avatar_path_shape` exists.
4. `authenticated` has no UPDATE privilege on `profiles.avatar_path` or `avatar_updated_at`.
5. Every non-null `avatar_path` refers to an existing object, so no dangling references.

## 10. Testing

### Already done: disposable Postgres (no Supabase connection)

`bash supabase/tests/avatar_proposal/run.sh`:

- starts a throwaway `postgres:16` container;
- builds a Supabase-shaped stub (`schema.sql`) mirroring the live grants and policies on `profiles`,
  and Supabase's helper semantics;
- applies `docs/proposals/avatar_storage.sql` **verbatim**;
- runs 20 assertions (`cases.sql`).

It fails closed: an exact case count, and any unexpected SQL error aborts the run.

**Result 2026-10-10: 20/20 PASS, exit 0.**

| Group | Cases |
|---|---|
| Bucket | private, webp only, 1 MB |
| Read | owner sees only their own well-formed object (not another user's, not nested, not a non-uuid name); anon sees nothing; a token with no subject sees nothing |
| Direct writes (the bypass) | user cannot insert into own folder, overwrite own, delete own, or delete another's |
| `avatar_path` CHECK | own folder accepted; another's folder, nested, `.png`, non-uuid, traversal, upper-case and no-login rejected; null accepted |
| Grants | user cannot write `avatar_path` even on own row; existing `full_name` self-edit still works |
| CAS | the first of two racing writes wins; the stale write updates 0 rows |

**Negative control.** `PROPOSAL_SQL=supabase/tests/avatar_proposal/nc_insert_policy.sql bash …/run.sh`
adds revision 1's owner-folder upload policy, and the harness **fails** (19/20, "user cannot upload
into their own folder: statement affected 1 row"). So the test really detects a bypass.

**Limits.** This tests the SQL logic against a stub, not the real Storage service. The real service's
API paths and the S3 endpoint are covered next.

### Still to do before enabling: isolated Supabase, never the shared project

Use either a **local stack** (`supabase start`, Docker) or a **Supabase branch**. A branch is billed,
so it needs approval. Apply the migration there, then:

1. **Direct-API bypass:**
   - with a real user JWT, `POST /storage/v1/object/avatars/<uid>/<uuid>.webp` returns 403;
   - with `x-upsert: true`, also 403;
   - TUS and S3 (session-token auth) uploads are also denied;
   - `DELETE` and `move` on one's own object are denied.
2. **Cross-user:** user B cannot `createSignedUrl` or download A's object. Anon gets nothing.
3. **Malicious files to the Server Action:**
   - SVG renamed `.png`, HTML renamed `.jpg`;
   - a truncated JPEG and a 0-byte file;
   - a 30,000 × 30,000 PNG bomb and an animated PNG;
   - a JPEG with GPS EXIF, which must produce WebP output with no `exif`/`icc`/`xmp`;
   - a 5 MB + 1 byte file.

   All are refused, or produce clean output.
4. **Flows:**
   - first upload; replace, where the old object is gone afterwards;
   - JPEG → PNG → JPEG;
   - remove, and remove again (idempotent).
5. **Failure injection:**
   - force the CAS to match 0 rows: the new object is deleted and the old photo stays;
   - make the old-object delete fail: the user still succeeds, and the sweeper finds the orphan.
6. **Concurrency:** fire 2 uploads, then upload plus remove, in parallel (`Promise.all`). Assert
   exactly one or zero objects, consistent with `avatar_path`.
7. **Signed URLs:** valid for 600 s, then 400 or 403. After Remove, signing fails.
8. All health assertions pass, plus the existing `system_health_check()` and `_v2()`.
9. Playwright on Profile Settings with the flag on, against the isolated stack only.

## 11. Deployment (when approved) and rollback

| Step | Action | Safe because |
|---|---|---|
| 1 | Pass the isolated-stack tests (§10) | — |
| 2 | Commit the migration file and apply it (expand only) | Deployed code ignores the new bucket, policy and columns |
| 3 | Add `SUPABASE_SECRET_KEY` to Vercel (server env, not `NEXT_PUBLIC_`) | Unused until the code ships |
| 4 | Deploy code with `photoUploadAvailable` still **false** | Nothing user-visible |
| 5 | Verify the preview, then turn the flag on in one PR | Easy to revert |

**Rollback, in order:**

1. Set the flag to false and redeploy. Uploads stop at once; photos fall back to initials.
2. Optionally remove the env key.
3. The schema can stay. It's inert without the server writer.
4. If it truly has to go: empty the bucket through the Storage API, then write a **new** "contract"
   migration that drops the policy, constraint and columns, once no deployed code reads them.
   Applied migrations are never edited.

## 12. Open decisions for the reviewer

1. Approve **Option A** (Next.js plus server-only `SUPABASE_SECRET_KEY`) or Option B (Edge Function).
2. Approve adding `sharp` as a direct dependency.
3. Local stack or a Supabase branch for the isolated tests (a branch has a cost).
4. Whether the orphan sweeper runs on a Vercel cron or manually at first.

## References (Supabase docs, checked 2026-10-10)

- [Storage access control][ac]: RLS on `storage.objects`; no policy means no uploads; upsert needs INSERT, SELECT and UPDATE; service key bypasses RLS.
- [Storage helper functions][hf]: `foldername`, `filename`, `extension`.
- [Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits): bucket `file_size_limit`, `allowed_mime_types`.
- [createSignedUrl](https://supabase.com/docs/reference/javascript/storage-from-createsignedurl): `expiresIn` in seconds.
- [User sessions](https://supabase.com/docs/guides/auth/sessions): access tokens stay valid until expiry after sign-out (also the basis of the corrected password-change wording in PR #29).

[ac]: https://supabase.com/docs/guides/storage/security/access-control
[hf]: https://supabase.com/docs/guides/storage/schema/helper-functions
