# Runbook — rotate the seven demonstration-account passwords (stage S0)

**Status: NOT YET ROTATED.** The project owner authorised the rotation, but the Claude Code environment holds **no Supabase
service-role key** and **no password manager**, so the authorisation's stop conditions applied and nothing was changed in
the production project. The owner runs the procedure below. This runbook never contains a password or a key.

Seven accounts currently share one exposed password (four of them are Nurses). They are identified by e-mail address, which
you supply through environment variables — the addresses are not stored in this repository:

| Label | Environment variable | Expected profile role |
|---|---|---|
| `admin` | `E2E_ADMIN_EMAIL` | admin |
| `nurse` (primary; used by the E2E helpers) | `E2E_NURSE_EMAIL` | nurse |
| `nurse2`, `nurse3`, `nurse4` | `E2E_NURSE2_EMAIL`, `E2E_NURSE3_EMAIL`, `E2E_NURSE4_EMAIL` | nurse |
| `receptionist` | `E2E_RECEPTIONIST_EMAIL` | receptionist |
| `patient` | `E2E_PATIENT_EMAIL` | patient |

## 1. Before you start

- [ ] A **password manager** (team vault) is ready with a place for seven entries.
- [ ] You have the project's **service-role key** (Dashboard → Project Settings → API). It bypasses all security: type it only
      into the secure prompt below — never into chat, a repository file, a commit message, a ticket or a log.
- [ ] You know the project's **JWT expiry** (Dashboard → Project Settings → API/JWT) — the length of the residual window in §4.
- [ ] You know the **project ref** (the part of `https://<ref>.supabase.co`).
- [ ] The seven e-mail addresses are to hand, with no typos and no duplicates.
- [ ] Group members know their tests stop working until they receive new credentials (§5).

## 2. What the script guarantees (all asserted by the local tests, §6)

`scripts/rotate-demo-passwords.ts` uses the official Auth Admin API (`auth.admin.updateUserById`). It is a **dry run unless
`--apply` is given**.

- **Before anything changes** all seven accounts are matched by exact e-mail: each must be exactly one Auth user, with exactly
  one profile whose role is the expected one, and the seven user ids must be distinct. A **duplicate configured address, a
  missing account, a role mismatch or a missing/ambiguous profile aborts the whole run with nothing changed.**
- `--project-ref` must equal the project in `SUPABASE_URL`, so you confirm which project is about to change.
- Seven **different** passwords (40 characters, CSPRNG) are written to your private `--out` file and re-read **before** any
  account is touched. The file is never overwritten; a path inside a Git work tree is refused.
- Rotation order: **admin → nurse → nurse2 → nurse3 → nurse4 → receptionist → patient**.
- Only the password changes — user ids, e-mail, role, metadata, profiles and application data are untouched.
- Output is limited to labels, e-mail addresses, user ids and status. **No password and no key is ever printed.**
- **Partial failure:** the first failure stops the run; the summary names every account as `updated`, `FAILED` or
  `not attempted`. Accounts not yet updated keep their OLD password. Finish with `--resume` (§3 step 7), which re-applies the
  **same file** (idempotent) — no new passwords are generated.

## 3. Procedure — Windows PowerShell

Run in a **fresh PowerShell window** opened at the repository root. Replace every `<...>`.

```powershell
# --- 0. Where you are -----------------------------------------------------------------------------------------------
Set-Location C:\Users\dell\smart-clinic          # the branch that contains scripts\rotate-demo-passwords.ts (PR #37)
git branch --show-current                        # expect: chore/remove-demo-credentials (or main once PR #37 is merged)

# --- 1. Target project and the seven e-mail addresses (not secret) ----------------------------------------------------
$ref = "<project-ref>"
$env:SUPABASE_URL            = "https://$ref.supabase.co"
$env:E2E_ADMIN_EMAIL         = "<admin e-mail>"
$env:E2E_NURSE_EMAIL         = "<primary nurse e-mail>"
$env:E2E_NURSE2_EMAIL        = "<nurse 2 e-mail>"
$env:E2E_NURSE3_EMAIL        = "<nurse 3 e-mail>"
$env:E2E_NURSE4_EMAIL        = "<nurse 4 e-mail>"
$env:E2E_RECEPTIONIST_EMAIL  = "<receptionist e-mail>"
$env:E2E_PATIENT_EMAIL       = "<patient e-mail>"

# --- 2. Service-role key through a SECURE prompt (not echoed, not stored in PowerShell history) -----------------------
$k = Read-Host "Paste the service-role key and press Enter" -AsSecureString
$env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new("", $k).Password
$k.Dispose()

# --- 3. A private output folder OUTSIDE the repository and outside OneDrive; only your account can read it ----------------
$dir = Join-Path $env:LOCALAPPDATA "SmartClinicSecrets"
New-Item -ItemType Directory -Force $dir | Out-Null
icacls $dir /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F" | Out-Null
$out = Join-Path $dir ("demo-passwords-" + (Get-Date -Format "yyyyMMdd-HHmm") + ".txt")

# --- 4. DRY RUN: changes nothing. Check the seven lines: right e-mail, right role, seven different user ids. ------------
npx tsx scripts/rotate-demo-passwords.ts --project-ref $ref

# --- 5. APPLY (only after the dry run looked right) -----------------------------------------------------------------------
npx tsx scripts/rotate-demo-passwords.ts --project-ref $ref --apply --out $out
$LASTEXITCODE                                      # 0 = all seven updated; 2 = incomplete (see step 7); 1 = refused, nothing changed

# --- 6. VERIFY: signs each account in with its new password and out again; prints OK / FAILED per account ---------------
$env:SUPABASE_ANON_KEY = "<the project's public anon / publishable key>"   # public, safe to type
npx tsx scripts/rotate-demo-passwords.ts --project-ref $ref --verify --out $out

# --- 7. ONLY IF step 5 reported 'INCOMPLETE': fix the cause, then finish with the SAME file --------------------------------
npx tsx scripts/rotate-demo-passwords.ts --project-ref $ref --resume --out $out

# --- 8. Move the passwords into the password manager (open the file, copy each entry; do NOT print it in the terminal) ---
notepad $out                                       # close WITHOUT saving; clear the clipboard afterwards

# --- 9. Remove the file and every secret from this session ----------------------------------------------------------------
Remove-Item $out -Force
cipher /w:$dir                                     # optional: overwrite free space (a delete alone is not a secure erase on an SSD)
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY, Env:SUPABASE_ANON_KEY -ErrorAction SilentlyContinue
Get-ChildItem Env: | Where-Object Name -like "E2E_*" | Remove-Item
# then close the PowerShell window
```

Notes
- Do not run these commands with `-Verbose`, with `Start-Transcript` active, or in a screen share. The key never appears in
  a command line (it is typed at the prompt), but the environment variable exists for the life of the window.
- Reading the key out of the environment in other tools, or printing `Get-ChildItem Env:`, would expose it.
- After rotating, consider rotating the **service-role key** itself if it has been exposed anywhere.
- If the script cannot be used (Auth Admin API unreachable, key unavailable): use the Dashboard (Authentication → Users) to set
  a new random password or send a recovery e-mail for each of the seven users, admin first — what is offered depends on your
  dashboard version. Do not edit `auth.users` or `auth.sessions` with SQL.

### What the dry run and apply print (no secrets)

```
Target accounts (7; matched by exact e-mail, one profile each, profile role confirmed):
  admin         admin         <e-mail>  user id <uuid>
  nurse         nurse         <e-mail>  user id <uuid>
  ... nurse2, nurse3, nurse4, receptionist, patient ...
Summary: admin: updated · nurse: updated · nurse2: updated · nurse3: updated · nurse4: updated · receptionist: updated · patient: updated
```

| Outcome | Meaning | What to do |
|---|---|---|
| exit **1**, `ERROR: …` | refused **before any change** (missing/duplicate e-mail, account not found, role mismatch, profile missing, key unusable, bad `--out`) | fix the cause, re-run the dry run |
| exit **2**, `INCOMPLETE` | some accounts were updated; those marked FAILED / not attempted still have the OLD password | fix the cause, then `--resume --out $out` with the SAME file |
| exit **0** | all seven updated | verify (step 6), move the passwords, clean up |

## 4. Sessions — what was established (local, not yet verified on the production project)

Experiment on a disposable local stack running GoTrue **v2.197.0** (throwaway user, admin API); production's Auth version and
settings were not examined:

| Observation | Result |
|---|---|
| `updateUserById(password)`: old password afterwards | rejected; new password accepted |
| the user's **existing refresh token** afterwards | **invalid** — the admin password change ended the session |
| Auth `/user` with the **already-issued access token** afterwards | **403** — the Next.js app, which verifies users through Auth, rejects it |
| **PostgREST with the already-issued access token** afterwards | **200 until the token expires** (signature + expiry only) |
| `ban_duration` | blocks sign-in; does not shorten the access-token window; unnecessary for revocation |
| `auth.admin.signOut(jwt)` | needs the user's own token (an administrator cannot supply it) |
| admin endpoint to end sessions by user id | does not exist (404) |

**Residual window:** someone holding a valid access token can still make direct REST calls (RLS-governed) until it expires —
at most the project's JWT expiry (default 3600 s). They cannot refresh it. Rotate the admin first, wait out the JWT expiry,
and review sign-ins (§6).

## 5. After rotation

- Group members get credentials **only through the password manager**, then set the `E2E_*` environment variables (see
  `.env.example`). The E2E helpers use the primary nurse (`E2E_NURSE_*`); `nurse2`–`nurse4` are for manual demos.
- Tests affected: every spec that signs in as a demo account needs its `E2E_*` variables; the nine destructive suites are
  **disabled by default** (`E2E_ENABLE_DESTRUCTIVE=1`, local stack only); `scripts/verify.ts` and `scripts/check-4b.ts` refuse
  anything but a local stack.
- The applied migration `20260808154202_admin_account_and_profile_merge.sql` still contains the old admin password
  (append-only). After rotation it no longer works, but anyone may have copied it — which is why rotation is the control.

## 6. Still to do after rotation (not part of this authorisation)

1. **Review sign-ins** since the repository became public (read-only): `auth.audit_log_entries` and `auth.sessions` for the seven
   user ids — unrecognised addresses or times.
2. **Information officer:** if real personal information was reachable through these accounts, decide whether a POPIA
   section 22 notification duty is engaged.
3. Move destructive tests off the shared project (staged plan S1-T); give demo accounts their own demo clinic (D-ID5);
   consider retiring the shared admin demo account.
4. Add secret scanning (GitHub push protection / gitleaks) so a credential cannot be committed again.

## 7. How the script was tested (local stack only; no production access)

`scripts/rotate-demo-passwords.ts` against a disposable Supabase stack with seven users that **share one old password**, as in
production: **70 checks, 0 failed**. They cover: argument/environment interlocks; the dry run changing nothing; a missing nurse,
missing patient, nurse that is really a patient, nurse without a profile, receptionist whose role was changed, unusable key,
duplicate addresses (including different letter case) — each refused with **nothing changed and no file written**; a full apply
(admin first, seven different ≥24-character passwords, old shared password rejected for all seven, `--verify` OK for all seven);
**user ids, e-mails, metadata, profiles and roles identical before and after**; no password or key in any output or tracked
file; a simulated failure of `nurse3` (admin, nurse, nurse2 updated; nurse3 FAILED; the other three not attempted; old password
still working for the untouched four); `--verify` after the partial run (3 OK / 4 FAILED); refusal of tampered or short-password
files on `--resume`; `--resume` finishing all seven without changing the file. Four deliberately broken copies of the script
(printing a password, sharing one password among the nurses, wrong rotation order, skipping the role check) each fail the
suite. A bug found by these tests — failures after network calls exited with status 127 on Windows / Node 24 — is fixed
(the script now sets the exit code instead of calling `process.exit`).
