import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import {
  DESTRUCTIVE_SPECS,
  LIVE_HELPERS,
  OFFLINE_SPECS,
  READ_ONLY_RPCS,
  READ_ONLY_SPECS,
  SELF_GUARDED_SPECS,
  TEST_FILE_PATTERN,
  assertLocalSupabaseUrl,
  classifySpec,
  evaluateE2eSafety,
  isLocalOrigin,
  isMutatingSupabaseRequest,
  runnableSpecNames,
  sameLocalOrigin,
  specMatchPattern,
  specName,
  unclassifiedTestFiles,
} from './support/e2e-safety'
import { APPROVED_HELPER_CALLS, CLICK_ALLOW_BY_SPEC, auditReadOnlyHelpers, findMutationSubmissions } from './support/read-only-audit'
import { installReadOnlyGuard } from './support/safe-test'
import { buildConfig } from './support/playwright-config'
import { OFFLINE_SUPABASE_URL, loadNextEnvFiles, offlineServerEnv, parseEnvFile, planWebServer } from './support/web-server-plan'
import { PRODUCTION_PROJECT_REF } from './support/local-supabase-guard'
import { assertLocalStack, resetDemoState, setStaffIdleTimeoutMinutes } from './helpers'

/**
 * Safeguards that keep state-changing tests away from the shared (production) Supabase project. PURE: no browser, no
 * database, no network — a fetch spy proves the refusal tests send nothing. Rules: e2e/support/e2e-safety.ts.
 */

const E2E_DIR = join(process.cwd(), 'e2e')
/** Every file under e2e/ (any depth), relative to it, with forward slashes. */
function allFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allFiles(join(dir, e.name)) : [relative(E2E_DIR, join(dir, e.name)).replace(/\\/g, '/')]))
}
const everyFile = allFiles(E2E_DIR)
/** The top-level `*.spec.ts` files (what the classification lists name). */
const specFiles = readdirSync(E2E_DIR).filter((f) => f.endsWith('.spec.ts'))
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
const PROD_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`

/** A complete, valid destructive-mode environment against a local stack. */
const LOCAL_ENV = {
  E2E_ENABLE_DESTRUCTIVE: '1',
  LOCAL_SUPABASE_URL: 'http://127.0.0.1:54321',
  LOCAL_SUPABASE_ANON: 'local-anon-key',
  LOCAL_SUPABASE_SERVICE: 'local-service-key',
  E2E_BASE_URL: 'http://127.0.0.1:3100',
  E2E_SUPABASE_URL: 'http://127.0.0.1:54321',
  E2E_SUPABASE_ANON_KEY: 'local-anon-key',
}
const without = (env: Record<string, string>, ...names: string[]) => Object.fromEntries(Object.entries(env).filter(([k]) => !names.includes(k)))

/** The parent's environment minus everything that could steer a child run toward a backend, plus `extra`. */
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !/^(E2E_|LOCAL_SUPABASE|NEXT_PUBLIC_|SUPABASE_|DATABASE_URL)/.test(k)) env[k] = v
  }
  return { ...env, ...extra } as NodeJS.ProcessEnv
}

// ---------------------------------------------------------------------------------------------- classification
test.describe('spec classification (an unclassified spec fails closed)', () => {
  test('every spec file is classified exactly once', () => {
    const unclassified = specFiles.map(specName).filter((n) => classifySpec(n) === 'unclassified')
    expect(unclassified, 'classify these in e2e/support/e2e-safety.ts (until then they are treated as destructive)').toEqual([])
  })

  test('H1: nothing test-shaped exists anywhere under e2e/ (any depth, any extension Playwright recognises) except a classified top-level <name>.spec.ts', () => {
    expect(unclassifiedTestFiles(everyFile), 'move/rename these or classify them in e2e/support/e2e-safety.ts; the config will not run them').toEqual([])
    // sanity: the scan really sees test files, including the ones this suite is made of
    expect(everyFile.filter((f) => TEST_FILE_PATTERN.test(f)).length).toBeGreaterThan(20)
  })

  test('the lists name only specs that exist, and no spec is in two lists', () => {
    const names = new Set(specFiles.map(specName))
    for (const n of [...OFFLINE_SPECS, ...READ_ONLY_SPECS, ...SELF_GUARDED_SPECS, ...DESTRUCTIVE_SPECS]) expect(names.has(n), `${n} is listed but has no spec file`).toBe(true)
    const all = [...OFFLINE_SPECS, ...READ_ONLY_SPECS, ...SELF_GUARDED_SPECS, ...DESTRUCTIVE_SPECS]
    expect(new Set(all).size).toBe(all.length)
  })

  test('by default exactly the offline, read-only and self-guarded specs may run; with the opt-in the destructive ones join them, and nothing else does', () => {
    expect(runnableSpecNames(false).sort()).toEqual([...OFFLINE_SPECS, ...READ_ONLY_SPECS, ...SELF_GUARDED_SPECS].sort())
    expect(runnableSpecNames(true).sort()).toEqual([...OFFLINE_SPECS, ...READ_ONLY_SPECS, ...SELF_GUARDED_SPECS, ...DESTRUCTIVE_SPECS].sort())
    for (const n of DESTRUCTIVE_SPECS) expect(runnableSpecNames(false)).not.toContain(n)
  })

  test('a brand-new spec nobody classified can never match, in either mode', () => {
    expect(classifySpec('brand-new-feature')).toBe('unclassified')
    for (const destructive of [false, true]) {
      expect(specMatchPattern('/repo/e2e', destructive).test('/repo/e2e/brand-new-feature.spec.ts')).toBe(false)
    }
  })

  test('a spec listed in two classes is unclassified and therefore excluded from the allowlist in BOTH modes', () => {
    OFFLINE_SPECS.push('nurse-v2') // also a DESTRUCTIVE spec
    try {
      expect(classifySpec('nurse-v2')).toBe('unclassified')
      for (const destructive of [false, true]) {
        expect(runnableSpecNames(destructive)).not.toContain('nurse-v2')
        expect(specMatchPattern('/repo/e2e', destructive).test('/repo/e2e/nurse-v2.spec.ts')).toBe(false)
      }
    } finally {
      OFFLINE_SPECS.pop()
    }
    expect(classifySpec('nurse-v2')).toBe('destructive')
  })

  test('H1: the allowlist pattern matches ONLY <testDir>/<classified name>.spec.ts — not sub-folders, other extensions, other names or other directories', () => {
    for (const dir of ['/repo/e2e', 'C:\\repo\\e2e', 'C:/repo (1)/e2e.v2', '/a.b/e2e']) {
      const sep = dir.includes('\\') ? '\\' : '/'
      const at = (...parts: string[]) => [dir, ...parts].join(sep)
      const re = specMatchPattern(dir, false)
      for (const ok of ['admin-v2.spec.ts', 'e2e-safety.spec.ts', 'nurse-v3-skip.local.spec.ts']) expect(re.test(at(ok)), at(ok)).toBe(true)
      const bad: string[][] = [
        ['sub', 'admin-v2.spec.ts'], // a sub-folder
        ['support', 'admin-v2.spec.ts'],
        ['e2e', 'admin-v2.spec.ts'], // a folder that merely has the same name
        ['admin-v2.test.ts'], // Playwright's other default test-file spelling
        ['admin-v2.spec.tsx'],
        ['admin-v2.spec.js'],
        ['admin-v2.spec.mjs'],
        ['admin-v2.spec.cts'],
        ['admin-v2.spec.ts.bak'],
        ['Admin-V2.spec.ts'], // case-sensitive on purpose
        ['xadmin-v2.spec.ts'],
        ['admin-v2.spec.ts', 'x'],
        ['nurse-v2.spec.ts'], // destructive: not on the default allowlist
        ['brand-new-feature.spec.ts'], // unclassified
        ['brand-new-feature.test.tsx'],
      ]
      for (const b of bad) expect(re.test(at(...b)), at(...b)).toBe(false)
      expect(re.test(`${sep}other${sep}${at('admin-v2.spec.ts')}`)).toBe(false) // same tail under a different directory
      // with the opt-in the destructive specs join the list; unclassified and mis-shaped files still do not
      const all = specMatchPattern(dir, true)
      expect(all.test(at('nurse-v2.spec.ts'))).toBe(true)
      expect(all.test(at('sub', 'nurse-v2.spec.ts'))).toBe(false)
      expect(all.test(at('brand-new-feature.spec.ts'))).toBe(false)
    }
  })

  test('unclassifiedTestFiles reports every test-shaped file that is not a classified top-level spec', () => {
    expect(
      unclassifiedTestFiles([
        'admin-v2.spec.ts', // fine
        'helpers.ts', // not test-shaped
        'support/e2e-safety.ts',
        'new.spec.ts', // unclassified
        'sub/admin-v2.spec.ts', // sub-folder
        'admin-v2.test.ts',
        'admin-v2.spec.tsx',
        'x.spec.mjs',
        'sub\\deep\\y.test.cjs', // a Windows-style path
      ])
    ).toEqual(['new.spec.ts', 'sub/admin-v2.spec.ts', 'admin-v2.test.ts', 'admin-v2.spec.tsx', 'x.spec.mjs', 'sub/deep/y.test.cjs'])
  })

  test('a spec listed twice is unclassified, not silently safe', () => {
    expect(classifySpec('nurse-v2')).toBe('destructive')
    expect(classifySpec('e2e-safety')).toBe('offline')
    expect(classifySpec('reception-queue')).toBe('read-only')
    expect(classifySpec('reception-queue-actions')).toBe('destructive')
    expect(classifySpec('nurse-v3-skip.local')).toBe('self-guarded')
  })
})

// ---------------------------------------------------------------------------------------------- static audit
test.describe('static audit of the suite (writes cannot hide in a "safe" spec)', () => {
  const sourceOf = (n: string) => read(`e2e/${n}.spec.ts`)
  const DESTRUCTIVE_HELPERS = /\b(resetDemoState|setStaffIdleTimeoutMinutes|createTestClient)\b/

  test('any spec using a destructive helper or a direct Supabase client is classified destructive', () => {
    for (const f of specFiles) {
      const n = specName(f)
      if (n === 'e2e-safety') continue
      const src = sourceOf(n)
      if (DESTRUCTIVE_HELPERS.test(src.replace(/^\s*(\/\/|\*).*$/gm, '')) || /\bcreateClient\s*\(/.test(src)) {
        expect(['destructive', 'self-guarded'], `${n} uses a destructive helper or its own Supabase client`).toContain(classifySpec(n))
      }
    }
  })

  test('OFFLINE specs use no live helper, no sign-in and no Supabase client', () => {
    for (const n of OFFLINE_SPECS.filter((s) => s !== 'e2e-safety')) {
      const code = sourceOf(n).replace(/^\s*(\/\/|\*).*$/gm, '')
      expect(LIVE_HELPERS.test(code), `${n} references a live helper (ACCOUNTS / loginAs / ...)`).toBe(false)
      expect(/from '\.\/helpers'/.test(code), `${n} imports ./helpers`).toBe(false)
      expect(/\bcreateClient\s*\(/.test(code), `${n} creates a Supabase client`).toBe(false)
    }
  })

  test('READ-ONLY specs never submit anything: only allowlisted clicks and keys, read-only evaluate(), no Server Action handling, no forged requests, no unguarded way to reach a server', () => {
    for (const n of READ_ONLY_SPECS) {
      expect(findMutationSubmissions(sourceOf(n), { spec: n }), `${n} does something the read-only policy does not permit (e2e/support/read-only-audit.ts) — move it to a destructive spec`).toEqual([])
    }
  })

  test('the sign-in/booking helpers a read-only spec may import are themselves audited, with only the reviewed exemptions', () => {
    expect(auditReadOnlyHelpers(read('e2e/helpers.ts'))).toEqual([])
  })

  test('read-only specs import no helper beyond the audited sign-in/booking ones', () => {
    for (const n of READ_ONLY_SPECS) {
      const m = /import\s*\{([^}]*)\}\s*from\s*'\.\/helpers'/.exec(sourceOf(n))
      const names = (m?.[1] ?? '').split(',').map((s) => s.trim().replace(/\s+as\s+.*/, '')).filter(Boolean)
      for (const name of names) expect(['ACCOUNTS', 'loginAs', 'waitSettled', 'chooseBookingService', 'pickBookingDate'], `${n} imports ${name} from ./helpers`).toContain(name)
    }
  })

  test('every per-spec click allowlist entry belongs to a read-only spec that exists (no stale permission)', () => {
    for (const n of Object.keys(CLICK_ALLOW_BY_SPEC)) expect(READ_ONLY_SPECS, `${n} has click permissions but is not a read-only spec`).toContain(n)
  })

  test('every exempted helper statement still exists verbatim in helpers.ts (no stale exemption)', () => {
    const src = read('e2e/helpers.ts').replace(/\s+/g, ' ')
    for (const stmt of APPROVED_HELPER_CALLS) expect(src, `exemption no longer matches helpers.ts: ${stmt}`).toContain(stmt)
  })

  test('READ-ONLY specs run on the read-only guarded test and use only sign-in helpers', () => {
    for (const n of READ_ONLY_SPECS) {
      const src = sourceOf(n)
      expect(src, `${n} must import test from ./support/safe-test`).toContain("from './support/safe-test'")
      expect(/import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*'@playwright\/test'/.test(src), `${n} imports test straight from @playwright/test`).toBe(false)
      const code = src.replace(/^\s*(\/\/|\*).*$/gm, '')
      expect(DESTRUCTIVE_HELPERS.test(code), `${n} uses a destructive helper`).toBe(false)
      expect(/\bcreateClient\s*\(/.test(code), `${n} creates a Supabase client`).toBe(false)
    }
  })

  test('the specs the review flagged were SPLIT: their submissions now live in destructive specs and are detected there', () => {
    for (const n of ['reception-queue-actions', 'reception-profile-actions']) {
      expect(classifySpec(n)).toBe('destructive')
      expect(findMutationSubmissions(sourceOf(n)).length, `${n} should contain the submissions that were moved out`).toBeGreaterThan(0)
    }
    const queueActions = sourceOf('reception-queue-actions')
    expect(queueActions).toContain('forgeSkipId')
    expect(queueActions).toMatch(/double submit/)
    expect(sourceOf('reception-profile-actions')).toMatch(/Update password/)
    // …and are gone from the read-only specs.
    expect(sourceOf('reception-queue')).not.toMatch(/forgeSkipId|NONEXISTENT_ID|next-action/)
    expect(sourceOf('reception-profile')).not.toMatch(/Update password'|rejects .* with a clear message|next-action/)
  })

  test('destructive specs run on the guarded test and open only guarded contexts', () => {
    for (const n of DESTRUCTIVE_SPECS) {
      const src = sourceOf(n)
      expect(src, `${n} must import test from ./support/guarded-test`).toContain("from './support/guarded-test'")
      expect(/import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*'@playwright\/test'/.test(src), `${n} imports test straight from @playwright/test`).toBe(false)
      expect(src.includes('browser.newContext('), `${n} opens an unguarded browser context`).toBe(false)
    }
  })

  test('no credential literal and no production project reference in the helpers, scripts or config', () => {
    const files = ['e2e/helpers.ts', 'scripts/verify.ts', 'scripts/check-4b.ts', 'playwright.config.ts', 'e2e/support/e2e-safety.ts', 'e2e/support/destructive-global-setup.ts', 'e2e/support/guarded-test.ts']
    for (const f of files) {
      const src = read(f)
      expect(src.includes(PRODUCTION_PROJECT_REF), `${f} names the production project`).toBe(false)
      expect(/password\s*:\s*['"`][^'"`$]{4,}['"`]/i.test(src), `${f} has a literal password`).toBe(false)
      expect(/signIn\(\s*['"`][^'"`]+['"`]\s*,\s*['"`]/.test(src), `${f} signs in with literals`).toBe(false)
      expect(/sb_publishable_|sb_secret_|eyJ[A-Za-z0-9_-]{20,}/.test(src), `${f} embeds a key`).toBe(false)
    }
  })

  test('the write-capable scripts refuse a non-local target through the shared guard', () => {
    for (const f of ['scripts/verify.ts', 'scripts/check-4b.ts']) expect(read(f)).toContain("assertLocalSupabaseUrl(URL,")
  })
})

// ---------------------------------------------------------------------------------------------- read-only enforcement
test.describe('findMutationSubmissions: what a read-only spec may never contain (regression fixtures)', () => {
  const benign = `
    await loginAs(page, ACCOUNTS.nurse.email, ACCOUNTS.nurse.password)
    await page.goto('/nurse/queue')
    await expect(page.getByRole('heading', { name: 'My Queue' })).toBeVisible()
    await expect(actionsCell.getByRole('button', { name: 'Skip' })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
    await page.getByRole('button', { name: 'Sign Out' }).click()
    await page.getByRole('button', { name: 'Log out' }).click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('button', { name: 'Change Password' }).click()
    await page.getByRole('link', { name: 'Assign a nurse' }).click()
    // await page.getByRole('button', { name: 'Skip' }).click()   <- a comment is not code
  `
  test('a benign read-only snippet is clean (assertions on mutating controls, sign-out, panel toggles and links are fine)', () => {
    expect(findMutationSubmissions(benign, { spec: 'reception-profile' })).toEqual([])
  })

  test('the same clicks are NOT clean in a spec that has not been granted them (allowlists are per spec)', () => {
    const f = findMutationSubmissions(`await page.getByRole('button', { name: 'Cancel' }).click()`, { spec: 'logout' })
    expect(f.length).toBe(1)
    expect(findMutationSubmissions(`await page.getByRole('button', { name: 'Cancel' }).click()`)).not.toEqual([])
  })

  const offending: Array<[string, string]> = [
    ['clicking Skip', `await page.getByRole('button', { name: 'Skip' }).first().click()`],
    ['pressing Skip via nth()', `await rows.nth(0).getByRole('button', { name: 'Skip' }).nth(0).press('Enter')`],
    ['holding the Skip confirm button', `const confirm = dialog.getByRole('button', { name: /Skip patient|Please wait/i })`],
    ['clicking Save Changes', `await page.getByRole('button', { name: 'Save Changes' }).click()`],
    ['clicking Update password', `await panel.getByRole('button', { name: 'Update password' }).click()`],
    ['clicking a regex-named booking button', `await page.getByRole('button', { name: /Confirm booking/ }).click()`],
    ['calling the next patient', `await page.getByRole('button', { name: /Next patient|Call next patient/ }).click()`],
    ['tracking Server Action POSTs', `if (req.method() === 'POST' && req.headers()['next-action']) posts.push(req.url())`],
    ['forging a queue id', `const actionPosts = await forgeSkipId(page, 3000)`],
    ['rewriting post data', `await route.continue({ postData: forged })`],
    ['same-tick double submit', `await confirm.evaluate((el) => { const b = el as HTMLButtonElement; b.click(); b.click() })`],
    ['typing a password', `await panel.getByLabel('Current password').fill('whatever-current')`],
    ['clicking a submit selector', `await page.click('button[type="submit"]')`],
    ['submitting a form programmatically', `await form.evaluate((f) => f.requestSubmit())`],
  ]
  for (const [label, snippet] of offending) {
    test(`flags: ${label}`, () => {
      expect(findMutationSubmissions(snippet).length, snippet).toBeGreaterThan(0)
    })
  }

  test('the exact constructs the review flagged are caught', () => {
    // reception-queue.spec.ts at f9949e5: forged ids through the real Skip action, repeatedly.
    const queue = `
      const actionPosts = await forgeSkipId(page)
      await skipButton.click()
      const dialog = page.getByRole('dialog', { name: 'Skip patient' })
      await dialog.getByRole('button', { name: /Skip patient/i }).click()
      expect(actionPosts.aborted).toEqual([])
      await confirm.evaluate((el) => { const button = el as HTMLButtonElement; button.click(); button.click(); button.click() })`
    expect(findMutationSubmissions(queue).length).toBeGreaterThanOrEqual(3)
    // reception-profile.spec.ts at f9949e5: deliberately invalid profile / password submissions.
    const profile = `
      await page.locator('#full_name').fill('A')
      await page.getByRole('button', { name: 'Save Changes' }).click()
      await panel.getByLabel('New password', { exact: true }).fill('short')
      await panel.getByRole('button', { name: 'Update password' }).click()`
    expect(findMutationSubmissions(profile).length).toBeGreaterThanOrEqual(2)
  })

  /**
   * H2 regression table: every construct the independent review used to get past the old keyword detector (27 of 35 realistic
   * snippets slipped through), plus the same family. Each MUST now be flagged. The old detector only knew a list of labels.
   */
  const bypasses: Array<[string, string]> = [
    // unlisted button labels — the old detector only knew Skip/Save/Confirm/…
    ['unlisted verb: Complete', `await page.getByRole('button', { name: 'Complete consultation' }).click()`],
    ['unlisted verb: Add', `await page.getByRole('button', { name: 'Add service' }).click()`],
    ['unlisted verb: Activate', `await page.getByRole('button', { name: 'Activate' }).click()`],
    ['unlisted verb: Assign', `await page.getByRole('button', { name: 'Assign nurse' }).click()`],
    ['unlisted verb: Start consult', `await page.getByRole('button', { name: 'Start consult' }).click()`],
    ['unlisted verb: Accept', `await page.getByRole('button', { name: 'Accept' }).click()`],
    ['unlisted verb: Close', `await page.getByRole('button', { name: 'Close consultation' }).click()`],
    ['a harmless-sounding label is still denied unless allowlisted', `await page.getByRole('button', { name: 'Continue' }).click()`],
    // clicks that do not go through getByRole('button', { name })
    ['getByText click', `await page.getByText('Skip').click()`],
    ['css has-text click', `await page.locator('button:has-text("Skip")').click()`],
    ['page.click with a text selector', `await page.click('text=Save Changes')`],
    ['button with filter(hasText) and no name', `await page.getByRole('button').filter({ hasText: 'Skip' }).click()`],
    ['getByLabel click', `await page.getByLabel('Save').click()`],
    ['getByTestId click', `await page.getByTestId('confirm-skip').click()`],
    ['getByRole checkbox/switch click', `await page.getByRole('switch', { name: 'On duty' }).click()`],
    ['a link named like a write', `await page.getByRole('link', { name: 'Skip patient' }).click()`],
    ['click on an element handle', `const h = await page.$('button.skip'); await h!.click()`],
    ['chained locator then unlisted click', `await page.locator('table').locator('tr').first().getByRole('button', { name: 'Skip' }).click()`],
    ['chained via filter', `await page.getByRole('row').filter({ hasText: 'GC-1' }).getByRole('button', { name: /skip/i }).click()`],
    ['multi-line chained call', `await page\n  .getByRole('button', {\n    name: 'Save Changes',\n  })\n  .click()`],
    ['.or() makes the target ambiguous', `await page.getByRole('button', { name: 'Sign Out' }).or(page.getByRole('button', { name: 'Skip' })).click()`],
    ['dblclick / tap', `await page.getByRole('button', { name: 'Skip' }).dblclick(); await page.getByRole('button', { name: 'Skip' }).tap()`],
    // names the old regex could not read
    ['name from a variable', `const NAME = 'Skip'; await page.getByRole('button', { name: NAME }).click()`],
    ['name from a template literal', 'await page.getByRole(\'button\', { name: `Skip ${tok}` }).click()'],
    ['name built by concatenation', `await page.getByRole('button', { name: 'Sk' + 'ip' }).click()`],
    ['role from a variable', `await page.getByRole(role, { name: 'Sign Out' }).click()`],
    ['a stored locator used later', `const b = page.getByRole('button', { name: 'Delete' }); await b.click()`],
    ['a locator parameter clicked inside a helper', `async function go(btn) { await btn.click() }`],
    ['a loop variable clicked', `for (const b of await page.getByRole('button').all()) await b.click()`],
    ['a variable reassigned elsewhere', `let b = page.getByRole('button', { name: 'Sign Out' }); b = page.getByRole('button', { name: 'Skip' }); await b.click()`],
    // submission without a click
    ['Enter key submits the focused form', `await page.locator('#phone').fill('082'); await page.keyboard.press('Enter')`],
    ['locator.press Enter', `await page.locator('#full_name').press('Enter')`],
    ['locator.press with a non-literal key', `await page.locator('#x').press(key)`],
    ['Space activates a focused button', `await page.keyboard.press('Space')`],
    ['typing "\\n" key by key', `await page.keyboard.type('x\\n')`],
    ['dispatch a submit event', `await form.dispatchEvent('submit')`],
    ['submit() call', `await form.evaluate((f) => (f as HTMLFormElement).submit())`],
    ['evaluate that clicks', `await page.evaluate(() => document.querySelector('button')!.click())`],
    ['evaluate that assigns a property', `await page.evaluate(() => { document.body.innerHTML = 'x' })`],
    ['evaluate that fetches', `await page.evaluate(() => fetch('/reception/queue', { method: 'POST' }))`],
    ['waitForFunction that clicks', `await page.waitForFunction(() => { document.querySelector('button')?.click(); return true })`],
    ['evaluate with a non-inline callback', `await page.evaluate(fnDefinedElsewhere)`],
    ['selectOption / check / setInputFiles', `await page.locator('#s').selectOption('x'); await page.locator('#c').check(); await page.locator('#f').setInputFiles('a.png')`],
    // reaching a server another way
    ['APIRequestContext POST to Supabase', `await request.post('http://127.0.0.1:54321/rest/v1/queue_entries', { data: {} })`],
    ['page.request.post to the app', `await page.request.post('/nurse', { headers: { 'next-action': 'x' } })`],
    ['context.request', `await page.context().request.post('/x')`],
    ['the request fixture', `test('x', async ({ page, request }) => { await request.get('/') })`],
    ['the browser fixture', `test('x', async ({ browser }) => { const c = await browser.newContext() })`],
    ['playwright.request.newContext', `const r = await playwright.request.newContext()`],
    ['fresh context via browser.newContext', `const ctx = await browser.newContext(); const p = await ctx.newPage()`],
    ['importing chromium to launch an unguarded browser', `import { chromium } from '@playwright/test'`],
    ['in-page fetch to the app', `await page.evaluate(() => fetch('/reception/queue', { method: 'POST' }))`],
    ['XMLHttpRequest', `const x = new XMLHttpRequest()`],
    ['page.route that continues (bypasses the context guard)', `await page.route('**/*', (route) => route.continue())`],
    ['context.route', `await context.route('**/*', (r) => r.continue())`],
    ['page.route with a named handler (no continue/fulfill in sight)', `await page.route('**/*', handler)`],
    ['context.route with a named handler', `await context.route(/rest\\/v1/, handler)`],
    ['page.route through a variable', `const r = page.route; await r.call(page, '**/*', handler)`],
    ['routeFromHAR / addInitScript / exposeFunction', `await page.routeFromHAR('x.har'); await page.addInitScript(() => {}); await page.exposeFunction('f', () => 1)`],
    ['extra headers', `await page.setExtraHTTPHeaders({ 'next-action': 'x' })`],
    ['mouse click', `await page.mouse.click(10, 10)`],
    ['dialog.accept()', `page.on('dialog', (d) => d.accept())`],
    ['dynamic import', `const m = await import('./helpers')`],
    ['require', `const fs = require('node:fs')`],
    // text/trace of Server Actions and forging
    ['tracking Server Action POSTs', `if (req.method() === 'POST' && req.headers()['next-action']) posts.push(req.url())`],
    ['a Server Action id in a string', `const id = 'next-action'`],
    // imports
    ['importing from a non-allowlisted module', `import { execSync } from 'node:child_process'`],
    ['importing app route code', `import { skipPatient } from '../app/actions/reception'`],
    ['importing a destructive helper', `import { resetDemoState } from './helpers'`],
    ['importing test straight from playwright', `import { test } from '@playwright/test'`],
    ['re-exporting', `export * from './helpers'`],
    ['unparseable source', `await page.getByRole('button', { name: 'Skip' }`],
  ]
  for (const [label, snippet] of bypasses) {
    test(`H2 bypass is flagged: ${label}`, () => {
      expect(findMutationSubmissions(snippet, { spec: 'reception-profile' }).length, snippet).toBeGreaterThan(0)
    })
  }

  test('comments and string contents do not hide or fake code', () => {
    // a same-line block comment used to blank the whole line
    expect(findMutationSubmissions(`/* ok */ await page.getByRole('button', { name: 'Skip' }).click()`).length).toBeGreaterThan(0)
    expect(findMutationSubmissions(`await page.getByRole('button', { name: 'Skip' }).click() // sign out`).length).toBeGreaterThan(0)
    expect(findMutationSubmissions(`/* await page.getByRole('button', { name: 'Skip' }).click() */\n// page.request.post('/x')\nawait page.goto('/x')`)).toEqual([])
    expect(findMutationSubmissions(`const text = "page.request.post() and .click() are only words here"`)).toEqual([])
  })

  const legitimate: Array<[string, string, string?]> = [
    ['signing out, both spellings, through any chain', `await page.getByRole('navigation', { name: 'Main' }).first().getByRole('button', { name: 'Sign Out' }).last().click(); await page.getByRole('button', { name: /^Log out$/ }).click()`],
    ['a stored Sign Out button clicked twice (the logout double-submit test)', `const button = page.getByRole('button', { name: 'Sign Out' }); await Promise.all([button.click(), button.click({ force: true }).catch(() => {})])`],
    ['links: navigation', `await page.getByRole('link', { name: 'My Queue' }).click(); const l = page.getByRole('link', { name: /open Profile Settings/i }).first(); await l.click()`],
    ['a link through a locator chain', `await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Profile Settings' }).click()`],
    ['navigation keys', `await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Escape'); await page.locator('a').first().press('ArrowDown')`],
    ['filling a non-password field', `await page.locator('#full_name').fill('Noluthando Dlamini'); await page.locator('#phone').fill('082 000 0000')`],
    ['asserting on mutation-capable controls', `await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled(); await expect(page.getByRole('button', { name: /Skip/ })).toHaveCount(1)`],
    ['read-only evaluate callbacks', `const w = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); const keys = await form.evaluate((f) => [...new FormData(f as HTMLFormElement).keys()].filter((k) => !k.startsWith('$ACTION'))); const s = await link.evaluate((el) => getComputedStyle(el).boxShadow); const u = await page.evaluate(() => [...document.querySelectorAll('a, button')].filter((el) => (el as HTMLElement).offsetParent !== null).map((el) => el.textContent?.trim()))`],
    ['waiting for the page to settle', `await page.waitForFunction(() => !document.body.innerText.includes('Please wait'), { timeout: 30_000 }); await page.waitForTimeout(300)`],
    ['observing (not intercepting) requests', `page.on('request', (req) => { if (req.method() === 'POST') seen.push(req.url()) }); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })`],
    ['navigation and reading', `await page.goto('/nurse'); await expect(page).toHaveURL(/\\/nurse/); await page.reload(); await page.setViewportSize({ width: 390, height: 800 })`],
    ['type-only imports and the audited imports', `import type { Page } from '@playwright/test'\nimport { expect as baseExpect } from '@playwright/test'\nimport { test, expect } from './support/safe-test'\nimport { observeServerActions } from './support/observe-actions'\nimport { ACCOUNTS, loginAs as rawLoginAs } from './helpers'\nimport { todayInClinicTimezone } from '../lib/clinicTime'`],
  ]
  for (const [label, snippet] of legitimate) {
    test(`stays allowed: ${label}`, () => {
      expect(findMutationSubmissions(snippet, { spec: 'logout' }), snippet).toEqual([])
    })
  }

  test('each per-spec click permission is exactly what the spec was granted, and nothing leaks to other specs', () => {
    const cases: Array<[string, string, string]> = [
      ['admin-v2', `await page.getByRole('button', { name: /Show reasons/ }).click()`, 'ok'],
      ['reception-profile', `await page.getByRole('button', { name: 'Change Password' }).click()`, 'ok'],
      ['reception-queue', `await page.locator('button[aria-pressed]').first().click(); await page.getByRole('button', { name: 'All services' }).click()`, 'ok'],
      ['logout', `await page.getByRole('button', { name: /Show reasons/ }).click()`, 'denied'],
      ['reception-queue', `await page.locator('button[aria-pressed="true"]').click()`, 'denied'],
      ['reception-queue', `await page.locator('button').click()`, 'denied'],
      ['admin-v2', `await page.getByRole('button', { name: 'Show reasons and delete' }).click()`, 'denied'],
    ]
    for (const [spec, code, want] of cases) expect(findMutationSubmissions(code, { spec }).length === 0 ? 'ok' : 'denied', `${spec}: ${code}`).toBe(want)
  })

  test('the helper audit rejects a helper that grows a new interaction, or loses its exemption', () => {
    const helpers = read('e2e/helpers.ts')
    expect(auditReadOnlyHelpers(helpers)).toEqual([])
    // loginAs clicking something other than the sign-in submit
    const tampered = helpers.replace(`await page.click('button[type="submit"]')`, `await page.click('button[type="submit"]')\n  await page.getByRole('button', { name: 'Skip' }).click()`)
    expect(tampered).not.toBe(helpers)
    expect(auditReadOnlyHelpers(tampered).join('\n')).toContain('loginAs')
    // the sign-in submit with a changed selector is no longer the reviewed statement
    expect(auditReadOnlyHelpers(helpers.replace(`page.click('button[type="submit"]')`, `page.click('button.save')`)).length).toBeGreaterThan(0)
    // a helper that disappears
    expect(auditReadOnlyHelpers(helpers.replace('export async function waitSettled', 'export async function waitSettledX')).join('\n')).toContain('waitSettled is on the read-only helper list')
    // a fetch smuggled into a booking helper
    expect(auditReadOnlyHelpers(helpers.replace(`await page.goto('/book')`, `await page.goto('/book'); await fetch('/x', { method: 'POST' })`)).length).toBeGreaterThan(0)
  })
})

test.describe('isMutatingSupabaseRequest: the browser-level classifier', () => {
  const base = 'http://127.0.0.1:54321'
  const allowed: Array<[string, string]> = [
    ['GET', `${base}/rest/v1/queue_entries?select=*`],
    ['HEAD', `${base}/rest/v1/profiles`],
    ['OPTIONS', `${base}/rest/v1/profiles`],
    ['POST', `${base}/auth/v1/token?grant_type=password`],
    ['POST', `${base}/auth/v1/logout`],
    ['POST', `${base}/rest/v1/rpc/get_service_queue`],
    ['POST', `${base}/rest/v1/rpc/get_wait_estimate`],
    ['POST', `${base}/rest/v1/rpc/get_available_slots`],
    ['POST', `${base}/rest/v1/rpc/service_consultation_stats`],
    ['GET', `${base}/graphql/v1?query=%7Bx%7D`], // a read-only GraphQL request; every non-GET one is blocked below
    ['GET', `${base}/rest/v1/rpc/anything_at_all`], // PostgREST refuses GET on a volatile (writing) function
    ['POST', 'http://127.0.0.1:3000/login'],
    ['PATCH', 'http://127.0.0.1:3000/api/anything-not-supabase'],
  ]
  for (const [m, u] of allowed) test(`allows ${m} ${u.replace(base, '')}`, () => expect(isMutatingSupabaseRequest(m, u)).toBe(false))

  const blocked: Array<[string, string]> = [
    ['PATCH', `${base}/rest/v1/profiles?id=eq.1`],
    ['PUT', `${base}/rest/v1/profiles`],
    ['DELETE', `${base}/rest/v1/queue_entries?id=eq.1`],
    ['POST', `${base}/rest/v1/queue_entries`],
    ['POST', `${base}/rest/v1/rpc/check_in_patient`],
    ['POST', `${base}/rest/v1/rpc/next_patient`],
    ['POST', `${base}/rest/v1/rpc/skip_waiting_patient`],
    ['POST', `${base}/rest/v1/rpc/set_emergency_priority`],
    ['POST', `${base}/rest/v1/rpc/book_appointment`],
    ['POST', `${base}/rest/v1/rpc/admin_set_staff_status`],
    ['POST', `${base}/rest/v1/rpc/merge_patient_profiles`],
    ['POST', `${base}/rest/v1/rpc/mark_notifications_read`],
    ['PUT', `${base}/auth/v1/user`],
    ['POST', `${base}/auth/v1/signup`],
    ['POST', `${base}/auth/v1/recover`],
    ['POST', `${base}/storage/v1/object/avatars/x.png`],
    ['POST', `${base}/functions/v1/anything`],
    ['DELETE', `https://example-project.supabase.co/rest/v1/profiles`],
    // M1: GraphQL can carry a mutation in a POST body — every non-GET GraphQL request is blocked
    ['POST', `${base}/graphql/v1`],
    ['PATCH', `${base}/graphql/v1`],
    ['PUT', `${base}/graphql/v1`],
    ['DELETE', `${base}/graphql/v1`],
    // M1: the RPC check is a positive allowlist — write RPCs the old prefix list never named, and names nobody has heard of
    ['POST', `${base}/rest/v1/rpc/approve_visit`],
    ['POST', `${base}/rest/v1/rpc/complete_consultation`],
    ['POST', `${base}/rest/v1/rpc/add_service`],
    ['POST', `${base}/rest/v1/rpc/toggle_duty`],
    ['POST', `${base}/rest/v1/rpc/assign_nurse`],
    ['POST', `${base}/rest/v1/rpc/set_duty`],
    ['POST', `${base}/rest/v1/rpc/end_shift`],
    ['POST', `${base}/rest/v1/rpc/cancel_appointment`],
    ['POST', `${base}/rest/v1/rpc/check_in_appointment`],
    ['POST', `${base}/rest/v1/rpc/create_walkin_patient`],
    ['POST', `${base}/rest/v1/rpc/some_future_function`],
    ['POST', `${base}/rest/v1/rpc/get_or_create_patient`], // a get_ prefix proves nothing
    ['POST', `${base}/rest/v1/rpc/get_service_queue_and_delete`],
    ['POST', `${base}/rest/v1/rpc/GET_SERVICE_QUEUE`], // names are case-sensitive
    ['POST', `${base}/rest/v1/rpc/get_service_queue/extra`], // not exactly an allowlisted endpoint
    ['POST', `${base}/rest/v1/rpc/`],
    ['POST', `${base}/rest/v1/rpc`],
    ['POST', `${base}/rest/v1/rpc/%E0%A4%A`], // undecodable
    ['PATCH', `${base}/rest/v1/rpc/get_service_queue`], // only POST (and GET) are valid ways to call a read RPC
    ['DELETE', `${base}/rest/v1/rpc/get_service_queue`],
  ]
  for (const [m, u] of blocked) test(`blocks ${m} ${u.replace(base, '')}`, () => expect(isMutatingSupabaseRequest(m, u)).toBe(true))

  for (const name of READ_ONLY_RPCS) test(`allows POST to the read RPC ${name}`, () => expect(isMutatingSupabaseRequest('POST', `${base}/rest/v1/rpc/${name}`)).toBe(false))

  test('the read-RPC allowlist names no writing function', () => {
    // every RPC the app's browser code calls and that writes must be OFF the list (this is the list of writers found by `grep "\\.rpc("` in components/)
    for (const w of ['check_in_patient', 'check_in_appointment', 'next_patient', 'undo_next_patient', 'skip_waiting_patient', 'skip_patient', 'set_emergency_priority', 'set_duty', 'merge_patient_profiles', 'mark_notifications_read', 'end_shift', 'create_walkin_patient', 'cancel_appointment', 'book_appointment', 'admin_set_staff_status']) {
      expect(READ_ONLY_RPCS.has(w), w).toBe(false)
    }
  })

  test('malformed URLs are not classified as mutations (and never throw)', () => {
    expect(isMutatingSupabaseRequest('POST', 'not a url')).toBe(false)
  })
})

test.describe('the read-only browser guard (installReadOnlyGuard) blocks writes in a real browser context', () => {
  // No server involved: requests go to the closed local port 9; the guard decides before any connection is attempted.
  test('a write is aborted and recorded; reads and sign-in pass through to the (closed) port untouched', async ({ context, page }) => {
    const blocked = await installReadOnlyGuard(context)
    await page.goto('about:blank')
    const fire = (method: string, path: string) =>
      page.evaluate(
        ([m, p]) => fetch(`http://127.0.0.1:9${p}`, { method: m, mode: 'no-cors', body: m === 'GET' ? undefined : 'x' }).then(() => 'sent', () => 'failed'),
        [method, path]
      )
    await fire('POST', '/rest/v1/queue_entries')
    await fire('POST', '/rest/v1/rpc/check_in_patient')
    await fire('POST', '/rest/v1/rpc/next_patient')
    await fire('POST', '/storage/v1/object/avatars/x')
    await fire('POST', '/auth/v1/signup')
    await fire('POST', '/rest/v1/rpc/approve_visit') // not on the old prefix list; not on the read allowlist either
    await fire('POST', '/graphql/v1')
    expect(blocked).toEqual([
      'POST /rest/v1/queue_entries',
      'POST /rest/v1/rpc/check_in_patient',
      'POST /rest/v1/rpc/next_patient',
      'POST /storage/v1/object/avatars/x',
      'POST /auth/v1/signup',
      'POST /rest/v1/rpc/approve_visit',
      'POST /graphql/v1',
    ])
    await fire('GET', '/rest/v1/queue_entries')
    await fire('POST', '/auth/v1/token')
    await fire('POST', '/auth/v1/logout')
    await fire('POST', '/rest/v1/rpc/get_service_queue')
    await fire('POST', '/rest/v1/rpc/get_wait_estimate')
    expect(blocked.length, 'reads, sign-in, logout and read RPCs must not be blocked').toBe(7)
  })
})

/**
 * M1: the real `test` fixture from safe-test.ts, run in a CHILD Playwright process on throw-away specs (a spec cannot test its
 * own fixture's failure from inside itself). Proves, end to end: a blocked write FAILS the test at teardown (the assertion is
 * not dead code); a clean test passes; and every route around the guard — page/context routes, page.request, the `request`
 * fixture — throws at run time instead of silently bypassing it. Nothing leaves the machine: requests go to the closed local
 * port 9 and the guard decides before any connection is attempted.
 */
/** M3: the REAL config builder follows the plan — a refusal is a command that explains and exits, never `npm run dev`. */
test.describe('buildConfig applies the web-server plan', () => {
  const withEnvFile = (content: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-cfg-'))
    if (content) writeFileSync(join(dir, '.env.local'), content)
    return dir
  }
  const build = (mode: 'default' | 'offline', dir: string, env: Record<string, string>) => buildConfig({ mode, configDir: dir, env: env as NodeJS.ProcessEnv })

  test('default mode: shared-project env file => refusal command; local env file => npm run dev; E2E_BASE_URL => no server', () => {
    const hosted = withEnvFile('NEXT_PUBLIC_SUPABASE_URL=https://example-project.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=k\n')
    const local = withEnvFile('NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nNEXT_PUBLIC_SUPABASE_ANON_KEY=k\n')
    const empty = withEnvFile('')
    try {
      const refused = build('default', hosted, {}).webServer as { command: string; env: Record<string, string> }
      expect(refused.command).toContain('e2e-refuse-web-server')
      expect(refused.command).not.toContain('npm run dev')
      expect(refused.env.E2E_REFUSAL_REASON).toContain('REFUSING TO START THE APP')
      expect((build('default', empty, {}).webServer as { command: string }).command).toContain('e2e-refuse-web-server') // no URL at all
      expect((build('default', local, {}).webServer as { command: string; reuseExistingServer: boolean })).toMatchObject({ command: 'npm run dev', reuseExistingServer: false })
      expect(build('default', hosted, { E2E_BASE_URL: 'http://localhost:3100' }).webServer).toBeUndefined()
      expect(build('default', hosted, { E2E_BASE_URL: 'http://localhost:3100' }).use?.baseURL).toBe('http://localhost:3100')
    } finally {
      for (const d of [hosted, local, empty]) rmSync(d, { recursive: true, force: true })
    }
  })

  test('offline mode: starts a server whose env cannot reach the shared project, even with a shared-project env file; matches only offline specs', () => {
    const hosted = withEnvFile('NEXT_PUBLIC_SUPABASE_URL=https://example-project.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=secret-value\n')
    try {
      const cfg = build('offline', hosted, {})
      const ws = cfg.webServer as { command: string; env: Record<string, string> }
      expect(ws.command).toBe('npm run dev')
      expect(ws.env.NEXT_PUBLIC_SUPABASE_URL).toBe(OFFLINE_SUPABASE_URL)
      expect(ws.env.SUPABASE_SERVICE_ROLE_KEY).toBe('')
    } finally {
      rmSync(hosted, { recursive: true, force: true })
    }
  })

  test('the config derives testMatch from the same allowlist, and only wires the global setup in destructive default mode', () => {
    const dir = withEnvFile('')
    try {
      const d = build('default', dir, {})
      expect((d.testMatch as RegExp).test(join(dir, 'e2e', 'admin-v2.spec.ts'))).toBe(true)
      expect((d.testMatch as RegExp).test(join(dir, 'e2e', 'nurse-v2.spec.ts'))).toBe(false)
      expect(d.globalSetup).toBeUndefined()
      const o = build('offline', dir, {})
      expect((o.testMatch as RegExp).test(join(dir, 'e2e', 'nurse-v3-queue.spec.ts'))).toBe(true)
      expect((o.testMatch as RegExp).test(join(dir, 'e2e', 'admin-v2.spec.ts'))).toBe(false)
      const x = build('default', dir, LOCAL_ENV)
      expect(String(x.globalSetup)).toContain('destructive-global-setup')
      expect((x.testMatch as RegExp).test(join(dir, 'e2e', 'nurse-v2.spec.ts'))).toBe(true)
      expect(build('offline', dir, LOCAL_ENV).globalSetup).toBeUndefined()
      expect(() => build('default', dir, { E2E_ENABLE_DESTRUCTIVE: 'true' })).toThrow(/REFUSING TO RUN/)
      expect(() => build('offline', dir, { E2E_ENABLE_DESTRUCTIVE: 'true' })).toThrow(/REFUSING TO RUN/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test.describe('safe-test fixture, run for real in a child process', () => {
  const cli = join(process.cwd(), 'node_modules', '@playwright', 'test', 'cli.js')
  test.skip(!existsSync(cli), 'playwright cli not found')
  test.describe.configure({ timeout: 300_000 })

  const FIRE = `const fire = (page, method, path) => page.evaluate(([m, p]) => fetch('http://127.0.0.1:9' + p, { method: m, mode: 'no-cors', body: m === 'GET' ? undefined : 'x' }).then(() => 'sent', () => 'failed'), [method, path])`
  // [title, fixtures the test asks for, body]
  const cases: Array<[string, string, string]> = [
    ['clean: reads, sign-in, logout and read RPCs', 'page', `await page.goto('about:blank'); for (const [m, p] of [['GET', '/rest/v1/queue_entries'], ['POST', '/auth/v1/token'], ['POST', '/auth/v1/logout'], ['POST', '/rest/v1/rpc/get_service_queue']]) await fire(page, m, p)`],
    ['blocked: a table write', 'page', `await page.goto('about:blank'); await fire(page, 'POST', '/rest/v1/queue_entries')`],
    ['blocked: an RPC off the allowlist', 'page', `await page.goto('about:blank'); await fire(page, 'POST', '/rest/v1/rpc/approve_visit')`],
    ['blocked: a GraphQL POST', 'page', `await page.goto('about:blank'); await fire(page, 'POST', '/graphql/v1')`],
    ['sealed: page.route', 'page', `await page.route('**/*', (route) => route.continue())`],
    ['sealed: context.route', 'context', `await context.route('**/*', (route) => route.continue())`],
    ['sealed: page.request', 'page', `await page.request.post('http://127.0.0.1:9/rest/v1/queue_entries', { data: {} })`],
    ['sealed: context.request', 'context', `await context.request.post('http://127.0.0.1:9/rest/v1/queue_entries', { data: {} })`],
    ['sealed: a page opened later', 'context', `const p = await context.newPage(); await p.route('**/*', (route) => route.continue())`],
    ['sealed: the request fixture', 'request', `await request.post('http://127.0.0.1:9/rest/v1/queue_entries', { data: {} })`],
  ]

  test('the teardown assertion fails a blocked write; clean tests pass; the routes around the guard throw', () => {
    mkdirSync(join(process.cwd(), 'test-results'), { recursive: true })
    const dir = mkdtempSync(join(process.cwd(), 'test-results', 'safe-test-fixture-'))
    try {
      const safeTest = join(process.cwd(), 'e2e', 'support', 'safe-test').replace(/\\/g, '/')
      const specSource =
        `import { test, expect } from '${safeTest}'\n${FIRE}\n` +
        cases.map(([title, fixtures, body]) => `test(${JSON.stringify(title)}, async ({ ${fixtures} }) => { ${body} })`).join('\n') +
        '\nvoid expect\n'
      writeFileSync(join(dir, 'fixture.spec.ts'), specSource)
      writeFileSync(
        join(dir, 'playwright.config.cjs'),
        `module.exports = { testDir: __dirname, testMatch: /fixture\\.spec\\.ts$/, workers: 1, retries: 0, timeout: 60000, reporter: [['json', { outputFile: ${JSON.stringify(join(dir, 'result.json'))} }]], outputDir: ${JSON.stringify(join(dir, 'out'))}, projects: [{ name: 'chromium', use: { browserName: 'chromium' } }] }\n`
      )
      try {
        execFileSync(process.execPath, [cli, 'test', '-c', join(dir, 'playwright.config.cjs')], { env: cleanEnv({}), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd(), timeout: 240_000 })
      } catch {
        /* a non-zero exit is expected: some of the fixture tests must fail; the JSON report is what is asserted */
      }
      type Suite = { specs?: Array<{ title: string; tests: Array<{ results: Array<{ status: string; error?: { message?: string } }> }> }>; suites?: Suite[] }
      const report = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8')) as Suite
      const results = new Map<string, { status: string; message: string }>()
      const walk = (s: Suite) => {
        for (const sp of s.specs ?? []) {
          const r = sp.tests[0]?.results[0]
          results.set(sp.title, { status: r?.status ?? 'missing', message: (r?.error?.message ?? '').replace(/\u001b\[[0-9;]*m/g, '') })
        }
        for (const c of s.suites ?? []) walk(c)
      }
      walk(report)
      expect([...results.keys()].sort()).toEqual(cases.map(([title]) => title).sort())

      const clean = results.get('clean: reads, sign-in, logout and read RPCs')!
      expect(clean.status, clean.message).toBe('passed')
      const failed = (title: string, text: string) => {
        const r = results.get(title)!
        expect(r.status, `${title}: ${r.message}`).toBe('failed')
        expect(r.message, title).toContain(text)
      }
      failed('blocked: a table write', 'a read-only spec tried to change data through the browser')
      failed('blocked: a table write', 'POST /rest/v1/queue_entries')
      failed('blocked: an RPC off the allowlist', 'POST /rest/v1/rpc/approve_visit')
      failed('blocked: a GraphQL POST', 'POST /graphql/v1')
      for (const t of ['sealed: page.route', 'sealed: a page opened later']) failed(t, 'page.route is not available in a read-only spec')
      failed('sealed: context.route', 'context.route is not available in a read-only spec')
      failed('sealed: page.request', 'page.request.post() is not available in a read-only spec')
      failed('sealed: context.request', 'context.request.post() is not available in a read-only spec')
      failed('sealed: the request fixture', 'the `request` fixture.post() is not available in a read-only spec')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------------------------- environment rules
test.describe('evaluateE2eSafety: the shared project and misconfiguration are rejected', () => {
  test('disabled (unset, empty, "0") is not an error and enables nothing', () => {
    for (const v of [undefined, '', '  ', '0']) expect(evaluateE2eSafety({ E2E_ENABLE_DESTRUCTIVE: v })).toEqual({ destructive: false, problems: [] })
  })

  test('a complete local configuration is accepted', () => {
    expect(evaluateE2eSafety(LOCAL_ENV)).toEqual({ destructive: true, problems: [] })
    expect(evaluateE2eSafety({ ...LOCAL_ENV, E2E_SUPABASE_URL: 'http://localhost:54321', LOCAL_SUPABASE_URL: 'http://127.0.0.1:54321' }).problems).toEqual([])
  })

  for (const v of ['true', 'yes', 'on', '2', 'enabled', '1.0', 'TRUE']) {
    test(`E2E_ENABLE_DESTRUCTIVE="${v}" is refused (not silently treated as off)`, () => {
      const r = evaluateE2eSafety({ ...LOCAL_ENV, E2E_ENABLE_DESTRUCTIVE: v })
      expect(r.destructive).toBe(true)
      expect(r.problems.join('\n')).toContain('must be exactly "1"')
    })
  }

  test('enabled with nothing else configured is refused and says what is missing', () => {
    const r = evaluateE2eSafety({ E2E_ENABLE_DESTRUCTIVE: '1' })
    expect(r.problems.join('\n')).toMatch(/LOCAL_SUPABASE_URL.*E2E_BASE_URL/)
    expect(r.problems.join('\n')).toContain('E2E_SUPABASE_URL is not set')
    expect(r.problems.join('\n')).toContain('E2E_SUPABASE_ANON_KEY is not set')
  })

  test('the production project as E2E_SUPABASE_URL is rejected', () => {
    const r = evaluateE2eSafety({ ...LOCAL_ENV, E2E_SUPABASE_URL: PROD_URL })
    expect(r.problems.join('\n')).toContain('E2E_SUPABASE_URL refers to the shared/hosted Supabase project')
  })

  test('the production project as LOCAL_SUPABASE_URL is rejected', () => {
    const r = evaluateE2eSafety({ ...LOCAL_ENV, LOCAL_SUPABASE_URL: PROD_URL })
    expect(r.problems.join('\n')).toContain('LOCAL_SUPABASE_URL refers to the shared/hosted Supabase project')
  })

  test('the production project as NEXT_PUBLIC_SUPABASE_URL (the dev server\'s target) is rejected', () => {
    const r = evaluateE2eSafety({ ...LOCAL_ENV, NEXT_PUBLIC_SUPABASE_URL: PROD_URL })
    expect(r.problems.join('\n')).toContain('NEXT_PUBLIC_SUPABASE_URL refers to the shared/hosted Supabase project')
  })

  test('any other hosted supabase.co URL is rejected too', () => {
    expect(evaluateE2eSafety({ ...LOCAL_ENV, E2E_SUPABASE_URL: 'https://someone-elses-project.supabase.co' }).problems.join('\n')).toContain('E2E_SUPABASE_URL refers to')
  })

  test('the project named in an unrelated-looking connection variable is rejected', () => {
    const r = evaluateE2eSafety({ ...LOCAL_ENV, DATABASE_URL: `postgresql://postgres:x@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres` })
    expect(r.problems.join('\n')).toContain('DATABASE_URL refers to the shared/hosted Supabase project')
  })

  test('problems name variables but never print a secret value', () => {
    const secret = 'super-secret-service-key-value'
    const r = evaluateE2eSafety({ ...LOCAL_ENV, LOCAL_SUPABASE_SERVICE: `${secret}-${PRODUCTION_PROJECT_REF}` })
    expect(r.problems.length).toBeGreaterThan(0)
    expect(r.problems.join('\n')).not.toContain(secret)
  })

  test('E2E_BASE_URL missing, or not local, is rejected (no auto-started server, no remote app)', () => {
    expect(evaluateE2eSafety(without(LOCAL_ENV, 'E2E_BASE_URL')).problems.join('\n')).toContain('E2E_BASE_URL')
    expect(evaluateE2eSafety({ ...LOCAL_ENV, E2E_BASE_URL: 'https://smart-clinic-alpha.vercel.app' }).problems.join('\n')).toContain('E2E_BASE_URL')
  })

  test('a missing LOCAL_SUPABASE_* value is rejected, and so are keys that mention the production project', () => {
    expect(evaluateE2eSafety(without(LOCAL_ENV, 'LOCAL_SUPABASE_SERVICE')).problems.join('\n')).toContain('LOCAL_SUPABASE_SERVICE is not set')
    expect(evaluateE2eSafety(without(LOCAL_ENV, 'LOCAL_SUPABASE_ANON')).problems.join('\n')).toContain('LOCAL_SUPABASE_ANON is not set')
  })

  test('E2E_SUPABASE_URL must be exactly the local stack: missing, remote, different port, or https are all rejected', () => {
    expect(evaluateE2eSafety(without(LOCAL_ENV, 'E2E_SUPABASE_URL')).problems.join('\n')).toContain('E2E_SUPABASE_URL is not set')
    expect(evaluateE2eSafety({ ...LOCAL_ENV, E2E_SUPABASE_URL: 'https://example.com' }).problems.join('\n')).toContain('not a plain local origin')
    expect(evaluateE2eSafety({ ...LOCAL_ENV, E2E_SUPABASE_URL: 'http://127.0.0.1:54399' }).problems.join('\n')).toContain('differs from LOCAL_SUPABASE_URL')
    expect(evaluateE2eSafety({ ...LOCAL_ENV, E2E_SUPABASE_URL: 'https://127.0.0.1:54321' }).problems.join('\n')).toContain('not a plain local origin')
  })

  test('E2E_SUPABASE_ANON_KEY must be the local stack\'s key', () => {
    expect(evaluateE2eSafety(without(LOCAL_ENV, 'E2E_SUPABASE_ANON_KEY')).problems.join('\n')).toContain('E2E_SUPABASE_ANON_KEY is not set')
    expect(evaluateE2eSafety({ ...LOCAL_ENV, E2E_SUPABASE_ANON_KEY: 'some-other-key' }).problems.join('\n')).toContain('differs from LOCAL_SUPABASE_ANON')
  })

  test('NEXT_PUBLIC_SUPABASE_URL pointing at some other local port is rejected; the same stack is fine', () => {
    expect(evaluateE2eSafety({ ...LOCAL_ENV, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54399' }).problems.join('\n')).toContain('NEXT_PUBLIC_SUPABASE_URL')
    expect(evaluateE2eSafety({ ...LOCAL_ENV, NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321' }).problems).toEqual([])
  })

  test('the app and the database may not be the same host:port', () => {
    expect(evaluateE2eSafety({ ...LOCAL_ENV, E2E_BASE_URL: 'http://127.0.0.1:54321' }).problems.join('\n')).toContain('same host:port')
  })
})

test.describe('isLocalOrigin / assertLocalSupabaseUrl', () => {
  for (const ok of ['http://127.0.0.1:54321', 'http://localhost:54321', 'http://127.0.0.1:3100/']) {
    test(`accepts ${ok}`, () => {
      expect(isLocalOrigin(ok)).toBe(true)
      expect(() => assertLocalSupabaseUrl(ok, 'x')).not.toThrow()
    })
  }
  for (const bad of [
    undefined, '', ' ', 'not a url', PROD_URL, `${PROD_URL}/`, 'https://127.0.0.1:54321', 'http://127.0.0.1', 'http://127.0.0.1:54321/rest/v1',
    'http://127.0.0.1:54321?x=1', 'http://user:pw@127.0.0.1:54321', 'http://0.0.0.0:54321', 'http://[::1]:54321', 'http://127.0.0.1.evil.com:54321',
    'http://localhost.supabase.co:54321', 'http://192.168.1.10:54321', `http://localhost:54321/${PRODUCTION_PROJECT_REF}`, 'ftp://127.0.0.1:54321',
  ]) {
    test(`rejects ${JSON.stringify(bad)}`, () => {
      expect(isLocalOrigin(bad)).toBe(false)
      expect(() => assertLocalSupabaseUrl(bad, 'The action')).toThrow(/only runs against a local Supabase stack/)
    })
  }
  test('sameLocalOrigin treats localhost and 127.0.0.1 as one machine, but ports must match', () => {
    expect(sameLocalOrigin('http://localhost:54321', 'http://127.0.0.1:54321')).toBe(true)
    expect(sameLocalOrigin('http://localhost:54321', 'http://127.0.0.1:54322')).toBe(false)
    expect(sameLocalOrigin(PROD_URL, PROD_URL)).toBe(false)
  })
})

/**
 * M3: the default run no longer starts an app that is wired to shared infrastructure. `planWebServer` is pure; the files a dev
 * server would read are passed in, so none of this touches the real .env.local (whose values are never printed anywhere).
 */
test.describe('planWebServer: the app is only started when it cannot reach the shared project', () => {
  const noFiles = { values: {}, origin: {} }
  const files = (name: string, values: Record<string, string>) => ({ values, origin: Object.fromEntries(Object.keys(values).map((k) => [k, name])) })
  const LOCAL_APP = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-anon' }
  const PROD_APP = { NEXT_PUBLIC_SUPABASE_URL: PROD_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'prod-anon-key-value', SUPABASE_SERVICE_ROLE_KEY: 'prod-service-role-key-value' }
  const plan = (mode: 'default' | 'offline', env: Record<string, string | undefined>, f = noFiles) => planWebServer({ mode, env, files: f })

  test('default mode REFUSES when .env.local names the shared project (the previous behaviour started it)', () => {
    const p = plan('default', {}, files('.env.local', PROD_APP))
    expect(p.kind).toBe('refuse')
    expect(p.reason).toContain('REFUSING TO START THE APP')
    expect(p.reason).toContain('NEXT_PUBLIC_SUPABASE_URL (from .env.local)')
    expect(p.reason).toContain('npm run test:e2e:offline')
    // names, never values
    for (const secret of [PRODUCTION_PROJECT_REF, 'prod-anon-key-value', 'prod-service-role-key-value']) expect(p.reason).not.toContain(secret)
  })

  test('default mode refuses when the URL comes from the process environment, a hosted URL, or is missing altogether', () => {
    expect(plan('default', { NEXT_PUBLIC_SUPABASE_URL: PROD_URL }).kind).toBe('refuse')
    expect(plan('default', { NEXT_PUBLIC_SUPABASE_URL: 'https://someone-elses.supabase.co' }).kind).toBe('refuse')
    expect(plan('default', { NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.com' }).kind).toBe('refuse')
    expect(plan('default', { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1' }).kind).toBe('refuse') // no explicit port: not a plain local origin
    const none = plan('default', {})
    expect(none.kind).toBe('refuse')
    expect(none.reason).toContain('NEXT_PUBLIC_SUPABASE_URL is not set')
  })

  test('default mode starts the app only when its own configuration is a plain local Supabase origin', () => {
    expect(plan('default', {}, files('.env.local', LOCAL_APP)).kind).toBe('start')
    expect(plan('default', LOCAL_APP).kind).toBe('start')
    expect(plan('default', { NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321' }).kind).toBe('start')
  })

  test('a hosted reference in ANY related variable refuses, even next to a local URL', () => {
    const p = plan('default', {}, files('.env', { ...LOCAL_APP, DATABASE_URL: `postgresql://postgres:x@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres` }))
    expect(p.kind).toBe('refuse')
    expect(p.reason).toContain('DATABASE_URL (from .env)')
    expect(p.reason).not.toContain(PRODUCTION_PROJECT_REF)
    expect(plan('default', { ...LOCAL_APP, SUPABASE_SERVICE_URL: 'https://x.supabase.co' }).kind).toBe('refuse')
  })

  test('the process environment wins over the files, in the order Next.js reads them', () => {
    expect(plan('default', LOCAL_APP, files('.env.local', PROD_APP)).kind).toBe('start') // shell overrides a production file
    expect(plan('default', { NEXT_PUBLIC_SUPABASE_URL: PROD_URL }, files('.env.local', LOCAL_APP)).kind).toBe('refuse') // …and the reverse
  })

  test('an app started by the caller (E2E_BASE_URL) is used as given and nothing is started', () => {
    for (const mode of ['default', 'offline'] as const) {
      expect(plan(mode, { E2E_BASE_URL: 'http://localhost:3100' }, files('.env.local', PROD_APP)).kind).toBe('external')
    }
  })

  test('destructive mode, and LOCAL_SUPABASE_* without a base URL, never start a server', () => {
    for (const v of ['1', 'true', 'yes']) expect(plan('default', { E2E_ENABLE_DESTRUCTIVE: v }, files('.env.local', LOCAL_APP)).kind).toBe('none')
    expect(plan('default', { E2E_ENABLE_DESTRUCTIVE: '0' }, files('.env.local', LOCAL_APP)).kind).toBe('start')
    expect(plan('default', { LOCAL_SUPABASE_URL: 'http://127.0.0.1:54321' }, files('.env.local', LOCAL_APP)).kind).toBe('none')
    expect(plan('offline', { E2E_ENABLE_DESTRUCTIVE: '1' }).kind).toBe('none')
  })

  test('offline mode starts a server whose Supabase settings cannot reach any project, whatever .env.local says', () => {
    const p = plan('offline', { SUPABASE_SERVICE_ROLE_KEY: 'from-the-shell' }, files('.env.local', PROD_APP))
    expect(p.kind).toBe('start')
    if (p.kind !== 'start') return
    expect(p.env!.NEXT_PUBLIC_SUPABASE_URL).toBe(OFFLINE_SUPABASE_URL)
    expect(isLocalOrigin(OFFLINE_SUPABASE_URL)).toBe(true)
    expect(p.env!.SUPABASE_SERVICE_ROLE_KEY).toBe('') // blanked, whether it came from the file or the shell
    expect(p.env!.NEXT_PUBLIC_SUPABASE_ANON_KEY).not.toContain('prod')
    expect(JSON.stringify(p)).not.toContain(PRODUCTION_PROJECT_REF)
    expect(JSON.stringify(p)).not.toContain('prod-service-role-key-value')
    // every secret-looking variable present in the shell or any file is overridden, not just the ones named above
    const e = offlineServerEnv({ MY_DATABASE_URL: 'x', JWT_SECRET: 'y', E2E_SUPABASE_URL: 'z' }, files('.env', { POSTGRES_PASSWORD: 'p' }))
    for (const k of ['MY_DATABASE_URL', 'JWT_SECRET', 'E2E_SUPABASE_URL', 'POSTGRES_PASSWORD']) expect(e[k], k).toBe('')
  })

  test('env-file parsing: comments, quotes, export, CRLF, and Next.js precedence between files', () => {
    expect(parseEnvFile('# c\r\nA=1\r\nexport B="two words"\r\nC=\'x\' # trailing\r\nD=plain # trailing\r\n\r\nnot a line\r\nE=\r\n')).toEqual({ A: '1', B: 'two words', C: 'x', D: 'plain', E: '' })
    const dir = mkdtempSync(join(tmpdir(), 'e2e-env-'))
    try {
      writeFileSync(join(dir, '.env'), 'A=from-env\nB=from-env\nC=from-env\n')
      writeFileSync(join(dir, '.env.development'), 'B=from-development\nC=from-development\n')
      writeFileSync(join(dir, '.env.local'), 'C=from-local\n')
      const loaded = loadNextEnvFiles(dir)
      expect(loaded.values).toEqual({ A: 'from-env', B: 'from-development', C: 'from-local' })
      expect(loaded.origin).toEqual({ A: '.env', B: '.env.development', C: '.env.local' })
      expect(loadNextEnvFiles(join(dir, 'does-not-exist'))).toEqual({ values: {}, origin: {} })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------------------------- helpers refuse
test.describe('destructive helpers refuse before sending anything', () => {
  test('assertLocalStack: disabled flag, production URL, missing URL and lookalikes are all refused', () => {
    expect(() => assertLocalStack('act()', 'http://127.0.0.1:54321', '')).toThrow(/disabled by default/)
    expect(() => assertLocalStack('act()', 'http://127.0.0.1:54321', '0')).toThrow(/disabled by default/)
    expect(() => assertLocalStack('act()', 'http://127.0.0.1:54321', 'true')).toThrow(/disabled by default/)
    expect(() => assertLocalStack('act()', PROD_URL, '1')).toThrow(/only runs against a local Supabase stack/)
    expect(() => assertLocalStack('act()', '', '1')).toThrow(/\(not set\)/)
    expect(() => assertLocalStack('act()', 'http://localhost.supabase.co:54321', '1')).toThrow(/only runs against/)
    expect(() => assertLocalStack('act()', 'http://127.0.0.1:54321', '1')).not.toThrow()
  })

  test('resetDemoState and setStaffIdleTimeoutMinutes reject in a default environment and send no request', async () => {
    test.skip((process.env.E2E_ENABLE_DESTRUCTIVE ?? '').trim() !== '', 'only meaningful in a default (non-destructive) environment')
    const realFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      calls += 1
      return realFetch(...args)
    }) as typeof fetch
    try {
      await expect(resetDemoState()).rejects.toThrow(/disabled by default/)
      await expect(setStaffIdleTimeoutMinutes(5)).rejects.toThrow(/disabled by default/)
    } finally {
      globalThis.fetch = realFetch
    }
    expect(calls).toBe(0)
  })
})

// ---------------------------------------------------------------------------------------------- the real config
test.describe('playwright.config.ts end to end (child `playwright test --list`; no browser, no network)', () => {
  const cli = join(process.cwd(), 'node_modules', '@playwright', 'test', 'cli.js')
  test.skip(!existsSync(cli), 'playwright cli not found')

  /** Runs a REAL config (default: playwright.config.ts) in a child process with a clean environment plus `extra`, `--list` only. */
  function list(extra: Record<string, string>, config?: string, cwd = process.cwd()) {
    try {
      const args = [cli, 'test', '--list', ...(config ? ['-c', config] : [])]
      const out = execFileSync(process.execPath, args, { env: cleanEnv(extra), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd, timeout: 120_000 })
      return { code: 0, text: out }
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string }
      return { code: err.status ?? 1, text: `${err.stdout ?? ''}${err.stderr ?? ''}` }
    }
  }
  /** The spec file names a `--list` output contains (`› admin-v2.spec.ts:5:1 ›`). */
  const listedFiles = (text: string) => [...new Set([...text.matchAll(/›\s+(\S+?\.spec\.ts):\d+:\d+\s+›/g)].map((m) => m[1]))].sort()
  test.describe.configure({ timeout: 300_000 })

  test('default: succeeds and lists EXACTLY the offline, read-only and self-guarded specs — no destructive spec, nothing else', () => {
    const r = list({})
    expect(r.code, r.text).toBe(0)
    expect(listedFiles(r.text)).toEqual(runnableSpecNames(false).map((n) => `${n}.spec.ts`).sort())
    for (const n of DESTRUCTIVE_SPECS) expect(r.text, `${n} must not be listed by default`).not.toContain(`${n}.spec.ts`)
  })

  test('explicitly naming a destructive spec, or a spec nobody classified, on the command line still lists nothing', () => {
    for (const target of ['e2e/nurse-v2.spec.ts', 'e2e/reception-queue-actions.spec.ts', 'e2e/patient-v3.spec.ts', 'nurse-v2', 'e2e/does-not-exist.spec.ts']) {
      const out = (() => {
        try {
          return execFileSync(process.execPath, [cli, 'test', '--list', target], { env: cleanEnv({}), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd(), timeout: 120_000 })
        } catch (e) {
          const err = e as { stdout?: string; stderr?: string }
          return `${err.stdout ?? ''}${err.stderr ?? ''}`
        }
      })()
      expect(listedFiles(out), target).toEqual([])
    }
  })

  test('H1: a synthetic e2e folder — sub-folders, .test.ts, .spec.tsx/.js/.mjs, unclassified and destructive names — lists only the top-level classified safe specs', () => {
    mkdirSync(join(process.cwd(), 'test-results'), { recursive: true })
    const dir = mkdtempSync(join(process.cwd(), 'test-results', 'discovery-'))
    try {
      const files = [
        'admin-v2.spec.ts', // allowed
        'logout.spec.ts', // allowed
        'nurse-v2.spec.ts', // destructive: not by default
        'brand-new-feature.spec.ts', // unclassified
        'sub/admin-v2.spec.ts', // same name, sub-folder
        'sub/deeper/logout.spec.ts',
        'admin-v2.test.ts',
        'admin-v2.spec.tsx',
        'logout.spec.js',
        'logout.spec.mjs',
        'logout.test.cjs',
        'sub/brand-new.test.ts',
        'support/admin-v2.spec.ts',
      ]
      for (const f of files) {
        mkdirSync(join(dir, 'e2e', ...f.split('/').slice(0, -1)), { recursive: true })
        writeFileSync(join(dir, 'e2e', f), `import { test } from '@playwright/test'\ntest('t ${f}', async () => {})\n`)
      }
      const base = join(process.cwd(), 'e2e', 'support', 'playwright-config').replace(/\\/g, '/')
      const config = (mode: string) => {
        writeFileSync(join(dir, `${mode}.config.ts`), `import { buildConfig } from '${base}'\nexport default buildConfig({ mode: '${mode}', configDir: __dirname })\n`)
        return join(dir, `${mode}.config.ts`)
      }
      // E2E_BASE_URL set => the plan is "external" and no server is involved; the listing is purely the allowlist.
      const dflt = list({ E2E_BASE_URL: 'http://localhost:3999' }, config('default'), dir)
      expect(dflt.code, dflt.text).toBe(0)
      expect(listedFiles(dflt.text)).toEqual(['admin-v2.spec.ts', 'logout.spec.ts'])
      expect((dflt.text.match(/\.spec\.ts:\d+:\d+ ›/g) ?? []).length).toBe(2)
      expect(dflt.text).not.toMatch(/\.(test\.(ts|cjs)|spec\.(tsx|js|mjs))/)
      // with the destructive opt-in (a valid local configuration) the destructive spec joins; the rest still do not
      const all = list({ ...LOCAL_ENV }, config('default'), dir)
      expect(all.code, all.text).toBe(0)
      expect(listedFiles(all.text)).toEqual(['admin-v2.spec.ts', 'logout.spec.ts', 'nurse-v2.spec.ts'])
      // the offline entry point lists none of these (no offline spec is present in the synthetic folder)
      const off = list({ E2E_BASE_URL: 'http://localhost:3999' }, config('offline'), dir)
      expect(listedFiles(off.text)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the offline config lists only the offline specs', () => {
    const r = list({ E2E_BASE_URL: 'http://localhost:3999' }, 'playwright.offline.config.ts')
    expect(r.code, r.text).toBe(0)
    expect(listedFiles(r.text)).toEqual(OFFLINE_SPECS.map((n) => `${n}.spec.ts`).sort())
  })

  test('the offline config refuses an unsafe destructive setting too', () => {
    const r = list({ E2E_ENABLE_DESTRUCTIVE: 'true' }, 'playwright.offline.config.ts')
    expect(r.code).not.toBe(0)
    expect(r.text).toContain('REFUSING TO RUN')
  })

  test('E2E_ENABLE_DESTRUCTIVE=true is refused by the config itself', () => {
    const r = list({ E2E_ENABLE_DESTRUCTIVE: 'true' })
    expect(r.code).not.toBe(0)
    expect(r.text).toContain('REFUSING TO RUN')
    expect(r.text).toContain('must be exactly "1"')
  })

  test('E2E_ENABLE_DESTRUCTIVE=1 with nothing else is refused', () => {
    const r = list({ E2E_ENABLE_DESTRUCTIVE: '1' })
    expect(r.code).not.toBe(0)
    expect(r.text).toContain('REFUSING TO RUN')
    expect(r.text).toContain('E2E_SUPABASE_URL is not set')
  })

  test('E2E_ENABLE_DESTRUCTIVE=1 with the production project is refused and lists no tests', () => {
    const r = list({ ...LOCAL_ENV, E2E_SUPABASE_URL: PROD_URL, NEXT_PUBLIC_SUPABASE_URL: PROD_URL })
    expect(r.code).not.toBe(0)
    expect(r.text).toContain('E2E_SUPABASE_URL refers to the shared/hosted Supabase project')
    expect(r.text).toContain('NEXT_PUBLIC_SUPABASE_URL refers to the shared/hosted Supabase project')
    expect(r.text).not.toMatch(/\.spec\.ts:\d+:\d+ ›/)
  })

  test('a complete local configuration is accepted and the destructive specs are listed', () => {
    const r = list(LOCAL_ENV)
    expect(r.code, r.text).toBe(0)
    expect(listedFiles(r.text)).toEqual(runnableSpecNames(true).map((n) => `${n}.spec.ts`).sort())
    for (const n of DESTRUCTIVE_SPECS) expect(r.text, n).toContain(`${n}.spec.ts`)
  })
})
