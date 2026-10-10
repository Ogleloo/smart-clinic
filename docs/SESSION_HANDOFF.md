# Session Handoff — Smart Clinic

Latest development checkpoint. Read this when continuing previous work.

---

## Latest checkpoint — Nurse V3 Phase 2: My Queue

**Date:** 2026-10-10 · **Branch:** `feat/nurse-v3-my-queue` · **Draft PR #31** (do not merge; Phase 3 not started). No migrations, no RLS change, nothing written to the shared project.

### Security-review follow-up (latest)

- **V3 Skip disabled fail-closed.** The first push's `skipWaitingPatient` (read status, then `skip_patient()`) had a time-of-check/time-of-use race: another nurse's `next_patient()` between the two could have its consultation closed. `skipWaitingPatient`, `waitingSkipRefusal` and `NurseSkipModal` are **removed** (no endpoint left); waiting rows show an `aria-disabled` Skip that does nothing, focusable and described by a note: "Skip is temporarily unavailable on My Queue … ask reception to skip them" (reception's `skip_patient` path is atomic). A source-scan test asserts no V3 file references any skip action. The modal can be restored from commit `ce4422a`.
- **Atomic fix proposed, not applied:** `docs/proposals/skip_waiting_patient_atomic.md` + `docs/proposals/skip_waiting_patient.sql` — new additive `skip_waiting_patient(uuid)` (same auth/clinic checks as `skip_patient`, `for update` then `status = 'waiting'` under the lock, never touches consultations, revoke public/anon). Disposable-Postgres harness `bash supabase/tests/skip_waiting_patient_proposal/run.sh`: 24/24 cases, 13/13 concurrency checks (incl. a control that reproduces the old race); the same suite against a no-lock copy fails 3 checks.
- **Found, not changed (per instruction): the classic `/nurse` Skip has the same race, wider** — `SkipButton` → `skipPatient` → `skip_patient()` as a nurse with no status check at all. Proposal §6 covers moving it onto the new function.
- **End session report fixed.** Cause: `NurseHeader` rendered the `endSession` slot only while on duty, so `EndSessionControl` (which holds the "Session ended…" report) unmounted when the refresh delivered `is_on_duty = false`; on `/nurse/queue` the whole view was also keyed on duty. Now the slot is always rendered at a stable position, and My Queue keys only its body. Regression tests for both screens; each fails with the fix reverted.
- **Shared hook rechecked** on the classic panel in the harness: duplicate-click suppression, same-id retry after a thrown request, Undo expiry, network-failed Undo retry with the original id, focus reconciliation, queue-empty with/without Undo, long-consultation decision.

### What exists

- **`/nurse/queue`** (Figma `161:170`, with `162:534` Queue Updated and `164:192` Patient Called as interaction states; `164:268` Skip Patient not wired) inside the `(v3)` shell. Sidebar/mobile **My Queue → `/nurse/queue`**; dashboard "View all", "Open My Queue" and "Go on duty in My Queue" point there too. `/nurse` is unchanged and linked from My Queue ("Open the classic nurse screen"); `homeForRole('nurse')` is still `/nurse`.
- **State machine extracted, not duplicated:** `lib/hooks/useNextPatientFlow.ts` holds the Next patient / long-consultation / Undo machine moved out of `CurrentPatientPanel`, which now uses it with identical rendering. V3's `CallNextPanel` uses the same hook. Additions (both screens): an in-flight guard on submit/undo (same-tick clicks sent 3 requests with the same action id before; now 1), a thrown Server Action call (connection lost) becomes a retryable error with the **same** action id instead of sticking on "Please wait…", an undo that never reached the server stays retryable, and a failed focus-reconcile read no longer blanks the current patient.
- **Data:** `lib/nurseQueue.ts` — pure row building/filtering plus `loadQueueSnapshot` (read-only, used by the server page and every client refresh). Waiting rows = `get_service_queue` in DB order (emergency first); In Consultation = the nurse's own open consultation only; Completed = the nurse's own consultations ended today (RLS `consultations_nurse_write`, filtered explicitly by `nurse_id`), excluding `patient_skipped` / `patient_no_show` / `demo_reset` / `orphaned_test_data`; a `staff_break` close is listed as completed, flagged "Break · not in average". Other nurses' in-progress patients are counted in a footnote, not shown as this nurse's. The nurse's own current patient is never also shown as waiting (stale read just after a call).
- **Refresh:** realtime ping, window focus and every completed call/undo re-read the whole snapshot; reads are numbered and an older read that lands late is dropped. Tab, search and filter are local and survive refreshes. A failed refresh keeps the last list and says so.
- **Skip:** disabled fail-closed (see follow-up above); no skip action is wired to any V3 screen.
- **Reused unchanged:** `NurseHeader` (duty, Switch service, End session), `DutyControl`, `EndSessionControl`, `CoverageWarning`, `EmergencyToggle` (only sized down via a wrapper), Reception's `QueueUpdatedToast`.

### Deviations from Figma (deliberate)

No per-row Start Consult / Start Consultation (`next_patient()` picks the patient and opens the consultation atomically) — one **Call next patient / Next patient** control, next token shown as "Next" on position 1 and in the hint (informational). Patient Called (164:192) is shown inline above the queue (not a separate page) so the action id and Undo survive; its Start Consultation slot is **Next patient** with a consequence line. No View Details (no details screen). Skip disabled (when re-enabled: Reason and Notes omitted — no backend persistence — and the copy must say the patient is removed from the waiting queue; Figma's "will remain in the queue" is false). Subtitle says "shared waiting queue for <service>…" not "Patients assigned to you". Duty bar + current-patient panel inserted between header and tabs (no Figma slot; essential workflow). Filters = "Emergency priority only". Contrast: active tab/primary #037F74, Waiting #8A5600/#FFF5DB, Completed #067647/#ECFDF3, danger #B42318. Table from 1280px (Service column from 1400px), cards below. Toast at the bottom (Reception's position would cover the duty bar).

### Tests (`e2e/nurse-v3-queue.spec.ts`)

- **Pure (24) + isolated harness (55) = 79 passed** (after the review follow-up): `e2e/support/nurse-queue-harness` bundles the real components with esbuild, swapping only Server Actions, the Supabase client, the realtime hook and Next router for in-page mocks; it fails the build if server modules are bundled, aborts+records any non-static request, and the mocks throw on writes or unconfigured calls. Covers ordering/emergency, tabs+search+filter, empty/off-duty/no-service/read-failure, current-patient recovery, call idempotency and same-id retry (incl. thrown requests), long-consultation decision, Undo success/refusal/expiry/network retry, Skip disabled (aria-disabled, explained, inert on click/Enter/Space, desktop and mobile), classic-panel regressions, End session report on both screens, emergency toggle wiring, realtime refresh preserving tab/search, queue emptying, out-of-order reads, multi-tab focus reconciliation, offline banner, responsive at 1440/1280/1024/900/768/390, Figma geometry at 1440, accessibility structure. Negative controls run: removing the submit guard, the read-sequence guard, the throw handling, the duplicate-row fix or either End-session fix each makes its test fail.
- **Live read-only (12)**: access (signed out, patient, receptionist), real nurse data with no Figma examples, Waiting count equals the classic screen, sidebar + classic link, no horizontal scroll at six widths. No mutating control is clicked.
- **Not run (write against shared DB):** `nurse-v2`, `nurse-undo`, `dashboard-guard`, reception walk-in/check-in live tests. **Not verified live:** a real call/undo/skip/emergency/duty change from `/nurse/queue` — the wiring is the same Server Actions as `/nurse`, exercised only through mocks.

### Next

1. Decide on the `skip_waiting_patient` proposal (apply → re-enable V3 Skip → move classic Skip onto it), each with its own approval.
2. With approval: a controlled live test on a preview with one synthetic patient (call, undo, call) — no skip until (1).
3. Then review/merge PR #31. Phase 3 (patient details / vitals / notes) needs the RLS/privacy review noted below.

---

## Previous checkpoint — Nurse V3 Phase 1: Dashboard

**Date:** 2026-10-10 · **Branch:** `feat/nurse-v3-dashboard` (from `main` after PR #29 merged). **Not merged — awaiting review.** Phase 2 not started.

### What exists

- **`/nurse/dashboard`** (Figma `05 · Nurse V3`, frame `161:3`): sidebar (264px), hero with the real nurse's name and chip, four stat cards, Today's Queue (730px) and Recent Activity (380px) side by side from 1280px, stacked below.
- **`/nurse` is untouched** and stays the working screen (call next, undo, current patient, waiting list, duty, end session). Nothing redirects to the dashboard; `homeForRole('nurse')` is still `/nurse`. **There is no link from `/nurse` back to the dashboard yet** (adding one would modify the working screen; decide in Phase 2).
- **Routing:** the V3 shell is `app/nurse/(v3)/layout.tsx`. The `(v3)` route group means it wraps `/nurse/dashboard` and later V3 routes but not `/nurse` itself. `requireRole('nurse')` runs in both the layout and the page.
- **New code:** `components/nurse/v3/*` (sidebar, mobile nav, hero, stat cards, queue panel, activity panel, view), `lib/nurseDashboard.ts` (read-only loader plus pure mapping functions). `.theme-nurse` shares the `.theme-reception` token block in `globals.css` (identical Figma palette); `BrandMark` is now exported from the Reception sidebar and reused.
- **Small shared changes:** `lib/nurseStats.ts` gained a pure `summariseSeenToday()`; `getSeenTodayStats` now delegates to it with identical behaviour, so the working screen and dashboard cannot disagree on "seen today".

### Data mapping (all read-only; nothing here writes)

| Figma | Source | Notes |
|---|---|---|
| My Queue | `get_service_queue` for the nurse's `current_service_id`, waiting rows | "—" and a reason when off duty / no service / read failed |
| In Consultation | the nurse's own open consultation (`getNurseCurrentState`) | 0 or 1, never inferred from queue status |
| Completed Today | `summariseSeenToday` over the nurse's own consultations | personal; excludes breaks, skips and no-shows (they set `exclude_from_prediction`) |
| Avg. Consult Time | same rule (personal), with `service_consultation_stats` shown as "service avg" | the two are labelled apart; no value borrowed from the other |
| Today's Queue | `get_service_queue` (waiting + in-progress, backend order, emergency first) | Position = rank among waiting; elapsed = `waiting_minutes`; "to go" = `get_wait_estimate`, only for waiting rows shown, absent when the engine declines |
| Recent Activity | the nurse's own `consultations` rows today (RLS `consultations_nurse_write`) | one event per consultation: completed / in consultation / skipped / no-show / ended. Patients shown as "S. Ndlovu" |

Figma's trend lines ("+3 from earlier", "+4/-4 from yesterday") are **not shown**: nothing compares with yesterday. Figma's example patients, tokens and times are not used.

### Deviations from Figma (deliberate)

Sidebar shows only working routes (Dashboard, My Queue → `/nurse`) plus Sign Out; Current Patient, Patient History and Reports are not linked. A duty line ("On duty · <service>" / "Off duty" + link to My Queue) was added under the hero text. The hero image is the approved Riverside illustration (same as Reception), not the Figma photo. The profile chip is not a link (no nurse Profile Settings yet; Figma's chevron implies a menu that doesn't exist). Contrast: chip avatar `#037F74` (white on `#08B9A8` is 2.47:1), teal text/borders `#037F74`, Waiting pill `#8A5600` on `#FFF5DB` (Figma's amber is far below 4.5:1). Wait Time shows elapsed and estimate on two lines; Service column hidden between 1280 and 1400px.

### Figma Nurse workflow vs. what the database does (for Phase 2+)

Figma has 13 frames: dashboard, my-queue, patient-details, record-vitals, consultation, complete-consultation, consultation-completed, patient-history, queue-updated, next-patient, patient-called, skip-patient, profile-settings.

- **Next Patient / Patient Called / Undo Call** ↔ `next_patient()` + `undo_next_patient()` (action-specific id, limited window). There is no separate "call". Do not substitute `call_next_patient()`.
- **Start Consultation** has no equivalent: `next_patient` opens the consultation atomically with the call. A Figma "Start" button would have nothing to call (or must be a no-op acknowledgement).
- **Complete Consultation / Consultation Completed** ↔ no standalone complete action in the working flow: a consultation ends when the next patient is called (`ended_counted`, long-consultation record/break decision) or on `end_shift`. `end_consultation()` exists but the nurse screen deliberately does not use it. The completed frame's "You're ready for the next patient" maps to the `queue_empty` result.
- **Skip Patient** ↔ `skip_patient()` (already used by `SkipButton`; closes any open consultation as `patient_skipped`/`patient_no_show`).
- **Record Vitals / Notes / Patient Details / Patient History:** tables and RLS exist (`20261001211949_consultation_notes_and_vitals`, `…v2`, `20261006100008_consolidate_clinical_notes_rls`) but there is no nurse UI today. Needs an RLS/privacy review before Phase 3 (history across visits is a new read).
- **Emergency priority** (`set_emergency_priority`, `EmergencyToggle`) has no Figma frame; keep it.
- **Duty / End Session / coverage warning** have no Figma frame; they stay on `/nurse` until Phase 2 designs a home for them.

### PR #30 review corrections

1. **Independent statistics errors.** `errors.stats` is now only the nurse's own consultation read; a `service_consultation_stats` failure sets a separate `errors.serviceAverage`. Either can fail without hiding the other: a failed service average still shows Completed Today and the personal average ("Yours today · service avg unavailable"), and a failed personal read still shows a service average that loaded ("Yours unavailable · service avg 12 min"). `getNurseDashboardData` takes an optional injected `getCurrentState` (tests only) so the real loader can be run against a fake client.
2. **Unknown wait time.** The `?? 0` display fallback is gone: an empty elapsed time renders "Wait time unavailable" (the engine's estimate, if any, is still shown). Never "0 min elapsed".
3. **Missing clinic name.** The sidebar falls back to "Clinic", not "Riverside Clinic" (the hero chip already dropped the clinic part). The sidebar and mobile nav also tolerate a null pathname.

Regression tests for each were checked by temporarily reintroducing the original defect: each fails, then passes with the fix.

### Tests

- `e2e/nurse-v3-dashboard.spec.ts`: pure logic (queue order/position/elapsed-vs-estimate, activity events and clinic-day boundary, seen-today rule, stat cards, no trend text), real components rendered for each duty/failure state via `e2e/support/render-nurse-dashboard-states.tsx` (run with `tsx`, no database), contrast of the new colours, and a live **read-only** group (sign in, look; asserts no Server Action is invoked by loading the dashboard).
- **Not run on purpose:** `nurse-v2`, `nurse-undo`, `dashboard-guard` (they call `next_patient`/undo or `resetDemoState()`); nothing here starts a shift, skips, or writes. No migrations.
- Existing working-screen behaviour is checked read-only: `/nurse` still loads and its Waiting / Seen-today tiles equal the dashboard's My Queue / Completed Today.
- A sign-in occasionally fails transiently on the slow demo backend ("Those details don't match an account" once, with correct credentials); the live tests retry the sign-in once.

---

## Previous checkpoint — Reception V3 Phase 4: Profile Settings

**Date:** 2026-10-10 · PR #29 — **merged** (all review corrections in; photo backend still not applied).

### What exists now

`/reception/profile/settings` (Figma frame `222:1755`): two panels from 1280px (680 + 416 at 1440), stacked below. Header with the real receptionist chip; Profile Information form (photo block, full name, role, clinic, email, phone, Cancel/Save); Avatar Preview with live initials; "Photo and initials" note; Quick Actions (Change Password as an inline expandable panel, Sign Out via the existing `logout()` action). Every measured offset at 1440 matches the Figma coordinates (cards at y=104/440/600, fields at 264/344/424/504, buttons at 596, title y=22, chip y=14).

Reachable from the Dashboard and Queue header chips (now links; no chevron, since Figma's would promise a dropdown that doesn't exist), a "Profile Settings" row in the sidebar, and the mobile top bar. The mobile bar now pins **Profile** and **Sign Out** on the right: before, Sign Out sat at x≈654 scrolled out of sight inside the page-link strip on a 390px phone.

### Backend findings (read-only, against the shared project)

- **Name and phone are safely editable by a receptionist.** `profiles_update_own` (own row, not role-restricted) + column UPDATE grants limited to `full_name`, `phone`, `date_of_birth`, `id_number` (migration `20261006151206`). Role, clinic_id, is_active etc. cannot be written whatever the browser sends. New `updateStaffProfile` (`app/actions/receptionProfile.ts`) writes only name and phone, finds the row by the signed-in user's own `auth_user_id`, and uses `.select()` so a silently filtered update is an error, not a false "saved". The existing patient `updateProfile` was NOT reused: it also writes `date_of_birth` and `id_number`, so it would blank them for a form that doesn't show them.
- **Email is read-only.** It belongs to Supabase Auth; no email-change/verification flow exists anywhere in the app. Not added (needs its own security review).
- **Photo: no backend at all** — no bucket, no Storage policies, 0 objects, no avatar column. Upload / Change Photo and Remove Photo are disabled and say "Photo upload isn't available yet"; initials show. The revised design is in `docs/PROPOSAL_profile_photos.md` (revision 2) and the exact SQL in `docs/proposals/avatar_storage.sql` — **nothing was applied**, and it is deliberately not under `supabase/migrations/`.
- **Password:** reuses the existing `changePassword` (re-authenticates with the current password first), wrapped by `changeStaffPassword`, which then signs out every other session (`signOut({scope:'others'})`) because clinic computers are shared. That revokes the other sessions' refresh tokens; access tokens already issued stay valid until they expire (default 1 h), and the success message now says so. Not exercised for real (see below).

### Deviations from Figma (deliberate)

Save/Cancel are disabled until something changed (Figma shows them enabled); email is grey read-only with a one-line note in the label row (Figma shows it editable-looking); no chevrons on the chip or Sign Out; Change Password's chevron is real (it expands a panel); the Quick Actions Sign Out renders in ink (#07172F, 17.9:1), as in the approved screenshots; avatar preview is centred (Figma's is 12px left of centre); primary buttons (Save, Upload, Update password) use #037F74 / hover #026B62 instead of Figma's #08B9A8 (white text 4.89:1 vs 2.47:1), Cancel's border and text likewise, and error/success text uses #D12F2F / #037F74 instead of the theme's #FF4D4D (3.27:1) / #039486 (3.76:1) — all scoped to this screen; a sidebar "Profile Settings" row and mobile pinned buttons were added for reachability.

### Tests

- `e2e/reception-profile-validation.spec.ts` — 11 pure-logic tests (name, phone, avatar file incl. 5 MB boundary, wrong MIME/extension, a renamed `.exe`/HTML rejected by magic bytes, JPEG-as-PNG).
- `e2e/reception-profile.spec.ts` — live, strictly **read-only** against the shared DB: access (signed-out, patient), real data, role/clinic/email read-only and only `full_name`/`phone` submitted, initials + live preview + Cancel, Save/Cancel availability, photo honestly disabled, name/phone rejection and password rejection (all invalid input, rejected before any database or auth call), double-submit (1 request for 3 same-tick clicks with the first held in flight), nav entry points, layout at 1440/1280/1024/900/768/390 (no horizontal scroll; two panels from 1280), mobile pinned Profile/Sign Out, Sign Out lands on /login.
- **Write paths verified on a throwaway harness with injected mock actions (not committed, 24 checks, all passing):** save success (stored values adopted, no reload, preview updates, message hides on next edit), save error (values kept, Cancel restores the saved name), double-submit (1 call), password wrong/right/cleared/double-click, photo (renamed `.exe`, `.gif`, >5 MB rejected with nothing sent; backend failure keeps no photo; local preview while uploading; photo in form and preview on success; Remove only enabled with a photo; Remove restores initials).
- **Latest run (after review corrections):** validation 11/11; reception-profile 25 run → 24 passed first time, 1 timed out waiting for a page load (dev recompile during the run), then passed 3/3 on re-run; reception-queue 8 passed, 5 skipped (the live queue had no waiting patient; not reset on purpose); mocked check-in 4/4.
- **NOT verified:** a real profile save, a real password change (so `signOut({scope:'others'})` is untested live), a real upload — all would mutate the shared project. The Server Action wiring for those is reviewed, not exercised.

### Things worth knowing

- Reception pages take 8–29s per cold load in dev here (Dashboard 17–24s, Queue 16s, Appointments up to 29s; the new page is one of the faster ones), so the live suite uses long timeouts and a local `loginAs` wrapper that waits for the post-login redirect. The shared `loginAs` can return before that redirect lands on a slow server and make the next `goto` abort.
- React 19 clears all uncontrolled fields after a form action, so after a *wrong current password* all three password fields must be retyped (same as the patient form).
- `lib/profileValidation.ts` gained `parseStaffName` and `parsePhone` (SA formats, stored as `+27 82 123 4567`); existing phone data is free text and is not rewritten.

### PR #29 review corrections (2026-10-10)

Decided by the reviewer: keep the sidebar row; email stays read-only (verified email change is a future task); private, owner-only avatars, one model for all four roles, images re-encoded — and the design must not claim that if direct Storage API calls can bypass it.

- **Photo proposal revision 2:** users get *no* write path at all (no INSERT/UPDATE/DELETE policy on the bucket, no grant on `avatar_path`); the only writer is the server, which re-encodes with `sharp` to 512×512 WebP with no metadata. Uuid filenames, compare-and-set on `avatar_path`, orphan sweeper, 600 s signed URLs, health assertions, expand-only deploy and rollback. Disposable-Postgres harness `supabase/tests/avatar_proposal/run.sh`: 20/20 pass; a negative control (revision 1's upload policy) makes it fail, so it really detects a bypass. Real-Storage tests still to do on a local stack or branch, never the shared project.
- **Object-URL bug fixed:** the saved photo's blob URL was revoked the moment it was promoted, and Remove leaked its URL. Now owned URLs are released only when replaced, removed, failed or on unmount. Verified on a throwaway harness with mocked actions (saved photo renders; replaced URL revoked; Remove revokes). Photo buttons remain disabled in production.
- **Contrast** fixed as listed under deviations. **Password message** corrected as above.
- **1280px login timeout:** not a code defect. Login is a Server Action chaining several Supabase round trips, each 0.4–4.8 s from this machine; submit-to-redirect measured 8–21 s, settings load 6–11 s, and the same test took 27 s–1.3 min across runs. The local `loginAs` wrapper + long timeouts absorb it; re-runs passed 3/3.

### Needs your decision

1. Photo backend: Option A (Next.js + server-only `SUPABASE_SECRET_KEY`, recommended) or B (Edge Function); adding `sharp`; local stack vs Supabase branch for isolated tests; sweeper cron vs manual. See proposal §12.
2. App-wide: the shared primary Button (`bg-primary-700` #039486, 3.76:1 with white) and the reception danger token (#FF4D4D, 3.27:1) fail WCAG AA outside this screen — a separate design decision.
3. Pre-existing, for awareness: `logout()` calls `signOut()` with the default `global` scope, so signing out on one device signs the user out everywhere.

---

## Last checkpoint

**Date:** 2026-10-10
**Branch:** `main` at `8ec98dd` (Vercel production deployment of that commit: success)
**Session:** Reception V3 Phase 3 (Queue Management) closing report. Phase 4 not started.

### Merge status

| PR | What | State |
|---|---|---|
| #25 | Queue Management UI + Skip wiring | merged |
| #26 | `skip_patient()` clinic-isolation migration file + disposable-Postgres test harness | merged 2026-10-10 |
| #27 | Skip toast position/Figma fidelity, header overflow at 768px, double-submit test fix | merged 2026-10-10 |

### The security migration is live (and was not re-applied)

`20261010003117_skip_patient_clinic_isolation` was applied once to project `bffhjvpkfivtbzqielve` via `apply_migration` (no `db push`, nothing replayed or repaired). Before merging #26 it was re-checked read-only: the file's SQL hash equals the statements stored in `schema_migrations` for that version, the filename version equals the deployed version, the live function body is unchanged, history is 61 rows, and #26 only *adds* files. `skip_patient()` now authenticates an active profile, resolves the queue entry only inside the caller's clinic (entry and service clinic must both match), locks the row, lets receptionists skip only `waiting` entries (never `p_no_show`), and returns the same "Queue entry not found" for missing and cross-clinic ids. Re-run the harness with `bash supabase/tests/skip_patient_authorization/run.sh` (needs Docker; 27 cases + 11 concurrency checks must pass, exit 0).

### Controlled live test: passed

One synthetic walk-in ("ZZ Skip Test", Chronic, token CHR-001) went through the real check-in wizard and was skipped once through the real UI: exactly one request carrying the recorded id (fail-closed interceptor), HTTP 200, entry `skipped` with `completed_at` set, no consultation created, success toast shown, list refreshed with no page reload, Chronic filter preserved. Every other record's fingerprint was identical to the pre-test baseline. Dashboard: "Currently Waiting" 1 to 0, "Today's Check-ins" unchanged (a skipped patient did check in).

### Corrections the test led to (PR #27)

- **Toast** covered the profile chip (desktop) and the sticky nav (mobile). Now under the chip from 1280px, at the bottom of the screen below that, non-blocking; brought to the real Figma node (380x76, 12px radius, teal badge). Figma frame 114:1353 itself covers the chip; deliberately not copied. Copy differs on purpose (no predicted "next patient").
- **Queue header overflowed at 768px** (photo squeezed to 0px, page scrolled sideways). Pre-existing since Phase 3. Now stacks below 1024px; regression tests at 768/900/1024/1280. Confirmed on production after deploy: no overflow at 1440/1280/768/390.
- **Double-submit test was wrong, not the app.** Playwright `click()` waits for the button to be enabled, so its "second click" was a legitimate retry after the first request settled. Now three same-tick DOM clicks (without the ref guard in `SkipPatientModal`: 3 requests; with it: 1).

### Known limitations

- **Intermittent test:** the final double-submit spec hit 1 locator timeout (15s waiting for the error alert) in 33 repeats; it did not recur in the next 26 runs and the cause is unproven (likely dev-server latency). Timeouts were then widened to 30s and not re-run, because nothing is waiting any more. The five specs that need a waiting patient (waiting-rows, modal, Escape, forged id, double submit) self-skip whenever the clinic's queue is empty, so a green run does not prove them. Re-run them when a waiting patient exists.
- **Visual verification still open:** the post-fix toast has been measured (zero overlap at 1440/1280/1279/1024/900/768/390) and viewed on a throwaway page rendering the real components, but not seen on the real page after a real skip. That needs a second live write, so it is left for the next time a patient is legitimately skipped. Production was smoke-tested read-only (queue page loads, subtitle updated, no Next buttons, no writes). Screenshots from the test are held locally, not in the repo.
- Pre-existing, unrelated: `scripts/verify.ts` lint errors; migration filename drift for three older files (executable SQL verified identical to what is deployed).

### Pending: synthetic test-record cleanup (NOT done; needs separate approval)

The profile named `ZZ Skip Test` (role patient, no login, no phone/ID/DOB, no clinic) and its `skipped` queue entry `CHR-001` dated 2026-10-10 are still in the shared database. Read-only analysis found: the entry is the only row referencing the profile (`queue_entries.patient_id` is ON DELETE RESTRICT, so the profile cannot be deleted without deleting the entry; keeping the entry and deleting the profile is not possible); one `you_are_next` notification references both and would cascade; no consultations, appointments, vitals or nurse actions reference them; there are no references outside declared foreign keys. Tokens come from `max(token_number)+1` over *today's* entries, so there is no reservation to preserve: deleting frees CHR-001 for the rest of today only, and keeping it makes the next Chronic check-in today CHR-002. The delete would append one `queue_events` row and fire one realtime ping (that table stores no entry id). No admin or dashboard figure counts skipped entries. Leaving the records costs: the name appears in patient search, `skipped` total reads 5 instead of 4, and "Today's Check-ins" shows 1 for the rest of today. `reset_demo_state()` would not pick the profile up (it takes the first 7 no-login patients by name; this one sorts last). Proposed SQL and expected effects were given in the review message for this checkpoint, and need approval before running. Do not call `reset_demo_state()`.

### Phase 3 status

Ready to close, with the two open items above (fixture cleanup decision; post-fix toast seen on the real page once a patient is next legitimately skipped) tracked rather than blocking. Phase 4 (Profile Settings) is next and has not been started.

---

## Previous checkpoint — Reception V3 Phase 1–2, Dashboard visual fidelity, light-theme lock (2026-10-09, merged to `main`)

### What was done (Phase 2, this session)

New route `/reception/check-in` + `CheckInWizard.tsx`, consolidating
`WalkInWizard`/`CheckInAppointmentButton` into one 3-step flow (Figma
frames `111:183` / `111:342` / `111:487` / `112:302`): Find patient →
Confirm details → Add to queue → success.

**Verified live** (one login session, no `reset_demo_state()`): search for
a genuinely new patient → register → confirm (correctly defaults to
walk-in, no appointment found) → pick service → queue summary → confirm →
real queue token (`GC-007`) displayed. Reset ("Check in another patient")
correctly returns to step 1, no stuck-screen regression. Re-checking the
same patient into the same service surfaces the real RPC error ("already
in the queue for this service today") and the button re-enables — found
the "Please wait…" disabled state mid-flight in a screenshot, confirming
the existing double-submit guard (via `useActionState`'s pending flag)
covers this flow too, no new code needed for it. Legacy
`/reception/walk-in?patientId=&patientName=&newPatientName=` redirects to
`/reception/check-in` with all three params preserved — including the
negative case: a bogus `patientId` is correctly rejected ("Couldn't
verify this patient"), never displayed.

**Real bug found and fixed during verification:** a freshly-created walk-in
patient could not be re-read via the normal RLS-scoped `profiles` query —
`profiles_staff_read_clinic_patients` only grants read access once a
patient has an appointment or queue entry (or shares the staff member's
clinic_id), and a patient `create_walkin_patient` just inserted has none
of those yet. Fixed by trusting the RPC's own return value directly for
that one case (it ran server-side, role-checked, under the receptionist's
session — that create call IS the authorized access event) instead of
re-fetching. `CreatePatientState.patient` in `app/actions/reception.ts`
now also carries `phone` so that path doesn't need a second read either.

**Key design decisions:**
- The appointment/walk-in choice is a **real lookup**, not a toggle:
  on selecting a patient, the wizard queries `appointments` for that
  `patient_id` + today (clinic timezone) + `status = 'booked'`. Zero
  results → walk-in only. One or more → receptionist picks; only a real
  `appointment_id` from that query is ever sent to `checkInAppointment`.
  A `patientId` arriving via URL is re-verified through the same
  RLS-scoped query, never trusted/displayed as-is.
- **No predicted-token preview on step 3**, unlike Figma's own "Queue
  token to be issued: GC-016" — the real token only exists after
  `check_in_appointment`/`check_in_patient` actually succeeds, and
  showing a guess first would be exactly the kind of unjustified number
  this project's rules forbid. The success screen shows the real token
  only, from the RPC's actual response.
- **No Notes field** — neither RPC accepts one.
- Patient details on step 2 show only real columns (`full_name`, `phone`,
  `date_of_birth`, `id_number`). Figma's mock also shows "Patient number"
  and "Email address" — neither exists in the schema (no `patient_number`
  column anywhere; no `email` column on `profiles`), so both are omitted
  rather than fabricated.

### Post-review corrections (same checkpoint)

A review of the first PR #21 push caught a real bug and asked for the
appointment path to actually be verified rather than left skipped:

- **Bug fixed:** a failed appointment-lookup query (network error, RLS
  denial, anything) used to fall into the same code path as a genuine
  "zero appointments found" result — both set `appointments` to `[]` and
  silently defaulted to the walk-in path. Fixed by splitting appointment
  fetching into its own `fetchAppointments()`, adding a distinct
  `appointmentLoadError` state, and gating `canConfirm` on
  `appointments !== null` (eligibility actually resolved) rather than
  just "a service or appointment is picked." A failed lookup now shows
  a visible error with Retry and blocks `Continue`/check-in until it
  resolves — it can no longer be silently treated as "no appointment."
- **Appointment path verified via network-mocked Playwright tests**, not
  a live booking: `checkInAppointment` runs as a Server Action, so its
  Supabase RPC call happens on the Next.js server process and is
  invisible to `page.route()` — confirmed by first writing tests that
  tried to intercept `rpc/check_in_appointment` from the browser and
  observing they never fired. The client-side reads
  (`search_patients`/`profiles`/`appointments`) run in the browser and
  *are* interceptable, so the 4 new tests in
  `e2e/reception-checkin.spec.ts` mock those three endpoints only — no
  real Supabase row is read or written, nothing to approve — and verify:
  a real booked appointment's service/time display correctly; with two
  eligible appointments the receptionist's actual choice (not just the
  first) is what the hidden `appointment_id` form input carries
  (checked via `toHaveValue`, not a network capture, for the same
  server-action reason above); the `appointments` query itself carries
  `status=eq.booked` + `scheduled_date=eq.<today, clinic timezone>` +
  the right `patient_id` (proving ineligible appointments are excluded
  by the query, not by client-side filtering); and the Retry fix above.
  **All 4 pass** (`npx playwright test -g "appointment path \(mocked"`).
  Token-display after a real `checkInAppointment` success is not
  separately covered — same success component/code path the live
  walk-in tests already exercise, so not a new gap.
- **Still not run:** no live appointment was booked and
  `resetDemoState()` was not called — both would have needed approval
  first, and the mocked tests above made that unnecessary for what this
  round asked to verify.

**Tests:** `e2e/reception-checkin.spec.ts` — 4 live walk-in tests (new
walk-in + real token, reset-no-stuck, duplicate-checkin RPC error, legacy
redirect + param preservation) **written and listed but not executed**
(every one calls `resetDemoState()`, flagged rather than run without
approval, per the Phase 1 precedent) + 4 network-mocked appointment-path
tests, **executed and passing** (see above, no approval needed — no real
data touched).

**Note:** earlier manual verification this session created a handful of
real `E2E Phase2 *` walk-in patients and queue entries in the shared dev
database (same as the existing `reception-walkin.spec.ts` leaves behind
today) — harmless, cleared by the next `reset_demo_state()`. The mocked
appointment tests added in this correction round created nothing.

### What was done (Phase 1, merged)

Reception V3 scope was read directly off Figma (file `xKCONNQAkEBe56q0rbQuYC`,
page `04 · Reception V3`, 11 frames) since `V3_REQUIREMENTS.md` doesn't break
it down further. Full plan: `docs/V3_REQUIREMENTS.md` still only says
"pending" — the actual scope and the phase-by-phase build plan live in this
session's plan (ask Claude Code to re-derive from Figma if the plan file is
gone).

**Built and verified (`npx tsc --noEmit`, `eslint`, manual login + screenshot
against the dev account):**
- `.theme-reception` design tokens in `app/globals.css` (own palette, same
  mechanism as `.theme-patient` — accent `#08B9A8`/`#039486`, scoped so
  nurse/admin screens are untouched).
- `ReceptionSidebar` (desktop, 264px, 4 nav items) + `ReceptionMobileNav`
  (functional fallback below `md` — no mobile frame exists in Figma, this
  just preserves the nav V2's `ReceptionNav` had at every width).
- `components/reception/PageHeader.tsx` (shared `PAGE_CLASS`/`TYPE`).
- V3 Dashboard (`app/reception/page.tsx`, Figma frame `111:2`) — hero
  welcome + profile chip, 4 stat tiles, Queue Overview table, Today's
  Activity feed. Reuses `getReceptionDashboardData` unchanged; only added
  `patientName` to `ActivityEvent` (data was already fetched, just not
  surfaced) to match the activity feed's per-row patient name.
- Deliberately **dropped** the Figma stat tiles' "+12% from yesterday" trend
  line — no real yesterday-comparison data exists to back it (CLAUDE.md: never
  state a number the system can't justify).

**Known scope decisions carried forward (see plan file for full reasoning):**
- **Call Next Patient will not be built.** `call_next_patient()`
  (`supabase/migrations/20260805171832_nurse_flow.sql`) is hard-gated to
  `role = 'nurse'` and opens a consultation under the calling nurse's own
  id — giving reception this action needs new backend work, which is
  explicitly "undergoing final review" project-wide. Queue Management
  (not yet built) will ship with Skip Patient only (`skip_patient()`
  already grants `receptionist`).
- **Emergency/urgent escalation is out of scope entirely**, not deferred UI —
  `set_emergency_priority()` is nurse/admin-only, same under-review
  territory as Call Next. This is a supervisor-requested future change;
  don't add a priority control to the check-in flow without a backend
  decision first.
- **Appointments / Patients / Reports**: the `SmartClinic/ReceptionSidebar`
  Figma component has 6 states, but only 4 have page designs. Appointments
  nav keeps pointing at the existing, untouched V2
  `app/reception/appointments` page. Patients/Reports have no nav entry
  yet — nothing was deleted, there's just nothing to link to.

### What's next (not started)

- [x] **Check-in wizard** (`/reception/check-in`) — done in Phase 2
      (this checkpoint), on `feat/reception-v3-check-in`, PR not yet
      opened/merged. Appointment-path live verification still pending —
      see Phase 2 notes above.
- [ ] **Queue Management** restyle + Skip Patient modal. Needs a new
      `skipPatient` Server Action in `app/actions/reception.ts` (none
      exists yet) wrapping `skip_patient()` — no RLS/GRANT change, that
      authorization already exists.
- [ ] **Profile Settings** (`/reception/profile`). Reuse
      `updateProfile`/`changePassword` from `app/actions/profile.ts`
      unchanged — but `updateProfile` writes 4 fields
      (`full_name`, `phone`, `date_of_birth`, `id_number`); the reception
      form only shows 2, so it must preserve the caller's existing
      `date_of_birth`/`id_number` rather than blank them. Add
      `/reception/profile` to that action's `revalidatePath` calls. No
      avatar upload (no backend support confirmed).
- [ ] **Nurse V3 screens** — 13 frames in Figma page `05 · Nurse V3`
- [ ] **Admin V3 screens** — 10 frames in Figma page `06 · Admin V3`
- [ ] **Fix SMTP** — configure Gmail App Password so OTP emails work (Confirm email currently OFF)
- [ ] **Fix error display** — `error.message` instead of `JSON.stringify(error)` on auth pages
- [ ] **Input validation** — email, SA phone, name, password strength
- [ ] **Stale queue entries** — 65 entries stuck open across 11 past dates

### Blockers

- SMTP not configured — Resend free tier only delivers to account owner. Gmail App Password recommended but not yet set up.
- Call Next Patient / emergency escalation for reception both need a backend
  decision (new RPC or loosened RLS) that's explicitly still under review —
  do not build either without that decision landing first.

---

## Previous checkpoint — Patient V3 complete (2026-10-09, `main`)

### What was done

1. **Patient V3 screens — deployed to production**
   - Sidebar, Dashboard, Book Appointment wizard, My Appointments, Appointment Details
   - My Queue (V2 explainability preserved), Notifications, Profile, Profile Settings
   - Registration updated with optional DOB and ID number
   - 11 e2e tests in `patient-v3.spec.ts`
   - `npm run build` passes

2. **Sign Out button** — merged via `fix/patient-sign-out` (PR #17)
   - Added to patient sidebar (desktop) and profile page (mobile)
   - 2 new tests in `patient-v3.spec.ts`, logout test selectors fixed

3. **Workflow docs** — merged via `docs/workflow-setup` (PR #18)
   - CLAUDE.md updated: V3 status table, context-efficiency policy
   - Created `docs/ARCHITECTURE.md`, `docs/V3_REQUIREMENTS.md`, `docs/SESSION_HANDOFF.md`
   - Fixed `e2e/logout.spec.ts` patient selectors ("Log out" → "Sign Out")

4. **Database work completed earlier**
   - `consultation_notes` and `patient_vitals` tables with RLS
   - Duplicate policy cleanup migration applied
   - 8 migration files committed to `supabase/migrations/`
   - Clinic phone set to `035 123 4567`, service descriptions added

### What remains

- [x] **Add Sign Out button** — merged via `fix/patient-sign-out`
- [x] **Commit, push and merge** `feat/patient-v3-screens` — live on production
- [x] **Workflow docs** — merged via `docs/workflow-setup`
- [ ] **Reception V3 screens** — 11 frames in Figma page `04 · Reception V3` ← **next task**
- [ ] **Nurse V3 screens** — 13 frames in Figma page `05 · Nurse V3`
- [ ] **Admin V3 screens** — 10 frames in Figma page `06 · Admin V3`
- [ ] **Fix SMTP** — configure Gmail App Password so OTP emails work (Confirm email currently OFF)
- [ ] **Fix error display** — `error.message` instead of `JSON.stringify(error)` on auth pages
- [ ] **Input validation** — email, SA phone, name, password strength
- [ ] **Stale queue entries** — 65 entries stuck open across 11 past dates

### Blockers

- SMTP not configured — Resend free tier only delivers to account owner. Gmail App Password recommended but not yet set up.
