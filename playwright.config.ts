import { readdirSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'
import { evaluateE2eSafety, ignoredSpecGlobs, mayAutoStartWebServer, unsafeConfigurationError } from './e2e/support/e2e-safety'

/**
 * Regression/integration tests. Where they run and who they sign in as come from the environment (e2e/helpers.ts):
 * no credential is committed and nothing defaults to the shared production project (the repository is public).
 *
 * FAIL-CLOSED (rules and tests: e2e/support/e2e-safety.ts, e2e/e2e-safety.spec.ts):
 *  - Every spec is classified safe / self-guarded / destructive. Destructive specs — and any spec nobody has classified —
 *    are IGNORED unless E2E_ENABLE_DESTRUCTIVE=1.
 *  - With E2E_ENABLE_DESTRUCTIVE set, any problem (a value other than "1", the shared Supabase project named in any
 *    variable, a missing/non-local LOCAL_SUPABASE_* or E2E_* value, E2E_SUPABASE_* differing from the local stack…)
 *    makes this file THROW: no test runs, not even --list.
 *  - In that mode no dev server is auto-started (it would read .env.local, normally production) and a global setup proves
 *    the app server reads the local stack.
 * Workers are forced to 1 so two tests never race over the same state.
 */
const safety = evaluateE2eSafety(process.env)
if (safety.problems.length) throw unsafeConfigurationError(safety.problems)

const specFiles = readdirSync('./e2e').filter((f) => f.endsWith('.spec.ts'))

export default defineConfig({
  testDir: './e2e',
  testIgnore: ignoredSpecGlobs(specFiles, safety.destructive),
  globalSetup: safety.destructive ? './e2e/support/destructive-global-setup.ts' : undefined,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Never auto-start `npm run dev` when destructive testing or the local-only integration specs are opted into: that
  // server would read .env.local — normally the shared production project — before any guard could refuse anything. In
  // those modes the app must be started explicitly and is verified by the canary (global setup / the spec's own check).
  webServer: mayAutoStartWebServer(process.env)
    ? {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 60_000,
      }
    : undefined,
})
