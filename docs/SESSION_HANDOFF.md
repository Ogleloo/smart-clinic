# Session Handoff — Smart Clinic

Latest development checkpoint. Read this when continuing previous work.

---

## Latest checkpoint — Reception V3 Phase 4: Profile Settings

**Date:** 2026-10-10
**Branch:** `feat/reception-v3-profile-settings` (from `main` at `8ec98dd`). **Not merged — awaiting review.**
(The "Last checkpoint" section below is the Phase 3 closing report from PR #28, which was still open when this was written.)

### What exists now

`/reception/profile/settings` (Figma frame `222:1755`): two panels from 1280px (680 + 416 at 1440), stacked below. Header with the real receptionist chip; Profile Information form (photo block, full name, role, clinic, email, phone, Cancel/Save); Avatar Preview with live initials; "Photo and initials" note; Quick Actions (Change Password as an inline expandable panel, Sign Out via the existing `logout()` action). Every measured offset at 1440 matches the Figma coordinates (cards at y=104/440/600, fields at 264/344/424/504, buttons at 596, title y=22, chip y=14).

Reachable from the Dashboard and Queue header chips (now links; no chevron, since Figma's would promise a dropdown that doesn't exist), a "Profile Settings" row in the sidebar, and the mobile top bar. The mobile bar now pins **Profile** and **Sign Out** on the right: before, Sign Out sat at x≈654 scrolled out of sight inside the page-link strip on a 390px phone.

### Backend findings (read-only, against the shared project)

- **Name and phone are safely editable by a receptionist.** `profiles_update_own` (own row, not role-restricted) + column UPDATE grants limited to `full_name`, `phone`, `date_of_birth`, `id_number` (migration `20261006151206`). Role, clinic_id, is_active etc. cannot be written whatever the browser sends. New `updateStaffProfile` (`app/actions/receptionProfile.ts`) writes only name and phone, finds the row by the signed-in user's own `auth_user_id`, and uses `.select()` so a silently filtered update is an error, not a false "saved". The existing patient `updateProfile` was NOT reused: it also writes `date_of_birth` and `id_number`, so it would blank them for a form that doesn't show them.
- **Email is read-only.** It belongs to Supabase Auth; no email-change/verification flow exists anywhere in the app. Not added (needs its own security review).
- **Photo: no backend at all** — no bucket, no Storage policies, 0 objects, no avatar column. Upload / Change Photo and Remove Photo are disabled and say "Photo upload isn't available yet"; initials show. The exact proposed migration, Storage policies, server flow and open decisions are in `docs/PROPOSAL_profile_photos.md` — **nothing was applied**, and it is deliberately not under `supabase/migrations/`.
- **Password:** reuses the existing `changePassword` (re-authenticates with the current password first), wrapped by `changeStaffPassword`, which then signs out every other session (`signOut({scope:'others'})`) because clinic computers are shared. Not exercised for real (see below).

### Deviations from Figma (deliberate)

Save/Cancel are disabled until something changed (Figma shows them enabled); email is grey read-only with a one-line note in the label row (Figma shows it editable-looking); no chevrons on the chip or Sign Out; Change Password's chevron is real (it expands a panel); Sign Out uses the accessible `text-danger` token (#B42318) rather than Figma's #E53935 (4.2:1 on white); avatar preview is centred (Figma's is 12px left of centre); Save uses Figma's #08B9A8 fill, which is only ~2.3:1 against white text (a property of the design, shared with the Phase 3 filter pills); a sidebar "Profile Settings" row and mobile pinned buttons were added for reachability.

### Tests

- `e2e/reception-profile-validation.spec.ts` — 11 pure-logic tests (name, phone, avatar file incl. 5 MB boundary, wrong MIME/extension, a renamed `.exe`/HTML rejected by magic bytes, JPEG-as-PNG).
- `e2e/reception-profile.spec.ts` — live, strictly **read-only** against the shared DB: access (signed-out, patient), real data, role/clinic/email read-only and only `full_name`/`phone` submitted, initials + live preview + Cancel, Save/Cancel availability, photo honestly disabled, name/phone rejection and password rejection (all invalid input, rejected before any database or auth call), double-submit (1 request for 3 same-tick clicks with the first held in flight), nav entry points, layout at 1440/1280/1024/900/768/390 (no horizontal scroll; two panels from 1280), mobile pinned Profile/Sign Out, Sign Out lands on /login.
- **Write paths verified on a throwaway harness with injected mock actions (not committed, 24 checks, all passing):** save success (stored values adopted, no reload, preview updates, message hides on next edit), save error (values kept, Cancel restores the saved name), double-submit (1 call), password wrong/right/cleared/double-click, photo (renamed `.exe`, `.gif`, >5 MB rejected with nothing sent; backend failure keeps no photo; local preview while uploading; photo in form and preview on success; Remove only enabled with a photo; Remove restores initials).
- **NOT verified:** a real profile save, a real password change (so `signOut({scope:'others'})` is untested live), a real upload — all would mutate the shared project. The Server Action wiring for those is reviewed, not exercised.

### Things worth knowing

- Reception pages take 8–29s per cold load in dev here (Dashboard 17–24s, Queue 16s, Appointments up to 29s; the new page is one of the faster ones), so the live suite uses long timeouts and a local `loginAs` wrapper that waits for the post-login redirect. The shared `loginAs` can return before that redirect lands on a slow server and make the next `goto` abort.
- React 19 clears all uncontrolled fields after a form action, so after a *wrong current password* all three password fields must be retyped (same as the patient form).
- `lib/profileValidation.ts` gained `parseStaffName` and `parsePhone` (SA formats, stored as `+27 82 123 4567`); existing phone data is free text and is not rewritten.

### Needs your decision

1. Approve, change or reject the photo storage proposal (`docs/PROPOSAL_profile_photos.md`) — in particular who may see a photo (owner-only vs clinic-wide) and whether to re-encode images to strip metadata.
2. Whether to add a verified email-change flow (Supabase secure email change needs SMTP + confirmation settings reviewed).
3. Whether the sidebar "Profile Settings" row should stay (it is not in Figma).

---

## Last checkpoint

**Date:** 2026-10-10
**Branch:** `fix/skip-queue-toast-and-double-submit-test` (from `main` at `4598e55`; PR #25 and the Skip wiring are merged, PR #26 is deployed but still open)
**Session:** Reception V3 Phase 3 — the approved controlled end-to-end Skip test, and what it found.

### Controlled live test (one synthetic fixture, one real Skip)

Pre-checks: `skip_patient()` migration live (`20261010003117`, body fingerprint unchanged, `anon` cannot execute), production deployment `4598e55` contains PR #25, receptionist and all services in the same clinic, no existing "ZZ Skip Test". Fixture created through the real check-in wizard: patient **"ZZ Skip Test"** (walk-in, no phone/ID), service **Chronic** (no nurse on duty, so nobody could call it), token **CHR-001**. Rows created: 1 `profiles`, 1 `queue_entries`; 0 consultations, 0 appointments.

The one real Skip succeeded: exactly 1 Server Action request carrying the recorded queue-entry id (a fail-closed interceptor aborts any action request with a different UUID), HTTP 200, entry now `skipped` with `completed_at` set, **no consultation created**, toast "CHR-001 skipped. The queue has been updated.", list already empty by the time the toast appeared (no reload — a window marker survived), Chronic filter still selected, `waiting_today` 1 → 0. Dashboard: "Currently Waiting" 1 → 0; "Today's Check-ins" stays 1 (a skipped patient did check in); in-consultation and scheduled unchanged. `queue_entries` 2736 → 2737, `skipped` 4 → 5, `profiles` 93 → 94; every other record's fingerprint is identical to the pre-test baseline.

**The fixture was left in place (skipped).** Cleanup — deleting the `ZZ Skip Test` profile and its skipped queue entry — is NOT done and needs separate approval. Find them by name ("ZZ Skip Test") / token CHR-001 dated 2026-10-10. Until then, tests that need a waiting patient self-skip.

### Defects found by the test, and fixed on this branch

1. **Toast covered the profile chip** (desktop, 9,108 px²) and the sticky mobile nav (13,246 px²). Figma frame 114:1353 has the same flaw (it moves the chip down and puts the toast on top). Now pinned under the chip band from 1280px up and at the bottom of the screen below that, `pointer-events: none`; also brought to the real Figma node (380×76, 12px radius, teal badge, 16/12px type — it had been built from a screenshot as a pill). Copy deliberately differs from Figma ("Next patient is now GC-014" would predict a patient).
2. **Queue header overflowed at 768px** (fixed 480px title block squeezed the photo to 0px and scrolled the page ~32px). Pre-existing since Phase 3, missed because the width list skipped tablet portrait. Header now stacks below `lg`; regression tests at 768/900/1024/1280.
3. **Double-submit test was wrong, not the app.** It used Playwright `click()` twice; `click()` waits for the button to be enabled, so the "second click" landed after the first request settled (a legitimate retry) — 2 requests in 4/10 runs. Instrumented: second click at +3.6s. Now three same-tick DOM clicks; negative control with the ref guard removed gives 3 requests, with it 1 (React queues extra submissions and runs them after the first settles). The guard in `SkipPatientModal` is necessary and works.

### Known limits
- Toast placement was verified by measurement (`getBoundingClientRect` at 1440/1280/1279/1024/900/768/390) on a throwaway page rendering the real components, and visually on the real page for the pre-fix layout; the post-fix toast has not been seen on the real queue page after a real skip (that would need a second live write).
- The double-submit spec showed 1 locator timeout in 33 runs (15s wait for the error alert, not reproduced in the following 26; timeouts since widened to 30s, not re-run because nothing is waiting any more). Cause not established; most likely dev-server latency.
- `scripts/verify.ts` lint errors are pre-existing and unrelated.

### Next
- Review this PR; decide whether to clean up the fixture.
- PR #26 (migration already deployed) can be merged whenever convenient — it only adds the file and the disposable-Postgres harness.
- Phase 4 (Profile Settings) not started.

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
