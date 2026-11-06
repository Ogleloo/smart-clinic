import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@playwright/test'
import type { SignOutHarnessResponse } from './mocks/state'

/**
 * Serves the harness bundle at a same-origin URL on the dev server (so the app's real compiled CSS and fonts
 * apply), and routes every other request through a fail-closed filter: only GETs for /_next/static assets pass.
 * Anything else — a Supabase call, a Server Action POST, any other fetch — is aborted and recorded in `escapes`,
 * asserted empty by every test. That is what makes "Cancel sent nothing" a provable claim and not an assumption.
 */
export const SIGNOUT_HARNESS_URL = 'http://localhost:3000/__signout-confirm-harness'

let bundle: string | null = null
let shell: { cssLinks: string[]; htmlClass: string } | null = null

export function buildSignOutHarnessBundle(): string {
  if (bundle) return bundle
  const outfile = path.join(os.tmpdir(), `signout-confirm-harness-${process.pid}.js`)
  execFileSync(process.execPath, ['e2e/support/signout-confirm-harness/build.mjs', outfile], {
    stdio: 'pipe',
    timeout: 120_000,
  })
  bundle = readFileSync(outfile, 'utf8')
  return bundle
}

async function appShell(): Promise<{ cssLinks: string[]; htmlClass: string }> {
  if (shell) return shell
  const res = await fetch('http://localhost:3000/login')
  const html = await res.text()
  const cssLinks = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]!)
  const htmlClass = /<html[^>]*class="([^"]*)"/.exec(html)?.[1] ?? ''
  if (cssLinks.length === 0) throw new Error('harness: no stylesheet found on /login')
  shell = { cssLinks, htmlClass }
  return shell
}

export interface SignOutHarnessConfig {
  /** How many SignOutConfirm copies to mount (two proves the per-instance ARIA ids). Defaults to 1. */
  instances?: number
  defaults?: Record<string, SignOutHarnessResponse>
}

export async function openSignOutHarness(page: Page, cfg: SignOutHarnessConfig = {}): Promise<{ escapes: string[] }> {
  const js = buildSignOutHarnessBundle()
  const { cssLinks, htmlClass } = await appShell()
  const escapes: string[] = []
  const html = `<!doctype html><html lang="en" class="${htmlClass}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${cssLinks
    .map((h) => `<link rel="stylesheet" href="${h}">`)
    .join('')}<title>Harness</title></head><body class="antialiased"><div id="root"></div><script src="/__signout-confirm-harness.js"></script></body></html>`

  await page.route('**/*', (route) => {
    const req = route.request()
    const url = req.url()
    if (url === SIGNOUT_HARNESS_URL) return route.fulfill({ contentType: 'text/html', body: html })
    if (url === `${SIGNOUT_HARNESS_URL}.js`) return route.fulfill({ contentType: 'application/javascript', body: js })
    const u = new URL(url)
    if (req.method() === 'GET' && u.origin === 'http://localhost:3000' && u.pathname.startsWith('/_next/static/')) {
      return route.continue()
    }
    escapes.push(`${req.method()} ${url}`)
    return route.abort()
  })
  await page.addInitScript((c) => {
    ;(window as unknown as { __signOutHarnessConfig: unknown }).__signOutHarnessConfig = c
  }, { instances: cfg.instances ?? 1, defaults: cfg.defaults })
  await page.goto(SIGNOUT_HARNESS_URL)
  return { escapes }
}

/** Every call the mocked logout() received. Length is the whole assertion: 0 after Cancel, exactly 1 after confirm. */
export async function signOutCalls(page: Page): Promise<{ name: string }[]> {
  return page.evaluate(() => window.__signOutHarness.calls)
}

export async function queueSignOutResponse(page: Page, ...responses: SignOutHarnessResponse[]) {
  await page.evaluate((rs) => {
    const h = window.__signOutHarness
    ;(h.responses['logout'] ??= []).push(...rs)
  }, responses)
}

export async function releaseSignOut(page: Page) {
  await page.evaluate(() => window.__signOutHarness.release('logout'))
}
