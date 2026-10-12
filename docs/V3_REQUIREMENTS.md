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
- **Registration** — optional DOB and ID number fields

Additional requirements:
- Sign out button in sidebar (above "Need help?" card) and mobile profile — **not yet added**
- 9 e2e tests in `patient-v3.spec.ts`
- `npm run build` passes

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

## Supervisor requirements (2026-10-12) — designed, not implemented

Full design: `docs/proposals/supervisor_requirements.md`. Nothing is implemented or deployed yet.

1. **Mandatory patient identification.** Every patient — self-registered or a Reception walk-in — must provide a
   South African ID number or a passport number with its issuing country. Duplicate registration is **prevented**
   (database-enforced uniqueness of active documents), not merged afterwards. Admin V3 has **no** routine duplicate
   detection / merge screen; any exceptional merge is restricted and audited.
2. **Queue priority belongs to Reception (revised BR-10).** Reception of the entry's clinic sets and clears priority
   on waiting patients from the Reception V3 Queue, with a reason (clinical emergency from a nurse escalation, or
   administrative with a note); every change is recorded. Nurses lose the routine emergency toggle and gain an
   "escalate to reception" action. The Nurse toggle and the database function change together, in one release.

---

## Cross-cutting requirements

- **Input validation:** email format, SA phone (`+27` / `0xx`), name (non-empty), password strength — not yet implemented
- **Stale queue cleanup:** 65 entries stuck open across 11 past dates — not yet resolved
- **SMTP:** Gmail App Password recommended to replace Resend. Confirm email currently OFF.
- **Error display fix:** use `error.message` not `JSON.stringify(error)` on auth pages
