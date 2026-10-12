// Mandatory-identification design invariants. LOCAL SUPABASE STACK ONLY.
//
//   PHASE=baseline  -> records today's behaviour: the optional, free-text profiles.id_number does not prevent
//                      duplicate registration and is editable by the patient.
//   PHASE=proposed  -> additionally tests docs/proposals/identity_documents_prototype.sql (a DESIGN PROTOTYPE, not the
//                      registration feature): SA ID checksum/date validation, passport + country, normalisation,
//                      uniqueness under concurrency, replacement, minimum exposure.
//
//   SB_URL=... SB_ANON=... SB_SERVICE=... PHASE=... PSQL_CMD="docker exec -i supabase_db_<project> psql -U postgres -At -v ON_ERROR_STOP=1" \
//   node supabase/tests/clinical_records_access/probe_identity.mjs
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'

const require = createRequire(`${process.cwd()}/`)
const { createClient } = require('@supabase/supabase-js')
const { SB_URL, SB_ANON, SB_SERVICE, PHASE, PSQL_CMD } = process.env
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(SB_URL ?? '')) throw new Error(`Refusing: SB_URL must be a local stack, got ${SB_URL}`)
if (!['baseline', 'proposed'].includes(PHASE)) throw new Error('PHASE must be baseline or proposed')
if (!PSQL_CMD || !/(supabase_db_[a-z0-9_-]+\s|@(127\.0\.0\.1|localhost)[:/])/.test(PSQL_CMD)) throw new Error('Refusing: PSQL_CMD must target a local supabase_db_* container or localhost')
const psql = (sql) => execSync(PSQL_CMD, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()

const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const svc = createClient(SB_URL, SB_SERVICE, opts)
const RUN = Date.now().toString(36)
const must = async (p, what) => { const r = await p; if (r.error) throw new Error(`setup ${what}: ${r.error.message}`); return r.data }

// A valid SA ID for a date and sequence, computed with the Luhn rule (independent of the SQL implementation).
function saId(yymmdd, seq, citizen = '0') {
  const body = `${yymmdd}${seq}${citizen}8`
  let total = 0
  for (let i = 0; i < 12; i++) {
    let v = Number(body[11 - i])
    if (i % 2 === 0) { v *= 2; if (v > 9) v -= 9 }
    total += v
  }
  return body + String((10 - (total % 10)) % 10)
}
const uniq = String(Date.now()).slice(-4)
const VALID1 = saId('900101', uniq)
const VALID2 = saId('050229', '0' + uniq.slice(1)) // 2005 is not a leap year -> invalid date
const VALID3 = saId('000229', uniq)                // 2000-02-29 is valid
const results = []
async function check(area, name, expect, run) {
  const want = expect[PHASE]
  if (want === 'skip') { results.push({ area, name, want, got: 'skip', ok: true, detail: 'not applicable in this phase' }); return }
  const { outcome, detail } = await run()
  results.push({ area, name, want, got: outcome, ok: outcome === want, detail })
}
const KEEP = { baseline: 'allowed', proposed: 'allowed' }
const NEW = { baseline: 'skip', proposed: 'allowed' }
const NEWDENY = { baseline: 'skip', proposed: 'denied' }
const bool = (sql) => async () => { const v = psql(`select ${sql};`); return { outcome: v === 't' ? 'allowed' : 'denied', detail: v } }
const ins = (patient, type, country, number) => svc.from('patient_identity_documents').insert({ patient_id: patient, document_type: type, issuing_country: country, number_normalized: number }).select('id')
const res = (r) => ({ outcome: !r.error && (r.data ?? []).length > 0 ? 'allowed' : 'denied', detail: r.error ? `${r.error.code} ${r.error.message}`.slice(0, 80) : 'inserted' })

// Today's behaviour (documented so the change is measurable; not a target state)
const pa = (await must(svc.from('profiles').insert({ full_name: `ID A ${RUN}`, role: 'patient', id_number: VALID1 }).select('id').single(), 'pa')).id
await check('today (to be replaced)', 'two profiles can hold the same id_number (no duplicate prevention)', KEEP, async () => {
  const r = await svc.from('profiles').insert({ full_name: `ID B ${RUN}`, role: 'patient', id_number: VALID1 }).select('id')
  return res(r)
})
await check('today (to be replaced)', 'id_number is optional at registration (walk-ins have none)', KEEP, async () => {
  const r = await svc.from('profiles').insert({ full_name: `ID C ${RUN}`, role: 'patient' }).select('id')
  return res(r)
})
await check('today (to be replaced)', 'a signed-in patient can change their own id_number (UPDATE column grant)', KEEP, async () => {
  const email = `id-self.${RUN}@probe.test`
  const u = (await must(svc.auth.admin.createUser({ email, password: 'probe-password-1', email_confirm: true }), 'u')).user
  const c = createClient(SB_URL, SB_ANON, opts)
  await must(c.auth.signInWithPassword({ email, password: 'probe-password-1' }), 'signin')
  const r = await c.from('profiles').update({ id_number: 'X1234567' }).eq('auth_user_id', u.id).select('id')
  return res(r)
})

// Prototype invariants
await check('validation', `valid SA ID ${VALID1} accepted`, NEW, bool(`private.is_valid_sa_id('${VALID1}')`))
await check('validation', 'valid SA ID on 2000-02-29 accepted', NEW, bool(`private.is_valid_sa_id('${VALID3}')`))
await check('validation', 'SA ID with a wrong check digit rejected', NEWDENY, bool(`private.is_valid_sa_id('${VALID1.slice(0, 12)}${(Number(VALID1[12]) + 1) % 10}')`))
await check('validation', 'SA ID on 2005-02-29 (not a date) rejected', NEWDENY, bool(`private.is_valid_sa_id('${VALID2}')`))
await check('validation', 'SA ID with citizenship digit 3 rejected', NEWDENY, bool(`private.is_valid_sa_id('${saId('900101', uniq, '3')}')`))
await check('validation', 'SA ID with 12 digits rejected', NEWDENY, bool(`private.is_valid_sa_id('${VALID1.slice(0, 12)}')`))
await check('validation', 'passport needs an issuing country', NEWDENY, bool(`coalesce(private.is_valid_passport('A1234567', null), false)`))
await check('validation', 'passport format is not assumed per country (5–20 letters/digits)', NEW, bool(`private.is_valid_passport('X12345', 'GBR') and private.is_valid_passport('123456789AB', 'NGA')`))
await check('normalisation', "'800101 5009-087' and '8001015009087' normalise identically", NEW, bool(`private.normalize_document_number(' 800101 5009-087 ') = '8001015009087'`))

const p1 = pa
const p2 = (await must(svc.from('profiles').insert({ full_name: `ID P2 ${RUN}`, role: 'patient' }).select('id').single(), 'p2')).id
const p3 = (await must(svc.from('profiles').insert({ full_name: `ID P3 ${RUN}`, role: 'patient' }).select('id').single(), 'p3')).id
await check('uniqueness', 'register an SA ID for patient 1', NEW, async () => res(await ins(p1, 'sa_id', 'ZAF', VALID1)))
await check('uniqueness', 'the same SA ID for patient 2 is refused (23505)', NEWDENY, async () => res(await ins(p2, 'sa_id', 'ZAF', VALID1)))
await check('uniqueness', 'an SA ID that fails the checksum cannot be stored', NEWDENY, async () => res(await ins(p2, 'sa_id', 'ZAF', VALID1.slice(0, 12) + ((Number(VALID1[12]) + 1) % 10))))
await check('uniqueness', 'an un-normalised number cannot be stored', NEWDENY, async () => res(await ins(p2, 'passport', 'GBR', 'ab 12345')))
await check('uniqueness', 'same passport number, different issuing country: allowed', NEW, async () => {
  const a = await ins(p2, 'passport', 'GBR', `P${uniq}99`)
  if (a.error) return res(a)
  return res(await ins(p3, 'passport', 'ZWE', `P${uniq}99`))
})
await check('uniqueness', 'same passport + country for another patient refused', NEWDENY, async () => res(await ins(p1, 'passport', 'GBR', `P${uniq}99`)))
await check('uniqueness', 'a person may hold an SA ID and a passport (one active per kind)', NEW, async () => res(await ins(p1, 'passport', 'MOZ', `M${uniq}11`)))
await check('uniqueness', 'a second active SA ID for the same patient refused', NEWDENY, async () => res(await ins(p1, 'sa_id', 'ZAF', VALID3)))
await check('concurrency', 'two simultaneous registrations of one document: exactly one succeeds', NEW, async () => {
  const doc = saId('850615', String(Number(uniq) % 9000 + 1000))
  const q1 = (await must(svc.from('profiles').insert({ full_name: `ID R1 ${RUN}`, role: 'patient' }).select('id').single(), 'r1')).id
  const q2 = (await must(svc.from('profiles').insert({ full_name: `ID R2 ${RUN}`, role: 'patient' }).select('id').single(), 'r2')).id
  const [a, b] = await Promise.all([ins(q1, 'sa_id', 'ZAF', doc), ins(q2, 'sa_id', 'ZAF', doc)])
  const okN = [a, b].filter((r) => !r.error).length
  const codes = [a, b].map((r) => r.error?.code ?? 'ok').join(',')
  return { outcome: okN === 1 && codes.includes('23505') ? 'allowed' : 'denied', detail: `successes=${okN} (${codes})` }
})
await check('replacement', 'a replaced document frees the number only through an explicit status change', NEW, async () => {
  const d = (await svc.from('patient_identity_documents').select('id').eq('patient_id', p1).eq('document_type', 'passport').eq('issuing_country', 'MOZ').single()).data
  const u = await svc.from('patient_identity_documents').update({ status: 'replaced', change_reason: 'probe' }).eq('id', d.id).select('id')
  if (u.error) return res(u)
  return res(await ins(p1, 'passport', 'MOZ', `M${uniq}12`))
})
const rec = await (async () => {
  const email = `id-rec.${RUN}@probe.test`
  const u = (await must(svc.auth.admin.createUser({ email, password: 'probe-password-1', email_confirm: true }), 'rec')).user
  await must(svc.from('profiles').update({ role: 'receptionist', clinic_id: '11111111-1111-1111-1111-111111111111' }).eq('auth_user_id', u.id), 'rec role')
  const c = createClient(SB_URL, SB_ANON, opts)
  await must(c.auth.signInWithPassword({ email, password: 'probe-password-1' }), 'rec signin')
  return c
})()
await check('exposure', 'receptionist cannot read document numbers directly', NEWDENY, async () => {
  const r = await rec.from('patient_identity_documents').select('number_normalized')
  return { outcome: !r.error && (r.data ?? []).length > 0 ? 'allowed' : 'denied', detail: r.error ? `${r.error.code}` : `${(r.data ?? []).length} rows` }
})
await check('exposure', 'anon cannot read document numbers', NEWDENY, async () => {
  const r = await createClient(SB_URL, SB_ANON, opts).from('patient_identity_documents').select('number_normalized')
  return { outcome: !r.error && (r.data ?? []).length > 0 ? 'allowed' : 'denied', detail: r.error ? `${r.error.code}` : `${(r.data ?? []).length} rows` }
})

const width = Math.max(...results.map((r) => r.name.length))
let lastArea = ''
for (const r of results) {
  if (r.area !== lastArea) { console.log(`\n[${r.area}]`); lastArea = r.area }
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  expected ${r.want.padEnd(7)} got ${r.got.padEnd(7)} ${r.detail}`)
}
const failed = results.filter((r) => !r.ok)
console.log(`\nPHASE=${PHASE}: ${results.length - failed.length}/${results.length} assertions hold${failed.length ? `, ${failed.length} FAILED` : ''}.`)
process.exit(failed.length ? 1 : 0)
