import { evaluateE2eSafety, unsafeConfigurationError } from './e2e-safety'
import { establishLocalTarget } from './local-stack'

/**
 * Registered by playwright.config.ts ONLY when destructive testing is enabled. Re-checks the environment (the config
 * already refused an unsafe one) and then proves the app SERVER reads the local stack: a canary service that exists only
 * in that stack must render on the app's /display page, so an app quietly wired to .env.local (the shared project) makes
 * every test fail before anything is written. The canary is created in and removed from the local stack alone.
 */
export default async function globalSetup() {
  const safety = evaluateE2eSafety(process.env)
  if (!safety.destructive) return
  if (safety.problems.length) throw unsafeConfigurationError(safety.problems)
  await establishLocalTarget()
}
