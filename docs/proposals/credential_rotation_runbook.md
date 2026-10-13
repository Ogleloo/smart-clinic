# Runbook — demonstration-account passwords (stage S0)

**Status: ROTATION COMPLETED — owner-confirmed (2026-10-13).** The project owner reports that the passwords of the six
demonstration accounts (Admin, Nurse 1, Nurse 2, Nurse 3, Receptionist, Patient) were rotated and that all six new passwords
were verified through Supabase Auth. The owner holds a paper backup and a tested Windows DPAPI-encrypted backup; the
temporary plaintext password file was deleted and the administrative credentials were cleared from the PowerShell session.

What this document does and does not establish: the rotation and its verification were performed by the owner; **the
Claude Code session did not perform, observe or independently verify it** (it never held an administrative key, and made no
request to the production project). This repository now contains no live credential (one *obsolete* password remains in an
applied, append-only migration). No password, key, private path or command output is recorded here.

The procedure below stays as the reference for the **next** rotation, which should happen whenever a credential may have been
exposed, when someone with access leaves, and at least on a schedule the owner sets.

Accounts, identified by e-mail address supplied through environment variables (the addresses are not stored in the repository):

| Label | Environment variable | Expected profile role |
|---|---|---|
| `admin` | `E2E_ADMIN_EMAIL` | admin |
| `nurse` (primary; used by the E2E helpers) | `E2E_NURSE_EMAIL` | nurse |
| `nurse2`, `nurse3` | `E2E_NURSE2_EMAIL`, `E2E_NURSE3_EMAIL` | nurse |
| `receptionist` | `E2E_RECEPTIONIST_EMAIL` | receptionist |
| `patient` | `E2E_PATIENT_EMAIL` | patient |

## 1. Storing credentials — secure offline storage

The project owner keeps the demonstration credentials **offline**; the project does not depend on a hosted password manager.
Principles for any storage method:

- **At least two independent copies, in different forms**, so that losing one is not losing the credentials. The owner's
  arrangement: a **paper backup** kept somewhere physically secure, and a **Windows DPAPI-encrypted file** on the owner's
  machine whose restore has been **tested** (an untested backup is not a backup).
- **DPAPI limits:** a DPAPI-protected file can be decrypted only by the same Windows user on the same machine (unless
  domain-roaming applies). A reinstall, a profile loss or a hardware failure makes it unreadable — which is why a second,
  physical copy exists. Re-test the restore after any Windows or profile change.
- **Paper:** store like any physical secret; do not photograph it, do not keep it with the machine, and record *where* the
  copy is, not what it says, anywhere else.
- **Never** put credentials in the repository, a commit message, a pull request, an issue, chat, e-mail, a ticket, a shared
  drive, a screenshot or a log. Do not leave the plaintext file from a rotation on disk after the credentials are stored.
- **Sharing:** give a team member only the credentials they need, in person or through a channel the owner trusts, and
  rotate after a person with access leaves. Environment variables are set per terminal session and cleared afterwards.

## 2. What the rotation script guarantees (asserted by local tests, §8)

`scripts/rotate-demo-passwords.ts` uses the official Auth Admin API (`auth.admin.updateUserById`). It is a **dry run unless
`--apply` is given**.

- **Before anything changes** all six accounts are matched by exact e-mail: each must be exactly one Auth user, with exactly
  one profile whose role is the expected one, and the six user ids must be distinct. A **duplicate configured address, a
  missing account, a role mismatch or a missing/ambiguous profile aborts the run with nothing changed.**
- `--project-ref` must equal the project in `SUPABASE_URL`, so you confirm which project is about to change.
- Six **different** passwords (40 characters, CSPRNG) are written to your private `--out` file and re-read **before** any
  account is touched. The file is never overwritten; a path inside a Git work tree is refused.
- Rotation order: **admin → nurse → nurse2 → nurse3 → receptionist → patient**.
- Only the password changes — user ids, e-mail, role, metadata, profiles and application data are untouched.
- Output is limited to labels, e-mail addresses, user ids and status. **No password and no key is ever printed.**
- **Partial failure:** the first failure stops the run; the summary names every account as `updated`, `FAILED` or
  `not attempted`. Accounts not yet updated keep their OLD password. Finish with `--resume`, which re-applies the **same
  file** (idempotent) — no new passwords are generated.

## 3. Procedure for a future rotation — Windows PowerShell

Prerequisites: your storage method (§1) is ready; you hold the project's **service-role key** (Dashboard → Project Settings →
API) — it bypasses all security, so type it only into the secure prompt below; you know the **project ref** and the six
e-mail addresses. Run in a **fresh PowerShell window** at the repository root. Replace every `<...>`.

```powershell
# --- 0. Where you are ------------------------------------------------------------------------------------------------
Set-Location <path to the repository>
git branch --show-current                        # expect main (or the branch that contains scripts\rotate-demo-passwords.ts)

# --- 1. Target project and the six e-mail addresses (not secret) ------------------------------------------------------
$ref = "<project-ref>"
$env:SUPABASE_URL            = "https://$ref.supabase.co"
$env:E2E_ADMIN_EMAIL         = "<admin e-mail>"
$env:E2E_NURSE_EMAIL         = "<primary nurse e-mail>"
$env:E2E_NURSE2_EMAIL        = "<nurse 2 e-mail>"
$env:E2E_NURSE3_EMAIL        = "<nurse 3 e-mail>"
$env:E2E_RECEPTIONIST_EMAIL  = "<receptionist e-mail>"
$env:E2E_PATIENT_EMAIL       = "<patient e-mail>"

# --- 2. Service-role key through a SECURE prompt (not echoed, not stored in PowerShell history) ------------------------
$k = Read-Host "Paste the service-role key and press Enter" -AsSecureString
$env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new("", $k).Password
$k.Dispose()

# --- 3. A private output folder OUTSIDE the repository and outside OneDrive; only your account can read it ---------------
$dir = Join-Path $env:LOCALAPPDATA "<a folder name of your choice>"
New-Item -ItemType Directory -Force $dir | Out-Null
icacls $dir /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F" | Out-Null
$out = Join-Path $dir ("demo-passwords-" + (Get-Date -Format "yyyyMMdd-HHmm") + ".txt")

# --- 4. DRY RUN: changes nothing. Check the six lines: right e-mail, right role, six different user ids. ----------------
npx tsx scripts/rotate-demo-passwords.ts --project-ref $ref

# --- 5. APPLY (only after the dry run looked right) -------------------------------------------------------------------------
npx tsx scripts/rotate-demo-passwords.ts --project-ref $ref --apply --out $out
$LASTEXITCODE                                      # 0 = all six updated; 2 = incomplete (see step 7); 1 = refused, nothing changed

# --- 6. VERIFY: signs each account in with its new password and out again; prints OK / FAILED per account -----------------
$env:SUPABASE_ANON_KEY = "<the project's public anon / publishable key>"   # public, safe to type
npx tsx scripts/rotate-demo-passwords.ts --project-ref $ref --verify --out $out

# --- 7. ONLY IF step 5 reported 'INCOMPLETE': fix the cause, then finish with the SAME file ---------------------------------
npx tsx scripts/rotate-demo-passwords.ts --project-ref $ref --resume --out $out

# --- 8. Store the credentials (§1) from the file; do NOT print it in the terminal ------------------------------------------
notepad $out                                       # close WITHOUT saving; clear the clipboard afterwards

# --- 9. Remove the file and every secret from this session -----------------------------------------------------------------
Remove-Item $out -Force
cipher /w:$dir                                     # optional: overwrite free space (a delete alone is not a secure erase on an SSD)
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY, Env:SUPABASE_ANON_KEY -ErrorAction SilentlyContinue
Get-ChildItem Env: | Where-Object Name -like "E2E_*" | Remove-Item
# then close the PowerShell window
```

Notes
- Do not run these commands with `-Verbose`, with `Start-Transcript` active, or in a screen share. Do not print `Get-ChildItem Env:`.
- Rotate the **service-role key** itself if it has ever been exposed.
- If the script cannot be used: use the Dashboard (Authentication → Users) to set a new random password or send a recovery
  e-mail for each user, admin first. Do not edit `auth.users` or `auth.sessions` with SQL.

| Outcome | Meaning | What to do |
|---|---|---|
| exit **1**, `ERROR: …` | refused **before any change** (missing/duplicate e-mail, account not found, role mismatch, profile missing, key unusable, bad `--out`) | fix the cause, re-run the dry run |
| exit **2**, `INCOMPLETE` | some accounts were updated; those marked FAILED / not attempted still have the OLD password | fix the cause, then `--resume` with the SAME file |
| exit **0** | all six updated | verify (step 6), store the credentials, clean up |

## 4. Sessions — what was established (local experiment; not examined on the production project)

Disposable local stack running GoTrue **v2.197.0** (throwaway user, admin API):

| Observation | Result |
|---|---|
| `updateUserById(password)`: old password afterwards | rejected; new password accepted |
| the user's **existing refresh token** afterwards | **invalid** — the admin password change ended the session |
| Auth `/user` with the **already-issued access token** afterwards | **403** — the Next.js app, which verifies users through Auth, rejects it |
| **PostgREST with the already-issued access token** afterwards | **200 until the token expires** (signature + expiry only) |
| `ban_duration` | blocks sign-in; does not shorten the access-token window; unnecessary for revocation |
| admin endpoint to end sessions by user id | does not exist (404) |

**Residual window:** a holder of a valid access token could still make direct REST calls (RLS-governed) until it expired — at
most the project's JWT expiry (default 3600 s), so for the October 2026 rotation it has elapsed. They could not refresh it.

## 5. After the October 2026 rotation

- Credentials reach team members only from the owner's secure offline storage, then into `E2E_*` environment variables (see
  `.env.example`). The E2E helpers use the primary nurse (`E2E_NURSE_*`); `nurse2` and `nurse3` are for manual demos.
- The applied migration `20260808154202_admin_account_and_profile_merge.sql` still contains the **old** admin password
  (migrations are append-only). It no longer works; it remains in history, as do all the old values — which is why rotation, not
  clean-up, was the control.
- Test safety: see §7.

## 6. Still to do (not part of this change)

1. **Review sign-ins** since the repository became public (read-only): `auth.audit_log_entries` and `auth.sessions` for the six
   user ids — unrecognised addresses or times.
2. **Information officer:** if real personal information was reachable through these accounts, decide whether a POPIA
   section 22 notification duty is engaged.
3. Give demo accounts their own demo clinic (decision D-ID5); consider retiring the shared admin demo account.
4. Add secret scanning (GitHub push protection / gitleaks) so a credential cannot be committed again.
5. Add a committed local seed so the destructive suites have something to run against (§7): until then they are disabled.

## 7. Test safety — how the suite is kept away from the shared project

Specs are classified in `e2e/support/e2e-safety.ts`; anything unclassified is treated as destructive.

| Class | May do | Runs by default |
|---|---|---|
| **offline** | nothing outside the test: pure logic, or a mocked harness that intercepts every request; **no sign-in** | yes |
| **read-only** (live) | sign in, sign out, navigate, look. **Never submits anything a server could act on — not even input that is expected to be rejected** | yes |
| **self-guarded** | local-stack suites that prove their own local target; skip unless opted in | yes (they skip) |
| **destructive** | anything that writes, **and anything that submits a mutation-capable action even if it is expected to fail** (forged queue ids, invalid profile fields, a wrong current password, double-submit attempts) | **no** — `E2E_ENABLE_DESTRUCTIVE=1`, verified local stack only |

"Expected to fail" is not "cannot write": a submission calls a mutation-capable endpoint, and if the rejection logic ever
regressed the test would write. So `reception-queue.spec.ts` and `reception-profile.spec.ts` are now strictly read-only, and
their submissions moved to `reception-queue-actions.spec.ts` (Skip, forged ids, repeated submits) and
`reception-profile-actions.spec.ts` (Save Changes, Update password, double submit), both destructive. The live blocks of
`nurse-v3-queue.spec.ts` moved to `nurse-v3-queue-live.spec.ts`, leaving that file fully offline.

Layers, in order:

1. **Classification and the default ignore list** — destructive and unclassified specs are ignored unless explicitly enabled.
2. **Static audit** (`findMutationSubmissions`, run over every read-only spec by `e2e/e2e-safety.spec.ts`): rejects clicks on
   mutation-capable controls (Skip, Save, Update password, Book, Confirm, Check in, Call next, Undo…), Server Action handling
   (`next-action`), forged or rewritten requests, same-tick multi-click, form-submit selectors and password-field typing. It is a
   tripwire, not a proof — it cannot see what a click ends up calling — so anything it cannot rule out belongs in a destructive
   spec. Offline specs may not use the live helpers at all.
3. **Browser-level guard** (`e2e/support/safe-test.ts`, used by every read-only spec): aborts, records and fails the test on any
   browser request to a Supabase API that would change data (PATCH/PUT/DELETE, a POST to a table or a write RPC, auth changes
   other than sign-in/out, storage, edge functions). *Limit:* a Server Action runs on the app server and its writes are invisible
   to the browser — layer 2 is what covers those.
4. **Configuration** — with `E2E_ENABLE_DESTRUCTIVE` set, the config **throws** (nothing runs) on any unsafe setting: a value other
   than `1`, the shared project named in any Supabase/E2E variable, missing or non-local `LOCAL_SUPABASE_*` / `E2E_*` values,
   `E2E_SUPABASE_*` differing from the local stack; and it never auto-starts a dev server in that mode.
5. **Run time (destructive mode)** — a global setup proves the app **server** reads the local stack (a canary that exists only
   there); destructive specs use a guarded `test` that blocks any browser request to a non-local Supabase host; the destructive
   helpers and write-capable scripts refuse any target that is not a plain local origin, before any network call.

All of this is covered by `e2e/e2e-safety.spec.ts` (pure apart from one about:blank browser test that sends nothing to any
server). The audit of every spec found, over two rounds, these state-changing or submitting tests that the earlier lists had
missed or mis-classified: `nurse-v2` (calls, records and undoes a consultation); the saving test inside `clinic-hours` (now
`clinic-hours-edit`); the Skip-submission tests in `reception-queue`; the Save/Update-password submissions in
`reception-profile`.

**Running the local suites:** write the app origin as **`http://localhost:<port>`**, not `http://127.0.0.1:<port>`. Next.js 16's dev
server blocks `/_next/hmr` for any origin other than `localhost` unless it is in `allowedDevOrigins`; with `127.0.0.1` the page
reloads while a test is waiting for a control and the test times out (two local-suite failures were traced to exactly this). The
guards treat the two spellings as the same machine, so it is a convenience rule, not a safety one.

**Remaining exposure of the default configuration:** a default run still auto-starts `npm run dev` when `E2E_BASE_URL` is unset,
and that server reads `.env.local` (normally the shared project) — even for offline specs, which then make no requests to it. Setting
`E2E_BASE_URL` yourself (an app you started, wired to a local stack) avoids it.

## 8. How the rotation script was tested (local stack only; no production access)

`scripts/rotate-demo-passwords.ts` against a disposable Supabase stack with six users that **share one old password**: **71
checks, 0 failed**. They cover: argument/environment interlocks; the dry run changing nothing and listing **exactly six** accounts
(a leftover `E2E_NURSE4_EMAIL` is ignored); a missing nurse, missing patient, nurse that is really a patient, nurse without a
profile, receptionist whose role was changed, unusable key, duplicate addresses (including different letter case) — each
refused with **nothing changed and no file written**; a full apply (admin first, six different ≥24-character passwords, old
shared password rejected for all six, `--verify` OK for all six); **user ids, e-mails, metadata, profiles and roles identical
before and after**; no password or key in any output or tracked file; a simulated failure of `nurse3` followed by `--resume`;
refusal of tampered or short-password files. Five deliberately broken copies of the script each fail the suite. A bug found by
these tests — failures after network calls exited with status 127 on Windows / Node 24 — is fixed.
