# Supervisor requirements — mandatory patient identification and Reception-managed queue priority

**Status: requirements and design only.** Nothing here is implemented in the app or applied to the shared database.
Registration, check-in and the deployed priority controls are unchanged. SQL lives in `docs/proposals/` (not
`supabase/migrations/`) and has been exercised only on a disposable local stack.

Legend: **[fact]** verified in the code or on the local stack · **[design]** recommendation for review.

### Decisions applied (PR #36 review, revision 5)

| | Decision | Where |
|---|---|---|
| D-S1 | Cross-clinic privacy first; the interim duplicate risk is acceptable **only during development** — production intake requires compulsory SA ID / passport | profiles proposal; §1 |
| D-F13 | Destructive live tests move to isolated infrastructure; ordinary admins cannot run `reset_demo_state()` | `function_privileges_hardening.sql` |
| D-P1 | Reception only for routine priority; admins have read-only oversight | §2 |
| D-P2 | Reception does not classify emergencies: they call a nurse and follow clinic emergency procedures; only a nurse escalation yields a clinical priority | §2 |
| D-P3 | Reception-visible escalation content = structured reason codes, no free text | §2 |
| D-ID1 | Keyed hash (HMAC-SHA-256, Vault key); no plaintext; no encryption unless a need appears | §1.3, prototype rev 5 |
| D-ID2 | Verified, single-use, expiring, hashed claim codes | §1.4, prototype rev 5 |
| D-ID3 | Patients *request* corrections; staff perform verified replacements | §1.4 |
| D-ID4 | Mandatory at launch for new registrations and walk-ins; controlled backfill + verification for existing incomplete profiles | §1.5 |
| D-ID5 | Isolate test data; otherwise tag known demo records explicitly; never fabricate documents | §1.5 |

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
**Storage (D-ID1, prototyped in rev 5):** the number is never stored. The table keeps `number_hmac` =
HMAC-SHA-256(key, `type:country:normalised_number`) with the key in Supabase Vault (`identity_document_hmac_key_v1`,
created by an operator, never granted to any role), plus `number_last4` and `key_version`. The unique index and the
exact-match lookup both use the HMAC. An unkeyed hash would not do: SA ID numbers have low entropy (a date plus a
short sequence) and could be brute-forced. No encryption: nothing currently needs the full number back. **Key
rotation** cannot re-hash without the plaintext, so it happens lazily — on the next in-person verification the
document is re-hashed under the new key version; during rotation lookups try both versions. Asserted locally: no
column can hold the number; stored rows contain neither the number nor a claim code; app roles cannot execute the
registration, lookup, claim or key functions; the service role cannot read the key function either.

### 1.4 Workflows [design]

- **Self-registration**: document type + number (+ country for passports) become required. If the document already
  exists the account is **not** silently attached to the existing profile — see linking.
- **Reception walk-in**: `create_walkin_patient` gains the document; Reception marks it **verified** (saw the physical
  document). If it already exists, Reception is shown that profile (name + last 4) and checks the person in on it —
  this replaces today's name/phone search as the way a returning patient from **another clinic** is found.
- **Linking an existing profile to an account (D-ID2, prototyped):** knowing someone's ID number is never enough.
  Reception verifies the physical document, then issues a **claim code**: 80 random bits, shown once, stored only as an
  HMAC, expiring (24 h default), single-use, one live code per profile, issuable only for a patient profile with no
  login and an active **verified** document. Redemption links the new account only if the account has no profile yet
  and the profile is still unclaimed; every failure returns the same message. Attempt rate-limiting belongs to the
  calling RPC/API. Asserted: issue refused before verification; wrong, reused and expired codes refused; an account
  that already has a profile cannot claim.
- **Correction / replacement (D-ID3):** patients **request** a correction (a request record, no direct edit); staff
  perform the replacement after seeing the document: old row `replaced` with a reason (history kept), new row `active`
  and verified, linked by `replaced_by`, atomically. Asserted: replacement needs a reason and verifying staff. Today's
  patient self-edit of `id_number` is removed when documents go live.
- **More than one document for one person** (SA ID and passport, or a passport renewed under a new number): allowed on
  one profile. If two profiles turn out to be the same person through **different** documents, that is an
  **exceptional reconciliation** — the restricted, audited merge (§1.6), never a routine screen.

### 1.5 Existing records and migration [design]

1. *Expand*: add the table and functions; do not touch `profiles.id_number`.
2. Backfill: for each `profiles.id_number`, classify — valid SA ID (checksum + date) → `sa_id` document,
   **unverified**; anything else → **not** imported automatically (it could be a passport with unknown country, or
   garbage); flagged for capture at the next visit. Numbers shared by several profiles are **not** imported for any
   of them and go to a reconciliation list.
3. **D-ID4:** new self-registrations and walk-ins require a document **from launch**. Existing profiles without one
   get `identity_pending`: controlled backfill — Reception captures and verifies the document at the next visit; a
   report tracks the remaining pending profiles; any conflict found during capture (document already held by another
   profile) goes to exceptional reconciliation, never an automatic merge.
4. **D-ID5:** test data lives on isolated infrastructure (local stack / separate project) wherever possible; demo
   records that must remain in production are tagged explicitly (e.g. `is_test_record` or a dedicated demo clinic),
   excluded from backfill and reporting, and never given fabricated document numbers.
5. *Contract*: once all screens read documents through the new functions, stop writing `profiles.id_number`, then
   drop it in a later migration.

### 1.6 Duplicate detection and merge [design]

- **Admin V3 UI: no routine "find duplicates / merge" screen.** Prevention at registration replaces it.
- Keep the functions (expand/contract) but restricted: one private core requires patient profiles, an **active**
  admin, a single-clinic footprint (no queue entries, appointments, notifications or audit references at another
  clinic) and writes the append-only `patient_merge_audit`. **Rev 5 coordinated replacement:**
  `merge_patient_profiles_with_reason(keep, merge, reason_code, reason_note)` — code
  (`same_person_document_verified` | `registration_error_verified`) and a 10–500-character note are mandatory; the
  deployed 2-argument `merge_patient_profiles` stays until the Admin UI cutover and records `legacy_unspecified`, so
  `reason_code` is never null; at the cutover the 2-argument function is revoked from app roles.
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

> **BR-10 (revised, rev 5).** Queue priority is set and cleared only by **Reception of the entry's clinic**, only while
> the patient is **waiting**, through `set_queue_priority()`. Every change — **setting and clearing** — records who,
> when, old and new value and a **reason code**. Raising: `nurse_escalation_accepted` (clinical; must cite an open
> nurse escalation), `accessibility_need`, `safeguarding`, `operational` (short note required). Clearing:
> `no_longer_required`, `entered_in_error`, `escalation_withdrawn`. Reception never classifies a patient clinically:
> on an apparent emergency they contact a nurse immediately and follow the clinic's emergency procedure (D-P2).
> Nurses escalate with a **reason code only** (`nurse_assessed_urgent`, `nurse_requests_early_review`) — no symptoms
> or other clinical text reaches Reception (D-P3). Admins have read-only oversight (D-P1). Patients cannot affect
> priority. The history is append-only and survives deletion or archiving of the queue entry. Queue order remains
> `priority desc, checked_in_at, token_number`.

### 2.4 Proposed implementation (`queue_priority_reception.sql`) [design, tested locally]

- **Part 1 (additive):** `queue_priority_events` (append-only history), `queue_priority_escalations` (nurse → Reception,
  one open per entry, reason code only), `set_queue_priority()`, `request_priority_escalation()`,
  `decline_priority_escalation()`. **Retention (rev 5):** neither table has a foreign key to `queue_entries`; each row
  snapshots `clinic_id`, `service_id`/`token`/`queue_date`; triggers make events append-only and escalations
  resolve-once / never deleted — for every role including the service role. Asserted: history and escalations survive
  deleting the queue entry; updates and deletes refused.
  Row lock (`FOR NO KEY UPDATE`, the strength `next_patient()` uses) for check-then-write; two simultaneous requests →
  one change, one event (asserted). Same "Queue entry not found" for another clinic (no oracle).
- **Part 2 (cutover, same release as the UI):** revoke `set_emergency_priority` from app roles (closes F12) and make
  `check_in_patient` refuse a non-zero `p_priority` (priority is set after check-in, with a reason).
- With `clinical_records_access.sql`, direct `queue_entries` updates are gone (F11), so the functions are the only path.
- **Must ship together** with: Reception V3 Queue control + escalation inbox, removal of the Nurse toggle (classic and
  V3), and a Nurse "escalate to reception" action. Part 2 before the UI change would break the deployed Nurse toggle.
- D-P1/D-P2/D-P3 are decided (table above) and implemented in the rev-5 SQL.

---

## 3. Impact on the V3 roles [design]

| Role | Impact |
|---|---|
| **Patient V3** (implemented) | Registration form: document type, number, issuing country (passport) become required; profile shows the document masked (last 4) and no longer lets the patient edit it after verification; account linking via a claim code. |
| **Reception V3** | Walk-in creation captures and verifies a document; patient lookup by exact document replaces cross-clinic name/phone search; **priority control on the Queue** (set/clear, reason, note) and an **escalation inbox**; document correction with reason. |
| **Nurse V3** | **Remove** the emergency toggle (classic `/nurse` and `/nurse/queue`) in the cutover release; add "Escalate to reception" on waiting rows; Patient Details shows the document **masked**, through a treating-gated function. |
| **Admin V3** | **No** duplicate-detection / merge screen; Staff page with an explicit clinic filter; read access to priority history and merge audit for the admin's clinic; exceptional reconciliation (if kept) as a restricted, reasoned, audited action. |
