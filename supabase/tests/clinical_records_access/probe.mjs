// Clinical-records access assertions. LOCAL SUPABASE STACK ONLY.
//
// Refuses any API URL that is not http://localhost|127.0.0.1:<port>, and any PSQL_CMD that does not target a
// local `supabase_db_*` container or localhost. It creates users, a second clinic, queue entries,
// consultations, notes and vitals, so it must never point at the shared project.
//
//   PHASE=baseline  -> asserts today's behaviour (the committed migrations): the gaps are expected to be OPEN.
//   PHASE=proposed  -> asserts the behaviour after docs/proposals/clinical_records_access.sql: gaps CLOSED and the
//                      legitimate flow still working.
//
//   SB_URL=... SB_ANON=... SB_SERVICE=... PHASE=proposed \
//   PSQL_CMD="docker exec -i supabase_db_<project> psql -U postgres -At -v ON_ERROR_STOP=1" \
//   node supabase/tests/clinical_records_access/probe.mjs
//
// Exit code 0 only if every assertion for the phase holds. CLINIC_A is the demo clinic id used by the local
// scratch seed; set PROBE_CLINIC_A to override.
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

const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const svc = createClient(SB_URL, SB_SERVICE, opts)
const RUN = Date.now().toString(36)
const CLINIC_A = process.env.PROBE_CLINIC_A ?? '11111111-1111-1111-1111-111111111111'
const CLINIC_B = crypto.randomUUID()
const must = async (p, what) => { const r = await p; if (r.error) throw new Error(`setup ${what}: ${r.error.message}`); return r.data }
const prefix = () => Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')
const psql = (sql) => execSync(PSQL_CMD, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })

// ---------------------------------------------------------------- fixtures (service role, local only)
await must(svc.from('clinics').insert({ id: CLINIC_B, name: `Probe B ${RUN}` }), 'clinic B')
const service = async (clinic, name) => (await must(svc.from('services').insert({ clinic_id: clinic, name, token_prefix: prefix() }).select('id').single(), name)).id
const svcA = await service(CLINIC_A, `Probe A ${RUN}`)
const svcA2 = await service(CLINIC_A, `Probe A2 ${RUN}`)
const svcB = await service(CLINIC_B, `Probe B ${RUN}`)

async function user(tag, role, clinic) {
  const email = `${tag}.${RUN}@probe.test`
  const u = (await must(svc.auth.admin.createUser({ email, password: 'probe-password-1', email_confirm: true }), `user ${tag}`)).user
  await must(svc.from('profiles').update({ role, clinic_id: clinic, full_name: `Probe ${tag}` }).eq('auth_user_id', u.id), `role ${tag}`)
  const prof = await must(svc.from('profiles').select('id').eq('auth_user_id', u.id).single(), `profile ${tag}`)
  const client = createClient(SB_URL, SB_ANON, opts)
  await must(client.auth.signInWithPassword({ email, password: 'probe-password-1' }), `sign in ${tag}`)
  return { client, id: prof.id, tag }
}
const nurseT = await user('treating', 'nurse', CLINIC_A) // will call patient X through the real next_patient()
const nurseU = await user('unrelated', 'nurse', CLINIC_A) // same clinic, no link to X
const nurseP = await user('previous', 'nurse', CLINIC_A) // authored X's earlier visit
const nurseI = await user('inactive', 'nurse', CLINIC_A) // treating W, then deactivated
const nurseB = await user('otherclinic', 'nurse', CLINIC_B)
const recA = await user('reception', 'receptionist', CLINIC_A)
const adminA = await user('admin', 'admin', CLINIC_A)
const patX = await user('patientx', 'patient', null) // a real login, to test the patient's own access
const anon = createClient(SB_URL, SB_ANON, opts)

const newPatient = async (name) => (await must(svc.from('profiles').insert({ full_name: name, role: 'patient' }).select('id').single(), name)).id
let tokenN = 0
async function entry(patient, clinic, serviceId, status) {
  const n = ++tokenN
  return (await must(svc.from('queue_entries').insert({ clinic_id: clinic, service_id: serviceId, patient_id: patient, token: `Q${n}-${RUN}`, token_number: 900 + n, status }).select('id').single(), 'queue entry')).id
}
async function visit(patient, clinic, serviceId, nurse, { open = false, clinical = false, hoursAgo = 48 } = {}) {
  const q = await entry(patient, clinic, serviceId, open ? 'in_progress' : 'done')
  const started = new Date(Date.now() - hoursAgo * 3600_000)
  const c = (await must(svc.from('consultations').insert({
    queue_entry_id: q, nurse_id: nurse.id, service_id: serviceId, started_at: started.toISOString(),
    ended_at: open ? null : new Date(started.getTime() + 600_000).toISOString(),
  }).select('id').single(), 'consultation')).id
  let note = null; let vitals = null
  if (clinical) {
    note = (await must(svc.from('consultation_notes').insert({ consultation_id: c, nurse_id: nurse.id, diagnosis: `DX-${RUN}` }).select('id').single(), 'note')).id
    vitals = (await must(svc.from('patient_vitals').insert({ consultation_id: c, patient_id: patient, nurse_id: nurse.id, pulse: 72 }).select('id').single(), 'vitals')).id
  }
  return { queue: q, consultation: c, note, vitals }
}

const X = patX.id
const Y = await newPatient(`Probe Y ${RUN}`) // seen before at clinic A, nobody treating them now
const W = await newPatient(`Probe W ${RUN}`) // being treated by the nurse who is then deactivated
const Z = await newPatient(`Probe Z ${RUN}`) // waiting, no consultation (target for a forged consultation)
const R = await newPatient(`Probe R ${RUN}`) // nurse U's own current patient (for the re-target attempt)

const xPrevA = await visit(X, CLINIC_A, svcA, nurseP, { clinical: true, hoursAgo: 72 }) // previous visit, clinic A
const xPrevB = await visit(X, CLINIC_B, svcB, nurseB, { clinical: true, hoursAgo: 96 }) // previous visit, clinic B
const yPrev = await visit(Y, CLINIC_A, svcA, nurseP, { clinical: true, hoursAgo: 50 })
const wPrev = await visit(W, CLINIC_A, svcA, nurseP, { clinical: true, hoursAgo: 60 })
await visit(W, CLINIC_A, svcA2, nurseI, { open: true })
const tEnded = await visit(Y, CLINIC_A, svcA, nurseT, { hoursAgo: 30 }) // nurse T's own ENDED visit, no notes
const uEnded = await visit(Z, CLINIC_A, svcA2, nurseU, { hoursAgo: 20 }) // nurse U's own ENDED visit
const uOpen = await visit(R, CLINIC_A, svcA2, nurseU, { open: true })
const bFresh = await visit(Z, CLINIC_B, svcB, nurseB, { open: true }) // clinic B consultation, no note yet
const zWaiting = await entry(Z, CLINIC_A, svcA2, 'waiting')

// X's current visit, through the real next_patient(): T is on duty on svcA and X is the only waiting entry.
await entry(X, CLINIC_A, svcA, 'waiting')
await must(svc.from('profiles').update({ is_on_duty: true, current_service_id: svcA }).eq('id', nurseT.id), 'duty')
const called = await nurseT.client.rpc('next_patient', { p_action_id: crypto.randomUUID() })
if (called.error) throw new Error(`setup next_patient: ${called.error.message}`)
const xNow = await must(svc.from('consultations').select('id, queue_entry:queue_entries!consultations_queue_entry_id_fkey(patient_id, status)').eq('nurse_id', nurseT.id).is('ended_at', null).single(), 'current consultation')
if (xNow.queue_entry.patient_id !== X || xNow.queue_entry.status !== 'in_progress') throw new Error('setup: next_patient did not call X')
await must(svc.from('profiles').update({ is_active: false }).eq('id', nurseI.id), 'deactivate')

// ---------------------------------------------------------------- assertions
const results = []
const rowsOf = (r) => (r.error || r.data == null ? 0 : Array.isArray(r.data) ? r.data.length : 1)
const readOutcome = (r) => (rowsOf(r) > 0 ? 'allowed' : 'denied')
const writeOutcome = (r) => (!r.error && rowsOf(r) > 0 ? 'allowed' : 'denied')
const why = (r) => (r.error ? `${r.error.code ?? ''} ${r.error.message ?? ''}`.trim().slice(0, 70) : `${rowsOf(r)} row(s)`)

/** expect: { baseline, proposed } each 'allowed' | 'denied' | 'skip' */
async function check(area, name, expect, run) {
  const want = expect[PHASE]
  if (want === 'skip') { results.push({ area, name, want, got: 'skip', ok: true, detail: 'not applicable in this phase' }); return }
  const { outcome, detail } = await run()
  results.push({ area, name, want, got: outcome, ok: outcome === want, detail })
}
const read = (q) => async () => { const r = await q; return { outcome: readOutcome(r), detail: why(r) } }
const write = (q) => async () => { const r = await q; return { outcome: writeOutcome(r), detail: why(r) } }
const OPEN = { baseline: 'allowed', proposed: 'denied' } // a gap today, closed by the proposal
const KEEP = { baseline: 'allowed', proposed: 'allowed' } // legitimate, must keep working
const DENY = { baseline: 'denied', proposed: 'denied' } // already denied, must stay denied
const NEW = { baseline: 'skip', proposed: 'allowed' } // only exists after the proposal

const notes = (c) => c.from('consultation_notes').select('id')
const vit = (c) => c.from('patient_vitals').select('id')

// Treating nurse
await check('treating nurse', "reads current patient X's previous clinic-A note (other author)", KEEP, read(notes(nurseT.client).eq('id', xPrevA.note)))
await check('treating nurse', "reads current patient X's previous clinic-A vitals", KEEP, read(vit(nurseT.client).eq('id', xPrevA.vitals)))
await check('treating nurse', "reads X's clinic-B note (cross-clinic history)", DENY, read(notes(nurseT.client).eq('id', xPrevB.note)))
await check('treating nurse', "reads Y's note (not currently treating Y)", OPEN, read(notes(nurseT.client).eq('id', yPrev.note)))
await check('treating nurse', "reads X's previous consultation row directly (policy not broadened)", DENY, read(nurseT.client.from('consultations').select('id').eq('id', xPrevA.consultation)))
await check('treating nurse', 'get_patient_clinical_history(X) returns the clinic-A visits', NEW, async () => {
  const r = await nurseT.client.rpc('get_patient_clinical_history', { p_patient_id: X })
  const ids = (r.data ?? []).map((v) => v.consultation_id)
  const ok = !r.error && ids.includes(xPrevA.consultation) && ids.includes(xNow.id) && !ids.includes(xPrevB.consultation)
  return { outcome: ok ? 'allowed' : 'denied', detail: r.error ? why(r) : `${ids.length} visit(s); prevA=${ids.includes(xPrevA.consultation)} current=${ids.includes(xNow.id)} clinicB=${ids.includes(xPrevB.consultation)}` }
})
await check('treating nurse', 'get_patient_clinical_history(Y) for a patient not in care', DENY, write(nurseT.client.rpc('get_patient_clinical_history', { p_patient_id: Y })))

// Unrelated / other nurses
await check('unrelated nurse', "same-clinic nurse with no link reads X's previous note", OPEN, read(notes(nurseU.client).eq('id', xPrevA.note)))
await check('unrelated nurse', "same-clinic nurse with no link reads X's vitals by patient_id", OPEN, read(vit(nurseU.client).eq('patient_id', X)))
await check('unrelated nurse', 'same-clinic nurse lists every note in the clinic', OPEN, read(notes(nurseU.client)))
await check('unrelated nurse', 'get_patient_clinical_history(X) by an unrelated nurse', DENY, write(nurseU.client.rpc('get_patient_clinical_history', { p_patient_id: X })))
await check('author nurse', 'author reads the note they wrote (patient no longer in their care)', KEEP, read(notes(nurseP.client).eq('id', xPrevA.note)))
await check('other clinic', "clinic-B nurse reads X's clinic-A note", DENY, read(notes(nurseB.client).eq('id', xPrevA.note)))
await check('other clinic', 'clinic-B nurse reads the clinic-B note they authored', KEEP, read(notes(nurseB.client).eq('id', xPrevB.note)))
await check('inactive nurse', "deactivated nurse still holding W's open consultation reads W's history", OPEN, read(notes(nurseI.client).eq('id', wPrev.note)))

// Non-nurse roles
await check('receptionist', 'receptionist reads clinical notes', OPEN, read(notes(recA.client)))
await check('receptionist', 'receptionist reads vitals', OPEN, read(vit(recA.client)))
await check('admin', 'admin reads clinical notes', OPEN, read(notes(adminA.client)))
await check('admin', 'admin reads vitals', OPEN, read(vit(adminA.client)))
await check('patient', 'patient X reads their own notes (POPIA review pending)', DENY, read(notes(patX.client)))
await check('patient', 'patient X reads their own vitals', DENY, read(vit(patX.client)))
await check('anon', 'anon reads notes', DENY, read(notes(anon)))
await check('anon', 'anon reads vitals', DENY, read(vit(anon)))
await check('anon', 'anon inserts a note', DENY, write(anon.from('consultation_notes').insert({ consultation_id: xNow.id, nurse_id: nurseT.id, diagnosis: 'anon' }).select('id')))
await check('receptionist', 'receptionist inserts a note', DENY, write(recA.client.from('consultation_notes').insert({ consultation_id: xNow.id, nurse_id: recA.id, diagnosis: 'rec' }).select('id')))

// Helper exposure
await check('helpers', 'private.nurse_treats_patient is not callable as an RPC', DENY, write(nurseT.client.rpc('nurse_treats_patient', { p_patient_id: X })))
await check('helpers', 'private schema not reachable through PostgREST', DENY, write(nurseT.client.schema('private').rpc('nurse_treats_patient', { p_patient_id: X })))

// Forgery (must be denied before the legitimate write so the unique(consultation_id) slot is still free)
await check('forgery', "unrelated nurse writes a note on the treating nurse's consultation", OPEN, write(nurseU.client.from('consultation_notes').insert({ consultation_id: xNow.id, nurse_id: nurseU.id, diagnosis: 'forged' }).select('id')))
if (PHASE === 'baseline') await svc.from('consultation_notes').delete().eq('consultation_id', xNow.id) // free the slot again
await check('forgery', 'clinic-A nurse writes a note on a clinic-B consultation', OPEN, write(nurseT.client.from('consultation_notes').insert({ consultation_id: bFresh.consultation, nurse_id: nurseT.id, diagnosis: 'forged' }).select('id')))
await check('forgery', "treating nurse records vitals for Y on X's consultation", OPEN, write(nurseT.client.from('patient_vitals').insert({ consultation_id: xNow.id, patient_id: Y, nurse_id: nurseT.id, pulse: 199 }).select('id')))
if (PHASE === 'baseline') await svc.from('patient_vitals').delete().eq('consultation_id', xNow.id)
await check('forgery', 'nurse writes a note on their own ENDED consultation (D3: addendum workflow later)', OPEN, write(nurseT.client.from('consultation_notes').insert({ consultation_id: tEnded.consultation, nurse_id: nurseT.id, diagnosis: 'late' }).select('id')))
if (PHASE === 'baseline') await svc.from('consultation_notes').delete().eq('consultation_id', tEnded.consultation)
await check('forgery', 'note authored as another nurse (nurse_id spoofed)', DENY, write(nurseU.client.from('consultation_notes').insert({ consultation_id: uOpen.consultation, nurse_id: nurseT.id, diagnosis: 'spoof' }).select('id')))

// Treatment-link spoofing
await check('link spoofing', "nurse inserts a consultation on Z's waiting entry (self-assigned care)", OPEN, write(nurseU.client.from('consultations').insert({ queue_entry_id: zWaiting, nurse_id: nurseU.id, service_id: svcA2 }).select('id')))
await check('link spoofing', 'nurse re-opens their own ended consultation', OPEN, write(nurseU.client.from('consultations').update({ ended_at: null }).eq('id', uEnded.consultation).select('id')))
await check('link spoofing', 'nurse changes patient_id on the queue entry they are serving to X', OPEN, write(nurseU.client.from('queue_entries').update({ patient_id: X }).eq('id', uOpen.queue).select('id')))
await check('link spoofing', "after those attempts, unrelated nurse reads X's previous note", OPEN, read(notes(nurseU.client).eq('id', xPrevA.note)))

// Legitimate author flow
let ownNote = null
await check('legitimate', 'treating nurse writes a note on their own active consultation', KEEP, async () => {
  const r = await nurseT.client.from('consultation_notes').insert({ consultation_id: xNow.id, nurse_id: nurseT.id, chief_complaint: 'cough' }).select('id')
  ownNote = r.data?.[0]?.id ?? null
  return { outcome: writeOutcome(r), detail: why(r) }
})
await check('legitimate', "treating nurse records vitals for the consultation's patient", KEEP, write(nurseT.client.from('patient_vitals').insert({ consultation_id: xNow.id, patient_id: X, nurse_id: nurseT.id, pulse: 80 }).select('id')))
await check('legitimate', 'treating nurse edits their note while the consultation is active', KEEP, write(nurseT.client.from('consultation_notes').update({ treatment: 'rest' }).eq('id', ownNote).select('id')))
await check('legitimate', 'treating nurse reads their note back', KEEP, read(notes(nurseT.client).eq('id', ownNote)))
await check('forgery', 'treating nurse moves their note to another encounter', OPEN, write(nurseT.client.from('consultation_notes').update({ consultation_id: tEnded.consultation }).eq('id', ownNote).select('id')))
if (PHASE === 'baseline') await svc.from('consultation_notes').update({ consultation_id: xNow.id }).eq('id', ownNote)
await check('forgery', 'nurse deletes a note', DENY, write(nurseT.client.from('consultation_notes').delete().eq('id', ownNote).select('id')))

// After the consultation ends, the "previous records" link ends; authorship remains.
await must(svc.from('consultations').update({ ended_at: new Date().toISOString() }).eq('id', xNow.id), 'end')
await must(svc.from('queue_entries').update({ status: 'done' }).eq('id', (await must(svc.from('consultations').select('queue_entry_id').eq('id', xNow.id).single(), 'q')).queue_entry_id), 'done')
await check('after completion', "nurse T reads X's previous note once X is no longer in their care", OPEN, read(notes(nurseT.client).eq('id', xPrevA.note)))
await check('after completion', 'nurse T still reads the note they wrote', KEEP, read(notes(nurseT.client).eq('id', ownNote)))
await check('after completion', 'nurse T edits their note after completion (silent change)', OPEN, write(nurseT.client.from('consultation_notes').update({ treatment: 'changed later' }).eq('id', ownNote).select('id')))

// Privileges that RLS does not govern: TRUNCATE as authenticated, inside a transaction that is rolled back.
// (queue_entries is covered by the catalog assertions: a CASCADE truncate of it also needs privileges on
// unrelated referencing tables, which would make the result about those tables rather than this one.)
for (const [role, table] of [['authenticated', 'consultation_notes'], ['authenticated', 'patient_vitals'], ['authenticated', 'consultations'], ['anon', 'consultation_notes']]) {
  await check('grants', `${role} can TRUNCATE ${table} (inside a rolled-back transaction)`, OPEN, async () => {
    const sql = `begin;\nset local role ${role};\ntruncate public.${table} cascade;\nrollback;\n`
    try {
      psql(sql)
      return { outcome: 'allowed', detail: 'TRUNCATE succeeded (rolled back)' }
    } catch (e) {
      const msg = String(e.stderr ?? e.message)
      if (/permission denied/i.test(msg)) return { outcome: 'denied', detail: msg.trim().split('\n')[0].slice(0, 70) }
      throw e
    }
  })
}

// ---------------------------------------------------------------- catalog assertions (read-only SQL)
const catalog = psql(readFileSync(join(here, 'assert_catalog.sql'), 'utf8')).trim().split('\n').filter(Boolean).map((l) => l.split('|'))
for (const [pass, name, detail] of catalog) {
  const want = PHASE === 'proposed' ? 'pass' : 'any'
  results.push({ area: 'catalog', name, want, got: pass === 't' ? 'pass' : 'fail', ok: want === 'any' || pass === 't', detail })
}

// ---------------------------------------------------------------- report
const width = Math.max(...results.map((r) => r.name.length))
let lastArea = ''
for (const r of results) {
  if (r.area !== lastArea) { console.log(`\n[${r.area}]`); lastArea = r.area }
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  expected ${r.want.padEnd(7)} got ${r.got.padEnd(7)} ${r.detail ?? ''}`)
}
const failed = results.filter((r) => !r.ok)
console.log(`\nPHASE=${PHASE}: ${results.length - failed.length}/${results.length} assertions hold${failed.length ? `, ${failed.length} FAILED` : ''}.`)
process.exit(failed.length ? 1 : 0)
