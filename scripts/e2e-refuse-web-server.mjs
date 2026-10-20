// Used as playwright's webServer command when e2e/support/web-server-plan.ts refuses to start the app (it would be wired to
// shared/hosted infrastructure). Prints the reason (variable and file NAMES only, never values) and exits non-zero, so the run
// stops with an explanation instead of silently starting a server that reads .env.local.
console.error(`\n${process.env.E2E_REFUSAL_REASON ?? 'REFUSING TO START THE APP: it would be wired to shared infrastructure.'}\n`)
process.exitCode = 1
