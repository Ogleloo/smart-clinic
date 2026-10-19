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

1. **Classification and the spec allowlist** — the config's `testMatch` is an **allowlist**: exactly the classified, top-level
   `e2e/<name>.spec.ts` files. Offline, read-only and self-guarded specs are on it by default; destructive specs only with the
   opt-in. A spec nobody classified — in a sub-folder, or named `.test.ts`, `.spec.tsx`, `.spec.js`, `.spec.mjs`… — can never
   match, in any mode, even if named on the command line. (The earlier design *ignored the unclassified files it could see*, which
   missed every shape Playwright discovers that the listing did not; that was review finding H1.) A test also fails if any
   test-shaped file exists under `e2e/` that is not a classified top-level spec.
2. **Static audit** (`read-only-audit.ts`, run over every read-only spec and the sign-in helpers by `e2e/e2e-safety.spec.ts`).
   It parses the source with the TypeScript compiler and is **deny-by-default**: it lists what a read-only spec *may* do and
   rejects every other submission-capable or ambiguous interaction, instead of listing dangerous button labels (review finding
   H2: a label list let 27 of 35 realistic variants through).
   - *Clicks* only on a link, a button whose literal name is on the allowlist (Sign Out / Log out everywhere; a few named
     client-side controls per spec, in `CLICK_ALLOW_BY_SPEC`), or an allowlisted selector. Anything else — `getByText`, CSS,
     `getByTestId`, a name built from a variable or template, `page.click(selector)`, element handles, a receiver that is a
     parameter or loop variable, `.or()` — is denied.
   - *Keys*: navigation keys only. Enter and Space (they submit forms and activate buttons) and key-by-key typing are denied.
   - *`evaluate()` / `waitForFunction()`* callbacks may only read the page.
   - *No other route to a server*: `fetch`/XHR, `request` / `page.request`, `page.route` / `context.route`, new contexts, init
     scripts, extra headers, `dispatchEvent`, `submit()`, dialogs accepted, `next-action` handling, forged or rewritten requests,
     password typing.
   - *Imports* from a short allowlist; `./helpers` only for the sign-in/booking helpers, which are themselves audited, with six
     reviewed exact-statement exemptions (`APPROVED_HELPER_CALLS`).
   It is still static: it cannot see what a permitted click ends up calling, and a Server Action's writes are invisible to layer
   3. That is why the allowlists are short and every entry is a reviewed decision in `read-only-audit.ts`, not a comment in a
   spec. Offline specs may not use the live helpers at all.
3. **Browser-level guard** (`e2e/support/safe-test.ts`, used by every read-only spec): aborts, records and **fails the test at
   teardown** on any browser request to a Supabase API that would change data: PATCH/PUT/DELETE; a POST to a table; a POST to
   **any RPC not on the positive read allowlist** (`READ_ONLY_RPCS` — unknown and future RPC names are blocked); **any
   non-GET GraphQL request** (a mutation travels in a POST body); auth changes other than sign-in/out; storage; edge functions.
   The fixture is also **sealed at run time**: `page.route`, `context.route`, `routeFromHAR`, `addInitScript`, `exposeFunction`,
   extra headers, and the request-sending methods of `page.request`, `context.request` and the `request` fixture all throw —
   a page-level `route.continue()` would otherwise skip the context guard, and an `APIRequestContext` is never routed.
   *Limits:* a Server Action runs on the app server and its writes are invisible to the browser — layer 2 is what covers those;
   the `browser` fixture cannot be sealed (Playwright builds the context from it), so `browser.newContext()` is rejected
   statically only; realtime websockets are not inspected.
4. **Configuration** — with `E2E_ENABLE_DESTRUCTIVE` set, the config **throws** (nothing runs) on any unsafe setting: a value other
   than `1`, the shared project named in any Supabase/E2E variable, missing or non-local `LOCAL_SUPABASE_*` / `E2E_*` values,
   `E2E_SUPABASE_*` differing from the local stack; and it never auto-starts a dev server in that mode.
   **The dev server is only started when it cannot reach the shared project** (`web-server-plan.ts`, review finding M3). Before
   starting `npm run dev` the config reads what that server would read — the process environment over `.env.development.local`,
   `.env.local`, `.env.development`, `.env`, in Next.js's order — and **refuses** (it runs a command that prints why and exits;
   nothing is started) unless `NEXT_PUBLIC_SUPABASE_URL` is a plain local origin and no related variable names a hosted project.
   Messages name variables and files, never values.
5. **Run time (destructive mode)** — a global setup proves the app **server** reads the local stack (a canary that exists only
   there); destructive specs use a guarded `test` that blocks any browser request to a non-local Supabase host; the destructive
   helpers and write-capable scripts refuse any target that is not a plain local origin, before any network call.

All of this is covered by `e2e/e2e-safety.spec.ts`. It sends nothing to any server: its browser tests use `about:blank` and the
closed local port 9, and its child `playwright test` runs only `--list` or run throw-away specs against that same closed port. The
audit of every spec found, over two rounds, these state-changing or submitting tests that the earlier lists had missed or
mis-classified: `nurse-v2` (calls, records and undoes a consultation); the saving test inside `clinic-hours` (now
`clinic-hours-edit`); the Skip-submission tests in `reception-queue`; the Save/Update-password submissions in
`reception-profile`.

**How to run the suite**

| You want | Run | What starts |
|---|---|---|
| Offline specs only — no backend, no credentials, no `.env.local` | `npm run test:e2e:offline` | a dev server whose Supabase settings are forced to a dead local port (`127.0.0.1:9`) and whose Supabase/database/secret-looking variables are blanked, so it cannot reach any real project whatever `.env.local` says |
| Everything that is safe by default, against a local stack | start the app against the local stack yourself, then set `E2E_BASE_URL=http://localhost:<port>` and the `E2E_*` variables, and run `npm run test:e2e` | nothing — you started the app |
| The same, letting Playwright start the app | only if the environment you run in already names a plain local `NEXT_PUBLIC_SUPABASE_URL` | `npm run dev`, after the plan has checked its configuration |
| Read-only specs against an app wired to shared data | start it yourself and set `E2E_BASE_URL` deliberately | nothing — this is a conscious choice; the config will not start it for you |
| Destructive specs | `E2E_ENABLE_DESTRUCTIVE=1` plus a verified local stack (§ above) | nothing; a canary proves the app reads the local stack |

A plain `npx playwright test` on a machine whose `.env.local` names the shared project now stops with an explanation and starts
nothing. Observed on this repository's own `.env.local`: the run exits with `REFUSING TO START THE APP … NEXT_PUBLIC_SUPABASE_URL
(from .env.local) is not a plain local origin`. The offline entry point was checked with Next.js's own env loader (`@next/env`): given
the plan's environment it resolves the Supabase URL to the placeholder and every other Supabase/secret variable to empty, whereas
the same loader in a fresh process without the overrides does load the shared project from `.env.local`.

**Running the local suites:** write the app origin as **`http://localhost:<port>`**, not `http://127.0.0.1:<port>`. The guards
treat the two spellings as the same machine, so this is a convenience rule, not a safety one.

What was observed, and what is only suspected, about the two failures that led to this rule:

| Observed (reproduced in this repository) | Not established |
|---|---|
| With the app at `http://127.0.0.1:3100`, two local-suite tests failed (2 failed, 52 passed, 12 did not run); the call log shows "waiting for navigation to finish… navigated to /nurse" three times, then a 180 s timeout waiting for the Confirm button. | That those repeated navigations are page **reloads** caused by Next's dev client. An idle `/login` page opened through `127.0.0.1` showed **no** full-page reload in 25 s (one navigation, against two through `localhost`), so "the page reloads while a test waits" is an inference, not something that was traced. |
| The dev-server log for those runs says: "Blocked cross-origin request to Next.js dev resource /_next/hmr from 127.0.0.1" and names `allowedDevOrigins`. Next 16 allows only `localhost` by default. | That the blocked HMR connection **is** what makes those two tests fail. It is the leading suspect: the correlation is complete (every `127.0.0.1` run, no `localhost` run) but the causal path was not isolated. |
| In a scripted browser, the `/_next/hmr` WebSocket handshake **failed and was retried about ten times in 25 s** through `127.0.0.1`, and connected once ("[HMR] connected") through `localhost`. | Whether adding `allowedDevOrigins: ['127.0.0.1']` to `next.config.ts` would remove the failures. It was not tried: it changes application configuration, which this change does not touch. |
| The same two tests against the same server written as `http://localhost:3100` **pass (2/2)**, and the whole local suites pass (66/66) on `localhost`. | |

So: the rule "use `localhost`" rests on the A/B result, not on a proven mechanism. It is a test-environment spelling issue; no
application or safeguard defect was found, and nothing is suppressed.

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
