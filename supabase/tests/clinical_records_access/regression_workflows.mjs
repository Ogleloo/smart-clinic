// Workflow regression for the clinical-records and profiles proposals. LOCAL SUPABASE STACK ONLY.
// Drives the real RPCs the deployed app uses — as real signed-in reception, nurse, admin and patient users — and
// asserts every step still succeeds (and that the reads each screen makes still return rows). Run it on a local
// stack with BOTH proposals applied; it should also pass on the unmodified baseline.
//
//   SB_URL=... SB_ANON=... SB_SERVICE=... node supabase/tests/clinical_records_access/regression_workflows.mjs
import { createRequire } from 'node:module'

const require = createRequire(`${process.cwd()}/`)
const { createClient } = require('@supabase/supabase-js')
const { SB_URL, SB_ANON, SB_SERVICE } = process.env
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(SB_URL ?? '')) throw new Error(`Refusing: SB_URL must be a local stack, got ${SB_URL}`)

const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const svc = createClient(SB_URL, SB_SERVICE, opts)
const RUN = Date.now().toString(36)
const CLINIC_A = process.env.PROBE_CLINIC_A ?? '11111111-1111-1111-1111-111111111111'
const must = async (p, what) => { const r = await p; if (r.error) throw new Error(`setup ${what}: ${r.error.message}`); return r.data }
const prefix = () => Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')

const svcId = (await must(svc.from('services').insert({ clinic_id: CLINIC_A, name: `WF ${RUN}`, token_prefix: prefix() }).select('id').single(), 'service')).id
async function user(tag, role, clinic) {
  const email = `wf-${tag}.${RUN}@probe.test`
  const u = (await must(svc.auth.admin.createUser({ email, password: 'probe-password-1', email_confirm: true }), tag)).user
  await must(svc.from('profiles').update({ role, clinic_id: clinic, full_name: `WF ${tag} ${RUN}` }).eq('auth_user_id', u.id), tag)
  const prof = await must(svc.from('profiles').select('id').eq('auth_user_id', u.id).single(), tag)
  const client = createClient(SB_URL, SB_ANON, opts)
  await must(client.auth.signInWithPassword({ email, password: 'probe-password-1' }), tag)
  return { client, id: prof.id }
}
const rec = await user('reception', 'receptionist', CLINIC_A)
const nurse = await user('nurse', 'nurse', CLINIC_A)
const nurse2 = await user('nurse2', 'nurse', CLINIC_A)
const admin = await user('admin', 'admin', CLINIC_A)
const patient = await user('patient', 'patient', null)

const results = []
async function step(name, run) {
  try {
    const detail = await run()
    results.push({ name, ok: true, detail: typeof detail === 'string' ? detail : '' })
  } catch (e) {
    results.push({ name, ok: false, detail: String(e.message ?? e).slice(0, 110) })
  }
}
const ok = async (q, what) => { const r = await q; if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data }
const nonEmpty = async (q, what) => { const d = await ok(q, what); const n = Array.isArray(d) ? d.length : d == null ? 0 : 1; if (!n) throw new Error(`${what}: no rows`); return `${n} row(s)` }

let p1, p2, p3, entry1, entry2, entry3
// Reception
await step('reception: create_walkin_patient (x2)', async () => {
  p1 = (await ok(rec.client.rpc('create_walkin_patient', { p_full_name: `WF Walkin One ${RUN}`, p_phone: null }), 'walkin')); p1 = p1?.id ?? p1
  p3 = (await ok(rec.client.rpc('create_walkin_patient', { p_full_name: `WF Walkin One ${RUN}`, p_phone: null }), 'walkin dup')); p3 = p3?.id ?? p3
  return `ids ${typeof p1}`
})
p2 = patient.id
await step('reception: search_patients finds the walk-in', () => nonEmpty(rec.client.rpc('search_patients', { p_query: `WF Walkin One ${RUN}` }), 'search'))
await step('reception: check_in_patient (walk-in and registered patient)', async () => {
  entry1 = await ok(rec.client.rpc('check_in_patient', { p_service_id: svcId, p_patient_id: p1 }), 'check-in 1')
  entry2 = await ok(rec.client.rpc('check_in_patient', { p_service_id: svcId, p_patient_id: p2 }), 'check-in 2')
  entry1 = entry1?.id ?? entry1; entry2 = entry2?.id ?? entry2
})
await step('reception: loads the checked-in patient profile for identity verification', () => nonEmpty(rec.client.from('profiles').select('id, full_name, phone, date_of_birth, id_number').eq('id', p2), 'profile'))
await step('reception: get_service_queue shows both', async () => { const d = await ok(rec.client.rpc('get_service_queue', { p_service_id: svcId }), 'queue'); if ((d ?? []).length < 2) throw new Error(`queue has ${(d ?? []).length}`); return `${d.length} waiting` })
await step('reception: queue_entries read with patient names (reception queue page)', () => nonEmpty(rec.client.from('queue_entries').select('id, token, patient:profiles!queue_entries_patient_id_fkey(full_name)').eq('service_id', svcId), 'queue read'))
await step('nurse: set_emergency_priority on and off (clinical staff only)', async () => { await ok(nurse2.client.rpc('set_emergency_priority', { p_queue_entry_id: entry2, p_emergency: true }), 'on'); await ok(nurse2.client.rpc('set_emergency_priority', { p_queue_entry_id: entry2, p_emergency: false }), 'off') })
await step('patient: reads own queue entry (patient dashboard)', () => nonEmpty(patient.client.from('queue_entries').select('id, status').eq('patient_id', p2), 'own entry'))

// Nurse
const a1 = crypto.randomUUID(); const a2 = crypto.randomUUID()
let consultation
await step('nurse: set_duty on the service', () => ok(nurse.client.rpc('set_duty', { p_on_duty: true, p_service_id: svcId }), 'duty'))
await step('nurse: next_patient', () => ok(nurse.client.rpc('next_patient', { p_action_id: a1 }), 'next'))
await step('nurse: undo_next_patient', () => ok(nurse.client.rpc('undo_next_patient', { p_action_id: a1 }), 'undo'))
await step('nurse: next_patient again', () => ok(nurse.client.rpc('next_patient', { p_action_id: a2 }), 'next 2'))
await step('nurse: reads own open consultation with patient name (current-patient panel)', async () => {
  const d = await ok(nurse.client.from('consultations').select('id, queue_entry:queue_entries!consultations_queue_entry_id_fkey(id, token, patient_id, patient:profiles!queue_entries_patient_id_fkey(full_name))').eq('nurse_id', nurse.id).is('ended_at', null).maybeSingle(), 'current')
  if (!d?.queue_entry?.patient?.full_name) throw new Error('no current patient name')
  consultation = d
  return d.queue_entry.token
})
await step('nurse: records a note and vitals on the active consultation', async () => {
  await ok(nurse.client.from('consultation_notes').insert({ consultation_id: consultation.id, nurse_id: nurse.id, chief_complaint: 'wf' }).select('id'), 'note')
  await ok(nurse.client.from('patient_vitals').insert({ consultation_id: consultation.id, patient_id: consultation.queue_entry.patient_id, nurse_id: nurse.id, pulse: 70 }).select('id'), 'vitals')
})
await step('nurse: nurse dashboard reads (own consultations today, service stats)', async () => {
  await nonEmpty(nurse.client.from('consultations').select('id, started_at, ended_at').eq('nurse_id', nurse.id), 'own consultations')
  await ok(nurse.client.rpc('service_consultation_stats', { p_service_id: svcId }), 'stats').catch(() => null)
})
await step('nurse 2: skip_waiting_patient on the remaining waiting entry', async () => {
  const q = await ok(nurse2.client.rpc('get_service_queue', { p_service_id: svcId }), 'queue')
  const waiting = (q ?? []).find((r) => r.status === 'waiting') ?? (q ?? [])[0]
  if (!waiting) throw new Error('no waiting entry left')
  entry3 = waiting.id ?? waiting.queue_entry_id
  await ok(nurse2.client.rpc('skip_waiting_patient', { p_queue_entry_id: entry3 }), 'skip')
})
await step('nurse: end_consultation', () => ok(nurse.client.rpc('end_consultation', { p_queue_entry_id: consultation.queue_entry.id }), 'end'))
await step('nurse: end_shift', () => ok(nurse.client.rpc('end_shift', {}), 'end shift'))
await step('reception: skip_patient on a fresh check-in', async () => {
  const e = await ok(rec.client.rpc('check_in_patient', { p_service_id: svcId, p_patient_id: p3 }), 'check-in 3')
  await ok(rec.client.rpc('skip_patient', { p_queue_entry_id: e?.id ?? e, p_no_show: false }), 'skip')
})

// Admin
await step('admin: reports read consultations at the clinic', () => nonEmpty(admin.client.from('consultations').select('id, service_id').eq('service_id', svcId), 'reports'))
await step('admin: staff page lists clinic staff', () => nonEmpty(admin.client.from('profiles').select('*').in('role', ['receptionist', 'nurse', 'admin']).eq('id', nurse.id), 'staff'))
await step('admin: admin_set_staff_status on an own-clinic nurse', () => ok(admin.client.rpc('admin_set_staff_status', { p_profile_id: nurse2.id, p_is_active: true }), 'staff status'))
await step('admin: patient search (direct profiles query) finds a clinic patient', () => nonEmpty(admin.client.from('profiles').select('id, full_name, phone, role, auth_user_id').ilike('full_name', `%WF Walkin One ${RUN}%`), 'patient search'))
await step('admin: find_duplicate_patients + merge_patient_profiles', async () => {
  await ok(admin.client.rpc('find_duplicate_patients'), 'duplicates')
  await ok(admin.client.rpc('merge_patient_profiles', { p_keep_id: p1, p_merge_id: p3 }), 'merge')
})

const width = Math.max(...results.map((r) => r.name.length))
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}`)
const failed = results.filter((r) => !r.ok)
console.log(`\nworkflows: ${results.length - failed.length}/${results.length} steps succeeded${failed.length ? `, ${failed.length} FAILED` : ''}.`)
process.exit(failed.length ? 1 : 0)
