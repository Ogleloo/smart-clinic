// Concurrency check: 5 parallel check_in_patient calls against the same
// service must all succeed with distinct, consecutive tokens — the
// scenario 4b in verify.ts skips when the finite Thabo-only patient pool
// is exhausted. This targets the dedicated "ConcTest Patient N" fixture
// profiles instead, so it doesn't depend on how many real patients
// happen to be seeded.
// Run with (LOCAL stack + E2E_* environment variables): npx tsx scripts/check-4b.ts
import { createClient } from '@supabase/supabase-js'

import { assertLocalSupabaseUrl } from '../e2e/support/e2e-safety'

// Target and credentials come from the environment — nothing is committed (see docs/proposals/credential_rotation_runbook.md).
// This script WRITES (check-ins), so it only runs against a LOCAL Supabase stack, never the shared project.
function need(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set (credentials are held by the project owner in secure offline storage, never in this repository)`)
  return value
}
const URL = need('E2E_SUPABASE_URL')
const KEY = need('E2E_SUPABASE_ANON_KEY')
assertLocalSupabaseUrl(URL, 'This script (it writes data)')
const SERVICE_GC = '22222222-2222-2222-2222-222222222221'

async function signIn(email: string, password: string) {
  const client = createClient(URL, KEY)
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.user || !data.session) {
    throw new Error(`sign-in failed for ${email}: ${error?.message}`)
  }
  return client
}

async function main() {
  const grace = await signIn(need('E2E_RECEPTIONIST_EMAIL'), need('E2E_RECEPTIONIST_PASSWORD'))

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date())

  // Exclude anyone already in today's queue for this service — a repeat
  // check-in fails with "already in the queue", which isn't the
  // scenario under test here.
  const { data: alreadyIn, error: alreadyErr } = await grace
    .from('queue_entries')
    .select('patient_id')
    .eq('service_id', SERVICE_GC)
    .eq('queue_date', today)
  if (alreadyErr) throw alreadyErr
  const exclude = new Set((alreadyIn ?? []).map((r) => r.patient_id))

  // ADR-021: a receptionist can only SELECT patients who already have an
  // appointment or queue entry at their clinic — a freshly created
  // walk-in profile is correctly invisible to a plain `profiles` query
  // until it has clinic history. So this only finds *previously used*
  // ConcTest fixtures here; any top-up below captures its id straight
  // from create_walkin_patient's own return value instead of a
  // follow-up SELECT, which would just fail to find them for the same
  // reason.
  const { data: existing, error: patientsErr } = await grace
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'patient')
    .ilike('full_name', 'ConcTest%')
    .order('full_name')
    .limit(50)
  if (patientsErr) throw patientsErr

  const chosen = (existing ?? []).filter((p) => !exclude.has(p.id))

  let nextSuffix = 1 + (existing ?? []).length
  while (chosen.length < 5) {
    const name = `ConcTest Patient ${nextSuffix++}`
    const { data, error } = await grace.rpc('create_walkin_patient', { p_full_name: name })
    if (error) throw new Error(`create_walkin_patient(${name}) failed: ${error.message}`)
    console.log(`(topped up fixture pool: created ${data.full_name} — ${data.id})`)
    chosen.push({ id: data.id, full_name: data.full_name })
  }
  chosen.length = 5

  console.log('\nFiring 5 parallel check_in_patient calls for:')
  for (const p of chosen) console.log(`  - ${p.full_name} (${p.id})`)

  const results = await Promise.all(
    chosen.map((p) =>
      grace.rpc('check_in_patient', { p_service_id: SERVICE_GC, p_patient_id: p.id })
    )
  )

  const errors = results.filter((r) => r.error)
  if (errors.length > 0) {
    console.error(`\nFAIL: ${errors.length} of 5 calls errored:`)
    for (const r of errors) console.error(`  - ${r.error?.message}`)
    process.exit(1)
  }

  const tokens = results.map((r) => r.data!.token as string)
  const tokenNumbers = results.map((r) => r.data!.token_number as number)

  console.log('\nTokens returned:')
  tokens.forEach((t, i) => console.log(`  ${i + 1}. ${t}  (token_number=${tokenNumbers[i]})`))

  const distinctCount = new Set(tokens).size
  if (distinctCount !== tokens.length) {
    console.error(`\nFAIL: tokens are not all distinct — ${distinctCount} distinct of ${tokens.length}: ${tokens.join(', ')}`)
    process.exit(1)
  }

  const sorted = [...tokenNumbers].sort((a, b) => a - b)
  let consecutive = true
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) {
      consecutive = false
      break
    }
  }
  if (!consecutive) {
    console.error(`\nFAIL: token numbers are not consecutive: ${sorted.join(', ')}`)
    process.exit(1)
  }

  console.log(`\nPASS: 5/5 check-ins succeeded, tokens distinct and consecutive (${sorted.join(', ')}).`)
  process.exit(0)
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
