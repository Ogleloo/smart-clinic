# Session Handoff — Smart Clinic

Latest development checkpoint. Read this when continuing previous work.

---

## Last checkpoint

**Date:** 2026-10-09
**Branch:** `feat/reception-v3`
**Session:** Reception V3 — Phase 1 (shell + Dashboard) built, stopped for review before continuing.

### What was done (this session)

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

- [ ] **Check-in wizard** (`/reception/check-in`) — consolidates
      `WalkInWizard`/`CheckInAppointmentButton`. Must treat the
      appointment-vs-walk-in choice as a real data lookup (does this
      patient have a genuine booked appointment today?), not a UI toggle —
      only pass a real `appointment_id` to `checkInAppointment`. No notes
      field (`check_in_appointment`/`check_in_patient` don't accept one).
      `/reception/walk-in` becomes a redirect preserving `patientId`,
      `patientName`, `newPatientName` — don't delete it or the legacy
      components until the new wizard is verified end-to-end.
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
