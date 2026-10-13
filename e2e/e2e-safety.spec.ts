import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DESTRUCTIVE_SPECS,
  SAFE_SPECS,
  SELF_GUARDED_SPECS,
  assertLocalSupabaseUrl,
  classifySpec,
  evaluateE2eSafety,
  ignoredSpecGlobs,
  isLocalOrigin,
  mayAutoStartWebServer,
  sameLocalOrigin,
  specName,
} from './support/e2e-safety'
import { PRODUCTION_PROJECT_REF } from './support/local-supabase-guard'
import { assertLocalStack, resetDemoState, setStaffIdleTimeoutMinutes } from './helpers'

/**
 * Safeguards that keep state-changing tests away from the shared (production) Supabase project. PURE: no browser, no
 * database, no network — a fetch spy proves the refusal tests send nothing. Rules: e2e/support/e2e-safety.ts.
 */

const E2E_DIR = join(process.cwd(), 'e2e')
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

// ---------------------------------------------------------------------------------------------- classification
test.describe('spec classification (an unclassified spec fails closed)', () => {
  test('every spec file is classified exactly once', () => {
    const unclassified = specFiles.map(specName).filter((n) => classifySpec(n) === 'unclassified')
    expect(unclassified, 'classify these in e2e/support/e2e-safety.ts (until then they are treated as destructive)').toEqual([])
  })

  test('the lists name only specs that exist, and no spec is in two lists', () => {
    const names = new Set(specFiles.map(specName))
    for (const n of [...SAFE_SPECS, ...SELF_GUARDED_SPECS, ...DESTRUCTIVE_SPECS]) expect(names.has(n), `${n} is listed but has no spec file`).toBe(true)
    const all = [...SAFE_SPECS, ...SELF_GUARDED_SPECS, ...DESTRUCTIVE_SPECS]
    expect(new Set(all).size).toBe(all.length)
  })

  test('by default exactly the destructive specs are ignored; with the opt-in nothing is', () => {
    expect(ignoredSpecGlobs(specFiles, false).sort()).toEqual(DESTRUCTIVE_SPECS.map((n) => `**/${n}.spec.ts`).sort())
    expect(ignoredSpecGlobs(specFiles, true)).toEqual([])
  })

  test('a brand-new spec nobody classified is ignored by default', () => {
    expect(ignoredSpecGlobs([...specFiles, 'brand-new-feature.spec.ts'], false)).toContain('**/brand-new-feature.spec.ts')
    expect(classifySpec('brand-new-feature')).toBe('unclassified')
  })

  test('a spec listed twice is unclassified, not silently safe', () => {
    expect(classifySpec('nurse-v2')).toBe('destructive')
    expect(classifySpec('e2e-safety')).toBe('safe')
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

  test('safe specs never import a destructive helper or create a Supabase client', () => {
    for (const n of SAFE_SPECS.filter((s) => s !== 'e2e-safety')) {
      const code = sourceOf(n).replace(/^\s*(\/\/|\*).*$/gm, '')
      expect(DESTRUCTIVE_HELPERS.test(code), `${n} imports a destructive helper`).toBe(false)
      expect(/\bcreateClient\s*\(/.test(code), `${n} creates a Supabase client`).toBe(false)
    }
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

test.describe('mayAutoStartWebServer', () => {
  test('only when nothing local-only or destructive is configured', () => {
    expect(mayAutoStartWebServer({})).toBe(true)
    expect(mayAutoStartWebServer({ E2E_ENABLE_DESTRUCTIVE: '0' })).toBe(true)
    expect(mayAutoStartWebServer({ E2E_BASE_URL: 'http://127.0.0.1:3100' })).toBe(false)
    expect(mayAutoStartWebServer({ LOCAL_SUPABASE_URL: 'http://127.0.0.1:54321' })).toBe(false)
    for (const v of ['1', 'true', 'yes']) expect(mayAutoStartWebServer({ E2E_ENABLE_DESTRUCTIVE: v })).toBe(false)
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

  /** Runs the REAL config in a child process with a clean environment plus `extra`. */
  function list(extra: Record<string, string>) {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !/^(E2E_|LOCAL_SUPABASE|NEXT_PUBLIC_|SUPABASE_|DATABASE_URL)/.test(k)) env[k] = v
    }
    try {
      const out = execFileSync(process.execPath, [cli, 'test', '--list'], { env: { ...env, ...extra } as NodeJS.ProcessEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd(), timeout: 120_000 })
      return { code: 0, text: out }
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string }
      return { code: err.status ?? 1, text: `${err.stdout ?? ''}${err.stderr ?? ''}` }
    }
  }
  test.describe.configure({ timeout: 300_000 })

  test('default: succeeds, lists the safe specs and none of the destructive ones', () => {
    const r = list({})
    expect(r.code).toBe(0)
    for (const n of ['admin-v2', 'nurse-v3-queue', 'e2e-safety']) expect(r.text, n).toContain(`${n}.spec.ts`)
    for (const n of DESTRUCTIVE_SPECS) expect(r.text, `${n} must be ignored by default`).not.toContain(`${n}.spec.ts`)
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
    for (const n of DESTRUCTIVE_SPECS) expect(r.text, n).toContain(`${n}.spec.ts`)
  })
})
