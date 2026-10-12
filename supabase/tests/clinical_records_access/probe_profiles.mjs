// Patient-identifier (profiles) access assertions for docs/proposals/profiles_identifier_access.sql.
// LOCAL SUPABASE STACK ONLY (refuses any non-local URL). Creates users, a second clinic and queue entries.
//
//   SB_URL=... SB_ANON=... SB_SERVICE=... PHASE=baseline|proposed node supabase/tests/clinical_records_access/probe_profiles.mjs
//
// Exit code 0 only if every assertion for the phase holds.
import { createRequire } from 'node:module'

const require = createRequire(`${process.cwd()}/`)
const { createClient } = require('@supabase/supabase-js')
const { SB_URL, SB_ANON, SB_SERVICE, PHASE } = process.env
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(SB_URL ?? '')) throw new Error(`Refusing: SB_URL must be a local stack, got ${SB_URL}`)
if (!['baseline', 'proposed'].includes(PHASE)) throw new Error('PHASE must be baseline or proposed')

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

const results = []
const rows = (r) => (r.error || r.data == null ? 0 : Array.isArray(r.data) ? r.data.length : 1)
const why = (r) => (r.error ? `${r.error.code ?? ''} ${r.error.message ?? ''}`.trim().slice(0, 70) : `${rows(r)} row(s)`)
async function check(area, name, expect, q) {
  const want = expect[PHASE]
  const r = await q
  const got = rows(r) > 0 ? 'allowed' : 'denied'
  results.push({ area, name, want, got, ok: got === want, detail: why(r) })
}
const OPEN = { baseline: 'allowed', proposed: 'denied' }
const KEEP = { baseline: 'allowed', proposed: 'allowed' }
const DENY = { baseline: 'denied', proposed: 'denied' }
const STAGE2 = { baseline: 'allowed', proposed: 'allowed' } // still allowed after Stage 1; Stage 2 design addresses it
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
await check('nurse', 'nurse search_patients across all clinics (name/phone) — Stage 2', STAGE2, nurseA.client.rpc('search_patients', { p_query: `PP linked B ${RUN}` }))
await check('patient', 'patient reads own ID number / date of birth', KEEP, patSelf.client.from('profiles').select('id_number, date_of_birth').eq('id', patSelf.id))
await check('patient', "patient reads another patient's profile", DENY, ident(patSelf.client, pA))

const width = Math.max(...results.map((r) => r.name.length))
let lastArea = ''
for (const r of results) {
  if (r.area !== lastArea) { console.log(`\n[${r.area}]`); lastArea = r.area }
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  expected ${r.want.padEnd(7)} got ${r.got.padEnd(7)} ${r.detail}`)
}
const failed = results.filter((r) => !r.ok)
console.log(`\nPHASE=${PHASE}: ${results.length - failed.length}/${results.length} assertions hold${failed.length ? `, ${failed.length} FAILED` : ''}.`)
process.exit(failed.length ? 1 : 0)
