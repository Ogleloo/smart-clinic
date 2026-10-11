import { defineConfig, devices } from '@playwright/test'

/**
 * These are regression/integration tests against the real shared dev
 * Supabase backend — not a per-test-isolated database. Every test that
 * touches queue/consultation/notification state calls resetDemoState()
 * first (see e2e/helpers.ts), and workers are forced to 1 here so two
 * tests never race each other over that same shared state. That trades
 * suite speed for correctness, which is the right trade for a suite
 * whose entire purpose is catching exactly this class of regression.
 */
export default defineConfig({
  testDir: './e2e',
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
  // Never auto-start `npm run dev` when the local-only integration specs have been opted into
  // (LOCAL_SUPABASE_*): that server would read .env.local — normally the shared production project — before the
  // spec's guard could refuse anything. In that mode the app must be started explicitly and verified by the spec
  // (see e2e/support/local-supabase-guard.ts); with E2E_BASE_URL unset the spec then fails closed.
  webServer:
    process.env.E2E_BASE_URL || ['LOCAL_SUPABASE_URL', 'LOCAL_SUPABASE_ANON', 'LOCAL_SUPABASE_SERVICE'].some((k) => process.env[k]?.trim())
      ? undefined
      : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 60_000,
      },
})
