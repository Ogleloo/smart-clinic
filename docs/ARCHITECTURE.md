# Architecture — Smart Clinic

Concise verified technical overview. Read this when starting work on the project.

---

## Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Framework   | Next.js 16.3.6, TypeScript, Tailwind|
| Database    | Supabase (Postgres, Auth, Realtime) |
| Hosting     | Vercel                              |
| Email       | Resend SMTP (migration to Gmail pending) |
| Icons       | lucide-react                        |
| Testing     | Playwright                          |
| Design      | Figma                               |

---

## Supabase project

- Project ID: `bffhjvpkfivtbzqielve`
- **Single database** shared across production, preview, and local dev
- Scheduled jobs: `pg_cron` (2 active jobs)
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

- Supabase Auth with email/password
- Anti-enumeration: `data.user?.identities?.length === 0` detects existing accounts
- Confirm email: **currently OFF** (SMTP not configured for delivery to non-owner emails)
- `getUser()` only, never `getSession()`

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

Target project: `E2E_SUPABASE_URL` and `E2E_SUPABASE_ANON_KEY`. Specs are classified in `e2e/support/e2e-safety.ts`:
those that write data (and any spec nobody has classified) are **disabled by default** and run only with
`E2E_ENABLE_DESTRUCTIVE=1` against a verified local Supabase stack. The shared Supabase project is rejected in that mode.

Reset demo state: `SELECT * FROM public.reset_demo_state();`

---

## Health checks

```sql
SELECT * FROM public.system_health_check();      -- 14 assertions
SELECT * FROM public.system_health_check_v2();   -- 9 assertions
```
