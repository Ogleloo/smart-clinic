/**
 * next_patient() lock-mode check against a LOCAL Supabase stack (`supabase start`) with the REAL RPCs:
 * next_patient, undo_next_patient, skip_patient, set_emergency_priority, check_in_patient, create_walkin_patient,
 * set_duty — over PostgREST with real GoTrue JWTs, plus `psql` sessions that run the same RPCs under the same JWT
 * claims inside a transaction held open, to make the race windows deterministic.
 *
 *   VARIANT=original  installs supabase/tests/next_patient_lock/rollback_original_next_patient.sql (= production)
 *   VARIANT=fixed     installs supabase/migrations/20261011010000_next_patient_no_key_update.sql
 *
 * Checks tagged DEFECT encode the bug: on `original` they are expected to FAIL (negative control), on `fixed`
 * they must PASS. Every other check is an invariant that must pass on both. Exit 0 means: fixed → everything
 * passed; original → every invariant passed AND every DEFECT check failed.
 *
 * Refuses to run unless SB_URL is localhost. Never point it at the shared project.
 * Env: SB_URL SB_ANON SB_SERVICE SB_DB_CONTAINER VARIANT REPO (repo root holding the two SQL files)
 */
import { createRequire } from 'node:module'
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const require = createRequire(`${process.cwd()}/`)
const { createClient } = require('@supabase/supabase-js')

const { SB_URL, SB_ANON, SB_SERVICE, SB_DB_CONTAINER: DB, VARIANT, REPO } = process.env
if (!SB_URL || !SB_ANON || !SB_SERVICE || !DB || !REPO || !['original', 'fixed'].includes(VARIANT)) {
  console.error('SETUP ERROR: missing env (VARIANT must be original|fixed)'); process.exit(2)
}
const host = new URL(SB_URL).hostname
if (host !== '127.0.0.1' && host !== 'localhost') { console.error(`SETUP ERROR: refusing non-local URL ${SB_URL}`); process.exit(2) }

const results = []
const check = (cond, msg, kind = 'invariant') => {
  results.push({ ok: !!cond, msg, kind })
  console.log(`${cond ? 'PASS' : 'FAIL'}${kind === 'defect' ? ' (DEFECT)' : ''} [${msg}]`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const psql = (sql) => execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: sql }).toString().trim()
async function must(p, what) {
  const { data, error } = await p
  if (error) { console.error(`SETUP ERROR: ${what}: ${error.message}`); process.exit(2) }
  return data
}

// ------------------------------------------------------------------ install the variant
const sqlFile = VARIANT === 'fixed'
  ? path.join(REPO, 'supabase/migrations/20261011010000_next_patient_no_key_update.sql')
  : path.join(REPO, 'supabase/tests/next_patient_lock/rollback_original_next_patient.sql')
execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: readFileSync(sqlFile) })
const installed = psql(`select position('for no key update skip locked' in pg_get_functiondef('public.next_patient(uuid,text)'::regprocedure)) > 0`)
if ((installed === 't') !== (VARIANT === 'fixed')) { console.error('SETUP ERROR: wrong next_patient installed'); process.exit(2) }
console.log(`# variant: ${VARIANT} (next_patient claims with ${VARIANT === 'fixed' ? 'FOR NO KEY UPDATE' : 'FOR UPDATE'} SKIP LOCKED)`)

// ------------------------------------------------------------------ actors (real GoTrue users)
const CLINIC = '11111111-1111-1111-1111-111111111111'
const RUN = Date.now().toString(36)
const PW = 'local-only-password-1'
const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
async function makeUser(tag, role) {
  const email = `${tag}.${RUN}@local.test`
  const u = await must(admin.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { full_name: `NP ${tag}` } }), `create ${tag}`)
  await must(admin.from('profiles').update({ role, clinic_id: CLINIC }).eq('auth_user_id', u.user.id), `profile ${tag}`)
  const prof = await must(admin.from('profiles').select('id').eq('auth_user_id', u.user.id).single(), `read ${tag}`)
  const client = createClient(SB_URL, SB_ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  await must(client.auth.signInWithPassword({ email, password: PW }), `sign in ${tag}`)
  return { tag, client, uid: u.user.id, profileId: prof.id }
}
const N1 = await makeUser('n1', 'nurse')
const N2 = await makeUser('n2', 'nurse')
const N3 = await makeUser('n3', 'nurse')
const REC = await makeUser('rec', 'receptionist')
const nurses = [N1, N2, N3]

let svcN = 0
/** A fresh service per scenario, so each starts with an empty queue; every nurse goes on duty for it via set_duty. */
async function freshService() {
  svcN += 1
  const id = crypto.randomUUID()
  // token_prefix must match ^[A-Z]{2,4}$ and be unique per clinic: a random 4-letter prefix.
  const prefix = Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')
  await must(admin.from('services').insert({ id, clinic_id: CLINIC, name: `NP ${RUN} ${svcN}`, token_prefix: prefix }), 'service')
  // Close anything left open by an earlier scenario so no long-consultation prompt interferes.
  psql(`update public.consultations set ended_at = greatest(now(), started_at + interval '1 second') where ended_at is null and nurse_id in ('${nurses.map((n) => n.profileId).join("','")}');`)
  for (const n of nurses) await must(n.client.rpc('set_duty', { p_on_duty: true, p_service_id: id }), `duty ${n.tag}`)
  return id
}
/** Real check-in: create a walk-in patient, then check_in_patient — every queue_entries trigger fires. */
async function checkIn(svc, name) {
  const p = await must(REC.client.rpc('create_walkin_patient', { p_full_name: `${name} ${RUN}` }), 'walk-in')
  const pid = typeof p === 'string' ? p : (p.id ?? p.patient_id ?? p)
  const e = await must(REC.client.rpc('check_in_patient', { p_service_id: svc, p_patient_id: pid }), 'check-in')
  return { id: e.id ?? e.queue_entry_id, token: e.token, name }
}
const call = (n) => n.client.rpc('next_patient', { p_action_id: crypto.randomUUID() })
const statusOf = (id) => psql(`select status from public.queue_entries where id = '${id}'`)
const openCons = (id) => Number(psql(`select count(*) from public.consultations where queue_entry_id = '${id}' and ended_at is null`))

/** Run SQL as `who` (JWT claims) inside a transaction held open for `holdS` seconds; resolves with psql output. */
function held(who, body, holdS = 6) {
  const sql = `begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${who.uid}', true) \\g /dev/null
select set_config('request.jwt.claims', '{"sub":"${who.uid}","role":"authenticated"}', true) \\g /dev/null
${body}
select pg_sleep(${holdS}) \\g /dev/null
commit;
`
  const p = spawn('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'])
  let out = ''
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d))
  p.stdin.end(sql)
  return new Promise((resolve) => p.on('close', (code) => resolve({ code, out })))
}

// ------------------------------------------------------------------ S1: two nurses call at the same moment
{
  const svc = await freshService()
  const [p1, p2, p3] = [await checkIn(svc, 'S1 first'), await checkIn(svc, 'S1 second'), await checkIn(svc, 'S1 third')]
  const h = held(N1, `select public.next_patient(gen_random_uuid())->>'queue_entry_id';`)
  await sleep(1500)
  const t0 = Date.now(); const r = await call(N2); const ms = Date.now() - t0
  const hr = await h
  check(hr.code === 0 && hr.out.includes(p1.id), 'S1 nurse 1 (held) called the first patient')
  check(!r.error && r.data?.status === 'called', `S1 nurse 2 got a patient: ${r.error?.message ?? r.data?.status}`)
  check(r.data?.queue_entry_id === p2.id, `S1 nurse 2 called the SECOND patient (got ${r.data?.token}; second=${p2.token}, third=${p3.token})`, 'defect')
  check(ms < 3000, `S1 nurse 2 did not wait (${ms}ms)`)
  check(r.data?.queue_entry_id !== p1.id, 'S1 never a duplicate claim of the first patient')
}

// ------------------------------------------------------------------ S2: queue_empty must not be reported while a patient waits
{
  const svc = await freshService()
  const [p1, p2] = [await checkIn(svc, 'S2 first'), await checkIn(svc, 'S2 second')]
  const h = held(N1, `select public.next_patient(gen_random_uuid())->>'queue_entry_id';`)
  await sleep(1500)
  const r = await call(N2)
  const hr = await h
  check(hr.code === 0 && hr.out.includes(p1.id), 'S2 nurse 1 (held) called the first patient')
  check(r.data?.status === 'called' && r.data?.queue_entry_id === p2.id, `S2 nurse 2 called the waiting second patient, not queue_empty (got ${r.data?.status} ${r.data?.token ?? ''})`, 'defect')
}

// ------------------------------------------------------------------ S3: reception skips the head while a nurse calls (K2 analogue with the existing skip_patient)
{
  const svc = await freshService()
  const [p1, p2, p3] = [await checkIn(svc, 'S3 first'), await checkIn(svc, 'S3 second'), await checkIn(svc, 'S3 third')]
  const h = held(REC, `select status from public.skip_patient('${p1.id}');`)
  await sleep(1500)
  const r = await call(N2)
  const hr = await h
  check(hr.code === 0 && hr.out.includes('skipped'), 'S3 reception (held) skipped the first patient')
  check(r.data?.queue_entry_id === p2.id, `S3 nurse called the SECOND patient while the skip was in flight (got ${r.data?.token}; third=${p3.token})`, 'defect')
  check(statusOf(p1.id) === 'skipped' && openCons(p1.id) === 0, 'S3 skipped patient has no consultation')
}

// ------------------------------------------------------------------ S4: emergency marked while a nurse calls
{
  const svc = await freshService()
  const [p1, p2, p3] = [await checkIn(svc, 'S4 first'), await checkIn(svc, 'S4 second'), await checkIn(svc, 'S4 third')]
  // Marking p3 as emergency inserts "emergency_ahead" for the patient now behind it (p1): KEY SHARE on p1.
  const h = held(N1, `select public.set_emergency_priority('${p3.id}', true) is not null;`)
  await sleep(1500)
  const r = await call(N2)
  const hr = await h
  check(hr.code === 0, 'S4 nurse 1 (held) marked the third patient as emergency')
  // The emergency is not committed yet when nurse 2 calls, so the committed order still has p1 first.
  check(r.data?.queue_entry_id === p1.id, `S4 nurse 2 called the committed head (first patient), not someone behind them (got ${r.data?.status} ${r.data?.token ?? ''})`, 'defect')
  // After the emergency commits, it goes first.
  const r2 = await call(N3)
  check(r2.data?.queue_entry_id === p3.id, `S4 once committed, the emergency patient is called next (got ${r2.data?.token})`)
}

// ------------------------------------------------------------------ S4b: emergency ordering without concurrency
{
  const svc = await freshService()
  const [p1, p2, p3] = [await checkIn(svc, 'S4b first'), await checkIn(svc, 'S4b second'), await checkIn(svc, 'S4b third')]
  await must(N1.client.rpc('set_emergency_priority', { p_queue_entry_id: p3.id, p_emergency: true }), 'emergency')
  const order = []
  for (const n of [N1, N2, N3]) order.push((await call(n)).data?.queue_entry_id)
  check(JSON.stringify(order) === JSON.stringify([p3.id, p1.id, p2.id]), 'S4b emergency first, then check-in order')
}

// ------------------------------------------------------------------ S5: check-in at the same moment as a call
{
  const svc = await freshService()
  const [p1, p2] = [await checkIn(svc, 'S5 first'), await checkIn(svc, 'S5 second')]
  const walk = await must(REC.client.rpc('create_walkin_patient', { p_full_name: `S5 late ${RUN}` }), 'walk-in')
  const pid = typeof walk === 'string' ? walk : (walk.id ?? walk.patient_id ?? walk)
  const h = held(REC, `select (public.check_in_patient('${svc}', '${pid}')).id;`)
  await sleep(1500)
  const r = await call(N2)
  const hr = await h
  check(hr.code === 0, 'S5 reception (held) checked a patient in')
  check(r.data?.queue_entry_id === p1.id, `S5 a concurrent check-in does not displace the head (got ${r.data?.token})`)
  const r2 = await call(N3)
  check(r2.data?.queue_entry_id === p2.id, 'S5 then the second patient')
}

// ------------------------------------------------------------------ S6: Undo still works, also while another nurse calls
{
  const svc = await freshService()
  const [p1, p2, p3] = [await checkIn(svc, 'S6 first'), await checkIn(svc, 'S6 second'), await checkIn(svc, 'S6 third')]
  const actionId = crypto.randomUUID()
  const c1 = await N1.client.rpc('next_patient', { p_action_id: actionId })
  check(c1.data?.queue_entry_id === p1.id, 'S6 nurse 1 called the first patient')
  // Undo held open while nurse 2 calls.
  const h = held(N1, `select public.undo_next_patient('${actionId}')->>'status';`)
  await sleep(1500)
  const r = await call(N2)
  const hr = await h
  check(hr.code === 0 && hr.out.includes('undone'), 'S6 undo (held) succeeded with the original action id')
  check(r.data?.queue_entry_id === p2.id, `S6 during the undo, nurse 2 called the second patient (got ${r.data?.token})`)
  check(statusOf(p1.id) === 'waiting' && openCons(p1.id) === 0, 'S6 after undo the first patient is waiting again with no consultation')
  const r3 = await call(N3)
  check(r3.data?.queue_entry_id === p1.id, `S6 the restored patient is called next (got ${r3.data?.token})`)
  // Replay: the same action id returns the recorded result, not a second call.
  const replay = await N1.client.rpc('next_patient', { p_action_id: actionId })
  check(replay.data?.replayed === true && replay.data?.queue_entry_id === p1.id, 'S6 the original action id still replays (idempotency kept)')
  void p3
}

// ------------------------------------------------------------------ S7: three nurses, many rounds, no duplicates and strict order
{
  const svc = await freshService()
  const patients = []
  for (let i = 0; i < 12; i++) patients.push(await checkIn(svc, `S7 p${String(i).padStart(2, '0')}`))
  const called = []
  let errors = 0
  for (let round = 0; round < 4; round++) {
    const rs = await Promise.all(nurses.map((n) => call(n)))
    for (const r of rs) { if (r.error) errors++; else if (r.data?.status === 'called') called.push(r.data.queue_entry_id) }
  }
  const ids = patients.map((p) => p.id)
  check(errors === 0, `S7 no errors over 12 concurrent calls (${errors})`)
  check(new Set(called).size === called.length && called.length === 12, `S7 12 calls, 12 distinct patients (got ${called.length}, distinct ${new Set(called).size})`)
  // Strict order: after each round of 3, the called set is exactly the first 3k patients.
  const inOrder = [0, 1, 2, 3].every((k) => new Set(called.slice(0, 3 * (k + 1))).size === 3 * (k + 1) && called.slice(0, 3 * (k + 1)).every((id) => ids.indexOf(id) < 3 * (k + 1)))
  check(inOrder, 'S7 each concurrent round called exactly the next patients in order (no one passed over)', VARIANT === 'fixed' ? 'invariant' : 'observe')
}

// ------------------------------------------------------------------ S8: mixed load — no deadlocks, no inconsistent state
{
  const svc = await freshService()
  const pts = []
  for (let i = 0; i < 18; i++) pts.push(await checkIn(svc, `S8 p${i}`))
  const errs = []
  const actions = new Map()
  for (let round = 0; round < 5; round++) {
    const ops = nurses.map((n) => {
      const id = crypto.randomUUID(); actions.set(n.tag, id)
      return n.client.rpc('next_patient', { p_action_id: id })
    })
    const waitingNow = psql(`select id from public.queue_entries where service_id = '${svc}' and status = 'waiting' order by checked_in_at desc limit 2`).split('\n').filter(Boolean)
    if (waitingNow[0]) ops.push(REC.client.rpc('skip_patient', { p_queue_entry_id: waitingNow[0] }))
    if (waitingNow[1]) ops.push(N1.client.rpc('set_emergency_priority', { p_queue_entry_id: waitingNow[1], p_emergency: true }))
    ops.push((async () => {
      const w = await REC.client.rpc('create_walkin_patient', { p_full_name: `S8 late ${round} ${RUN}` })
      const pid = typeof w.data === 'string' ? w.data : (w.data?.id ?? w.data?.patient_id)
      return REC.client.rpc('check_in_patient', { p_service_id: svc, p_patient_id: pid })
    })())
    const rs = await Promise.all(ops)
    rs.forEach((r) => { if (r.error) errs.push(`${r.error.code} ${r.error.message}`) })
    if (round % 2 === 1) {
      const u = await N2.client.rpc('undo_next_patient', { p_action_id: actions.get('n2') })
      if (u.error && !/no longer|later action|not found|already/i.test(u.error.message)) errs.push(`undo ${u.error.message}`)
    }
  }
  const deadlocks = errs.filter((e) => e.startsWith('40P01') || /deadlock/i.test(e))
  check(deadlocks.length === 0, `S8 no deadlocks under mixed load (${deadlocks.length})`)
  check(errs.length === 0, `S8 no unexpected errors (${errs.slice(0, 3).join(' | ') || 'none'})`)
  const bad = psql(`
    select
      (select count(*) from public.queue_entries q where q.service_id = '${svc}' and q.status = 'in_progress'
         and (select count(*) from public.consultations c where c.queue_entry_id = q.id and c.ended_at is null) <> 1) || ',' ||
      (select count(*) from public.queue_entries q where q.service_id = '${svc}' and q.status <> 'in_progress'
         and exists (select 1 from public.consultations c where c.queue_entry_id = q.id and c.ended_at is null)) || ',' ||
      (select count(*) from (select nurse_id from public.consultations where ended_at is null group by nurse_id having count(*) > 1) x)`)
  check(bad === '0,0,0', `S8 consistent: every in-progress entry has exactly one open consultation, no other entry has one, no nurse has two (${bad})`)
}

// ------------------------------------------------------------------ summary
const inv = results.filter((r) => r.kind === 'invariant')
const def = results.filter((r) => r.kind === 'defect')
const invOk = inv.every((r) => r.ok)
const defPassed = def.filter((r) => r.ok).length
console.log(`\n# ${VARIANT}: invariants ${inv.filter((r) => r.ok).length}/${inv.length} passed; DEFECT checks ${defPassed}/${def.length} passed${results.some((r) => r.kind === 'observe') ? `; observed: ${results.filter((r) => r.kind === 'observe').map((r) => (r.ok ? 'in order' : 'OUT OF ORDER')).join(',')}` : ''}`)
const ok = VARIANT === 'fixed' ? invOk && defPassed === def.length : invOk && defPassed === 0
console.log(ok ? `RESULT: PASS (${VARIANT === 'fixed' ? 'correction verified' : 'defect reproduced by every DEFECT check'})` : 'RESULT: FAIL')
process.exit(ok ? 0 : 1)
