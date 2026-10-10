import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@playwright/test'
import type { HarnessResponse } from './mocks/state'

/**
 * Serves the harness bundle at a same-origin URL on the dev server (so the app's real compiled CSS and fonts
 * apply), and routes every other request through a fail-closed filter: only GETs for /_next/static assets pass.
 * Anything else — a Supabase call, a Server Action POST, any other fetch — is aborted and recorded in
 * `escapes`, which every test asserts is empty.
 */
export const HARNESS_URL = 'http://localhost:3000/__nurse-queue-harness'

let bundle: string | null = null
let shell: { cssLinks: string[]; htmlClass: string } | null = null

export function buildHarnessBundle(): string {
  if (bundle) return bundle
  const outfile = path.join(os.tmpdir(), `nurse-queue-harness-${process.pid}.js`)
  execFileSync(process.execPath, ['e2e/support/nurse-queue-harness/build.mjs', outfile], { stdio: 'pipe', timeout: 120_000 })
  bundle = readFileSync(outfile, 'utf8')
  return bundle
}

/** The stylesheet links and <html> font classes of a real app page, so the harness renders with the same CSS. */
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

export interface HarnessConfig {
  mode: 'queue' | 'classic'
  props: Record<string, unknown>
  defaults?: Record<string, HarnessResponse>
  online?: boolean
}

export async function openHarness(page: Page, cfg: HarnessConfig): Promise<{ escapes: string[] }> {
  const js = buildHarnessBundle()
  const { cssLinks, htmlClass } = await appShell()
  const escapes: string[] = []
  const html = `<!doctype html><html lang="en" class="${htmlClass}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${cssLinks
    .map((h) => `<link rel="stylesheet" href="${h}">`)
    .join('')}<title>Harness</title></head><body class="antialiased"><div id="root"></div><script src="/__nurse-queue-harness.js"></script></body></html>`

  await page.route('**/*', (route) => {
    const req = route.request()
    const url = req.url()
    if (url === HARNESS_URL) return route.fulfill({ contentType: 'text/html', body: html })
    if (url === `${HARNESS_URL}.js`) return route.fulfill({ contentType: 'application/javascript', body: js })
    const u = new URL(url)
    if (req.method() === 'GET' && u.origin === 'http://localhost:3000' && u.pathname.startsWith('/_next/static/')) return route.continue()
    escapes.push(`${req.method()} ${url}`)
    return route.abort()
  })
  await page.addInitScript((c) => {
    ;(window as unknown as { __harnessConfig: unknown }).__harnessConfig = c
  }, cfg)
  await page.goto(HARNESS_URL)
  return { escapes }
}

/** Calls recorded by the mocks, optionally filtered by name. */
export async function calls(page: Page, name?: string): Promise<{ name: string; args: unknown[] }[]> {
  const all = await page.evaluate(() => window.__harness.calls)
  return name ? all.filter((c) => c.name === name) : all
}

export async function queueResponse(page: Page, name: string, ...responses: HarnessResponse[]) {
  await page.evaluate(
    ([n, rs]) => {
      const h = window.__harness
      ;(h.responses[n] ??= []).push(...rs)
    },
    [name, responses] as const
  )
}

export async function setDefault(page: Page, name: string, response: HarnessResponse) {
  await page.evaluate(([n, r]) => (window.__harness.defaults[n] = r), [name, response] as const)
}

export async function release(page: Page, name: string) {
  await page.evaluate((n) => window.__harness.release(n), name)
}

export async function fireQueueChange(page: Page) {
  await page.evaluate(() => window.__harness.fireQueueChange())
}
