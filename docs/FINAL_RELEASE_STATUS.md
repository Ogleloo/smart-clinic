# Final Release Status — Smart Clinic Appointment & Queue Management System

Baseline for the assessed release. Written 2026-11-01 from the merged code on `main`; every statement is graded by how it is known.

| Grade | Meaning |
|---|---|
| **Merged** | The code is on `main` at the release commit (read in the repository). |
| **Offline-tested** | Covered by `npm run test:e2e:offline`: no backend, nothing leaves the machine. Proves validators, contracts and page behaviour — **not** a real database write, email delivery, RLS decision or realtime event. |
| **Previously run** | A suite or manual check recorded in `docs/SESSION_HANDOFF.md` or a PR as having passed on a given date. **Not re-run for this document.** |
| **Owner-reported** | Stated by the project owner; not reproducible from the repository. |
| **Unverified** | Neither tested nor observed. |

"Implemented" never means "fully tested". Where a claim rests on offline tests alone it says so.

---

## 1. Release commit and deployment

| Item | Value |
|---|---|
| Repository | `Ogleloo/smart-clinic` (public) |
| Release commit | `37e4ee68ffd75fe30db9e6693aead87610cab49a` — "feat(auth): require DOB and ID/passport at registration; show/hide password (#38)", merged 2026-11-01 05:04 SAST |
| Production deployment | Vercel, environment *Production*, created 2026-11-01 03:05 UTC for that SHA; commit status `success` (read with `gh api`) |
| Production URL | `smart-clinic-alpha.vercel.app` |
| Framework | Next.js 16.3.6 (App Router, Server Actions), React 19.2.8, TypeScript, Tailwind v4 |
| Database | One Supabase project, `bffhjvpkfivtbzqielve`, **shared by production, previews and local development** — there is no staging database |
| Migrations | 63 files in `supabase/migrations/`; the last is `20261010232531_next_patient_no_key_update.sql`. No migration was applied for or after the release commit |
| Not recorded | A post-merge production smoke test (`CLAUDE.md` requires one); no record exists in the repository. **Unverified.** |

Baseline checks run on the release commit for this document (2026-11-01, local, no Supabase contact):

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint app components lib e2e` | no output (clean) |
| `npm run test:e2e:offline` | **432 passed** (1.9 min) |
| `npm run build` | passed on the PR #38 branch before merge (Supabase URL pointed at a closed local port); the Vercel production build of the release commit succeeded. Not re-run locally here |

## 2. Feature-by-feature implementation status

| Area | Status | Notes |
|---|---|---|
| Patient V3 (sidebar, dashboard, booking wizard, appointments + details, queue with explainability, notifications, profile + settings, sign out) | **Merged** | PRs #15–#17, #20 |
| Registration with required DOB and ID/passport, SA-ID date suggestion, one password rule, show/hide password | **Merged**, offline-tested | PR #38. Fresh-account persistence **unverified** (§5) |
| Email OTP (6 digits), resend, sign-in of unverified account → `/verify` | **Merged**; delivery and verification **owner-reported** working in a live test | UI hard-codes 6 digits |
| Password recovery (`/forgot-password` → email link → `/auth/callback` → `/reset-password`) | **Merged**; recovery email delivery **owner-reported** | Link-based, not OTP |
| Reception V3: shell + dashboard, unified check-in wizard, queue management with Skip, profile settings | **Merged** | PRs #19–#29. Photo upload **not implemented** (no backend; controls disabled) |
| Reception appointments page | **Merged** — V2 screen | Not restyled to V3 |
| Nurse classic screen `/nurse` (call next, undo, current patient, waiting list, duty, end session, emergency toggle) | **Merged** (V2, PR #12) | Still the post-login home for nurses |
| Nurse V3 dashboard `/nurse/dashboard`, My Queue `/nurse/queue` (shared Next/Undo state machine, Skip) | **Merged** | PRs #30, #31 |
| Nurse V3 patient details, vitals, consultation, completion, history, profile settings | **Not started** | Blocked on the clinical-records access review (PR #36) |
| Admin (V2): dashboard, staff + invitations, services, patients, reports, settings (opening hours, idle timeout) | **Merged** (V2, PR #13 and later) | Admin V3 **not started** |
| Public waiting-room display `/display/[serviceId]` | **Merged** (V2, PR #7) | The only `anon`-callable function: `get_public_queue_display()` (ADR-028). V3 display **not started** |
| Landing page `/` | **Merged** (PR #4, #6) | |
| Prediction engine (wait estimate, confidence label, no estimate without an on-duty nurse) | **Merged** — runs in the database | |
| Automatic no-show job, appointment reminders (`pg_cron`) | **Merged** (migrations) | Job execution **not re-verified** for this release |
| Staff idle-timeout sign-out (reception, nurse, admin; never patients) | **Merged** | |
| Staff invitations (`admin_invite_staff`, `accept_staff_invitation`) | **Merged** | Safe only while *Confirm email* is ON (§7) |
| Notifications (booking, queue, no-show, reminders) | **Merged** (migrations + patient page) | |
| Clinical notes / vitals tables with RLS | **Merged** (database only) | No UI; patients cannot read their own notes (POPIA review pending) |

## 3. Workflows

Each line is the path a user takes; the grade says how far it is known to work.

**Patient** — register (name, email, DOB, ID/passport, password) → 6-digit email code → dashboard → book appointment (service → slot → confirm, gets a reference number) → view/cancel appointments → on the day the receptionist checks them in → My Queue shows token, position and a wait estimate with its inputs → notifications → profile settings → sign out.

**Reception** — sign in → dashboard (coverage, queue overview, today's activity) → check-in wizard (find or create patient → confirm details → pick appointment or service → real token issued) → queue management (view by service, Skip a waiting patient) → profile settings (name, phone, password).

**Nurse** — sign in → classic `/nurse` or V3 `/nurse/dashboard` → start duty for a service → `/nurse/queue` or `/nurse`: Next patient (atomic call + consultation open), Undo within its window, Skip a waiting patient, emergency priority, long-consultation decision → End session report → sign out.

**Admin** — sign in → dashboard → staff (invite a nurse/receptionist; invitee registers, verifies email, role applied on acceptance) → services → clinic settings (opening hours, idle timeout) → patients (duplicate detection/merge) → reports.

**Public display** — a waiting-room screen opens `/display/<serviceId>` with nobody signed in and shows the current/next tokens and wait information through the single anon RPC.

## 4. Evidence of testing, by workflow

Spec classes are defined in `e2e/support/e2e-safety.ts` and explained in `CLAUDE.md` ("Safe testing"). Counts are `test(` declarations in the file.

| Workflow | Strongest evidence | What it does *not* establish |
|---|---|---|
| Registration, password rules, show/hide, OTP code entry (UI) | `registration-validation.spec.ts` (57) — **offline, 432-pass run today**: validators, SA-ID vectors incl. leap years and century ambiguity, trigger mirror, persistence contract (keys the form sends = keys the trigger reads), every password-writing action uses the shared rule, real-page tests with every non-GET request aborted | A real registration; that DOB/ID are stored for a **fresh** account; email delivery; the visual appearance of the toggle and year-choice UI (not reviewed) |
| Email OTP delivery and verification, recovery email | **Owner-reported** live test | No automated or reproducible evidence; dashboard settings not in repo |
| Login / logout | `logout.spec.ts` (5, read-only class) — not run for this document | |
| Patient V3 booking/appointments/queue/profile | `patient-v3.spec.ts` (11), `queue-explainability.spec.ts` (5), `appointment-cancel.spec.ts` (1) — **destructive class, disabled by default**; **previously run** (PRs #15–#17, before the safety classification existed) | Cannot be re-run today: no committed local seed; they must not run against the shared project. Current `main` behaviour for these flows is therefore **not freshly tested** |
| Reception dashboard/profile | `reception-profile.spec.ts` (11, read-only), `reception-profile-validation.spec.ts` (11, offline — in today's run) | A real profile save or password change (never exercised live: would mutate shared data) |
| Reception check-in | `reception-checkin.spec.ts` (8, destructive; 4 mocked appointment-path tests passed in PR #21); a controlled live walk-in test passed on 2026-10-09 | Not re-run; appointment check-in not exercised end-to-end live |
| Reception queue + Skip | `reception-queue.spec.ts` (6, read-only; several self-skip when the queue is empty), `reception-queue-actions.spec.ts` (4, destructive); controlled live Skip of one synthetic patient passed 2026-10-10; `skip_patient()` isolation harness: 27 cases + 11 concurrency checks (needs Docker, not re-run) | Green read-only runs with an empty queue do not prove the waiting-row tests |
| Nurse V3 My Queue | `nurse-v3-queue.spec.ts` (90, offline — in today's run): state machine, Undo, Skip dialog, fail-closed states with mocked actions; `nurse-v3-skip.local.spec.ts` (7) and `nurse-classic-skip.local.spec.ts` (18 declarations; 59 results recorded in PR #31) **previously passed on a local Supabase stack** | A real call/undo/skip/emergency/duty change from `/nurse/queue` on a preview or production (**not verified live**) |
| Nurse V3 dashboard | `nurse-v3-dashboard.spec.ts` (49): pure logic + components (no database) + read-only live group | Live group not re-run for this document |
| Classic nurse flow | `nurse-v2.spec.ts`, `nurse-undo.spec.ts` (destructive; **disabled**); database function tests in `supabase/tests/` for `next_patient`, skip functions (local Postgres) | |
| Admin (V2) | `admin-v2.spec.ts` (2), `clinic-hours.spec.ts` (4) read-only; `clinic-hours-edit.spec.ts` destructive | Staff invitation → acceptance end-to-end is **not covered by any committed test** |
| Public display | None in `e2e/`. ADR-028 and the continuously asserted "exactly one anon function" health check | The display page itself has no automated test |
| Prediction engine, no-show, reminders, RLS invariants | `system_health_check()` (13 PASS + 1 INFO) and `system_health_check_v2()` (10/10), last recorded 2026-10-10 after the October migrations | **Not re-run for this document.** The checks cover database invariants, not the UI |
| Test-harness safety | `e2e-safety.spec.ts` (76, offline — in today's run): every spec classified, allowlist, shared project rejected, browser write guard | Nothing enforces it in CI — **no CI exists** |

Overall: today's 432-test run covers four specs (safety harness, Nurse V3 queue state machine, Reception profile validators, registration). **The remaining workflows rest on earlier runs or manual checks that this document did not repeat.**

## 5. Confirmed limitations and untested behaviour

Registration and identity
1. **Fresh-account persistence of DOB and ID is unverified.** In a live test, OTP delivery and verification worked, but an existing test account had no date of birth or ID in its Auth metadata or its profile. The code path (form → Server Action → sign-up metadata → `handle_new_user()` → `profiles` → Profile page) is correct in the repository and covered by contract tests. The leading explanation — re-signing-up an email that already has an unconfirmed account re-sends the code but keeps the old metadata — comes from the Supabase Auth source and has **not been reproduced**. The proposed read-only diagnostic was not run. Until a brand-new account is registered and checked, state only that the code is correct and the live outcome is unknown.
2. Passport **issuing country** and **document type** are not stored; a purely numeric foreign passport of 10+ digits (and a 13-digit one that is not a valid SA ID) cannot register.
3. The unique index on `(clinic_id, id_number)` does not stop two self-registered patients (NULL `clinic_id`) sharing an ID. Unverified against the live schema.
4. Patient profile settings can still clear DOB and ID, and accept any phone text up to 30 characters.
5. Registering with an email that already exists (confirmed or unconfirmed) has no tailored recovery path in the UI.
6. The show/hide password control and the year-choice (19YY/20YY) UI have had **no visual review**.

Other
7. **Reception photo upload does not exist** (no bucket, policies or column; design only, nothing applied).
8. `skip_patient()` still lets a nurse skip an in-progress entry if called directly through the API; no UI does.
9. The committed migrations do not replay on an empty database (demo clinic/services/settings were created outside migrations).
10. `logout()` signs out all of a user's sessions (global scope).
11. Primary button (#039486 on white, 3.76:1) and the Reception danger token (#FF4D4D, 3.27:1) fail WCAG AA outside the screens corrected so far.
12. 65 stale queue entries across 11 past dates were noted earlier and not resolved; not re-checked.
13. A synthetic test record ("ZZ Skip Test" and its skipped entry) remains in the shared database; cleanup was never approved.
14. No CI: nothing automatically runs the tests, secret scanning or lint on a push. `scripts/verify.ts` has pre-existing lint errors.
15. Several test paths cannot run anywhere today (destructive class has no local seed), so regression cover for patient booking, check-in, classic nurse flow and admin edits relies on earlier runs.
16. A comment in `app/actions/auth.ts` still says Confirm Email "is currently off"; it is stale (comment only).

## 6. Outstanding security concerns (PR #36 — open, draft, **nothing applied**)

PR #36 holds proposals, SQL drafts and local test harnesses only. Its branch is behind `main`. The production inventory it relies on was supplied by the reviewer and not re-run by the author. These concerns therefore **exist in the deployed system today**:

| Ref | Concern (as reported in PR #36) | Status |
|---|---|---|
| C0 | Demo-account credentials were committed in a public repository | Passwords removed from the tree and rotated (owner-confirmed, PR #37, merged). **Still open:** review of sign-ins to the shared project since the repository became public; the POPIA s.22 information-officer question; one occurrence remains in an old applied migration (history) |
| F1, F2 | Clinical notes/vitals readable by broad staff roles within a clinic (not treatment-linked) | Open; M1a proposed |
| F3–F7, F9–F11, F15 | Broad direct-write grants and legacy RPCs on clinical/queue tables | Open; M1a proposed |
| F8, F16 | An admin can read every profile in every clinic, including ID numbers, and merge/edit profiles | Open; M2 proposed |
| F12 | Emergency/priority setting rules (Reception should own routine priority; supervisor requirement) | Open; M3/M4 proposed, coordinated release |
| F13 | `reset_demo_state()` callable by admins — destructive | Open; revoke proposed after test isolation |
| F14 | `send_appointment_reminders` execute privilege | Open; revoke proposed |
| R1, R4 | `anon`/`authenticated` hold TRUNCATE/REFERENCES/TRIGGER on all 14 tables; `anon` has DML with RLS as the only barrier | Open; M1b drafted, DML hygiene undecided. Rated defence-in-depth, not directly exploitable |
| — | Mandatory patient identification (SA ID or passport + country) and DB-level uniqueness | Partly addressed in the UI by PR #38; database side (S7) not built |
| — | Patients cannot see their own clinical notes (POPIA access) | Review pending |

The staged order in `docs/proposals/staged_migration_plan.md` (on the PR #36 branch) is S0 credentials → S1 migrations → S1-T test isolation → S5/S2/S3/S4. **None of it is approved for production.** Nurse V3 Phase 3 must not be built before M1a.

## 7. Supabase configuration requirements (no secrets)

Held in the Supabase dashboard / Vercel, **not in this repository** — the owner must re-confirm each before the assessed release.

| Setting | Required value / reason |
|---|---|
| Auth → *Confirm email* | **ON.** The app routes every sign-up to `/verify`; `accept_staff_invitation()` requires `email_confirmed_at`, so with it OFF anyone could register an invited address first and obtain the staff role |
| Auth → *Email OTP Length* | **6** (the verify form accepts exactly six digits) |
| Auth → SMTP | Custom SMTP (Gmail, app password held by the owner) with a sender address that delivers to arbitrary recipients |
| Auth → email templates | *Confirm signup* template must include `{{ .Token }}`; recovery uses the link flow through `/auth/callback` |
| Auth → URL configuration | Site URL = production domain; redirect allow-list includes `/auth/callback` for production (and previews if used) |
| Auth → providers | Email/password only; no other provider is used by the code |
| Realtime | Enabled for `queue_entries`; broadcast authorisation scoped per migration `20260805110754` |
| Extensions / jobs | `pg_cron` with the no-show and reminder jobs; migration `20260814083259_assert_reminder_job_scheduled` asserts the reminder job exists when applied |
| Vercel environment | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` only. The application uses no service-role key |
| Test credentials | `E2E_*` variables, held by the owner in offline storage, never committed |
| Rate limits | Defaults assumed; not reviewed |

## 8. Future enhancements — **not implemented**

- Nurse V3 Phase 3: patient details, vitals, notes, history (after M1a).
- Admin V3 screens; V3 public display; Reception V3 Appointments/Patients/Reports pages.
- Reception profile photos (`docs/PROPOSAL_profile_photos.md`, `docs/proposals/avatar_storage.sql`).
- Reception-managed queue priority and nurse escalation inbox (supervisor requirements, PR #36).
- Identity documents table with issuing country, document type, keyed-hash uniqueness, verified claim codes (S7).
- Verified email change; making identity fields non-clearable; stricter patient phone validation.
- Clearer handling of an already-registered email at sign-up; configurable OTP length in the UI.
- Committed local seed so the destructive suite can run; CI with secret scanning and the offline suite.
- Migration linter (explicit `revoke … from public, anon` per new function/table); DML-hygiene migration.
- Stale-queue cleanup job; removal of `reset_demo_state()` from production.
- `allowedDevOrigins: ['127.0.0.1']` in `next.config.ts` (untried application config).

## 9. Academic documents

See `docs/ACADEMIC_DOCUMENT_INVENTORY.md`: no SRS, SDD, SPMP or Test Plan exists in the repository.
