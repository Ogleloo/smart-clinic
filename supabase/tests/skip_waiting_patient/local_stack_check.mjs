/**
 * End-to-end check of skip_waiting_patient() against a LOCAL Supabase stack (`supabase start`): real GoTrue
 * sign-ins and JWTs, real PostgREST RPC over HTTP, real RLS, and the real next_patient() from the replayed
 * migrations — not the simplified schema the disposable-Postgres harness uses.
 *
 * Refuses to run unless the API URL is localhost/127.0.0.1. Never point this at the shared project.
 *
 * Usage (from a directory whose node_modules has @supabase/supabase-js, e.g. the repo root):
 *   SB_URL=http://127.0.0.1:54321 SB_ANON=<local anon key> SB_SERVICE=<local service_role key> \
 *   SB_DB_CONTAINER=supabase_db_<project> MIGRATION=<path to the migration file> \
 *   node supabase/tests/skip_waiting_patient/local_stack_check.mjs
 * Exit 0 = all PASS, 1 = a check failed, 2 = setup error.
 */
import { createRequire } from 'node:module'
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const require = createRequire(`${process.cwd()}/`)
const { createClient } = require('@supabase/supabase-js')

const URL_ = process.env.SB_URL
const ANON = process.env.SB_ANON
const SERVICE = process.env.SB_SERVICE
const DB = process.env.SB_DB_CONTAINER
const MIGRATION = process.env.MIGRATION
if (!URL_ || !ANON || !SERVICE || !DB || !MIGRATION) { console.error('SETUP ERROR: missing env'); process.exit(2) }
const host = new URL(URL_).hostname
if (host !== '127.0.0.1' && host !== 'localhost') { console.error(`SETUP ERROR: refusing non-local URL ${URL_}`); process.exit(2) }

let failures = 0
const pass = (m) => console.log(`PASS [${m}]`)
const fail = (m) => { console.log(`FAIL [${m}]`); failures++ }
const check = (cond, m) => (cond ? pass(m) : fail(m))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const psql = (sql) => execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: sql }).toString().trim()

const CLINIC_A = '11111111-1111-1111-1111-111111111111'
const SVC_A = '22222222-2222-2222-2222-222222222221'
const CLINIC_B = '0b000000-0000-4000-8000-0000000000bb'
const SVC_B = '5b000000-0000-4000-8000-0000000000bb'
const RUN = Date.now().toString(36)
const PW = 'local-only-password-1'

async function must(p, what) {
  const { data, error } = await p
  if (error) { console.error(`SETUP ERROR: ${what}: ${error.message}`); process.exit(2) }
  return data
}

async function makeUser(tag, role, clinicId, extra = {}) {
  const email = `${tag}.${RUN}@local.test`
  const created = await must(admin.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { full_name: `Local ${tag}` } }), `create ${tag}`)
  const uid = created.user.id
  await must(admin.from('profiles').update({ role, clinic_id: clinicId, ...extra }).eq('auth_user_id', uid), `profile ${tag}`)
  const prof = await must(admin.from('profiles').select('id').eq('auth_user_id', uid).single(), `read ${tag}`)
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  await must(c.auth.signInWithPassword({ email, password: PW }), `sign in ${tag}`)
  return { client: c, uid, profileId: prof.id }
}

let tokenN = (Math.floor(Date.now() / 1000) % 100000) * 10 + 100 // unique per run: tokens are unique per service per day
async function entry(clinicId, serviceId, status = 'waiting', checkedIn = new Date()) {
  const patient = await must(admin.from('profiles').insert({ full_name: `Local patient ${tokenN}`, role: 'patient' }).select('id').single(), 'patient')
  tokenN += 1
  const row = await must(
    admin.from('queue_entries').insert({ clinic_id: clinicId, service_id: serviceId, patient_id: patient.id, token: `LT-${tokenN}`, token_number: tokenN, status, checked_in_at: checkedIn.toISOString() }).select('id').single(),
    'queue entry'
  )
  return row.id
}
const statusOf = async (id) => (await must(admin.from('queue_entries').select('status').eq('id', id).single(), 'status')).status
const openConsultations = async (id) => (await must(admin.from('consultations').select('id').eq('queue_entry_id', id).is('ended_at', null), 'cons')).length

// ------------------------------------------------------------------ setup
await must(admin.from('clinics').upsert({ id: CLINIC_B, name: 'Local Clinic B' }), 'clinic B')
await must(admin.from('services').upsert({ id: SVC_B, clinic_id: CLINIC_B, name: 'Service B', token_prefix: 'SB' }), 'service B')
// Clean slate for this service's waiting queue so next_patient picks what this script expects.
psql(`update public.queue_entries set status = 'done' where service_id = '${SVC_A}' and status in ('waiting','in_progress');
      update public.consultations set ended_at = greatest(now(), started_at + interval '1 second') where ended_at is null;`)

const nurseA = await makeUser('nurse-a', 'nurse', CLINIC_A)
const nurseA2 = await makeUser('nurse-a2', 'nurse', CLINIC_A, { is_on_duty: true, current_service_id: SVC_A })
const recA = await makeUser('rec-a', 'receptionist', CLINIC_A)
const adminA = await makeUser('admin-a', 'admin', CLINIC_A)
const nurseB = await makeUser('nurse-b', 'nurse', CLINIC_B)
const recInactive = await makeUser('rec-inactive', 'receptionist', CLINIC_A, { is_active: false })
const patientU = await makeUser('patient', 'patient', CLINIC_A)
const anonClient = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const rpc = (who, id) => who.client.rpc('skip_waiting_patient', { p_queue_entry_id: id })

// ------------------------------------------------------------------ authorization over real JWT + PostgREST
{
  const w = await entry(CLINIC_A, SVC_A)
  const { error } = await anonClient.rpc('skip_waiting_patient', { p_queue_entry_id: w })
  check(error && (error.code === '42501' || /permission denied/i.test(error.message)), `anon (no session) is refused by PostgREST/grants: ${error?.code} ${error?.message}`)
  for (const [name, who, expect] of [
    ['patient', patientU, 'Not authorised'],
    ['inactive receptionist', recInactive, 'Not authorised'],
    ['nurse of another clinic', nurseB, 'Queue entry not found'],
  ]) {
    const r = await rpc(who, w)
    check(r.error && r.error.message.includes(expect), `${name} refused: ${r.error?.message}`)
  }
  check((await statusOf(w)) === 'waiting', 'refused calls left the entry waiting')
}
{
  const inProg = await entry(CLINIC_A, SVC_A, 'in_progress')
  await must(admin.from('consultations').insert({ queue_entry_id: inProg, nurse_id: nurseA2.profileId, service_id: SVC_A }), 'consultation')
  const r = await rpc(nurseA, inProg)
  check(r.error?.message.includes('already in consultation'), `nurse: in_progress refused: ${r.error?.message}`)
  check((await statusOf(inProg)) === 'in_progress' && (await openConsultations(inProg)) === 1, 'in_progress entry and its consultation untouched')
  // The existing function is unchanged: reception still cannot skip an in-progress patient with skip_patient().
  const old = await recA.client.rpc('skip_patient', { p_queue_entry_id: inProg })
  check(old.error?.message.includes('already in consultation'), `skip_patient() unchanged for reception: ${old.error?.message}`)
  await must(admin.from('consultations').update({ ended_at: new Date(Date.now() + 1000).toISOString() }).eq('queue_entry_id', inProg), 'close')
  await must(admin.from('queue_entries').update({ status: 'done' }).eq('id', inProg), 'done')
}
for (const [name, who] of [['nurse', nurseA], ['receptionist', recA], ['admin', adminA]]) {
  const w = await entry(CLINIC_A, SVC_A)
  const r = await rpc(who, w)
  check(!r.error && r.data?.status === 'skipped', `${name} skips a waiting patient: ${r.error?.message ?? r.data?.status}`)
  // Read back through the caller's own RLS (queue_select_staff), not the service role.
  const seen = await who.client.from('queue_entries').select('status').eq('id', w).maybeSingle()
  check(seen.data?.status === 'skipped', `${name} sees the skipped status through RLS`)
  const again = await rpc(who, w)
  check(again.error?.message.includes('no longer waiting'), `${name}: a second skip is refused`)
}

// ------------------------------------------------------------------ concurrency against the REAL next_patient()
function heldPsql(sql) {
  const p = spawn('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'])
  let out = ''
  p.stdout.on('data', (d) => (out += d))
  p.stderr.on('data', (d) => (out += d))
  p.stdin.end(sql)
  return new Promise((resolve) => p.on('close', (code) => resolve({ code, out })))
}
const asNurseA2 = `set local role authenticated;
select set_config('request.jwt.claim.sub', '${nurseA2.uid}', true) \\g /dev/null
select set_config('request.jwt.claims', '{"sub":"${nurseA2.uid}","role":"authenticated"}', true) \\g /dev/null`
const HOLD = 6

{
  // K1: the real next_patient() (nurse A2, in a held transaction) claims the head of the queue; nurse A's skip
  // over HTTP arrives meanwhile. It must wait, then refuse; the consultation stays open.
  psql(`update public.queue_entries set status = 'done' where service_id = '${SVC_A}' and status = 'waiting';`)
  const head = await entry(CLINIC_A, SVC_A, 'waiting', new Date(Date.now() - 60_000))
  const second = await entry(CLINIC_A, SVC_A)
  const held = heldPsql(`begin;\n${asNurseA2}\nselect public.next_patient(gen_random_uuid())->>'queue_entry_id';\nselect pg_sleep(${HOLD}) \\g /dev/null\ncommit;\n`)
  await sleep(1000)
  const t0 = Date.now()
  const r = await rpc(nurseA, head)
  const ms = Date.now() - t0
  const h = await held
  check(h.code === 0 && h.out.includes(head), `K1 real next_patient claimed the head entry (${h.out.trim().split('\n').pop()})`)
  check(r.error?.message.includes('already in consultation'), `K1 HTTP skip during next_patient refused: ${r.error?.message}`)
  check(ms >= 3500, `K1 the skip waited ${ms}ms on the row lock`)
  check((await statusOf(head)) === 'in_progress' && (await openConsultations(head)) === 1, 'K1 final: head in_progress, consultation open')
  check((await statusOf(second)) === 'waiting', 'K1 the next patient is untouched')
  psql(`update public.consultations set ended_at = greatest(now(), started_at + interval '1 second') where ended_at is null;
        update public.queue_entries set status = 'done' where service_id = '${SVC_A}' and status in ('waiting','in_progress');`)
}
{
  // K2: nurse A's skip runs first inside a held transaction (via psql, same function, same JWT claims); the real
  // next_patient() over HTTP passes over the locked row at once and calls someone else.
  //
  // Pre-existing behaviour observed here (not caused by this function): the skip's UPDATE fires
  // notify_you_are_next(), which inserts a notification for the patient who becomes next; that FK check holds
  // FOR KEY SHARE on their entry until commit, and next_patient()'s FOR UPDATE SKIP LOCKED skips it too. So
  // with three patients waiting, next_patient calls the THIRD. Three are created so a patient remains callable.
  const head = await entry(CLINIC_A, SVC_A, 'waiting', new Date(Date.now() - 60_000))
  const second = await entry(CLINIC_A, SVC_A, 'waiting', new Date(Date.now() - 30_000))
  const third = await entry(CLINIC_A, SVC_A)
  const asNurseA = asNurseA2.replaceAll(nurseA2.uid, nurseA.uid)
  const held = heldPsql(`begin;\n${asNurseA}\nselect status from public.skip_waiting_patient('${head}');\nselect pg_sleep(${HOLD}) \\g /dev/null\ncommit;\n`)
  await sleep(1000)
  const t0 = Date.now()
  const r = await nurseA2.client.rpc('next_patient', { p_action_id: crypto.randomUUID() })
  const ms = Date.now() - t0
  const h = await held
  check(h.code === 0 && h.out.includes('skipped'), 'K2 skip (held) succeeded')
  check(!r.error && r.data?.status === 'called' && r.data?.queue_entry_id !== head, `K2 real next_patient over HTTP did not call the patient being skipped: ${r.error?.message ?? r.data?.status}`)
  const calledWho = r.data?.queue_entry_id === second ? 'second' : r.data?.queue_entry_id === third ? 'third' : 'unexpected'
  check(calledWho !== 'unexpected', `K2 next_patient called the ${calledWho} patient${calledWho === 'third' ? ' (the second was KEY SHARE-locked by the skip’s you_are_next notification — pre-existing, see readiness report)' : ''}`)
  check(ms < 2500, `K2 next_patient did not wait (${ms}ms)`)
  check((await statusOf(head)) === 'skipped' && (await openConsultations(head)) === 0, 'K2 final: head skipped, no consultation')
  psql(`update public.consultations set ended_at = greatest(now(), started_at + interval '1 second') where ended_at is null;
        update public.queue_entries set status = 'done' where service_id = '${SVC_A}' and status in ('waiting','in_progress');`)
}

// ------------------------------------------------------------------ rollback and PostgREST schema-cache reload
async function pollRpc(predicate, label) {
  const t0 = Date.now()
  let last
  while (Date.now() - t0 < 15_000) {
    last = await rpc(nurseA, '00000000-0000-4000-8000-000000000000')
    if (predicate(last)) return Date.now() - t0
    await sleep(250)
  }
  fail(`${label}: last response ${JSON.stringify(last.error ?? last.data)}`)
  return null
}
{
  psql(`drop function public.skip_waiting_patient(uuid); notify pgrst, 'reload schema';`)
  const gone = await pollRpc((r) => r.error?.code === 'PGRST202', 'rollback: RPC disappears from PostgREST')
  if (gone !== null) pass(`rollback (drop + notify): PostgREST reports PGRST202 after ${gone}ms`)
  check(psql(`select count(*) from pg_proc where proname = 'skip_waiting_patient'`) === '0', 'rollback leaves no function behind')

  execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: readFileSync(MIGRATION) })
  const back = await pollRpc((r) => r.error?.message?.includes('Queue entry not found'), 're-apply: RPC served again')
  if (back !== null) pass(`re-apply migration: PostgREST serves the RPC again after ${back}ms (schema reload)`)
  const { error } = await anonClient.rpc('skip_waiting_patient', { p_queue_entry_id: '00000000-0000-4000-8000-000000000000' })
  check(error && (error.code === '42501' || /permission denied/i.test(error.message)), 're-applied function is still not anon-callable')
}

console.log(failures === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
