// Queue-priority authorisation assertions for docs/proposals/queue_priority_reception.sql (revised BR-10: Reception
// manages priority; nurses escalate). LOCAL SUPABASE STACK ONLY (refuses any non-local URL).
//
//   PHASE=baseline  -> today's behaviour (nurse/admin set_emergency_priority, no clinic check, no history)
//   PHASE=proposed  -> queue_priority_reception.sql Parts 1 and 2 applied (run with clinical_records_access.sql too,
//                      which removes direct queue_entries writes)
//
//   SB_URL=... SB_ANON=... SB_SERVICE=... PHASE=... node supabase/tests/clinical_records_access/probe_priority.mjs
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

await must(svc.from('clinics').insert({ id: CLINIC_B, name: `QP B ${RUN}` }), 'clinic B')
const svcA = (await must(svc.from('services').insert({ clinic_id: CLINIC_A, name: `QP A ${RUN}`, token_prefix: prefix() }).select('id').single(), 'svcA')).id
const svcB = (await must(svc.from('services').insert({ clinic_id: CLINIC_B, name: `QP B ${RUN}`, token_prefix: prefix() }).select('id').single(), 'svcB')).id

async function user(tag, role, clinic) {
  const email = `qp-${tag}.${RUN}@probe.test`
  const u = (await must(svc.auth.admin.createUser({ email, password: 'probe-password-1', email_confirm: true }), tag)).user
  await must(svc.from('profiles').update({ role, clinic_id: clinic, full_name: `QP ${tag}` }).eq('auth_user_id', u.id), tag)
  const prof = await must(svc.from('profiles').select('id').eq('auth_user_id', u.id).single(), tag)
  const client = createClient(SB_URL, SB_ANON, opts)
  await must(client.auth.signInWithPassword({ email, password: 'probe-password-1' }), tag)
  return { client, id: prof.id }
}
const recA = await user('reca', 'receptionist', CLINIC_A)
const recB = await user('recb', 'receptionist', CLINIC_B)
const nurseA = await user('nursea', 'nurse', CLINIC_A)
const nurseB = await user('nurseb', 'nurse', CLINIC_B)
const adminA = await user('admina', 'admin', CLINIC_A)
const pat = await user('patient', 'patient', null)
const anon = createClient(SB_URL, SB_ANON, opts)

let n = 0
async function entry(clinic, serviceId, status, patientId) {
  const pid = patientId ?? (await must(svc.from('profiles').insert({ full_name: `QP P${n} ${RUN}`, role: 'patient' }).select('id').single(), 'patient')).id
  n++
  return (await must(svc.from('queue_entries').insert({ clinic_id: clinic, service_id: serviceId, patient_id: pid, token: `QP${n}-${RUN}`, token_number: 600 + n, status }).select('id').single(), 'entry')).id
}
const eA1 = await entry(CLINIC_A, svcA, 'waiting')
const eA2 = await entry(CLINIC_A, svcA, 'waiting')
const eA3 = await entry(CLINIC_A, svcA, 'waiting')
const eA4 = await entry(CLINIC_A, svcA, 'waiting')
const eOwn = await entry(CLINIC_A, svcA, 'waiting', pat.id)
const eProg = await entry(CLINIC_A, svcA, 'in_progress')
const eB = await entry(CLINIC_B, svcB, 'waiting')

const results = []
const rows = (r) => (r.error || r.data == null ? 0 : Array.isArray(r.data) ? r.data.length : 1)
const why = (r) => (r.error ? `${r.error.code ?? ''} ${r.error.message ?? ''}`.trim().slice(0, 80) : `${rows(r)} row(s)`)
async function check(area, name, expect, run) {
  const want = expect[PHASE]
  if (want === 'skip') { results.push({ area, name, want, got: 'skip', ok: true, detail: 'not applicable in this phase' }); return }
  const r = typeof run === 'function' ? await run() : await run
  const got = r.outcome ?? (rows(r) > 0 ? 'allowed' : 'denied')
  results.push({ area, name, want, got, ok: got === want, detail: r.detail ?? why(r) })
}
const OPEN = { baseline: 'allowed', proposed: 'denied' }
const DENY = { baseline: 'denied', proposed: 'denied' }
const NEW = { baseline: 'skip', proposed: 'allowed' }
const NEWDENY = { baseline: 'skip', proposed: 'denied' }
const emerg = (c, id, on = true) => c.rpc('set_emergency_priority', { p_queue_entry_id: id, p_emergency: on })
const setp = (c, id, priority, extra = {}) => c.rpc('set_queue_priority', { p_queue_entry_id: id, p_priority: priority, ...extra })
const prio = async (id) => (await must(svc.from('queue_entries').select('priority').eq('id', id).single(), 'prio')).priority

// Today's control (removed at cutover)
await check('legacy control', 'nurse sets emergency priority (set_emergency_priority)', OPEN, emerg(nurseA.client, eA1))
await check('legacy control', 'admin sets emergency priority', OPEN, emerg(adminA.client, eA4))
await check('legacy control', 'F12: clinic-A nurse sets priority on a clinic-B entry', OPEN, emerg(nurseA.client, eB))
await check('legacy control', 'nurse sets priority on an in-progress entry', OPEN, emerg(nurseA.client, eProg))
await check('legacy control', 'receptionist calls set_emergency_priority', DENY, emerg(recA.client, eA2))
await check('legacy control', 'patient calls set_emergency_priority on own entry', DENY, emerg(pat.client, eOwn))
await check('legacy control', 'nurse check-in with p_priority = 1', OPEN, async () => {
  const p = (await must(svc.from('profiles').insert({ full_name: `QP CI ${RUN}`, role: 'patient' }).select('id').single(), 'ci')).id
  return nurseA.client.rpc('check_in_patient', { p_service_id: svcA, p_patient_id: p, p_priority: 1 })
})
await check('direct write', 'receptionist updates queue_entries.priority directly (F11, unaudited)', OPEN, recA.client.from('queue_entries').update({ priority: 1 }).eq('id', eA3).select('id'))
if (PHASE === 'baseline') await svc.from('queue_entries').update({ priority: 0, priority_set_by: null }).in('id', [eA1, eA3, eA4, eB])

// Reception-managed priority (rev 5: a reason CODE is required to set AND to clear)
await check('reception', 'receptionist sets priority: accessibility_need', NEW, setp(recA.client, eA2, 1, { p_reason: 'accessibility_need' }))
await check('reception', 'the change is recorded: who, when, old -> new, reason, entry snapshot', NEW, async () => {
  const r = await svc.from('queue_priority_events').select('changed_by, changed_at, old_priority, new_priority, reason, token, queue_date, service_id').eq('queue_entry_id', eA2)
  const e = r.data?.[0]
  const ok = !r.error && r.data.length === 1 && e.changed_by === recA.id && e.old_priority === 0 && e.new_priority === 1
    && e.reason === 'accessibility_need' && !!e.changed_at && !!e.token && !!e.queue_date && e.service_id === svcA
  return { outcome: ok ? 'allowed' : 'denied', detail: r.error ? why(r) : JSON.stringify(e ?? null).slice(0, 80) }
})
await check('reception', 'queue order: the prioritised patient is listed first', NEW, async () => {
  const r = await recA.client.rpc('get_service_queue', { p_service_id: svcA })
  const first = (r.data ?? []).find((x) => x.status === 'waiting')
  return { outcome: !r.error && (first?.id ?? first?.queue_entry_id) === eA2 ? 'allowed' : 'denied', detail: r.error ? why(r) : `first waiting = ${(first?.id ?? first?.queue_entry_id) === eA2 ? 'eA2' : 'other'}` }
})
await check('clearing', 'clearing priority WITHOUT a reason is refused', NEWDENY, setp(recA.client, eA2, 0))
await check('clearing', 'clearing with a raising reason (accessibility_need) is refused', NEWDENY, setp(recA.client, eA2, 0, { p_reason: 'accessibility_need' }))
await check('clearing', 'clearing with no_longer_required succeeds and is logged with its reason', NEW, async () => {
  const r = await setp(recA.client, eA2, 0, { p_reason: 'no_longer_required' })
  if (r.error) return r
  const ev = await svc.from('queue_priority_events').select('id').eq('queue_entry_id', eA2).eq('new_priority', 0).eq('reason', 'no_longer_required').eq('changed_by', recA.id)
  return { outcome: (ev.data ?? []).length === 1 ? 'allowed' : 'denied', detail: `clear events=${(ev.data ?? []).length}` }
})
await check('reception', 'raising with a clearing reason (entered_in_error) is refused', NEWDENY, setp(recA.client, eA3, 1, { p_reason: 'entered_in_error' }))
await check('reception', 'operational priority without a note is refused', NEWDENY, setp(recA.client, eA3, 1, { p_reason: 'operational' }))
await check('reception', 'priority without any reason is refused', NEWDENY, setp(recA.client, eA3, 1))
await check('reception', 'nurse_escalation_accepted without an escalation is refused (Reception cannot classify clinically, D-P2)', NEWDENY, setp(recA.client, eA3, 1, { p_reason: 'nurse_escalation_accepted' }))
await check('reception', 'priority on an in-progress entry', NEWDENY, setp(recA.client, eProg, 1, { p_reason: 'accessibility_need' }))
await check('reception', 'setting the value it already has', NEWDENY, setp(recA.client, eA3, 0, { p_reason: 'no_longer_required' }))
await check('cross-clinic', 'clinic-A receptionist sets priority on a clinic-B entry', DENY, setp(recA.client, eB, 1, { p_reason: 'accessibility_need' }))
await check('roles', 'nurse calls set_queue_priority', DENY, setp(nurseA.client, eA3, 1, { p_reason: 'accessibility_need' }))
await check('roles', 'admin calls set_queue_priority (oversight only, D-P1)', DENY, setp(adminA.client, eA3, 1, { p_reason: 'accessibility_need' }))
await check('roles', 'patient prioritises own entry', DENY, setp(pat.client, eOwn, 1, { p_reason: 'accessibility_need' }))
await check('roles', 'anon calls set_queue_priority', DENY, setp(anon, eA3, 1, { p_reason: 'accessibility_need' }))
await check('oversight', 'admin reads the clinic priority history', NEW, adminA.client.from('queue_priority_events').select('id').eq('clinic_id', CLINIC_A).eq('queue_entry_id', eA2))

// Concurrency: two simultaneous identical requests -> exactly one change, one refusal, one event.
await check('concurrency', 'two simultaneous set_queue_priority calls: exactly one succeeds, one event row', NEW, async () => {
  const [r1, r2] = await Promise.all([
    setp(recA.client, eA4, 1, { p_reason: 'operational', p_note: 'first' }),
    setp(recA.client, eA4, 1, { p_reason: 'operational', p_note: 'second' }),
  ])
  const ev = await svc.from('queue_priority_events').select('id').eq('queue_entry_id', eA4)
  const okCount = [r1, r2].filter((r) => !r.error).length
  return { outcome: okCount === 1 && (ev.data ?? []).length === 1 && (await prio(eA4)) === 1 ? 'allowed' : 'denied', detail: `successes=${okCount}, events=${(ev.data ?? []).length}` }
})

// Nurse escalation -> Reception decision (rev 5: reason codes only, no free text — D-P3)
let escId = null
await check('escalation', 'nurse requests escalation with a reason code', NEW, async () => {
  const r = await nurseA.client.rpc('request_priority_escalation', { p_queue_entry_id: eA3, p_reason: 'nurse_assessed_urgent' })
  escId = r.data?.id ?? null
  return r
})
await check('escalation', 'escalation without a reason code is refused', NEWDENY, nurseA.client.rpc('request_priority_escalation', { p_queue_entry_id: eA1, p_reason: null }))
await check('escalation', 'free-text clinical notes cannot be attached (no note parameter)', NEWDENY, nurseA.client.rpc('request_priority_escalation', { p_queue_entry_id: eA1, p_reason: 'nurse_assessed_urgent', p_note: 'chest pain' }))
await check('escalation', 'what Reception can read about an escalation contains no free text', NEW, async () => {
  const r = await recA.client.from('queue_priority_escalations').select('*').eq('id', escId)
  const row = r.data?.[0] ?? {}
  const textCols = Object.entries(row).filter(([k, v]) => typeof v === 'string' && !['id', 'queue_entry_id', 'clinic_id', 'token', 'queue_date', 'requested_by', 'reason', 'status', 'created_at', 'resolved_by', 'resolved_at'].includes(k))
  return { outcome: !r.error && r.data.length === 1 && textCols.length === 0 && row.reason === 'nurse_assessed_urgent' ? 'allowed' : 'denied', detail: r.error ? why(r) : `columns=${Object.keys(row).join(',')}`.slice(0, 80) }
})
await check('escalation', 'a second open escalation for the same entry', NEWDENY, nurseA.client.rpc('request_priority_escalation', { p_queue_entry_id: eA3, p_reason: 'nurse_requests_early_review' }))
await check('escalation', 'escalation does not change the queue by itself', NEW, async () => ({ outcome: (await prio(eA3)) === 0 ? 'allowed' : 'denied', detail: 'priority still 0' }))
await check('escalation', 'clinic-B nurse escalates a clinic-A entry', DENY, nurseB.client.rpc('request_priority_escalation', { p_queue_entry_id: eA3, p_reason: 'nurse_assessed_urgent' }))
await check('escalation', 'receptionist calls request_priority_escalation', DENY, recA.client.rpc('request_priority_escalation', { p_queue_entry_id: eA3, p_reason: 'nurse_assessed_urgent' }))
await check('escalation', 'clinic-B reception cannot see it', DENY, recB.client.from('queue_priority_escalations').select('id').eq('queue_entry_id', eA3))
await check('escalation', 'reception accepts: nurse_escalation_accepted citing the escalation', NEW, async () => setp(recA.client, eA3, 1, { p_reason: 'nurse_escalation_accepted', p_escalation_id: escId }))
await check('escalation', 'escalation marked accepted by that receptionist', NEW, svc.from('queue_priority_escalations').select('id').eq('id', escId).eq('status', 'accepted').eq('resolved_by', recA.id))
await check('escalation', 'a resolved escalation cannot be re-opened or edited (even by the service role)', NEWDENY, svc.from('queue_priority_escalations').update({ status: 'open' }).eq('id', escId).select('id'))
await check('escalation', 'reception declines another escalation', NEW, async () => {
  const e = await nurseA.client.rpc('request_priority_escalation', { p_queue_entry_id: eA1, p_reason: 'nurse_requests_early_review' })
  if (e.error) return e
  return recA.client.rpc('decline_priority_escalation', { p_escalation_id: e.data.id })
})

// Audit retention (rev 5): history survives deletion of the queue entry and cannot be altered.
await check('retention', 'priority history survives deletion of the queue entry', NEW, async () => {
  const before = await svc.from('queue_priority_events').select('id').eq('queue_entry_id', eA2)
  const del = await svc.from('queue_entries').delete().eq('id', eA2).select('id')
  if (del.error) return { outcome: 'denied', detail: `delete failed: ${del.error.message}`.slice(0, 80) }
  const after = await svc.from('queue_priority_events').select('id, token').eq('queue_entry_id', eA2)
  const kept = (after.data ?? []).length
  return { outcome: kept > 0 && kept === (before.data ?? []).length && !!after.data[0].token ? 'allowed' : 'denied', detail: `events before=${(before.data ?? []).length} after=${kept}` }
})
await check('retention', 'escalation records survive deletion of the queue entry', NEW, async () => {
  const del = await svc.from('queue_entries').delete().eq('id', eA3).select('id')
  if (del.error) return { outcome: 'denied', detail: del.error.message.slice(0, 80) }
  const r = await svc.from('queue_priority_escalations').select('id').eq('queue_entry_id', eA3)
  return { outcome: (r.data ?? []).length >= 1 ? 'allowed' : 'denied', detail: `escalations=${(r.data ?? []).length}` }
})
await check('retention', 'priority history cannot be updated (append-only, even by the service role)', NEWDENY, svc.from('queue_priority_events').update({ reason: 'entered_in_error' }).eq('queue_entry_id', eA2).select('id'))
await check('retention', 'priority history cannot be deleted (even by the service role)', NEWDENY, svc.from('queue_priority_events').delete().eq('queue_entry_id', eA2).select('id'))
await check('retention', 'escalations cannot be deleted (even by the service role)', NEWDENY, svc.from('queue_priority_escalations').delete().eq('queue_entry_id', eA3).select('id'))
await check('audit', 'clinic-B reception cannot read clinic-A priority history', DENY, recB.client.from('queue_priority_events').select('id').eq('queue_entry_id', eA2))
await check('audit', 'nobody writes priority history directly', NEWDENY, recA.client.from('queue_priority_events').insert({ queue_entry_id: eA1, clinic_id: CLINIC_A, service_id: svcA, token: 'X', queue_date: '2026-10-12', old_priority: 0, new_priority: 1, reason: 'accessibility_need', changed_by: recA.id }).select('id'))
await check('audit', 'patient cannot read priority history', DENY, pat.client.from('queue_priority_events').select('id'))

const width = Math.max(...results.map((r) => r.name.length))
let lastArea = ''
for (const r of results) {
  if (r.area !== lastArea) { console.log(`\n[${r.area}]`); lastArea = r.area }
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  expected ${r.want.padEnd(7)} got ${r.got.padEnd(7)} ${r.detail}`)
}
const failed = results.filter((r) => !r.ok)
console.log(`\nPHASE=${PHASE}: ${results.length - failed.length}/${results.length} assertions hold${failed.length ? `, ${failed.length} FAILED` : ''}.`)
process.exit(failed.length ? 1 : 0)
