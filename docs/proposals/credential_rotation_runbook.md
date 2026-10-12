# Runbook — rotate the four demonstration-account passwords (stage S0)

**Status (2026-10-12): NOT YET ROTATED.** The project owner authorised the rotation, but the two stop conditions in the
authorisation were met in the Claude Code environment: it holds **no Supabase service-role key** (only the public URL and
anon key) and **no password manager** is available to it. Nothing was changed in the production project. Rotation is to be
done by the project owner with the procedure below. The credential cleanup of the repository tree is done (see the PR).

Accounts (patient, receptionist, nurse, admin) are identified by the e-mail addresses documented in the previous
`e2e/helpers.ts` (git history) and now supplied through `E2E_*_EMAIL`. This runbook never contains a password.

## 1. Before you start (owner)

- [ ] A **password manager** (team vault) is ready, with an entry or folder for the four accounts.
- [ ] You have the project's **service-role key** (Supabase Dashboard → Project Settings → API). Treat it like a
      password: it bypasses all security. It is typed into your own shell only, never into chat, a file in the repository,
      a commit message or a log.
- [ ] You know the project's **JWT expiry** (Dashboard → Project Settings → API/JWT). It is the length of the residual
      window in §3.
- [ ] Group members know their tests will stop working until they receive the new credentials (§4).

## 2. Rotate with the supplied script (recommended)

`scripts/rotate-demo-passwords.ts` uses the official Auth Admin API (`auth.admin.updateUserById`). It is a **dry run
unless `--apply` is given**, and it was tested end-to-end against a disposable local Supabase stack (30 checks, see the PR).

```bash
# In a fresh terminal. Replace <...>. Do not paste the key anywhere else.
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service-role key>"          # unset it when done: unset SUPABASE_SERVICE_ROLE_KEY
export E2E_ADMIN_EMAIL=... E2E_NURSE_EMAIL=... E2E_RECEPTIONIST_EMAIL=... E2E_PATIENT_EMAIL=...

# 1. Dry run: matches the four users, prints role + e-mail + user id, changes nothing.
npx tsx scripts/rotate-demo-passwords.ts --project-ref <project-ref>

# 2. Apply. --out must be OUTSIDE the repository (the script refuses a path inside any Git work tree and will not
#    overwrite an existing file). Use a folder only you can read.
npx tsx scripts/rotate-demo-passwords.ts --project-ref <project-ref> --apply --out "<private folder>/demo-passwords.txt"
```

What it guarantees (each asserted by the local tests):
- the four users are matched by **exact e-mail**, each must be exactly one auth user **and** its profile role must be the
  expected one — otherwise **nothing is changed**;
- `--project-ref` must equal the project in `SUPABASE_URL` (you confirm which project is about to change);
- four unique passwords (40 characters, CSPRNG) are written to the `--out` file and re-read **before** any account is
  touched; they are never printed or logged;
- accounts are updated **admin first**, then nurse, receptionist, patient; the first failure stops the run and the summary
  says which roles were updated / failed / not attempted;
- only the password changes: user ids, e-mail, role, profile and all application data are untouched.

Then:
1. Move the four entries from the file into the password manager and **delete the file** (empty the recycle bin; on an SSD
   a delete is not a secure erase, so keep the file in an encrypted folder or location).
2. `unset SUPABASE_SERVICE_ROLE_KEY`. Consider rotating the service-role key itself if it was ever exposed.
3. **Login test without chat:** `npx tsx scripts/rotate-demo-passwords.ts --project-ref <ref> --verify --out "<file>"` (before
   deleting the file; needs `SUPABASE_ANON_KEY`) prints only `OK` / `FAILED` per role. Or sign in once per account in a
   private browser window, copying the password from the password manager.

If the script cannot be used (Auth Admin API unreachable, key unavailable): use the Dashboard (Authentication → Users) to
set a new random password or send a password-recovery e-mail for each of the four users, admin first — the operations
available depend on your dashboard version; they are the same Auth operations. Do not edit `auth.users` or `auth.sessions`
with SQL.

## 3. Sessions — what was established (local, not yet verified on the production project)

Experiment on a disposable local stack running GoTrue **v2.197.0** (throwaway user, admin API; production's Auth version
and settings were not examined):

| Observation | Result |
|---|---|
| `updateUserById(password)`: old password afterwards | rejected; new password accepted |
| the user's **existing refresh token** afterwards | **invalid** — the admin password change ended the session |
| Auth `/user` with the **already-issued access token** afterwards | **403** (session gone) — the app, which verifies users through Auth, rejects it |
| **PostgREST with the already-issued access token** afterwards | **200 until the token expires** (it validates signature + expiry only) |
| `ban_duration` | blocks sign-in; does **not** shorten the access-token window; unnecessary for revocation |
| `auth.admin.signOut(jwt)` | needs the user's own token (an administrator cannot supply it); also ends the session, same residual window |
| admin endpoint to end sessions by user id (`/admin/users/<id>/sessions`) | does not exist (404) |

**Residual window:** someone who already holds a valid access token can still call the REST API (RLS-governed) until that
token expires — at most the project's JWT expiry (3600 s = 1 h is the default; check yours). They cannot refresh it, and the
Next.js application rejects it. Rotate the admin account first, wait out the JWT expiry, and review sign-ins (§5).
Shortening the expiry for the future is a project setting (it affects all users).

## 4. After rotation

- Group members: new credentials only through the password manager → `E2E_*` environment variables (see `.env.example`).
- Tests affected: every spec that signs in as a demo account needs `E2E_*` set; the nine destructive suites are **disabled
  by default** (`E2E_ENABLE_DESTRUCTIVE=1`, local stack only); `scripts/verify.ts` and `scripts/check-4b.ts` now refuse
  anything but a local stack.
- The applied migration `20260808154202_admin_account_and_profile_merge.sql` still contains the old admin password (migrations
  are append-only). After rotation it no longer works, but anyone may have copied it — which is why rotation, not clean-up, is
  the control.

## 5. Still to do after the passwords are rotated (not part of this authorisation)

1. **Review sign-ins** since the repository became public (read-only): `auth.audit_log_entries` and `auth.sessions` for the
   four user ids — unrecognised addresses or times.
2. **Information officer:** if real personal information was reachable through these accounts, decide whether a POPIA
   section 22 notification duty is engaged.
3. Move destructive tests off the shared project (staged plan S1-T) and give test/demo accounts their own demo clinic
   (decision D-ID5); consider retiring the shared admin demo account.
4. Add secret scanning (GitHub push protection / gitleaks) so a credential cannot be committed again.
