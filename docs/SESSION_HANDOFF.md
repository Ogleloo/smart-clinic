# Session Handoff — Smart Clinic

Latest development checkpoint. Read this when continuing previous work.

---

## Last checkpoint

**Date:** 2026-10-10
**Branch:** `feat/reception-v3-queue`
**Session:** Reception V3 Phase 3 (Queue Management, Figma frames `114:736` / `114:1204` / `114:1353`) built, stopped for review before merging. Phase 1 (PR #19), image assets (PR #20), Phase 2 (PR #21), the light-theme lock (PR #22) and the Dashboard visual-fidelity pass (PR #23) are all merged to `main`.

### What was done (Phase 3, this session)

Rewrote `/reception/queue` to match Figma: hero header (title/subtitle/photo/profile chip, `QueueHeader.tsx`), service filter pills driven by real active services (not Figma's hardcoded examples), and a single combined 7-column table (`#`, Token, Patient name, Service, Status, Wait time, Actions) — `table-fixed` with explicit column widths so it never overflows at the 1440px reference width (confirmed via `scrollWidth === clientWidth`), with a stacked-card fallback below `md` for 390px.

`ServiceQueueSync.tsx` replaces the old `ServiceQueuePanel.tsx` (deleted — fully superseded): one `useQueueBroadcast` subscription per service runs continuously regardless of which filter pill is selected, so switching filters is a pure client-side re-slice of already-live data rather than a resubscribe, and "All services" stays correctly live across every service at once. `#` position is recomputed client-side from `(priority desc, checked_in_at asc)` for whatever subset is currently shown — `get_service_queue`'s own `queue_position` is only valid within one service and would collide (two "#1"s) once combined.

**Security blocker found and NOT worked around — Skip Patient's write is disabled.** `skip_patient(p_queue_entry_id, p_no_show)` (`supabase/migrations/20260809125334_skip_patient_closes_consultation.sql`) checks only `auth_role() in ('nurse','receptionist','admin')` — it has **no clinic-isolation check at all**. Unlike its sibling nurse-flow RPCs (`call_next_patient` implicitly scopes to the caller's own assigned service; `end_consultation` checks `cons.nurse_id = caller`), nothing here ties the queue entry to the caller's own clinic. Since it's `security definer`, it bypasses RLS entirely — RLS being the project's only security boundary (CLAUDE.md) does not cover this call. Practical exploitability is bounded (the only RLS-scoped read path, `get_service_queue`, already filters to the caller's own clinic, and `get_public_queue_display()` — the one `anon`-callable function — never exposes `queue_entry_id`), but any authenticated staff member who obtains another clinic's queue-entry UUID by any other means could skip or no-show that patient. The migration's own comment already acknowledges the RPC's waiting-only restriction is UI-only and "not sufficient... the RPC remains directly callable" — the same reasoning applies to clinic isolation, which was never added at all.

Per the Phase 3 brief's explicit instruction for this situation ("STOP the Skip write integration and report the security blocker... do not silently weaken rules or introduce an unapproved production migration"), **no Server Action calls `skip_patient()` anywhere in this codebase.** `SkipPatientModal.tsx` is built to the full approved Figma spec (icon badge, patient panel with real token/patient/service/wait-time, Cancel, Confirm) but its Confirm button is permanently disabled with an inline explanation, and Cancel/Escape close it with no network call — verified by a test that arms `page.route` on `rpc/skip_patient` and asserts it's never invoked (`e2e/reception-queue.spec.ts`).

**To unblock:** a new migration adding a clinic-match check to `skip_patient()` (e.g. joining through `queue_entries.service_id → services.clinic_id` and comparing to `auth_clinic_id()`, the same pattern `get_service_queue` already uses) needs review and approval before `SkipPatientModal`'s Confirm button can be wired to a real Server Action. The modal, row-level Skip button, and surrounding UI are otherwise complete — unblocking is expected to be a small, contained change once approved.

**Also omitted, and why:** the Figma "Reason (optional)" dropdown in the Skip modal — `skip_patient()`'s signature has no parameter to persist a reason, and a field whose value is silently discarded is worse than no field (documented in `SkipPatientModal.tsx`). The "Next" (call-next) button Figma shows per waiting row is never rendered for receptionists — `call_next_patient()` is hard-gated to `role='nurse'` and this was out of scope from Phase 1 onward.

**Tests:** `e2e/reception-queue.spec.ts` (7 tests, all passing) reads real live queue data from the shared dev Supabase project — no `resetDemoState()`, no writes, since skip has no live-write path to test at all right now. Covers: position ordering, All-services vs. individual-service filtering, the waiting-vs-in-consultation action split (and that a "Next" button never renders for a receptionist), the Skip modal's content/disabled-Confirm/no-RPC-call, Escape-to-close, and no horizontal overflow at both 1440px and 390px. `QueueUpdatedToast.tsx` (the success state, Figma `114:1353`) was built and visually verified against Figma via a disposable local route (not committed) rather than a live trigger, since there is no safe way to actually succeed a skip yet — it isn't wired into any flow.

### What remains / next session

- **Fix `skip_patient()`'s clinic isolation** (needs an approved migration — see blocker above), then wire `SkipPatientModal`'s Confirm button to a real Server Action and `QueueUpdatedToast` to its real success response.
- Phase 4 (Profile Settings) is next per the original Reception V3 plan — not started.
- Patients/Reports nav items remain absent (no V3 page design exists yet).

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
