// Rollback cycle test — proves a rollback script is COMPLETE. LOCAL SUPABASE STACK ONLY.
//
//   snapshot S0 -> apply migration -> snapshot S1 (must differ from S0) -> apply rollback -> snapshot S2 (must equal S0)
//   -> re-apply migration -> snapshot S3 (must equal S1)
//
// The migration and rollback files are applied exactly as written. The snapshot is catalog_snapshot.sql (privileges,
// RLS flags, policies, functions with body fingerprints, triggers, schemas, enum types). A rollback that leaves any added
// object or privilege behind, or restores a different privilege set, shows up as a diff.
//
// Requirements for production use (docs/proposals/staged_migration_plan.md §6): run on a local stack whose catalog equals
// the production pre-deploy snapshot; data that the migrated code wrote (e.g. merged profiles, audit rows) is out of scope
// of a schema rollback and must be handled by an export step named in the rollback file.
//
//   PSQL_CMD="docker exec -i supabase_db_<project> psql -U postgres -At -F '|' -v ON_ERROR_STOP=1" \
//   node supabase/tests/clinical_records_access/rollback_cycle.mjs <migration.sql> <rollback.sql> [--expect-no-change-on-apply]
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const { PSQL_CMD } = process.env
if (!PSQL_CMD || !/(supabase_db_[a-z0-9_-]+\s|@(127\.0\.0\.1|localhost)[:/])/.test(PSQL_CMD)) throw new Error('Refusing: PSQL_CMD must target a local supabase_db_* container or localhost')
const [migration, rollback] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (!migration || !rollback) throw new Error('usage: rollback_cycle.mjs <migration.sql> <rollback.sql>')
const here = dirname(fileURLToPath(import.meta.url))
const run = (sql) => execSync(PSQL_CMD, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
const snapshotSql = readFileSync(join(here, 'catalog_snapshot.sql'), 'utf8')
const snapshot = () => run(snapshotSql).trim().split('\n').filter((l) => l && l !== 'BEGIN' && l !== 'ROLLBACK')
const apply = (file) => run(readFileSync(resolve(file), 'utf8'))
const diff = (a, b) => {
  const A = new Set(a); const B = new Set(b)
  return { removed: a.filter((x) => !B.has(x)), added: b.filter((x) => !A.has(x)) }
}
const show = (d) => [...d.removed.slice(0, 8).map((l) => `    - ${l.slice(0, 150)}`), ...d.added.slice(0, 8).map((l) => `    + ${l.slice(0, 150)}`)].join('\n')

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n${detail}` : ''}`) }

const s0 = snapshot()
apply(migration)
const s1 = snapshot()
const d01 = diff(s0, s1)
check(`apply changes the catalog (${d01.removed.length} facts removed, ${d01.added.length} added)`, d01.removed.length + d01.added.length > 0)
apply(rollback)
const s2 = snapshot()
const d02 = diff(s0, s2)
check(`rollback restores the original catalog exactly (${s0.length} facts compared)`, d02.removed.length + d02.added.length === 0, show(d02))
apply(migration)
const s3 = snapshot()
const d13 = diff(s1, s3)
check('re-applying after rollback reproduces the migrated catalog exactly', d13.removed.length + d13.added.length === 0, show(d13))

const failed = results.filter((r) => !r.ok)
console.log(`\nrollback cycle: ${results.length - failed.length}/${results.length} checks hold${failed.length ? `, ${failed.length} FAILED` : ''}. (Stack left in the migrated state.)`)
process.exit(failed.length ? 1 : 0)
