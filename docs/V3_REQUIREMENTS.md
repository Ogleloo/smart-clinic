# V3 Requirements

Approved workflows and screen requirements for V3 development.

---

## Roles and terminology

| Old term (V2/Figma) | Correct term (V3) | Notes |
|----------------------|--------------------|-------|
| Doctor               | Nurse              | Matches `profiles.role = 'nurse'` |
| Department           | Service            | Matches `services` table |
| Front Desk           | Reception          | Matches `profiles.role = 'receptionist'` |
| On Leave             | Off Duty           | Matches `profiles.is_on_duty` |

---

## Design source

Figma V3: `xKCONNQAkEBe56q0rbQuYC`

| Figma page           | Role        | Frame count |
|----------------------|-------------|-------------|
| 03 · Patient V3      | Patient     | ✅ Built     |
| 04 · Reception V3    | Receptionist| 11 frames — ✅ built (Phases 1–4; photo backend not applied) |
| 05 · Nurse V3        | Nurse       | 13 frames — 🔶 dashboard and My Queue built; patient details, vitals, consultation, history not started |
| 06 · Admin V3        | Admin       | 10 frames — 🔲 not started |

"Built" means merged to `main`. How much of each is tested, and how, is in `docs/FINAL_RELEASE_STATUS.md`.

---

## Patient V3 — approved and implemented

Screens built on `feat/patient-v3-screens`:

- **Sidebar** — nav links, "Need help?" card using `clinics.phone`
- **Dashboard** (`/dashboard`) — greeting, action cards, next appointment, queue status, clinic info
- **Book appointment** (`/book`) — 3-step wizard + confirmed page with `appointments.reference`
- **My Appointments** (`/appointments`) — Upcoming/Previous tabs
- **Appointment Details** (`/appointments/[id]`) — reference number, consultation time from `service_consultation_stats`
- **My Queue** (`/queue`) — V2 explainability panel preserved
- **Notifications** (`/notifications`) — filter tabs (All, Queue, Appointments, System)
- **Profile** (`/profile`) — read-only with DOB, ID number
- **Profile Settings** — editable form
- **Registration** — date of birth and ID/passport number are required (client + server validated). A valid SA ID suggests the date of birth (asking which year when the century is ambiguous) and a contradicting date is refused; a passport number derives nothing

Additional requirements:
- Sign out button in sidebar (above "Need help?" card) and mobile profile — added (PR #17)
- 11 e2e tests in `patient-v3.spec.ts` (classified *destructive*: disabled by default, see `CLAUDE.md` "Safe testing")
- `npm run build` passes

### Registration — needs a future migration (not implemented, not approved)

- **Passport issuing country** and **identity document type**: `profiles` has a single `id_number` column. Today the kind is inferred (13 digits = SA ID; other 6–20 letters/digits = passport; digit-only 10+ other than a valid SA ID is refused), so a purely numeric foreign passport of 10+ digits cannot register.
- **Database-level identity uniqueness**: `profiles_id_number_clinic_unique` is a partial unique index on `(clinic_id, id_number)`, but self-registered patients have `clinic_id` NULL and NULLs never conflict, so two self-registered patients can share an ID number. Unverified against the live schema.
- **Profile settings can still clear identity fields** (date of birth, ID number) because they are nullable; making them non-clearable needs a decision on existing patients with blanks.
- **Existing account / unconfirmed account at signup**: re-registering an email that already has an unconfirmed account re-sends the code but does not save the newly entered details or password (per the Supabase Auth source; not reproduced), so the profile keeps the old (possibly blank) values. This is one unconfirmed candidate: the owner's read-only check on 1 November 2026 of an affected test account found no DOB/ID in either Auth metadata or profile, with the trigger enabled and migrations recorded; the root cause remains unconfirmed (`docs/FINAL_RELEASE_STATUS.md` §5).
- Phone at registration is checked for plausibility only (7–15 digits, kept as typed); patient profile settings still accept any text up to 30 characters.

---

## Reception V3 — implemented (merged), with open items

Figma page: `04 · Reception V3` (11 frames). Merged: shell and Dashboard (#19, #23), unified check-in wizard `/reception/check-in` (#21), Queue Management with Skip (#25–#27), Profile Settings (#29).

Open / deliberately not built:
- **Profile photo upload:** no backend (no bucket, policies or avatar column). Controls are disabled and say so. Design in `docs/PROPOSAL_profile_photos.md`; SQL in `docs/proposals/avatar_storage.sql` (not a migration, not applied).
- **Call Next Patient and emergency/priority controls for Reception:** not built; supervisor requirement D-P1/D-P2 in PR #36 (unmerged) specifies Reception-managed priority.
- Appointments page is still the V2 screen; there are no Patients or Reports pages for Reception.
- Email change is read-only (no verified email-change flow).

---

## Nurse V3 — partially implemented (merged)

Figma page: `05 · Nurse V3` (13 frames). Merged: Dashboard `/nurse/dashboard` (#30) and My Queue `/nurse/queue` with Next/Undo/Skip (#31). The classic `/nurse` screen remains the working screen and is still the post-login home.

Not started: Patient Details, Record Vitals, Consultation, Complete Consultation, Patient History, Profile Settings. These read clinical records and need the access-control review proposed in PR #36 (open, unmerged) first. The database tables (`consultation_notes`, `patient_vitals`) and their RLS already exist.

---

## Admin V3 — not started

Figma page: `06 · Admin V3` (10 frames)
Build approach: same as Patient V3.

---

## Cross-cutting requirements

- **Input validation:** email format, name, password strength, date of birth and ID/passport — implemented for patient registration and password changes (PR #38; offline-tested). SA-format phone normalisation exists for staff profile settings only; patient profile settings still accept any text up to 30 characters.
- **Stale queue cleanup:** 65 entries stuck open across 11 past dates — not yet resolved (status not re-checked for this release)
- **Email delivery:** Gmail SMTP and 6-digit email OTP were reported working in a live test (sign-up code delivered and verified; recovery emails delivered). The dashboard settings (*Confirm email* ON, *Email OTP Length* 6, SMTP) are not visible from the repository and must be re-confirmed by the owner before release.
- **Error display fix:** done — no `JSON.stringify` remains under `app/` (searched for this release); auth actions return `error.message` or fixed strings.
