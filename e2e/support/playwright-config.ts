import path from 'node:path'
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test'
import { OFFLINE_SPECS, evaluateE2eSafety, specMatchPattern, unsafeConfigurationError } from './e2e-safety'
import { DEV_SERVER_COMMAND, loadNextEnvFiles, planWebServer, type Mode } from './web-server-plan'

/**
 * The one place the Playwright configuration is built (playwright.config.ts = default, playwright.offline.config.ts = offline),
 * so both entry points are fail-closed in the same way. Rules and tests: e2e/support/e2e-safety.ts, web-server-plan.ts,
 * e2e/e2e-safety.spec.ts.
 *
 * FAIL-CLOSED:
 *  - testMatch is an ALLOWLIST (specMatchPattern): exactly the classified top-level e2e/<name>.spec.ts files that may run.
 *    Offline, read-only and self-guarded specs run by default; destructive specs only with E2E_ENABLE_DESTRUCTIVE=1. A spec
 *    nobody classified — in any sub-folder, with any extension (`.test.ts`, `.spec.tsx`, `.spec.js`…) — never runs.
 *  - With E2E_ENABLE_DESTRUCTIVE set, any problem (a value other than "1", the shared Supabase project named in any
 *    variable, a missing/non-local LOCAL_SUPABASE_* or E2E_* value, E2E_SUPABASE_* differing from the local stack…) makes
 *    this THROW: no test runs, not even --list. A global setup proves the app server reads the local stack.
 *  - The config starts the dev server only when planWebServer() says it cannot reach shared infrastructure; otherwise it
 *    runs a command that explains the refusal and exits (nothing is started, nothing is sent anywhere).
 * Workers are forced to 1 so two tests never race over the same state.
 */
export function buildConfig(options: { mode: Mode; configDir: string; testDir?: string; env?: NodeJS.ProcessEnv }): PlaywrightTestConfig {
  const env = options.env ?? process.env
  const safety = evaluateE2eSafety(env)
  if (safety.problems.length) throw unsafeConfigurationError(safety.problems)

  const offline = options.mode === 'offline'
  const testDir = path.resolve(options.configDir, options.testDir ?? 'e2e')
  const plan = planWebServer({ mode: options.mode, env, files: loadNextEnvFiles(options.configDir) })
  const baseURL = env.E2E_BASE_URL?.trim() || 'http://localhost:3000'

  return defineConfig({
    testDir,
    testMatch: specMatchPattern(testDir, safety.destructive && !offline, offline ? OFFLINE_SPECS : undefined),
    globalSetup: safety.destructive && !offline ? path.join(__dirname, 'destructive-global-setup.ts') : undefined,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 120_000,
    reporter: [['list']],
    use: { baseURL, trace: 'retain-on-failure' },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer:
      plan.kind === 'start'
        ? { command: DEV_SERVER_COMMAND, url: 'http://localhost:3000', env: plan.env, reuseExistingServer: false, timeout: 120_000 }
        : plan.kind === 'refuse'
          ? { command: 'node scripts/e2e-refuse-web-server.mjs', url: 'http://localhost:3000', env: { E2E_REFUSAL_REASON: plan.reason }, reuseExistingServer: false, timeout: 20_000 }
          : undefined,
  })
}
