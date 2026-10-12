// M1b grant-hygiene assertions (docs/proposals/grant_hygiene_m1b.sql). LOCAL SUPABASE STACK ONLY (refuses any other URL).
//
//   PHASE=baseline -> before M1b: the excess privileges are present (each negative test must show the privilege WORKING,
//                     so a pass in the next phase means the test really exercised the thing)
//   PHASE=m1b      -> M1b applied ALONE (no other proposal): excess privileges gone, everything else unchanged
//
//   SB_URL=... SB_ANON=... SB_SERVICE=... PHASE=... PSQL_CMD="docker exec -i supabase_db_<project> psql -U postgres -At -v ON_ERROR_STOP=1" \
//   node supabase/tests/clinical_records_access/probe_grants.mjs
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
if (!['baseline', 'm1b'].includes(PHASE)) throw new Error('PHASE must be baseline or m1b')
if (!PSQL_CMD || !/(supabase_db_[a-z0-9_-]+\s|@(127\.0\.0\.1|localhost)[:/])/.test(PSQL_CMD)) throw new Error('Refusing: PSQL_CMD must target a local supabase_db_* container or localhost')
const psql = (sql) => execSync(PSQL_CMD, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
const psqlTry = (sql) => { try { return { ok: true, out: psql(sql) } } catch (e) { return { ok: false, out: String(e.stderr ?? e.message).trim().split('\n')[0] } } }

const TABLES = ['appointments', 'clinic_hours', 'clinic_settings', 'clinics', 'notifications', 'nurse_actions', 'profiles', 'queue_events', 'services', 'staff_invitations']
// Expected SELECT/INSERT/UPDATE/DELETE per role, from the baseline inventory (unchanged by M1b: "preserve required DML").
const ALL4 = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']
const EXPECT_DML = {
  appointments: { anon: ALL4, authenticated: ALL4 }, clinic_hours: { anon: ALL4, authenticated: ALL4 },
  clinic_settings: { anon: ALL4, authenticated: ALL4 }, clinics: { anon: ALL4, authenticated: ALL4 },
  notifications: { anon: ['SELECT', 'UPDATE'], authenticated: ['SELECT', 'UPDATE'] },
  nurse_actions: { anon: ['SELECT'], authenticated: ['SELECT'] },
  profiles: { anon: ALL4, authenticated: ['SELECT', 'INSERT', 'DELETE'] },   // authenticated UPDATE is column-level only
  queue_events: { anon: ALL4, authenticated: ALL4 }, services: { anon: ALL4, authenticated: ALL4 },
  staff_invitations: { anon: ALL4, authenticated: ALL4 },
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const svc = createClient(SB_URL, SB_SERVICE, opts)
const RUN = Date.now().toString(36)
const CLINIC_A = process.env.PROBE_CLINIC_A ?? '11111111-1111-1111-1111-111111111111'
const must = async (p, what) => { const r = await p; if (r.error) throw new Error(`setup ${what}: ${r.error.message}`); return r.data }

async function user(tag, role, clinic) {
  const email = `gr-${tag}.${RUN}@probe.test`
  const u = (await must(svc.auth.admin.createUser({ email, password: 'probe-password-1', email_confirm: true }), tag)).user
  await must(svc.from('profiles').update({ role, clinic_id: clinic, full_name: `GR ${tag}` }).eq('auth_user_id', u.id), tag)
  const prof = await must(svc.from('profiles').select('id').eq('auth_user_id', u.id).single(), tag)
  const client = createClient(SB_URL, SB_ANON, opts)
  await must(client.auth.signInWithPassword({ email, password: 'probe-password-1' }), tag)
  return { client, id: prof.id }
}
const patient = await user('patient', 'patient', null)
const rec = await user('rec', 'receptionist', CLINIC_A)
const nurse = await user('nurse', 'nurse', CLINIC_A)
const admin = await user('admin', 'admin', CLINIC_A)
const anon = createClient(SB_URL, SB_ANON, opts)

const results = []
async function check(area, name, expect, run) {
  const want = expect[PHASE]
  const { outcome, detail } = await run()
  results.push({ area, name, want, got: outcome, ok: outcome === want, detail })
}
const OPEN = { baseline: 'allowed', m1b: 'denied' }   // a gap today, closed by M1b
const KEEP = { baseline: 'allowed', m1b: 'allowed' }  // must keep working
const DENY = { baseline: 'denied', m1b: 'denied' }    // denied before and after (RLS / column grants)
const sql = (text, okMeans = 'allowed') => async () => {
  const r = psqlTry(text)
  return { outcome: r.ok ? okMeans : (okMeans === 'allowed' ? 'denied' : 'allowed'), detail: r.ok ? 'statement succeeded' : r.out.slice(0, 90) }
}
const api = (q) => async () => { const r = await q; return { outcome: r.error ? 'denied' : 'allowed', detail: r.error ? `${r.error.code ?? ''} ${r.error.message}`.slice(0, 90) : `${(r.data ?? []).length ?? 0} row(s)` } }
const apiRows = (q) => async () => { const r = await q; const n = r.error ? 0 : (Array.isArray(r.data) ? r.data.length : (r.data ? 1 : 0)); return { outcome: n > 0 ? 'allowed' : 'denied', detail: r.error ? `${r.error.code ?? ''} ${r.error.message}`.slice(0, 90) : `${n} row(s)` } }
// One catalog round trip for the whole privilege grid.
const GRID = new Map(psql(`select r, t, p, has_table_privilege(r, 'public.' || t, p)
  from unnest(array[${TABLES.map((t) => `'${t}'`).join(',')}]) t
  cross join unnest(array['anon','authenticated','service_role']) r
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
  where p <> 'MAINTAIN' or current_setting('server_version_num')::int >= 170000;`).split(String.fromCharCode(10)).map((l) => { const [r, t, p, v] = l.split('|'); return [`${r}|${t}|${p}`, v === 't'] }))
const has = (role, table, priv) => GRID.get(`${role}|${table}|${priv}`) === true

// ---- 1. Negative: the excess privileges, actually exercised (rolled-back transactions)
for (const role of ['anon', 'authenticated']) {
  for (const t of TABLES) {
    await check('TRUNCATE', `${role} can TRUNCATE ${t} (rolled-back transaction)`, OPEN,
      sql(`begin;\nset local role ${role};\ntruncate public.${t} cascade;\nrollback;\n`))
  }
}
const scratchFk = (role, parent) => `begin;
create schema m1b_scratch; grant usage, create on schema m1b_scratch to anon, authenticated;
set local role ${role};
create table m1b_scratch.m1b_ref_probe (c uuid references public.${parent}(id));
rollback;
`
await check('REFERENCES', 'authenticated can create a foreign key to public.clinics (scratch schema, rolled back)', OPEN, sql(scratchFk('authenticated', 'clinics')))
await check('REFERENCES', 'anon can create a foreign key to public.services (scratch schema, rolled back)', OPEN, sql(scratchFk('anon', 'services')))
await check('TRIGGER', 'authenticated can create a trigger on public.services (rolled back)', OPEN,
  sql(`begin;\nset local role authenticated;\ncreate trigger m1b_trigger_probe before update on public.services for each row execute function public.touch_updated_at();\nrollback;\n`))
const pg17 = Number(psql('show server_version_num;')) >= 170000
if (pg17) {
  for (const role of ['anon', 'authenticated', 'PUBLIC']) {
    await check('MAINTAIN (Part B, beyond D-R1)', `${role} holds MAINTAIN on any of the 10 tables${role === 'PUBLIC' ? ' (control: never held)' : ''}`, role === 'PUBLIC' ? DENY : OPEN,
      async () => {
        const held = role === 'PUBLIC'
          ? psql(`select count(*) from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where c.oid in (${TABLES.map((t) => `'public.${t}'::regclass`).join(',')}) and a.grantee = 0 and a.privilege_type = 'MAINTAIN';`)
          : TABLES.filter((t) => has(role, t, 'MAINTAIN')).length
        return { outcome: Number(held) > 0 ? 'allowed' : 'denied', detail: `${held} table(s)` }
      })
  }
}
// Whole-grid fact check (all 10 tables x 2 roles x 3 privileges) so no table can be missed by a hand-picked test.
await check('grid', 'any of TRUNCATE / REFERENCES / TRIGGER held by anon or authenticated on any of the 10 tables', OPEN, async () => {
  const held = []
  for (const role of ['anon', 'authenticated']) for (const t of TABLES) for (const p of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) if (has(role, t, p)) held.push(`${role}:${t}:${p}`)
  return { outcome: held.length ? 'allowed' : 'denied', detail: `${held.length} of 60 held` }
})

// ---- 2. Positive: everything that must be unchanged
await check('DML preserved', 'SELECT/INSERT/UPDATE/DELETE table privileges equal the baseline registry for anon and authenticated (80 facts)', KEEP, async () => {
  const wrong = []
  for (const t of TABLES) for (const role of ['anon', 'authenticated']) for (const p of ALL4) {
    const want = EXPECT_DML[t][role].includes(p)
    if (has(role, t, p) !== want) wrong.push(`${role}:${t}:${p}`)
  }
  return { outcome: wrong.length === 0 ? 'allowed' : 'denied', detail: wrong.length ? `mismatch: ${wrong.slice(0, 4).join(', ')}` : '80 of 80 as expected' }
})
await check('DML preserved', 'profiles: authenticated column UPDATE only on full_name / phone / date_of_birth / id_number', KEEP, async () => {
  const cols = psql(`select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated' and privilege_type = 'UPDATE';`)
  return { outcome: cols === 'date_of_birth,full_name,id_number,phone' ? 'allowed' : 'denied', detail: cols }
})
await check('service_role', 'service_role keeps SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on all 10 tables', KEEP, async () => {
  const missing = []
  for (const t of TABLES) for (const p of [...ALL4, 'TRUNCATE', 'REFERENCES', 'TRIGGER']) if (!has('service_role', t, p)) missing.push(`${t}:${p}`)
  return { outcome: missing.length === 0 ? 'allowed' : 'denied', detail: missing.length ? missing.slice(0, 4).join(', ') : '70 of 70' }
})
await check('service_role', 'service_role can still TRUNCATE nurse_actions (rolled-back transaction)', KEEP,
  sql(`begin;\nset local role service_role;\ntruncate public.nurse_actions;\nrollback;\n`))
await check('service_role', 'service_role (admin client) still creates and reads fixtures through the API', KEEP, api(svc.from('services').select('id').limit(1)))

// ---- 3. Positive: legitimate API use, per role (no behaviour change)
await check('anon', 'anon reads clinic_hours (anon policy hours_read)', KEEP, api(anon.from('clinic_hours').select('*').limit(1)))
await check('anon', 'anon calls the one public RPC get_public_queue_display', KEEP, async () => {
  const sid = (await must(svc.from('services').select('id').limit(1).single(), 'service')).id
  return api(anon.rpc('get_public_queue_display', { p_service_id: sid }))()
})
await check('anon', 'anon cannot read profiles (no anon policy)', DENY, apiRows(anon.from('profiles').select('id').limit(1)))
await check('anon', 'anon cannot insert into profiles (privilege held, RLS refuses)', DENY, apiRows(anon.from('profiles').insert({ full_name: 'x', role: 'admin' }).select('id')))
await check('anon', 'anon cannot update clinics (privilege held, RLS refuses)', DENY, apiRows(anon.from('clinics').update({ name: 'x' }).eq('id', CLINIC_A).select('id')))
await check('patient', 'patient reads clinics and services', KEEP, async () => {
  const rs = await Promise.all([patient.client.from('clinics').select('id').limit(1), patient.client.from('services').select('id').limit(1)])
  return { outcome: rs.every((r) => !r.error && (r.data ?? []).length > 0) ? 'allowed' : 'denied', detail: rs.map((r) => (r.error ? 'err' : (r.data ?? []).length)).join('/') }
})
await check('patient', 'patient gets no clinic_settings rows (staff-only policy; no privilege error)', DENY, apiRows(patient.client.from('clinic_settings').select('clinic_id').limit(1)))
await check('patient', 'patient updates own phone (profiles column UPDATE)', KEEP, apiRows(patient.client.from('profiles').update({ phone: '+27 82 111 2222' }).eq('id', patient.id).select('id')))
await check('patient', 'patient cannot change own role (column grant)', DENY, apiRows(patient.client.from('profiles').update({ role: 'admin' }).eq('id', patient.id).select('id')))
await check('patient', 'patient reads own notifications and marks them read (RPC)', KEEP, async () => {
  const a = await patient.client.from('notifications').select('id').eq('recipient_id', patient.id)
  const b = await patient.client.rpc('mark_notifications_read', { p_ids: [] })
  return { outcome: !a.error && !b.error ? 'allowed' : 'denied', detail: `${a.error?.message ?? 'read ok'} / ${b.error?.message ?? 'mark ok'}`.slice(0, 90) }
})
await check('reception', 'receptionist reads appointments and queue_events', KEEP, async () => {
  const rs = await Promise.all([rec.client.from('appointments').select('id').limit(1), rec.client.from('queue_events').select('id').limit(1)])
  return { outcome: rs.every((r) => !r.error) ? 'allowed' : 'denied', detail: rs.map((r) => r.error?.message ?? 'ok').join(' / ').slice(0, 90) }
})
await check('nurse', 'nurse reads nurse_actions (own)', KEEP, api(nurse.client.from('nurse_actions').select('id').eq('nurse_id', nurse.id)))
await check('admin', 'admin updates own clinic_settings (settings_admin_write)', KEEP,
  apiRows(admin.client.from('clinic_settings').update({ staff_idle_timeout_minutes: 30 }).eq('clinic_id', CLINIC_A).select('clinic_id')))
await check('admin', 'admin reads staff_invitations of own clinic', KEEP, api(admin.client.from('staff_invitations').select('id').limit(1)))
await check('admin', 'admin_set_staff_status RPC on an own-clinic nurse', KEEP, api(admin.client.rpc('admin_set_staff_status', { p_profile_id: nurse.id, p_is_active: true })))

// ---- 4. Automated check catches a new table that relies on Supabase default privileges (decision D-R3)
const grantsSql = readFileSync(join(here, 'assert_catalog_grants.sql'), 'utf8')
await check('D-R3 automation', 'a NEW table created with default privileges is flagged by assert_catalog_grants.sql (rolled back)', { baseline: 'denied', m1b: 'denied' }, async () => {
  const out = psql(`begin;\ncreate table public.m1b_new_table_probe (id int);\n${grantsSql}\nrollback;`)
  const rows = out.split('\n').filter((l) => l.startsWith('f|'))
  const flagged = rows.some((l) => /TRUNCATE \/ REFERENCES/.test(l) && l.includes('m1b_new_table_probe')) && rows.some((l) => /row level security/.test(l) && l.includes('m1b_new_table_probe'))
  // outcome 'denied' = "the new table was NOT allowed to pass unnoticed"
  return { outcome: flagged ? 'denied' : 'allowed', detail: flagged ? 'flagged for excess privileges and missing RLS' : `not flagged: ${rows.length} failing row(s)` }
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
