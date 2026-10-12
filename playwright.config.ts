import { defineConfig, devices } from '@playwright/test'

/**
 * Regression/integration tests. Where they run and who they sign in as come from the environment (e2e/helpers.ts):
 * no credential is committed and nothing defaults to the shared production project (the repository is public).
 *
 * The suites below WRITE shared state (reset_demo_state, check-ins, clinic settings). They are DISABLED BY DEFAULT and
 * only run when E2E_ENABLE_DESTRUCTIVE=1 against a local Supabase stack — their helpers refuse any other target.
 * Workers are forced to 1 so two tests never race over the same state.
 */
const DESTRUCTIVE_SPECS = [
  'appointment-cancel',
  'dashboard-guard',
  'dashboard-queue-card',
  'idle-timeout',
  'nurse-undo',
  'patient-v3',
  'queue-explainability',
  'reception-checkin',
  'reception-walkin',
].map((name) => `**/${name}.spec.ts`)

export default defineConfig({
  testDir: './e2e',
  testIgnore: process.env.E2E_ENABLE_DESTRUCTIVE === '1' ? [] : DESTRUCTIVE_SPECS,
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
