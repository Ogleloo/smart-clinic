# Architecture — Smart Clinic

Concise verified technical overview. Read this when starting work on the project.

---

## Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Framework   | Next.js 16.3.6, TypeScript, Tailwind|
| Database    | Supabase (Postgres, Auth, Realtime) |
| Hosting     | Vercel                              |
| Email       | Supabase Auth mail via custom SMTP — Gmail (owner-reported; the dashboard setting is not in this repo). Resend was the earlier provider and delivered only to its account owner |
| Icons       | lucide-react                        |
| Testing     | Playwright                          |
| Design      | Figma                               |

---

## Supabase project

- Project ID: `bffhjvpkfivtbzqielve`
- **Single database** shared across production, preview, and local dev
- Migrations: 63 files in `supabase/migrations/`, all applied (append-only)
- Scheduled jobs: `pg_cron` (2 jobs: automatic no-show, appointment reminders)
- Realtime: enabled for queue_entries

---

## Database schema (14 tables)

Core tables: `clinics`, `profiles`, `services`, `appointments`, `queue_entries`, `consultations`, `notifications`, `consultation_notes`, `patient_vitals`

Supporting: `staff_invitations`, `service_consultation_stats` (materialized view equivalent)

Key relationships:
- `profiles.id` → `auth.users.id` (1:1, Supabase Auth)
- `appointments` → `queue_entries` (check-in creates queue entry)
- `queue_entries` → `consultations` (1:1)
- `consultations` → `consultation_notes` + `patient_vitals` (1:1 each)

---

## Security model

- **RLS on every table** — 44+ policies, no middleware tier
- **Roles:** `patient`, `receptionist`, `nurse`, `admin`
- **One anon-callable function:** `get_public_queue_display()` (ADR-028)
- **Clinical notes:** patients cannot see own notes (POPIA review pending)
- **Functions default EXECUTE to PUBLIC** — every new function must `REVOKE ... FROM public, anon`

---

## Auth

- Supabase Auth with email/password; roles set only by the `handle_new_user()` trigger (always `patient`) or, in the database design, by `accept_staff_invitation()` (no application code calls it; staff accounts are created outside the app)
- Sign-up confirms by a **6-digit email code** (`/verify`, `verifyOtp`), not a link. The Supabase dashboard *Email OTP Length* must be **6** (the UI hard-codes six digits); *Confirm email* must be **ON**
- Sign-in with an unverified account redirects to `/verify`; failed sign-ins are deliberately vague (anti-enumeration)
- Password recovery: `/forgot-password` → emailed link → `/auth/callback` → `/reset-password`
- Idle timeout for staff (`IdleTimeoutMonitor`, setting in `staff_idle_timeout_setting` migration)
- `getUser()` only, never `getSession()`

### Registration (patients)

- Required: full name, email, **date of birth**, **ID or passport number**, password (≥ 8 non-space characters, never trimmed). Optional: phone (7–15 digits, kept as typed)
- One validator (`lib/registrationValidation.ts`) runs in the browser and again in the `register` Server Action
- A valid 13-digit South African ID (checksum, real date, citizenship digit) suggests the date of birth; when both 19YY and 20YY are possible the patient chooses; a contradicting date is refused. A passport number derives nothing
- Values travel as sign-up metadata and are stored by `handle_new_user()`, which silently drops malformed values — so the application validates first
- Show/hide password control on login, registration and reset-password (`components/ui/PasswordInput.tsx`)
- Already-registered emails: the application does **not** inspect `user.identities` (earlier revisions of this file claimed it did); behaviour follows whatever Supabase Auth returns for the configured *Confirm email* setting
- **Not implemented:** passport issuing country, document type, database-level identity uniqueness for self-registered patients (see `docs/V3_REQUIREMENTS.md`)
- **Open observation:** a read-only check by the owner on 1 November 2026 found, for an affected OTP-verified test account, no date-of-birth or ID key in the Auth metadata and no value in the profile (all four presence flags false), with the `handle_new_user()` trigger enabled and the relevant migrations recorded. The root cause is **unconfirmed**, and persistence for a *freshly created* account is **unverified** (`docs/FINAL_RELEASE_STATUS.md` §5)
- The comment in `app/actions/auth.ts` saying Confirm Email "is currently off" is stale; it is a comment only and was left untouched in this documentation change

---

## Prediction engine

Runs entirely in the database. Estimates waiting time from:
1. Queue position (patients ahead with `status = 'waiting'`)
2. Average consultation duration per service (from `consultations`)
3. Number of on-duty nurses for the service
4. Confidence label (High/Medium/Low based on data volume)

No nurse on duty → no estimate shown (never a guess).

---

## Key patterns

- **Mutations:** Server Actions (not API routes)
- **Timestamps:** always `Africa/Johannesburg` timezone (ADR-020)
- **Queue position:** derived at read time, never stored (ADR-003)
- **Token format:** `{service.token_prefix}-{daily_sequence}` (e.g. `GC-016`)
- **Migrations:** append-only, committed to `supabase/migrations/`

---

## Test accounts

The demonstration accounts' passwords are **not stored in this repository**. They are held by the project owner in
secure offline storage and supplied to tests and scripts through the environment (never committed). They were rotated
after being exposed in git history (see `docs/proposals/credential_rotation_runbook.md`):

| Role        | E-mail variable           | Password variable            |
|-------------|---------------------------|------------------------------|
| Patient     | `E2E_PATIENT_EMAIL`       | `E2E_PATIENT_PASSWORD`       |
| Nurse       | `E2E_NURSE_EMAIL`         | `E2E_NURSE_PASSWORD`         |
| Nurses 2-3  | `E2E_NURSE2_EMAIL`, `E2E_NURSE3_EMAIL` | (passwords held by the project owner in secure offline storage; used for manual demos) |
| Reception   | `E2E_RECEPTIONIST_EMAIL`  | `E2E_RECEPTIONIST_PASSWORD`  |
| Admin       | `E2E_ADMIN_EMAIL`         | `E2E_ADMIN_PASSWORD`         |

Target project: `E2E_SUPABASE_URL` and `E2E_SUPABASE_ANON_KEY`. Specs are classified in `e2e/support/e2e-safety.ts`
(offline / read-only / self-guarded / destructive). Default live specs are strictly read-only; those that write **or submit a
mutation-capable action, even one expected to fail**, (and any spec nobody has classified) are **disabled by default** and run only with
`E2E_ENABLE_DESTRUCTIVE=1` against a verified local Supabase stack. The shared Supabase project is rejected in that mode.
The config runs an **allowlist** of classified top-level specs, and it will not start the dev server when that server's configuration
names the shared project. `npm run test:e2e:offline` runs the offline specs with no backend and no credentials. Details:
`docs/proposals/credential_rotation_runbook.md` §7.

`reset_demo_state()` exists in the database but is **not** to be run against the shared project (destructive; PR #36 proposes revoking it from ordinary admins).

---

## Health checks

```sql
SELECT * FROM public.system_health_check();      -- 14 rows (13 PASS + 1 INFO at the last recorded run, 2026-10-10)
SELECT * FROM public.system_health_check_v2();   -- 10 assertions at the last recorded run, 2026-10-10
```

These were last recorded after the October 2026 migrations; they were not re-run for this documentation change.
