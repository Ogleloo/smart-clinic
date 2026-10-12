// Mandatory-identification design invariants. LOCAL SUPABASE STACK ONLY.
//
//   PHASE=baseline  -> records today's behaviour: the optional, free-text profiles.id_number does not prevent
//                      duplicate registration and is editable by the patient.
//   PHASE=proposed  -> additionally tests docs/proposals/identity_documents_prototype.sql (rev 5, a DESIGN PROTOTYPE,
//                      not the registration feature): validation, keyed-hash uniqueness under concurrency, replacement,
//                      single-use claim codes, and that no document number or claim code is stored in plaintext.
//
//   SB_URL=... SB_ANON=... SB_SERVICE=... PHASE=... PSQL_CMD="docker exec -i supabase_db_<project> psql -U postgres -At -v ON_ERROR_STOP=1" \
//   node supabase/tests/clinical_records_access/probe_identity.mjs
import { createRequire } from 'node:module'
import { execSync, exec } from 'node:child_process'

const require = createRequire(`${process.cwd()}/`)
const { createClient } = require('@supabase/supabase-js')
const { SB_URL, SB_ANON, SB_SERVICE, PHASE, PSQL_CMD } = process.env
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(SB_URL ?? '')) throw new Error(`Refusing: SB_URL must be a local stack, got ${SB_URL}`)
if (!['baseline', 'proposed'].includes(PHASE)) throw new Error('PHASE must be baseline or proposed')
if (!PSQL_CMD || !/(supabase_db_[a-z0-9_-]+\s|@(127\.0\.0\.1|localhost)[:/])/.test(PSQL_CMD)) throw new Error('Refusing: PSQL_CMD must target a local supabase_db_* container or localhost')
const psql = (sql) => execSync(PSQL_CMD, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
const psqlTry = (sql) => { try { return { ok: true, out: psql(sql) } } catch (e) { return { ok: false, out: String(e.stderr ?? e.message).trim().split('\n')[0] } } }
const psqlAsync = (sql) => new Promise((resolve) => {
  const child = exec(PSQL_CMD, { encoding: 'utf8' }, (err, stdout, stderr) => resolve({ ok: !err, out: (err ? stderr : stdout).trim().split('\n')[0] }))
  child.stdin.end(sql)
})

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
const bool = (sql) => async () => { const r = psqlTry(`select ${sql};`); return { outcome: r.ok && r.out === 't' ? 'allowed' : 'denied', detail: r.out.slice(0, 80) } }
const sqlOk = (sql) => async () => { const r = psqlTry(sql); return { outcome: r.ok ? 'allowed' : 'denied', detail: r.out.slice(0, 80) } }
const res = (r) => ({ outcome: !r.error && (r.data ?? []).length > 0 ? 'allowed' : 'denied', detail: r.error ? `${r.error.code} ${r.error.message}`.slice(0, 80) : 'ok' })
const reg = (patient, type, country, raw, verified = false) =>
  `select private.register_identity_document('${patient}', '${type}', ${country ? `'${country}'` : 'null'}, '${raw}', ${verified ? `'${STAFF}'` : 'null'}, ${verified});`

// Today's behaviour (documented so the change is measurable; not a target state)
const pa = (await must(svc.from('profiles').insert({ full_name: `ID A ${RUN}`, role: 'patient', id_number: VALID1 }).select('id').single(), 'pa')).id
await check('today (to be replaced)', 'two profiles can hold the same id_number (no duplicate prevention)', KEEP, async () =>
  res(await svc.from('profiles').insert({ full_name: `ID B ${RUN}`, role: 'patient', id_number: VALID1 }).select('id')))
await check('today (to be replaced)', 'id_number is optional at registration (walk-ins have none)', KEEP, async () =>
  res(await svc.from('profiles').insert({ full_name: `ID C ${RUN}`, role: 'patient' }).select('id')))
await check('today (to be replaced)', 'a signed-in patient can change their own id_number (UPDATE column grant)', KEEP, async () => {
  const email = `id-self.${RUN}@probe.test`
  const u = (await must(svc.auth.admin.createUser({ email, password: 'probe-password-1', email_confirm: true }), 'u')).user
  const c = createClient(SB_URL, SB_ANON, opts)
  await must(c.auth.signInWithPassword({ email, password: 'probe-password-1' }), 'signin')
  return res(await c.from('profiles').update({ id_number: 'X1234567' }).eq('auth_user_id', u.id).select('id'))
})

// ---------------------------------------------------------------- prototype (proposed phase)
const STAFF = (await must(svc.from('profiles').insert({ full_name: `ID staff ${RUN}`, role: 'receptionist', clinic_id: '11111111-1111-1111-1111-111111111111' }).select('id').single(), 'staff')).id
const newPatient = async (tag) => (await must(svc.from('profiles').insert({ full_name: `ID ${tag} ${RUN}`, role: 'patient' }).select('id').single(), tag)).id
if (PHASE === 'proposed') {
  // Throwaway HMAC key on the DISPOSABLE stack only (an operator creates the real one in Vault).
  psql(`select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'identity_document_hmac_key_v1')
        where not exists (select 1 from vault.secrets where name = 'identity_document_hmac_key_v1');`)
}
const p1 = pa
const p2 = await newPatient('P2')
const p3 = await newPatient('P3')

await check('validation', `valid SA ID ${VALID1} accepted`, NEW, bool(`private.is_valid_sa_id('${VALID1}')`))
await check('validation', 'valid SA ID on 2000-02-29 accepted', NEW, bool(`private.is_valid_sa_id('${VALID3}')`))
await check('validation', 'SA ID with a wrong check digit rejected', NEWDENY, bool(`private.is_valid_sa_id('${VALID1.slice(0, 12)}${(Number(VALID1[12]) + 1) % 10}')`))
await check('validation', 'SA ID on 2005-02-29 (not a date) rejected', NEWDENY, bool(`private.is_valid_sa_id('${VALID2}')`))
await check('validation', 'SA ID with citizenship digit 3 rejected', NEWDENY, bool(`private.is_valid_sa_id('${saId('900101', uniq, '3')}')`))
await check('validation', 'passport needs an issuing country', NEWDENY, sqlOk(reg(p2, 'passport', null, 'A1234567')))
await check('validation', 'passport format is not assumed per country (5–20 letters/digits)', NEW, bool(`private.is_valid_passport('X12345', 'GBR') and private.is_valid_passport('123456789AB', 'NGA')`))
await check('normalisation', "'800101 5009-087' and '8001015009087' normalise identically", NEW, bool(`private.normalize_document_number(' 800101 5009-087 ') = '8001015009087'`))

await check('uniqueness', 'register an SA ID for patient 1 (verified by staff)', NEW, sqlOk(reg(p1, 'sa_id', 'ZAF', VALID1, true)))
await check('uniqueness', 'the same SA ID for patient 2 is refused', NEWDENY, sqlOk(reg(p2, 'sa_id', 'ZAF', VALID1)))
await check('uniqueness', 'the same SA ID typed with spaces/hyphens is still refused (normalised before hashing)', NEWDENY,
  sqlOk(reg(p2, 'sa_id', 'ZAF', `${VALID1.slice(0, 6)} ${VALID1.slice(6, 10)}-${VALID1.slice(10)}`)))
await check('uniqueness', 'an SA ID that fails the checksum is refused', NEWDENY, sqlOk(reg(p2, 'sa_id', 'ZAF', VALID1.slice(0, 12) + ((Number(VALID1[12]) + 1) % 10))))
await check('uniqueness', 'same passport number, different issuing country: allowed', NEW, async () => {
  const a = psqlTry(reg(p2, 'passport', 'GBR', `P${uniq}99`))
  if (!a.ok) return { outcome: 'denied', detail: a.out }
  return sqlOk(reg(p3, 'passport', 'ZWE', `P${uniq}99`))()
})
await check('uniqueness', 'same passport + country (different formatting) for another patient refused', NEWDENY, sqlOk(reg(p1, 'passport', 'gbr', `p-${uniq}99`)))
await check('uniqueness', 'a person may hold an SA ID and a passport', NEW, sqlOk(reg(p1, 'passport', 'MOZ', `M${uniq}11`)))
await check('uniqueness', 'a second active SA ID for the same patient refused', NEWDENY, sqlOk(reg(p1, 'sa_id', 'ZAF', VALID3)))
await check('concurrency', 'two simultaneous registrations of one document (separate sessions): exactly one succeeds', NEW, async () => {
  const doc = saId('850615', String(Number(uniq) % 9000 + 1000))
  const q1 = await newPatient('R1'); const q2 = await newPatient('R2')
  const [a, b] = await Promise.all([psqlAsync(reg(q1, 'sa_id', 'ZAF', doc)), psqlAsync(reg(q2, 'sa_id', 'ZAF', doc))])
  const okN = [a, b].filter((r) => r.ok).length
  return { outcome: okN === 1 && [a, b].some((r) => /already registered/.test(r.out)) ? 'allowed' : 'denied', detail: `successes=${okN}` }
})
await check('lookup', 'exact-document lookup finds the patient (any formatting)', NEW, bool(`private.find_patient_by_document('sa_id', null, '${VALID1.slice(0, 6)} ${VALID1.slice(6)}') = '${p1}'`))
await check('lookup', 'lookup with a different number finds nobody', NEWDENY, bool(`private.find_patient_by_document('sa_id', null, '${VALID3}') is not null`))

await check('replacement', 'verified replacement: old row kept as replaced, new row active, linked', NEW, async () => {
  const id = psql(`select id from public.patient_identity_documents where patient_id = '${p1}' and document_type = 'passport' and status = 'active';`)
  const r = psqlTry(`select private.replace_identity_document('${id}', 'M${uniq}12', null, 'passport renewed', '${STAFF}');`)
  if (!r.ok) return { outcome: 'denied', detail: r.out }
  const v = psql(`select (select status from public.patient_identity_documents where id = '${id}') = 'replaced'
                    and (select replaced_by from public.patient_identity_documents where id = '${id}') = '${r.out}'::uuid
                    and (select status from public.patient_identity_documents where id = '${r.out}') = 'active';`)
  return { outcome: v === 't' ? 'allowed' : 'denied', detail: v }
})
await check('replacement', 'replacement without a reason refused', NEWDENY, async () => {
  const id = psql(`select id from public.patient_identity_documents where patient_id = '${p1}' and document_type = 'passport' and status = 'active';`)
  return sqlOk(`select private.replace_identity_document('${id}', 'M${uniq}13', null, '', '${STAFF}');`)()
})
await check('replacement', 'replacement without verifying staff refused', NEWDENY, async () => {
  const id = psql(`select id from public.patient_identity_documents where patient_id = '${p1}' and document_type = 'passport' and status = 'active';`)
  return sqlOk(`select private.replace_identity_document('${id}', 'M${uniq}13', null, 'renewed', null);`)()
})

// Claim codes: a walk-in profile (no login) with a verified document is claimed by a new account.
const walkin = await newPatient('Walkin')
const walkDoc = saId('770303', String((Number(uniq) + 7) % 9000 + 1000))
let code = null
await check('claim code', 'cannot issue a claim code before a document is verified', NEWDENY, sqlOk(`select private.issue_claim_code('${walkin}', '${STAFF}');`))
await check('claim code', 'issue after a verified document (code returned once)', NEW, async () => {
  const a = psqlTry(reg(walkin, 'sa_id', 'ZAF', walkDoc, true))
  if (!a.ok) return { outcome: 'denied', detail: a.out }
  const r = psqlTry(`select private.issue_claim_code('${walkin}', '${STAFF}');`)
  code = r.ok ? r.out : null
  return { outcome: r.ok && /^[0-9A-F]{20}$/.test(r.out) ? 'allowed' : 'denied', detail: r.ok ? 'code issued' : r.out }
})
const newAuth = async (tag) => (await must(svc.auth.admin.createUser({ email: `claim-${tag}.${RUN}@probe.test`, password: 'probe-password-1', email_confirm: true }), tag)).user.id
await check('claim code', 'a wrong code is refused', NEWDENY, async () => sqlOk(`select private.redeem_claim_code('00000000000000000000', '${crypto.randomUUID()}');`)())
await check('claim code', 'an account that already has a profile cannot claim', NEWDENY, async () => {
  const a = await newAuth('hasprofile')   // handle_new_user gives it a profile
  return sqlOk(`select private.redeem_claim_code('${code}', '${a}');`)()
})
let claimer = null
await check('claim code', 'redeem once with a fresh account: profile linked', NEW, async () => {
  claimer = await newAuth('claimer')
  psql(`delete from public.profiles where auth_user_id = '${claimer}';`)   // simulate the claim flow creating no second profile
  const r = psqlTry(`select private.redeem_claim_code('${code?.toLowerCase()}', '${claimer}');`)
  const linked = r.ok && psql(`select auth_user_id from public.profiles where id = '${walkin}';`) === claimer
  return { outcome: linked ? 'allowed' : 'denied', detail: r.out.slice(0, 60) }
})
await check('claim code', 'the same code cannot be used twice', NEWDENY, async () => {
  const other = await newAuth('second'); psql(`delete from public.profiles where auth_user_id = '${other}';`)
  return sqlOk(`select private.redeem_claim_code('${code}', '${other}');`)()
})
await check('claim code', 'an expired code is refused', NEWDENY, async () => {
  const w2 = await newPatient('Walkin2')
  psql(reg(w2, 'sa_id', 'ZAF', saId('660606', String((Number(uniq) + 3) % 9000 + 1000)), true))
  const c2 = psql(`select private.issue_claim_code('${w2}', '${STAFF}', interval '-1 minute');`)
  const a = await newAuth('expired'); psql(`delete from public.profiles where auth_user_id = '${a}';`)
  return sqlOk(`select private.redeem_claim_code('${c2}', '${a}');`)()
})

// Minimum exposure
await check('exposure', 'no column can hold a plaintext document number or claim code', NEW, bool(
  `not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('patient_identity_documents', 'patient_claim_codes')
     and data_type in ('text', 'character varying', 'character') and column_name not in ('issuing_country', 'number_last4', 'change_reason'))`))
await check('exposure', 'the stored rows do not contain the document number or the claim code', NEW, bool(
  `not exists (select 1 from public.patient_identity_documents d where row_to_json(d)::text like '%${VALID1}%' or row_to_json(d)::text like '%${walkDoc}%')
   and not exists (select 1 from public.patient_claim_codes c where row_to_json(c)::text ilike '%' || ${code ? `'${code}'` : `'__none__'`} || '%')`))
await check('exposure', 'receptionist cannot read the documents table', NEWDENY, async () => {
  const email = `id-rec.${RUN}@probe.test`
  const u = (await must(svc.auth.admin.createUser({ email, password: 'probe-password-1', email_confirm: true }), 'rec')).user
  await must(svc.from('profiles').update({ role: 'receptionist', clinic_id: '11111111-1111-1111-1111-111111111111' }).eq('auth_user_id', u.id), 'rec role')
  const c = createClient(SB_URL, SB_ANON, opts)
  await must(c.auth.signInWithPassword({ email, password: 'probe-password-1' }), 'rec signin')
  const r = await c.from('patient_identity_documents').select('number_last4')
  return { outcome: !r.error && (r.data ?? []).length > 0 ? 'allowed' : 'denied', detail: r.error ? `${r.error.code}` : `${(r.data ?? []).length} rows` }
})
await check('exposure', 'authenticated cannot execute the registration, lookup, claim or key functions', NEWDENY, bool(
  `has_function_privilege('authenticated', 'private.register_identity_document(uuid, public.identity_document_type, text, text, uuid, boolean)', 'EXECUTE')
   or has_function_privilege('authenticated', 'private.find_patient_by_document(public.identity_document_type, text, text)', 'EXECUTE')
   or has_function_privilege('authenticated', 'private.redeem_claim_code(text, uuid)', 'EXECUTE')
   or has_function_privilege('authenticated', 'private.identity_hmac_key()', 'EXECUTE')
   or has_function_privilege('service_role', 'private.identity_hmac_key()', 'EXECUTE')`))

const width = Math.max(...results.map((r) => r.name.length))
let lastArea = ''
for (const r of results) {
  if (r.area !== lastArea) { console.log(`\n[${r.area}]`); lastArea = r.area }
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  expected ${r.want.padEnd(7)} got ${r.got.padEnd(7)} ${r.detail}`)
}
const failed = results.filter((r) => !r.ok)
console.log(`\nPHASE=${PHASE}: ${results.length - failed.length}/${results.length} assertions hold${failed.length ? `, ${failed.length} FAILED` : ''}.`)
process.exit(failed.length ? 1 : 0)
