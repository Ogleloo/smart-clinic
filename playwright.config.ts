import { buildConfig } from './e2e/support/playwright-config'

/**
 * Regression/integration tests (default configuration). Where they run and who they sign in as come from the environment
 * (e2e/helpers.ts): no credential is committed and nothing defaults to the shared production project (the repository is public).
 *
 * Fail-closed behaviour — the spec allowlist, the destructive opt-in, and the refusal to start an app wired to shared
 * infrastructure — lives in e2e/support/playwright-config.ts. For no-backend, no-credential runs use
 * `npm run test:e2e:offline` (playwright.offline.config.ts).
 */
export default buildConfig({ mode: 'default', configDir: __dirname })
