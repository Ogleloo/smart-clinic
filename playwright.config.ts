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
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 60_000,
      },
})
