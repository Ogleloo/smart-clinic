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
| 04 · Reception V3    | Receptionist| 11 frames   |
| 05 · Nurse V3        | Nurse       | 13 frames   |
| 06 · Admin V3        | Admin       | 10 frames   |

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
- Sign out button in sidebar (above "Need help?" card) and mobile profile — **added**. The sidebar is `hidden md:flex`, so the profile screen carries its own `md:hidden` Sign Out; both post the same `logout` Server Action.
- 9 e2e tests in `patient-v3.spec.ts`
- `npm run build` passes

### Registration — needs a future migration (not implemented, not approved)

- **Passport issuing country** and **identity document type**: `profiles` has a single `id_number` column. Today the kind is inferred (13 digits = SA ID; other 6–20 letters/digits = passport; digit-only 10+ other than a valid SA ID is refused), so a purely numeric foreign passport of 10+ digits cannot register.
- **Database-level identity uniqueness**: **verified against the live schema on 2026-11-05 and confirmed.** `profiles_id_number_clinic_unique` is a partial unique index on `(clinic_id, id_number)`; self-registered patients have `clinic_id` NULL and NULLs never conflict, so the constraint excludes exactly the rows it was meant to cover. Two ID numbers are currently held by seven profiles. Migration `20261105132322_one_identity_per_profile.sql` stops any *new* duplicate (trigger on insert/update, plus `handle_new_user` dropping an already-registered ID instead of failing signup). Removing the existing duplicates and adding the global unique index needs a decision about which accounts keep their ID — proposed, not applied, in `docs/proposals/one_identity_per_profile_cleanup.sql`.
- **Profile settings can still clear identity fields** (date of birth, ID number) because they are nullable; making them non-clearable needs a decision on existing patients with blanks.
- **Existing account / unconfirmed account at signup**: re-registering an email that already has an unconfirmed account re-sends the code but does not save the newly entered details or password (per the Supabase Auth source; not reproduced), so the profile keeps the old (possibly blank) values. See the PR #38 investigation.
- Phone at registration is checked for plausibility only (7–15 digits, kept as typed); patient profile settings still accept any text up to 30 characters.

---

## Reception V3 — pending

Figma page: `04 · Reception V3` (11 frames)
Build approach: same as Patient V3 — extract Figma specs, generate Claude Code prompt.

---

## Nurse V3 — pending

Figma page: `05 · Nurse V3` (13 frames)
Build approach: same as Patient V3.

---

## Admin V3 — pending

Figma page: `06 · Admin V3` (10 frames)
Build approach: same as Patient V3.

---

## Cross-cutting requirements

- **Input validation:** email format, SA phone (`+27` / `0xx`), name (non-empty), password strength — not yet implemented
- **Stale queue cleanup:** 65 entries stuck open across 11 past dates — not yet resolved
- **SMTP:** stale — verified read-only against the shared project on 2026-11-05: confirm email is **ON** and OTP mail is being delivered (recent signups confirm in ~26–150s). Delivery to an arbitrary third-party address is still untested; only the addresses actually in use are known to work.
- **Error display fix:** use `error.message` not `JSON.stringify(error)` on auth pages
