// Rotates the passwords of the SIX demonstration accounts — 1 admin, 3 nurses, 1 receptionist, 1 patient — through the
// official Supabase Auth Admin API, and writes the new passwords to a LOCAL FILE OUTSIDE THE REPOSITORY — never to the
// terminal, a log, Git or chat.
//
// It is the owner's tool: it needs the project's service-role (secret) key, which only the project owner holds. The key
// is read from the environment, never from an argument, and is never printed. Windows PowerShell steps:
// docs/proposals/credential_rotation_runbook.md.
//
//   Accounts (e-mail addresses come from the environment; every one must be a distinct, existing Auth user):
//     admin         E2E_ADMIN_EMAIL           expected profile role: admin
//     nurse         E2E_NURSE_EMAIL           nurse   (the primary nurse test account used by the E2E helpers)
//     nurse2, nurse3  E2E_NURSE2_EMAIL, E2E_NURSE3_EMAIL   nurse
//     receptionist  E2E_RECEPTIONIST_EMAIL    receptionist
//     patient       E2E_PATIENT_EMAIL         patient
//
//   DRY RUN (default; changes nothing; prints labels, e-mail addresses and user ids only):
//     npx tsx scripts/rotate-demo-passwords.ts --project-ref <ref>
//   APPLY:    ... --project-ref <ref> --apply  --out <new file outside the repo>
//   RESUME:   ... --project-ref <ref> --resume --out <the file from the interrupted --apply>
//   VERIFY:   ... --project-ref <ref> --verify --out <same file>   (signs each account in with its new password and out again)
//
// Safety interlocks:
//   * all six users are matched by exact e-mail BEFORE anything changes; each must be exactly one Auth user whose single
//     profile has the expected role, and the six user ids must be distinct. A duplicate configured e-mail, a missing
//     account, a role mismatch or an ambiguous/missing profile aborts the run with NOTHING changed;
//   * --project-ref must equal the project in SUPABASE_URL (hosted) — you confirm which project you are about to change;
//   * six unique passwords (CSPRNG, 40 characters) are written to the --out file, flushed and re-read BEFORE any account
//     is changed; the file is never overwritten and a path inside a Git work tree is refused;
//   * only the password is updated: e-mail, role, metadata, profile and application data are untouched;
//   * rotation order: admin, nurse, nurse2, nurse3, receptionist, patient. The first failure stops the run and the
//     summary names every account as updated / FAILED / not attempted. Accounts not yet updated keep their OLD password;
//     --resume re-applies the SAME file (idempotent) so the run can be finished without generating new passwords;
//   * output is limited to labels, e-mail addresses, user ids and status — never a password or a key.
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

type Role = 'admin' | 'nurse' | 'receptionist' | 'patient'
type Account = { label: string; role: Role; envVar: string }
// Rotation order: highest privilege first.
const ACCOUNTS: Account[] = [
  { label: 'admin', role: 'admin', envVar: 'E2E_ADMIN_EMAIL' },
  { label: 'nurse', role: 'nurse', envVar: 'E2E_NURSE_EMAIL' },
  { label: 'nurse2', role: 'nurse', envVar: 'E2E_NURSE2_EMAIL' },
  { label: 'nurse3', role: 'nurse', envVar: 'E2E_NURSE3_EMAIL' },
  { label: 'receptionist', role: 'receptionist', envVar: 'E2E_RECEPTIONIST_EMAIL' },
  { label: 'patient', role: 'patient', envVar: 'E2E_PATIENT_EMAIL' },
]
const MIN_LENGTH = 24
const pad = (s: string) => s.padEnd(13)

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(name)
/** Before any network use (argument and environment checks): print and exit. */
function fail(message: string): never {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}
/**
 * After network use: throw instead of calling process.exit(), which can end the process abnormally (exit status 127 on
 * Windows / Node 24) while HTTP sockets are still open. The top-level handler prints the message and sets the exit code.
 */
class Abort extends Error {}
function abort(message: string): never {
  throw new Abort(message)
}

const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
const projectRef = arg('--project-ref')
const apply = flag('--apply')
const resume = flag('--resume')
const verify = flag('--verify')
const outPath = arg('--out')

if (!url) fail('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is not set')
if ([apply, resume, verify].filter(Boolean).length > 1) fail('choose one of --apply, --resume or --verify')
const host = new URL(url).hostname
const isLocal = host === 'localhost' || host === '127.0.0.1'
if (!isLocal) {
  if (!projectRef) fail('--project-ref <ref> is required for a hosted project (confirm the project you intend to change)')
  if (host !== `${projectRef}.supabase.co`) fail(`--project-ref "${projectRef}" does not match SUPABASE_URL host "${host}"`)
}
if (!serviceKey && !verify) fail('SUPABASE_SERVICE_ROLE_KEY is not set (only the project owner holds it; it is never printed)')

const emails: Record<string, string> = {}
for (const a of ACCOUNTS) {
  emails[a.label] = (process.env[a.envVar] ?? '').trim()
  if (!emails[a.label]) fail(`${a.envVar} is not set`)
}
{
  const seen = new Map<string, string>()
  for (const a of ACCOUNTS) {
    const key = emails[a.label].toLowerCase()
    if (seen.has(key)) fail(`the e-mail addresses must be distinct: ${a.label} and ${seen.get(key)} are the same address`)
    seen.set(key, a.label)
  }
}

/** A path inside any Git work tree is refused: a password file must never be committable. */
function assertOutsideGit(path: string) {
  const dir = dirname(path)
  if (!existsSync(dir)) abort(`directory does not exist: ${dir}`)
  let top = ''
  try {
    top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    /* not a git work tree — good */
  }
  if (top) abort(`--out must be outside any Git work tree (inside ${top})`)
}

/** >= 24 characters from a CSPRNG, guaranteed to contain lower, upper, digit and a symbol (-, _) so any policy passes. */
function generatePassword(): string {
  for (;;) {
    const p = randomBytes(30).toString('base64url') // 40 characters
    if (p.length >= MIN_LENGTH && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p) && /[-_]/.test(p)) return p
  }
}

/** One password per account, all different. */
function generatePasswords(): Record<string, string> {
  const out: Record<string, string> = {}
  const used = new Set<string>()
  for (const a of ACCOUNTS) {
    let p = generatePassword()
    while (used.has(p)) p = generatePassword()
    used.add(p)
    out[a.label] = p
  }
  return out
}

function parsePasswordFile(file: string): Record<string, { email: string; password: string }> {
  const rows: Record<string, { email: string; password: string }> = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue
    const [label, email, password] = line.split('\t')
    if (label && email && password) rows[label] = { email, password }
  }
  return rows
}

type Matched = Account & { id: string; email: string }

async function main() {
  if (verify) return runVerify()

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // 1. Identify exactly the six target users — before anything is changed.
  const all: { id: string; email?: string }[] = []
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) abort(`Auth Admin API unavailable: ${error.message}`)
    all.push(...data.users)
    if (data.users.length < 200) break
  }
  const matched: Matched[] = []
  for (const a of ACCOUNTS) {
    const hits = all.filter((u) => (u.email ?? '').toLowerCase() === emails[a.label].toLowerCase())
    if (hits.length !== 1) abort(`${a.label}: expected exactly one auth user for ${a.envVar}, found ${hits.length} — nothing was changed`)
    const { data: prof, error } = await admin.from('profiles').select('role').eq('auth_user_id', hits[0].id)
    if (error || !prof || prof.length !== 1) abort(`${a.label}: could not read exactly one profile — nothing was changed`)
    if (prof[0].role !== a.role) abort(`${a.label}: the profile role is "${prof[0].role}", not "${a.role}" — nothing was changed`)
    matched.push({ ...a, id: hits[0].id, email: emails[a.label] })
  }
  if (new Set(matched.map((m) => m.id)).size !== matched.length) abort('two configured e-mail addresses resolve to the same user — nothing was changed')
  console.log(`Target accounts (${matched.length}; matched by exact e-mail, one profile each, profile role confirmed):`)
  for (const m of matched) console.log(`  ${pad(m.label)} ${m.role.padEnd(13)} ${m.email}  user id ${m.id}`)

  if (!apply && !resume) {
    console.log('\nDRY RUN: nothing was changed. Re-run with --apply --out <new file outside the repository>.')
    return
  }

  // 2. The owner must be able to retrieve the passwords BEFORE anything changes.
  if (!outPath) abort(`--out <file> is required with ${apply ? '--apply' : '--resume'}`)
  const file = resolve(outPath)
  assertOutsideGit(file)
  let passwords: Record<string, string>
  if (apply) {
    if (existsSync(file)) abort(`refusing to overwrite an existing file: ${file} (to finish an interrupted run use --resume)`)
    passwords = generatePasswords()
    const body =
      `# Smart Clinic demonstration accounts — NEW passwords (${matched.length}). Move into the team password manager, then securely delete this file.\n` +
      matched.map((m) => `${m.label}\t${m.email}\t${passwords[m.label]}`).join('\n') +
      '\n'
    const fd = openSync(file, 'wx', 0o600)
    try {
      writeSync(fd, body)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    const check = parsePasswordFile(file)
    if (!matched.every((m) => check[m.label]?.password === passwords[m.label] && check[m.label]?.email === m.email)) {
      abort(`the password file could not be re-read intact: ${file} (no account was changed)`)
    }
    console.log(`\nNew passwords written to ${file} (not printed). Updating accounts, admin first...`)
  } else {
    if (!existsSync(file)) abort(`--resume needs the password file from the interrupted run: ${file} does not exist`)
    const check = parsePasswordFile(file)
    for (const m of matched) {
      const row = check[m.label]
      if (!row) abort(`--resume: the file has no entry for ${m.label} — nothing was changed`)
      if (row.email.toLowerCase() !== m.email.toLowerCase()) abort(`--resume: the file entry for ${m.label} is for a different e-mail address — nothing was changed`)
      if (row.password.length < MIN_LENGTH) abort(`--resume: the file entry for ${m.label} is not a generated password — nothing was changed`)
    }
    if (new Set(matched.map((m) => check[m.label].password)).size !== matched.length) abort('--resume: the passwords in the file are not all different — nothing was changed')
    passwords = Object.fromEntries(matched.map((m) => [m.label, check[m.label].password]))
    console.log(`\nResuming with the passwords in ${file} (not printed). Re-applying to every account, admin first (idempotent)...`)
  }

  // 3. Rotate, highest privilege first; stop at the first failure.
  const status: string[] = []
  for (const [i, m] of matched.entries()) {
    // Test hook, honoured ONLY against a local stack: simulates a failure of one account to exercise partial-failure handling.
    const simulated = isLocal && process.env.ROTATE_TEST_FAIL_LABEL === m.label
    const { data, error } = simulated
      ? { data: { user: null }, error: { message: 'simulated failure (local test hook)' } }
      : await admin.auth.admin.updateUserById(m.id, { password: passwords[m.label] })
    if (error || data.user?.id !== m.id) {
      console.error(`  ${pad(m.label)} FAILED: ${error?.message ?? 'unexpected response'}`)
      status.push(`${m.label}: FAILED`)
      for (const rest of matched.slice(i + 1)) status.push(`${rest.label}: not attempted`)
      break
    }
    console.log(`  ${pad(m.label)} password updated`)
    status.push(`${m.label}: updated`)
  }
  console.log(`\nSummary: ${status.join(' · ')}`)
  const incomplete = status.some((s) => !s.endsWith('updated'))
  if (incomplete) {
    console.log('The run is INCOMPLETE. Accounts marked FAILED / not attempted still have their OLD password.')
    console.log('Fix the cause, then finish with the SAME file:  --resume --out <the same file>  (no new passwords are generated).')
  } else {
    console.log('Old passwords no longer work for updated accounts, and Supabase Auth ends their existing sessions (refresh tokens).')
    console.log('Access tokens already issued stay valid for direct API calls until they expire (the project JWT expiry setting) — see docs/proposals/credential_rotation_runbook.md.')
  }
  if (incomplete) process.exitCode = 2
}

async function runVerify() {
  if (!outPath) abort('--out <file> is required with --verify')
  const anon = (process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
  if (!anon) abort('SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) is not set')
  const rows = parsePasswordFile(resolve(outPath))
  let bad = 0
  for (const a of ACCOUNTS) {
    const row = rows[a.label]
    if (!row) { console.log(`  ${pad(a.label)} FAILED (no entry in file)`); bad++; continue }
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error } = await client.auth.signInWithPassword({ email: row.email, password: row.password })
    if (error) { console.log(`  ${pad(a.label)} ${row.email}  FAILED (${error.message})`); bad++ } else { console.log(`  ${pad(a.label)} ${row.email}  OK`); await client.auth.signOut() }
  }
  console.log(`\nVerify: ${ACCOUNTS.length - bad} of ${ACCOUNTS.length} accounts accept their new password.`)
  process.exitCode = bad ? 2 : 0
}

main().catch((e) => {
  console.error(`ERROR: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
