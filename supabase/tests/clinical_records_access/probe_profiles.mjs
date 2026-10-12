// Patient-identifier (profiles) access assertions for docs/proposals/profiles_identifier_access.sql.
// LOCAL SUPABASE STACK ONLY (refuses any non-local URL). Creates users, a second clinic and queue entries.
//
//   SB_URL=... SB_ANON=... SB_SERVICE=... PHASE=baseline|proposed node supabase/tests/clinical_records_access/probe_profiles.mjs
//
//   PSQL_CMD="docker exec -i supabase_db_<project> psql -U postgres -At -v ON_ERROR_STOP=1"  (catalog checks)
//
// Exit code 0 only if every assertion for the phase holds.
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(`${process.cwd()}/`)
const { createClient } = require('@supabase/supabase-js')
const { SB_URL, SB_ANON, SB_SERVICE, PHASE, PSQL_CMD } = process.env
const here = dirname(fileURLToPath(import.meta.url))
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(SB_URL ?? '')) throw new Error(`Refusing: SB_URL must be a local stack, got ${SB_URL}`)
if (!['baseline', 'proposed'].includes(PHASE)) throw new Error('PHASE must be baseline or proposed')
if (!PSQL_CMD || !/(supabase_db_[a-z0-9_-]+\s|@(127\.0\.0\.1|localhost)[:/])/.test(PSQL_CMD)) throw new Error('Refusing: PSQL_CMD must target a local supabase_db_* container or localhost')
const psql = (sql) => execSync(PSQL_CMD, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })

const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const svc = createClient(SB_URL, SB_SERVICE, opts)
const RUN = Date.now().toString(36)
const CLINIC_A = process.env.PROBE_CLINIC_A ?? '11111111-1111-1111-1111-111111111111'
const CLINIC_B = crypto.randomUUID()
const must = async (p, what) => { const r = await p; if (r.error) throw new Error(`setup ${what}: ${r.error.message}`); return r.data }
const prefix = () => Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')

await must(svc.from('clinics').insert({ id: CLINIC_B, name: `Probe B ${RUN}` }), 'clinic B')
const svcA = (await must(svc.from('services').insert({ clinic_id: CLINIC_A, name: `PP A ${RUN}`, token_prefix: prefix() }).select('id').single(), 'svcA')).id
const svcB = (await must(svc.from('services').insert({ clinic_id: CLINIC_B, name: `PP B ${RUN}`, token_prefix: prefix() }).select('id').single(), 'svcB')).id

async function user(tag, role, clinic, extra = {}) {
  const email = `${tag}.${RUN}@probe.test`
  const u = (await must(svc.auth.admin.createUser({ email, password: 'probe-password-1', email_confirm: true }), `user ${tag}`)).user
  await must(svc.from('profiles').update({ role, clinic_id: clinic, full_name: `PP ${tag}`, ...extra }).eq('auth_user_id', u.id), `role ${tag}`)
  const prof = await must(svc.from('profiles').select('id').eq('auth_user_id', u.id).single(), `profile ${tag}`)
  const client = createClient(SB_URL, SB_ANON, opts)
  await must(client.auth.signInWithPassword({ email, password: 'probe-password-1' }), `sign in ${tag}`)
  return { client, id: prof.id }
}
const adminA = await user('admin', 'admin', CLINIC_A)
const recA = await user('reception', 'receptionist', CLINIC_A)
const nurseA = await user('nurse', 'nurse', CLINIC_A)
const nurseB = await user('nurseb', 'nurse', CLINIC_B)
const patSelf = await user('patient', 'patient', null, { id_number: '9001015800085', date_of_birth: '1990-01-01' })

let n = 0
async function patient(name, clinic, serviceId) {
  const id = (await must(svc.from('profiles').insert({ full_name: name, role: 'patient', id_number: `90010158${String(10000 + ++n).slice(1)}`, date_of_birth: '1990-01-01', phone: '+27 82 000 0000' }).select('id').single(), name)).id
  if (clinic) await must(svc.from('queue_entries').insert({ clinic_id: clinic, service_id: serviceId, patient_id: id, token: `PP${n}-${RUN}`, token_number: 800 + n, status: 'done' }), 'entry')
  return id
}
const pA = await patient(`PP linked A ${RUN}`, CLINIC_A, svcA) // has a visit at clinic A
const pB = await patient(`PP linked B ${RUN}`, CLINIC_B, svcB) // only ever at clinic B
const pNone = await patient(`PP unlinked ${RUN}`, null, null) // registered, never visited anywhere

// Staff member of clinic B who was checked in at clinic A as a patient (check_in_patient accepts any profile).
const nurseB2 = await user('nurseb2', 'nurse', CLINIC_B)
const recA_ci = await recA.client.rpc('check_in_patient', { p_service_id: svcA, p_patient_id: nurseB2.id })
if (recA_ci.error) throw new Error(`setup staff-as-patient check-in: ${recA_ci.error.message}`)
// A clinic-B staff profile with no login of its own, for the merge-a-staff-profile attempt.
const staffNoLogin = (await must(svc.from('profiles').insert({ full_name: `PP staff nologin ${RUN}`, role: 'receptionist', clinic_id: CLINIC_B }).select('id').single(), 'staff no login')).id
// Duplicate pairs.
const dupName = `PP Dup ${RUN}`
const dupB1 = await patient(dupName + ' B', CLINIC_B, svcB)
const dupB2 = await patient(dupName + ' B', CLINIC_B, svcB) // clinic-B-only pair
const dupA = await patient(dupName + ' A', CLINIC_A, svcA)
const dupU = await patient(dupName + ' A', null, null) // linked(A) + unaffiliated pair
const mergeB1 = await patient(`PP MergeB ${RUN}`, CLINIC_B, svcB)
const mergeB2 = await patient(`PP MergeB ${RUN}`, CLINIC_B, svcB)
const phoneB = `+27 83 ${String(Date.now()).slice(-3)} ${String(Date.now()).slice(-7, -3)}`
await must(svc.from('profiles').update({ phone: phoneB }).eq('id', pB), 'phone B')

// Multi-clinic patient S: history at clinic A AND clinic B.
const S = await patient(`PP Shared ${RUN}`, CLINIC_A, svcA)
const sB = (await must(svc.from('queue_entries').insert({ clinic_id: CLINIC_B, service_id: svcB, patient_id: S, token: `PPS-${RUN}`, token_number: 798, status: 'done' }).select('id').single(), 'S at B')).id
const keepK = await patient(`PP Keep ${RUN}`, CLINIC_A, svcA) // clinic-A-only patient used as the merge target
const keepK2 = await patient(`PP Keep2 ${RUN}`, CLINIC_A, svcA)
// M1: clinic-A-only patient that is cancelled_by on a clinic-B appointment (an audit reference in another clinic).
const M1 = await patient(`PP AuditRef ${RUN}`, CLINIC_A, svcA)
const otherB = await patient(`PP Other B ${RUN}`, CLINIC_B, svcB)
const slot = new Date(Date.UTC(2026, 11, 1, 8, 15, 0)).toISOString()
const apptB = (await must(svc.from('appointments').insert({ patient_id: otherB, service_id: svcB, scheduled_time: slot, status: 'cancelled', cancelled_by: M1 }).select('id').single(), 'appt B')).id
// M2: clinic-A-only patient holding a notification about a clinic-B queue entry.
const M2 = await patient(`PP NotifRef ${RUN}`, CLINIC_A, svcA)
await must(svc.from('notifications').insert({ recipient_id: M2, kind: 'called', title: 'probe', queue_entry_id: sB }), 'notif B')
const adminB = await user('adminb', 'admin', CLINIC_B)

const results = []
const rows = (r) => (r.error || r.data == null ? 0 : Array.isArray(r.data) ? r.data.length : 1)
const why = (r) => (r.error ? `${r.error.code ?? ''} ${r.error.message ?? ''}`.trim().slice(0, 70) : `${rows(r)} row(s)`)
async function check(area, name, expect, q) {
  const want = expect[PHASE]
  if (want === 'skip') { await q; results.push({ area, name, want, got: 'skip', ok: true, detail: 'not applicable in this phase' }); return }
  const r = await q
  const got = rows(r) > 0 ? 'allowed' : 'denied'
  results.push({ area, name, want, got, ok: got === want, detail: why(r) })
}
const OPEN = { baseline: 'allowed', proposed: 'denied' }
const KEEP = { baseline: 'allowed', proposed: 'allowed' }
const DENY = { baseline: 'denied', proposed: 'denied' }
const STAGE2 = { baseline: 'allowed', proposed: 'allowed' } // still allowed after Stage 1; Stage 2 design addresses it
const DENY_IF_PROPOSED = () => ({ baseline: 'allowed', proposed: 'denied' })
const ident = (c, id) => c.from('profiles').select('id, id_number, date_of_birth, phone').eq('id', id)

await check('admin', 'admin A reads a clinic-B-only patient (ID number)', OPEN, ident(adminA.client, pB))
await check('admin', 'admin A reads a never-visited patient (ID number)', OPEN, ident(adminA.client, pNone))
await check('admin', 'admin A reads a clinic-B nurse profile', OPEN, adminA.client.from('profiles').select('id').eq('id', nurseB.id))
await check('admin', "admin A updates a clinic-B patient's id_number", OPEN, adminA.client.from('profiles').update({ id_number: '0000000000000' }).eq('id', pB).select('id'))
await check('admin', 'admin A reads a patient with a visit at clinic A', KEEP, ident(adminA.client, pA))
await check('admin', 'admin A reads clinic-A staff (staff page)', KEEP, adminA.client.from('profiles').select('id').eq('id', nurseA.id))
await check('admin', "admin A updates a clinic-A patient's profile directly (no app path uses this)", OPEN, adminA.client.from('profiles').update({ phone: '+27 82 111 1111' }).eq('id', pA).select('id'))
await check('admin', 'admin_set_staff_status on a clinic-B nurse', DENY, adminA.client.rpc('admin_set_staff_status', { p_profile_id: nurseB.id, p_is_active: false }).select('id'))
await check('reception', 'receptionist reads a linked patient for identity verification (check-in)', KEEP, ident(recA.client, pA))
await check('reception', 'receptionist reads a clinic-B-only patient', DENY, ident(recA.client, pB))
await check('reception', 'receptionist search_patients finds a never-visited patient by name (walk-in flow)', KEEP, recA.client.rpc('search_patients', { p_query: `PP unlinked ${RUN}` }))
await check('nurse', 'nurse reads ID number of any clinic-A patient (no care link) — Stage 2', STAGE2, ident(nurseA.client, pA))
// Item 1: other clinics' staff on the Admin Staff page (the page's own query: no clinic filter).
await check('staff page', "clinic-B nurse checked in at clinic A as a patient appears on clinic A's Staff page", OPEN, adminA.client.from('profiles').select('*').in('role', ['receptionist', 'nurse', 'admin']).eq('id', nurseB2.id))
await check('staff page', "clinic-A receptionist reads that clinic-B nurse's profile", OPEN, recA.client.from('profiles').select('id, phone').eq('id', nurseB2.id))
await check('staff page', 'Staff page still lists own-clinic staff', KEEP, adminA.client.from('profiles').select('*').in('role', ['receptionist', 'nurse', 'admin']).eq('id', recA.id))

// Item 2: duplicates, search, merge.
const dupPairs = async () => {
  const r = await adminA.client.rpc('find_duplicate_patients')
  return r
}
const pairOf = (r, a, b) => ({ ...r, data: (r.data ?? []).filter((x) => [x.profile_a, x.profile_b].sort().join() === [a, b].sort().join()) })
await check('duplicates', 'admin A sees a clinic-B-only duplicate pair (names, phones, visit counts)', OPEN, dupPairs().then((r) => pairOf(r, dupB1, dupB2)))
await check('duplicates', 'admin A sees a clinic-A + never-visited duplicate pair', KEEP, dupPairs().then((r) => pairOf(r, dupA, dupU)))
await check('search', 'receptionist A: partial-name search finds a clinic-B-only patient', OPEN, recA.client.rpc('search_patients', { p_query: `PP linked B ${RUN}` }))
await check('search', 'receptionist A: exact phone match discloses a clinic-B-only patient (a phone is not proof of identity)', OPEN, recA.client.rpc('search_patients', { p_query: phoneB }))
await check('search', 'receptionist A: partial phone does not find a clinic-B-only patient', DENY_IF_PROPOSED(), recA.client.rpc('search_patients', { p_query: phoneB.slice(0, 8) }))
await check('search', 'receptionist A: partial-name search finds a clinic-A patient', KEEP, recA.client.rpc('search_patients', { p_query: `PP linked A ${RUN}` }))
await check('search', 'nurse calls search_patients', OPEN, nurseA.client.rpc('search_patients', { p_query: `PP linked A ${RUN}` }))
await check('merge', 'admin A merges two clinic-B-only patients', OPEN, adminA.client.rpc('merge_patient_profiles', { p_keep_id: mergeB1, p_merge_id: mergeB2 }))
await check('merge', 'admin A merges a clinic-B staff profile into a clinic-A patient', OPEN, adminA.client.rpc('merge_patient_profiles', { p_keep_id: pA, p_merge_id: staffNoLogin }))
await check('merge', 'admin A merges a never-visited duplicate into a clinic-A patient', KEEP, adminA.client.rpc('merge_patient_profiles', { p_keep_id: dupA, p_merge_id: dupU }))

// Multi-clinic merge (rev 4): a patient known to clinics A and B must not be merged by either clinic alone.
await check('merge multi-clinic', 'receptionist A finds the shared patient S by name (legitimate cross-clinic care)', KEEP, recA.client.rpc('search_patients', { p_query: `PP Shared ${RUN}` }))
await check('merge multi-clinic', 'admin A merges shared patient S (history at A and B) into a clinic-A patient', OPEN, adminA.client.rpc('merge_patient_profiles', { p_keep_id: keepK, p_merge_id: S }))
await check('merge multi-clinic', "S's clinic-B queue entry still belongs to S afterwards", { baseline: 'denied', proposed: 'allowed' }, svc.from('queue_entries').select('id').eq('id', sB).eq('patient_id', S))
await check('merge multi-clinic', 'admin A merges a clinic-A patient INTO a shared profile (keep side shared)', { baseline: 'skip', proposed: 'denied' }, PHASE === 'baseline' ? Promise.resolve({ data: null }) : adminA.client.rpc('merge_patient_profiles', { p_keep_id: S, p_merge_id: keepK2 }))
await check('merge multi-clinic', 'admin B merges shared patient S as well', { baseline: 'skip', proposed: 'denied' }, PHASE === 'baseline' ? Promise.resolve({ data: null }) : adminB.client.rpc('merge_patient_profiles', { p_keep_id: otherB, p_merge_id: S }))
await check('merge audit refs', "admin A merges a clinic-A patient who is cancelled_by on a clinic-B appointment (rewrites B's audit record)", OPEN, adminA.client.rpc('merge_patient_profiles', { p_keep_id: keepK2, p_merge_id: M1 }))
await check('merge audit refs', "clinic B's appointment still records the original canceller", { baseline: 'denied', proposed: 'allowed' }, svc.from('appointments').select('id').eq('id', apptB).eq('cancelled_by', M1))
await check('merge audit refs', 'admin A merges a clinic-A patient holding a notification about a clinic-B entry', OPEN, adminA.client.rpc('merge_patient_profiles', { p_keep_id: keepK2, p_merge_id: M2 }))
await check('merge audit', 'an allowed merge writes a patient_merge_audit row (admin A can read it)', { baseline: 'skip', proposed: 'allowed' }, PHASE === 'baseline' ? Promise.resolve({ data: null }) : adminA.client.from('patient_merge_audit').select('id, merged_by, moved').eq('keep_id', dupA).eq('merged_by', adminA.id))
await check('merge audit', "admin B cannot read clinic A's merge audit", { baseline: 'skip', proposed: 'denied' }, PHASE === 'baseline' ? Promise.resolve({ data: null }) : adminB.client.from('patient_merge_audit').select('id').eq('keep_id', dupA))
await check('merge audit', 'nobody can write the merge audit directly', { baseline: 'skip', proposed: 'denied' }, PHASE === 'baseline' ? Promise.resolve({ data: null }) : adminA.client.from('patient_merge_audit').insert({ merged_by: adminA.id, clinic_id: CLINIC_A, keep_id: dupA, merged_id: dupA, moved: {} }).select('id'))

// F13 / F14 (function_privileges_hardening.sql)
const priv = (fn) => psql(`select has_function_privilege('authenticated', '${fn}', 'EXECUTE');`).trim() === 't'
await check('function privileges', 'authenticated can execute reset_demo_state() (any admin resets every clinic)', OPEN, Promise.resolve({ data: priv('public.reset_demo_state()') ? [1] : [] }))
await check('function privileges', 'service_role can still execute reset_demo_state()', KEEP, Promise.resolve({ data: psql("select has_function_privilege('service_role', 'public.reset_demo_state()', 'EXECUTE');").trim() === 't' ? [1] : [] }))
await check('function privileges', 'an ordinary patient triggers send_appointment_reminders()', OPEN, patSelf.client.rpc('send_appointment_reminders').then((r) => ({ ...r, data: r.error ? null : [1] })))
await check('function privileges', "the reminders cron job still targets send_appointment_reminders() as its owner", KEEP, Promise.resolve({ data: psql("select count(*) from cron.job where command like '%send_appointment_reminders%' and username = 'postgres';").trim() === '1' ? [1] : [] }))

// Remaining cross-clinic paths found in the audit — NOT changed by these proposals (pre-existing; separate fix).
const svcBForA = svcB
await check('cross-clinic controls', 'nurse A cannot go on duty on a clinic-B service (refused today)', DENY, nurseA.client.rpc('set_duty', { p_on_duty: true, p_service_id: svcBForA }).then((r) => ({ ...r, data: r.error ? null : [1] })))
await nurseA.client.rpc('set_duty', { p_on_duty: false })
const bEntry = (await must(svc.from('queue_entries').insert({ clinic_id: CLINIC_B, service_id: svcB, patient_id: pB, token: `PPE-${RUN}`, token_number: 799, status: 'waiting' }).select('id').single(), 'b entry')).id
await check('cross-clinic controls', 'F12: nurse A sets emergency priority on a clinic-B entry (closed by the queue_priority_reception cutover)', OPEN, nurseA.client.rpc('set_emergency_priority', { p_queue_entry_id: bEntry, p_emergency: true }).then((r) => ({ ...r, data: r.error ? null : [1] })))

await check('patient', 'patient reads own ID number / date of birth', KEEP, patSelf.client.from('profiles').select('id_number, date_of_birth').eq('id', patSelf.id))
await check('patient', "patient reads another patient's profile", DENY, ident(patSelf.client, pA))

const catalog = psql(readFileSync(join(here, 'assert_catalog_profiles.sql'), 'utf8')).trim().split('\n').filter(Boolean).map((l) => l.split('|'))
for (const [pass, name, detail] of catalog) {
  const want = PHASE === 'proposed' ? 'pass' : 'info'
  results.push({ area: 'catalog', name, want, got: pass === 't' ? 'pass' : 'fail', ok: want === 'info' || pass === 't', detail })
}

const width = Math.max(...results.map((r) => r.name.length))
let lastArea = ''
for (const r of results) {
  if (r.area !== lastArea) { console.log(`\n[${r.area}]`); lastArea = r.area }
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  expected ${r.want.padEnd(7)} got ${r.got.padEnd(7)} ${r.detail}`)
}
const failed = results.filter((r) => !r.ok)
console.log(`\nPHASE=${PHASE}: ${results.length - failed.length}/${results.length} assertions hold${failed.length ? `, ${failed.length} FAILED` : ''}.`)
process.exit(failed.length ? 1 : 0)
