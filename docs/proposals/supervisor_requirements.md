# Supervisor requirements — mandatory patient identification and Reception-managed queue priority

**Status: requirements and design only.** Nothing here is implemented in the app or applied to the shared database.
Registration, check-in and the deployed priority controls are unchanged. SQL lives in `docs/proposals/` (not
`supabase/migrations/`) and has been exercised only on a disposable local stack.

Legend: **[fact]** verified in the code or on the local stack · **[design]** recommendation for review.

---

## 1. Mandatory patient identification

### 1.1 Requirement

Every patient must present an identification document at registration — self-registration **and** walk-ins created
by Reception. Accepted: a **South African ID number**, or a **passport number with its issuing country**. The intent
is to **prevent** duplicate registration, not to merge duplicates afterwards.

### 1.2 What exists today [fact]

- `profiles.id_number` is **optional** free text (6–20 letters/digits, `lib/profileValidation.ts`); one field holds
  either an SA ID or a passport number, with no document type and no issuing country.
- **No uniqueness**: two profiles can hold the same number (asserted, `probe_identity.mjs`).
- **No checksum or date validation** of SA ID numbers.
- Reception walk-ins (`create_walkin_patient(name, phone)`) take **no** identification.
- A signed-in patient can **change their own** `id_number` at any time (column UPDATE grant; asserted).
- `profiles.id_number` is readable by clinic staff through `profiles_staff_read_clinic_patients` and shown on the
  check-in confirmation (`CheckInWizard.tsx`).
- Duplicates are handled after the fact: `find_duplicate_patients()` + `merge_patient_profiles()` on the admin screen.

### 1.3 Data model [design; prototype in `identity_documents_prototype.sql`]

A separate table `patient_identity_documents` (not a profile column), one row per document:

| Column | Notes |
|---|---|
| `patient_id` | owner profile (`on delete restrict`) |
| `document_type` | `sa_id` \| `passport` |
| `issuing_country` | ISO 3166-1 **alpha-3** (as printed in the passport MRZ); `ZAF` forced for `sa_id` |
| `number_normalized` | upper-case, spaces / hyphens / dots / slashes removed — nothing else rewritten |
| `number_last4` | generated; the only part routinely displayed |
| `status` | `active` \| `replaced` \| `revoked`, with `replaced_by`, `change_reason` |
| `recorded_by/at`, `verified_by/at` | who captured it; who saw the physical document |

**Validation.**
- *SA ID*: 13 digits `YYMMDD SSSS C A Z`; real calendar date (century chosen so the date is not in the future);
  citizenship digit `0` citizen, `1` permanent resident, `2` refugee; **Luhn** check digit. The gender digits are **not**
  interpreted or stored separately (consistent with "do not infer gender"). Optionally cross-check the date against
  the entered date of birth (warn, don't silently correct).
- *Passport*: issuing country required; **no country-specific format assumed** — 5–20 letters/digits after
  normalisation. Per-country rules or MRZ parsing can be added later without a schema change.

**Duplicate prevention — database-enforced.** A partial unique index on
`(document_type, issuing_country, number_normalized) WHERE status = 'active'`. Two concurrent registrations with the
same document cannot both succeed: the second receives `23505` and the registration flow turns that into "this
document is already registered" (asserted: two simultaneous inserts → exactly one succeeds). A second index allows one
active document **per kind per patient**, so a person may hold an SA ID *and* a passport.

**Minimum exposure.** No app role can `SELECT` the table (asserted for receptionist and anon). All access via
`SECURITY DEFINER` functions that return at most `number_last4`:
`register_patient_with_document(...)`, `find_patient_by_document(type, country, number)` (exact match only — the
caller must already hold the full number, i.e. the document is in front of them), `replace_identity_document(...)`.
Recommended for production: store a **keyed hash** (HMAC, key in Supabase Vault) for the unique index and exact-match
lookup, and either no full number or an encrypted one. An unkeyed hash is not enough — SA ID numbers have low entropy
(a date plus a short sequence). *Decision D-ID1.*

### 1.4 Workflows [design]

- **Self-registration**: document type + number (+ country for passports) become required. If the document already
  exists the account is **not** silently attached to the existing profile — see linking.
- **Reception walk-in**: `create_walkin_patient` gains the document; Reception marks it **verified** (saw the physical
  document). If it already exists, Reception is shown that profile (name + last 4) and checks the person in on it —
  this replaces today's name/phone search as the way a returning patient from **another clinic** is found.
- **Linking an existing profile to an account** (a walk-in later signs up): knowing someone's ID number must not be
  enough to take over their record. Proposed: a **one-time claim code** issued by Reception after an in-person
  document check (or an OTP to the phone already on the profile), redeemed once, expiring, audited. *Decision D-ID2.*
- **Correction / replacement** (typo, new passport): Reception or admin, with a reason; the old row becomes
  `replaced` (history kept), the new row `active`. Patients cannot edit their document themselves once verified —
  today's self-edit of `id_number` is removed. *Decision D-ID3: may a patient correct an unverified document?*
- **More than one document for one person** (SA ID and passport, or a passport renewed under a new number): allowed on
  one profile. If two profiles turn out to be the same person through **different** documents, that is an
  **exceptional reconciliation** — the restricted, audited merge (§1.6), never a routine screen.

### 1.5 Existing records and migration [design]

1. *Expand*: add the table and functions; do not touch `profiles.id_number`.
2. Backfill: for each `profiles.id_number`, classify — valid SA ID (checksum + date) → `sa_id` document,
   **unverified**; anything else → **not** imported automatically (it could be a passport with unknown country, or
   garbage); flagged for capture at the next visit. Numbers shared by several profiles are **not** imported for any
   of them and go to a reconciliation list.
3. Profiles without a document get an `identity_pending` state: allowed to check in during a transition window, with
   Reception prompted to capture the document; after the window, check-in requires it. *Decision D-ID4 (window
   length; hard block or warning).*
4. *Test / demo records*: the production database holds demo data (`reset_demo_state`, `ZZ…` test profiles). Tag them
   explicitly (e.g. a `is_test_record` flag or a dedicated demo clinic) and exclude them from the backfill and the
   duplicate checks rather than inventing fake document numbers. *Decision D-ID5.*
5. *Contract*: once all screens read documents through the new functions, stop writing `profiles.id_number`, then
   drop it in a later migration.

### 1.6 Duplicate detection and merge [design]

- **Admin V3 UI: no routine "find duplicates / merge" screen.** Prevention at registration replaces it.
- Keep the functions (expand/contract) but restricted: `merge_patient_profiles` now requires patient profiles, a
  single-clinic footprint (no queue entries, appointments, notifications or audit references at another clinic),
  and writes `patient_merge_audit` (`profiles_identifier_access.sql`, rev 4). Later: a reason-taking variant used only
  by an exceptional-reconciliation flow, and revoke the 2-argument version once the current admin screen is gone.
- With documents in place, a merge must also refuse when both profiles hold **different active documents of the same
  kind** (two different SA IDs cannot be one person) and must move document rows with an audit entry.

---

## 2. Queue priority belongs to Reception (revised BR-10)

### 2.1 Requirement

Reception manages queue-priority changes, on the Reception V3 Queue. Nurses no longer have the routine control.
Reception cannot change another clinic's priorities; patients cannot change their own. Every change is auditable
(who, when). Safe ordering and concurrency protection are preserved. An administrative priority is distinguished from
a clinically assessed emergency, and nurses keep a way to escalate clinical urgency to Reception.

### 2.2 What exists today [fact]

- `set_emergency_priority(entry, on)`: **nurse or admin**, **no clinic check** (F12 — a clinic-A nurse changed a
  clinic-B entry), also changes **in-progress** entries, keeps only the *last* setter (`priority_set_by/at`), no
  history, no reason.
- `check_in_patient(..., p_priority)`: nurse/admin may check a patient in at priority 1; Reception may not.
- Any clinic staff member can also `UPDATE queue_entries.priority` directly (F11) — unaudited.
- Used by the Nurse emergency toggle (classic `/nurse` and V3 queue, `app/actions/nurse.ts`). Reception has no
  priority control (`app/actions/reception.ts` deliberately omits `p_priority`).

### 2.3 Revised BR-10 [design]

> **BR-10 (revised).** Queue priority is set and cleared only by **Reception of the entry's clinic**, only while the
> patient is **waiting**, through `set_queue_priority()`. Every change records who, when, old and new value, and a
> reason: **clinical emergency** (must cite an open nurse escalation for that patient) or **administrative**
> (Reception's decision, note required). Nurses request priority through an **escalation**; they do not reorder the
> queue. Patients cannot affect priority. Queue order remains `priority desc, checked_in_at, token_number`.

### 2.4 Proposed implementation (`queue_priority_reception.sql`) [design, tested locally]

- **Part 1 (additive):** `queue_priority_events` (append-only history), `queue_priority_escalations` (nurse → Reception,
  one open per entry), `set_queue_priority()`, `request_priority_escalation()`, `decline_priority_escalation()`.
  Row lock (`FOR NO KEY UPDATE`, the strength `next_patient()` uses) for check-then-write; two simultaneous requests →
  one change, one event (asserted). Same "Queue entry not found" for another clinic (no oracle).
- **Part 2 (cutover, same release as the UI):** revoke `set_emergency_priority` from app roles (closes F12) and make
  `check_in_patient` refuse a non-zero `p_priority` (priority is set after check-in, with a reason).
- With `clinical_records_access.sql`, direct `queue_entries` updates are gone (F11), so the functions are the only path.
- **Must ship together** with: Reception V3 Queue control + escalation inbox, removal of the Nurse toggle (classic and
  V3), and a Nurse "escalate to reception" action. Part 2 before the UI change would break the deployed Nurse toggle.
- *Decisions:* D-P1 may an **admin** also set priority (proposal: no — Reception only)? D-P2 when Reception itself
  sees an obvious emergency (collapse, bleeding), record it as administrative-with-note and call a nurse, or allow a
  "reception-observed emergency" reason? D-P3 should an escalation note be restricted to non-clinical wording, since
  Reception reads it?

---

## 3. Impact on the V3 roles [design]

| Role | Impact |
|---|---|
| **Patient V3** (implemented) | Registration form: document type, number, issuing country (passport) become required; profile shows the document masked (last 4) and no longer lets the patient edit it after verification; account linking via a claim code. |
| **Reception V3** | Walk-in creation captures and verifies a document; patient lookup by exact document replaces cross-clinic name/phone search; **priority control on the Queue** (set/clear, reason, note) and an **escalation inbox**; document correction with reason. |
| **Nurse V3** | **Remove** the emergency toggle (classic `/nurse` and `/nurse/queue`) in the cutover release; add "Escalate to reception" on waiting rows; Patient Details shows the document **masked**, through a treating-gated function. |
| **Admin V3** | **No** duplicate-detection / merge screen; Staff page with an explicit clinic filter; read access to priority history and merge audit for the admin's clinic; exceptional reconciliation (if kept) as a restricted, reasoned, audited action. |
