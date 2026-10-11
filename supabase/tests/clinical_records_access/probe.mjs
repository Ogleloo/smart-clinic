// LOCAL STACK ONLY (refuses any URL that is not http://localhost|127.0.0.1:<port>). Never run against the shared project:
// it creates users, a second clinic and clinical rows.
// Usage: SB_URL=... SB_ANON=... SB_SERVICE=... node supabase/tests/clinical_records_access/probe.mjs
// Run before and after applying docs/proposals/clinical_records_access.sql to a LOCAL stack. "gap" probes return rows or
// succeed before and are denied after; control probes are denied both times; POSITIVE CONTROLS succeed both times.
// CLINIC_A is the demo clinic id of the scratch local seed; adjust if your local seed differs.
import { createRequire } from 'node:module'
const require = createRequire(`${process.cwd()}/`)
const { createClient } = require('@supabase/supabase-js')
const { SB_URL, SB_ANON, SB_SERVICE } = process.env
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(SB_URL ?? '')) throw new Error('local only')
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(SB_URL, SB_SERVICE, opts)
const RUN = Date.now().toString(36)
const CLINIC_A = '11111111-1111-1111-1111-111111111111'
const CLINIC_B = crypto.randomUUID()
const must = async (p, w) => { const r = await p; if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data }
const letters = () => Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')

await must(admin.from('clinics').insert({ id: CLINIC_B, name: `Probe B ${RUN}` }), 'clinic B')
const svcA = (await must(admin.from('services').insert({ clinic_id: CLINIC_A, name: `Probe A ${RUN}`, token_prefix: letters() }).select('id').single(), 'svcA')).id
const svcB = (await must(admin.from('services').insert({ clinic_id: CLINIC_B, name: `Probe B ${RUN}`, token_prefix: letters() }).select('id').single(), 'svcB')).id

async function user(tag, role, clinic) {
  const email = `${tag}.${RUN}@probe.test`
  const u = (await must(admin.auth.admin.createUser({ email, password: 'probe-password-1', email_confirm: true }), 'user')).user
  await must(admin.from('profiles').update({ role, clinic_id: clinic }).eq('auth_user_id', u.id), 'role')
  const prof = await must(admin.from('profiles').select('id').eq('auth_user_id', u.id).single(), 'prof')
  const client = createClient(SB_URL, SB_ANON, opts)
  await must(client.auth.signInWithPassword({ email, password: 'probe-password-1' }), 'signin')
  return { client, id: prof.id }
}
const nurseA1 = await user('na1', 'nurse', CLINIC_A)
const nurseA2 = await user('na2', 'nurse', CLINIC_A)
const recA = await user('ra', 'receptionist', CLINIC_A)
const adminA = await user('aa', 'admin', CLINIC_A)
const nurseB1 = await user('nb1', 'nurse', CLINIC_B)
const patientSelf = await user('pt', 'patient', null)
const anon = createClient(SB_URL, SB_ANON, opts)

// Patients X (clinic A) and Y (clinic B), with a visit each.
let seqN = 0
async function patientWithVisit(name, clinic, svc, nurse, withClinical) {
  const seq = ++seqN
  const p = await must(admin.from('profiles').insert({ full_name: name, role: 'patient', id_number: '9001015800085', date_of_birth: '1990-01-01', phone: '+27 82 000 0000' }).select('id').single(), 'patient')
  const q = await must(admin.from('queue_entries').insert({ clinic_id: clinic, service_id: svc, patient_id: p.id, token: `P${seq}-${RUN}`, token_number: seq, status: 'done' }).select('id').single(), 'queue')
  const c = await must(admin.from('consultations').insert({ queue_entry_id: q.id, nurse_id: nurse.id, service_id: svc, started_at: new Date(Date.now() - 3600_000).toISOString(), ended_at: new Date(Date.now() - 3000_000).toISOString() }).select('id').single(), 'cons')
  if (withClinical) {
    await must(admin.from('consultation_notes').insert({ consultation_id: c.id, nurse_id: nurse.id, diagnosis: `SECRET-DX-${name}`, treatment: 'SECRET-TX' }), 'note')
    await must(admin.from('patient_vitals').insert({ consultation_id: c.id, patient_id: p.id, nurse_id: nurse.id, pulse: 77 }), 'vitals')
  }
  return { patient: p.id, queue: q.id, consultation: c.id }
}
const X = await patientWithVisit(`Probe X ${RUN}`, CLINIC_A, svcA, nurseA1, true)
const Y = await patientWithVisit(`Probe Y ${RUN}`, CLINIC_B, svcB, nurseB1, true)
// A second, clinical-free consultation by nurse A1 on a different patient (a target for forged inserts).
const Z = await patientWithVisit(`Probe Z ${RUN}`, CLINIC_A, svcA, nurseA1, false)
const W = await patientWithVisit(`Probe W ${RUN}`, CLINIC_B, svcB, nurseB1, false)
const V = await patientWithVisit(`Probe V ${RUN}`, CLINIC_A, svcA, nurseA1, false)
await admin.from('profiles').update({ clinic_id: CLINIC_B }).eq('id', Y.patient)

const rows = []
const probe = (label, expectGap, outcome) => { rows.push({ label, outcome, expectGap }); console.log(`${outcome.padEnd(34)} ${label}`) }
const count = (r) => (r.error ? `ERROR ${r.error.code ?? ''}`.trim() : `${(r.data ?? []).length} row(s)`)

console.log('\n=== READS (what each role can see) ===')
probe('nurse A2 (not the author, no visit with X) reads X\'s consultation note', 'gap', count(await nurseA2.client.from('consultation_notes').select('id, diagnosis, treatment').eq('consultation_id', X.consultation)))
probe('nurse A2 reads ALL clinic notes at once (diagnosis column)', 'gap', count(await nurseA2.client.from('consultation_notes').select('id, diagnosis')))
probe('nurse A2 reads X\'s vitals by patient_id (across visits)', 'gap', count(await nurseA2.client.from('patient_vitals').select('id, pulse').eq('patient_id', X.patient)))
probe('RECEPTIONIST A reads clinical notes (diagnosis, treatment)', 'gap', count(await recA.client.from('consultation_notes').select('diagnosis, treatment')))
probe('RECEPTIONIST A reads vitals', 'gap', count(await recA.client.from('patient_vitals').select('pulse')))
probe('ADMIN A reads clinical notes', 'gap', count(await adminA.client.from('consultation_notes').select('diagnosis')))
probe('nurse A2 lists other nurses\' consultations (visit history)', 'ok', count(await nurseA2.client.from('consultations').select('id').eq('queue_entry_id', X.queue)))
probe('nurse of clinic B reads clinic A notes', 'ok', count(await nurseB1.client.from('consultation_notes').select('id').eq('consultation_id', X.consultation)))
probe('patient reads any note', 'ok', count(await patientSelf.client.from('consultation_notes').select('id')))
probe('patient reads any vitals', 'ok', count(await patientSelf.client.from('patient_vitals').select('id')))
probe('anon reads notes', 'ok', count(await anon.from('consultation_notes').select('id')))
probe('anon reads vitals', 'ok', count(await anon.from('patient_vitals').select('id')))
const idr = await nurseA2.client.from('profiles').select('full_name, id_number, date_of_birth, phone').eq('id', X.patient)
probe('nurse A2 reads X\'s ID number / DOB / phone (no care link)', 'gap', idr.error ? `ERROR ${idr.error.code}` : `${(idr.data ?? []).length} row(s), id_number=${idr.data?.[0]?.id_number ?? 'null'}`)
const adm = await adminA.client.from('profiles').select('id, id_number').eq('id', Y.patient)
probe('ADMIN of clinic A reads a clinic B patient\'s profile (ID number)', 'gap', adm.error ? `ERROR ${adm.error.code}` : `${(adm.data ?? []).length} row(s), id_number=${adm.data?.[0]?.id_number ?? 'null'}`)

console.log('\n=== WRITES (can a nurse forge clinical history?) ===')
// Z.consultation belongs to nurse A1 and patient Z; it has no note/vitals yet.
const forgedNote = await nurseA2.client.from('consultation_notes').insert({ consultation_id: Z.consultation, nurse_id: nurseA2.id, diagnosis: 'FORGED by another nurse' }).select('id')
probe('nurse A2 inserts a note on nurse A1\'s consultation (not theirs)', 'gap', forgedNote.error ? `ERROR ${forgedNote.error.code}` : `${forgedNote.data.length} row inserted`)
const forgedX = await nurseA1.client.from('consultation_notes').insert({ consultation_id: W.consultation, nurse_id: nurseA1.id, diagnosis: 'FORGED into another clinic' })
probe('nurse A1 (clinic A) inserts a note on a CLINIC B consultation', 'gap', forgedX.error ? `ERROR ${forgedX.error.code}` : 'row inserted')
const forgedV = await nurseA1.client.from('patient_vitals').insert({ consultation_id: Z.consultation, patient_id: X.patient, nurse_id: nurseA1.id, pulse: 200 })
probe('nurse A1 inserts vitals for patient X on patient Z\'s consultation', 'gap', forgedV.error ? `ERROR ${forgedV.error.code}` : 'row inserted (patient_id != consultation\'s patient)')
const notes = await must(admin.from('consultation_notes').select('id').eq('consultation_id', X.consultation), 'n')
const moved = await nurseA1.client.from('consultation_notes').update({ consultation_id: V.consultation }).eq('id', notes[0].id).select('id')
probe('nurse A1 re-points their own note to a different consultation', 'gap', moved.error ? `ERROR ${moved.error.code}` : `${moved.data.length} row updated`)
const del = await nurseA1.client.from('consultation_notes').delete().eq('id', notes[0].id).select('id')
probe('nurse A1 deletes a note (no DELETE policy)', 'ok', del.error ? `ERROR ${del.error.code}` : `${del.data.length} row(s) deleted`)

console.log('\n=== POSITIVE CONTROLS (the legitimate flow must still work) ===')
const vc = await patientWithVisit(`Probe OK ${RUN}`, CLINIC_A, svcA, nurseA1, false)
const okN = await nurseA1.client.from('consultation_notes').insert({ consultation_id: vc.consultation, nurse_id: nurseA1.id, diagnosis: 'own note' }).select('id')
probe('author nurse inserts a note on their own consultation', 'ok', okN.error ? `ERROR ${okN.error.code}` : `${okN.data.length} row inserted`)
const okV = await nurseA1.client.from('patient_vitals').insert({ consultation_id: vc.consultation, patient_id: vc.patient, nurse_id: nurseA1.id, pulse: 70 }).select('id')
probe('author nurse inserts vitals for the consultation\'s patient', 'ok', okV.error ? `ERROR ${okV.error.code}` : `${okV.data.length} row inserted`)
const okU = await nurseA1.client.from('consultation_notes').update({ treatment: 'edited' }).eq('id', okN.data?.[0]?.id).select('id')
probe('author nurse edits their own note', 'ok', okU.error ? `ERROR ${okU.error.code}` : `${okU.data.length} row updated`)
probe('author nurse reads it back', 'ok', count(await nurseA1.client.from('consultation_notes').select('id').eq('consultation_id', vc.consultation)))
console.log(`\nSummary: ${rows.filter((r) => r.expectGap === 'gap').length} gap probes, ${rows.filter((r) => r.expectGap === "ok").length} control probes (read the outcomes above).`)
