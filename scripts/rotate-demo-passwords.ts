// Rotates the passwords of the four demonstration accounts (patient, receptionist, nurse, admin) through the official
// Supabase Auth Admin API, and writes the new passwords to a LOCAL FILE OUTSIDE THE REPOSITORY — never to the
// terminal, a log, Git or chat.
//
// It is the owner's tool: it needs the project's service-role (secret) key, which only the project owner holds. The key
// is read from the environment, never from an argument, and is never printed.
//
//   DRY RUN (default; changes nothing, prints roles/emails/user ids only):
//     SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... E2E_PATIENT_EMAIL=... E2E_RECEPTIONIST_EMAIL=... \
//     E2E_NURSE_EMAIL=... E2E_ADMIN_EMAIL=...  npx tsx scripts/rotate-demo-passwords.ts --project-ref <ref>
//
//   APPLY:   ... npx tsx scripts/rotate-demo-passwords.ts --project-ref <ref> --apply --out <file outside the repo>
//   VERIFY:  ... npx tsx scripts/rotate-demo-passwords.ts --project-ref <ref> --verify --out <same file>
//            (signs each account in with its new password and signs out; prints OK/FAILED per role only)
//
// Safety interlocks:
//   * the four target users are matched by exact e-mail; each must match exactly ONE auth user whose profile role is the
//     expected one — if any of the four is ambiguous or missing, NOTHING is changed;
//   * --project-ref must equal the project in SUPABASE_URL (hosted) — you confirm which project you are about to change;
//   * the password file is written, flushed and re-read BEFORE any account is changed, refuses to overwrite, and refuses
//     a path inside a Git work tree;
//   * only the password is updated: e-mail, role, metadata, profile and application data are untouched;
//   * accounts are updated admin first, then nurse, receptionist, patient, and a failure stops the run.
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROLES = ['admin', 'nurse', 'receptionist', 'patient'] as const // rotation order: highest privilege first
type Role = (typeof ROLES)[number]
const MIN_LENGTH = 24

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(name)
function fail(message: string): never {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
const projectRef = arg('--project-ref')
const apply = flag('--apply')
const verify = flag('--verify')
const outPath = arg('--out')

if (!url) fail('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is not set')
if (apply && verify) fail('choose one of --apply or --verify')
const host = new URL(url).hostname
const isLocal = host === 'localhost' || host === '127.0.0.1'
if (!isLocal) {
  if (!projectRef) fail('--project-ref <ref> is required for a hosted project (confirm the project you intend to change)')
  if (host !== `${projectRef}.supabase.co`) fail(`--project-ref "${projectRef}" does not match SUPABASE_URL host "${host}"`)
}
if (!serviceKey && !verify) fail('SUPABASE_SERVICE_ROLE_KEY is not set (only the project owner holds it; it is never printed)')

const emails: Record<Role, string> = {
  admin: (process.env.E2E_ADMIN_EMAIL ?? '').trim(),
  nurse: (process.env.E2E_NURSE_EMAIL ?? '').trim(),
  receptionist: (process.env.E2E_RECEPTIONIST_EMAIL ?? '').trim(),
  patient: (process.env.E2E_PATIENT_EMAIL ?? '').trim(),
}
for (const r of ROLES) if (!emails[r]) fail(`E2E_${r.toUpperCase()}_EMAIL is not set`)
if (new Set(Object.values(emails).map((e) => e.toLowerCase())).size !== 4) fail('the four e-mail addresses must be distinct')

/** A path inside any Git work tree is refused: a password file must never be committable. */
function assertOutsideGit(path: string) {
  const dir = dirname(path)
  if (!existsSync(dir)) fail(`directory does not exist: ${dir}`)
  try {
    const top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (top) fail(`--out must be outside any Git work tree (inside ${top})`)
  } catch {
    /* not a git work tree — good */
  }
}

/** >= 24 characters from a CSPRNG, guaranteed to contain lower, upper, digit and a symbol (-, _) so any policy passes. */
function generatePassword(): string {
  for (;;) {
    const p = randomBytes(30).toString('base64url') // 40 characters
    if (p.length >= MIN_LENGTH && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p) && /[-_]/.test(p)) return p
  }
}

type Matched = { role: Role; id: string; email: string }

async function main() {
  if (verify) return runVerify()

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // 1. Identify exactly the four target users.
  const all: { id: string; email?: string }[] = []
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) fail(`Auth Admin API unavailable: ${error.message}`)
    all.push(...data.users)
    if (data.users.length < 200) break
  }
  const matched: Matched[] = []
  for (const role of ROLES) {
    const hits = all.filter((u) => (u.email ?? '').toLowerCase() === emails[role].toLowerCase())
    if (hits.length !== 1) fail(`${role}: expected exactly one auth user for the configured e-mail, found ${hits.length} — nothing was changed`)
    const { data: prof, error } = await admin.from('profiles').select('role').eq('auth_user_id', hits[0].id)
    if (error || !prof || prof.length !== 1) fail(`${role}: could not read exactly one profile — nothing was changed`)
    if (prof[0].role !== role) fail(`${role}: the profile role is "${prof[0].role}", not "${role}" — nothing was changed`)
    matched.push({ role, id: hits[0].id, email: emails[role] })
  }
  console.log('Target accounts (matched by exact e-mail, profile role confirmed):')
  for (const m of matched) console.log(`  ${m.role.padEnd(13)} ${m.email}  user id ${m.id}`)

  if (!apply) {
    console.log('\nDRY RUN: nothing was changed. Re-run with --apply --out <file outside the repository>.')
    return
  }

  // 2. The owner must be able to retrieve the passwords BEFORE anything changes.
  if (!outPath) fail('--out <file> is required with --apply')
  const file = resolve(outPath)
  assertOutsideGit(file)
  if (existsSync(file)) fail(`refusing to overwrite an existing file: ${file}`)
  const passwords = Object.fromEntries(ROLES.map((r) => [r, generatePassword()])) as Record<Role, string>
  const body =
    `# Smart Clinic demonstration accounts — NEW passwords. Move into the team password manager, then securely delete this file.\n` +
    matched.map((m) => `${m.role}\t${m.email}\t${passwords[m.role]}`).join('\n') +
    '\n'
  const fd = openSync(file, 'wx', 0o600)
  try {
    writeSync(fd, body)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  const reread = readFileSync(file, 'utf8')
  if (!ROLES.every((r) => reread.includes(passwords[r]))) fail(`the password file could not be re-read intact: ${file} (no account was changed)`)
  console.log(`\nNew passwords written to ${file} (not printed). Updating accounts, admin first...`)

  // 3. Rotate, highest privilege first; stop at the first failure.
  const status: string[] = []
  for (const m of matched) {
    const { data, error } = await admin.auth.admin.updateUserById(m.id, { password: passwords[m.role] })
    if (error || data.user?.id !== m.id) {
      console.error(`  ${m.role.padEnd(13)} FAILED: ${error?.message ?? 'unexpected response'}`)
      status.push(`${m.role}: FAILED`)
      for (const rest of matched.slice(matched.indexOf(m) + 1)) status.push(`${rest.role}: not attempted`)
      break
    }
    console.log(`  ${m.role.padEnd(13)} password updated`)
    status.push(`${m.role}: updated`)
  }
  console.log(`\nSummary: ${status.join(' · ')}`)
  console.log('Old passwords no longer work for updated accounts, and Supabase Auth ends their existing sessions (refresh tokens).')
  console.log('Access tokens already issued stay valid for direct API calls until they expire (the project JWT expiry setting) — see docs/proposals/credential_rotation_runbook.md.')
  if (status.some((s) => !s.endsWith('updated'))) process.exit(2)
}

async function runVerify() {
  if (!outPath) fail('--out <file> is required with --verify')
  const anon = (process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
  if (!anon) fail('SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) is not set')
  const lines = readFileSync(resolve(outPath), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
  let bad = 0
  for (const role of ROLES) {
    const row = lines.map((l) => l.split('\t')).find((c) => c[0] === role)
    if (!row) { console.log(`  ${role.padEnd(13)} FAILED (no entry in file)`); bad++; continue }
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error } = await client.auth.signInWithPassword({ email: row[1], password: row[2] })
    if (error) { console.log(`  ${role.padEnd(13)} FAILED (${error.message})`); bad++ } else { console.log(`  ${role.padEnd(13)} OK`); await client.auth.signOut() }
  }
  process.exit(bad ? 2 : 0)
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
