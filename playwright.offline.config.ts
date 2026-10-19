import { buildConfig } from './e2e/support/playwright-config'

/**
 * OFFLINE specs only (npm run test:e2e:offline): pure logic and the mocked harness. No Supabase project, no credentials and no
 * .env.local are needed. If an app is required (the harness fetches the login page for its HTML shell) this starts a dev server
 * whose Supabase settings are forced to a dead local port and whose secrets are blanked, so it cannot reach any real project
 * whatever .env.local says. Set E2E_BASE_URL to use an app you started yourself instead.
 */
export default buildConfig({ mode: 'offline', configDir: __dirname })
