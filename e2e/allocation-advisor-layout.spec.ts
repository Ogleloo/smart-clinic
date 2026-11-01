import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { ADMIN_NAV_ITEMS } from '../components/admin/v3/navItems'

/**
 * Allocation Advisor page — layout, accessibility and read-only contracts. Offline: the real component and the app's
 * real compiled CSS inside the real Admin V3 shell parts, no session, no network, no database. (The route itself needs
 * a signed-in admin, so it cannot be opened offline; its role guard is checked from the source.)
 *
 * NOT covered: the interactive controls in a real browser session (the scenario logic is covered by
 * nurse-allocation-advisor.spec.ts), and the live page with real data (needs the shared project).
 */

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

type Rendered = { css: string; sidebar: string; mobileNav: string; states: Record<'live' | 'empty' | 'servicesError' | 'coverageError', string> }
let r: Rendered
test.beforeAll(() => {
  r = JSON.parse(
    execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'e2e/support/render-allocation-advisor.tsx'], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
  )
})

const doc = (content: string) =>
  `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${r.css}</style></head><body>` +
  `<div class="min-h-dvh md:flex">${r.sidebar}<div class="min-w-0 flex-1">${r.mobileNav}<main class="theme-admin min-h-dvh bg-paper text-ink">${content}</main></div></div></body></html>`
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test.describe('route, navigation and read-only contracts (source)', () => {
  test('the page is admin-guarded, and the sidebar links to it', () => {
    expect(read('app/admin/allocation-advisor/page.tsx')).toContain("requireRole('admin')")
    expect(ADMIN_NAV_ITEMS.map((i) => i.href)).toContain('/admin/allocation-advisor')
    expect(ADMIN_NAV_ITEMS.find((i) => i.href === '/admin/allocation-advisor')!.label).toBe('Allocation Lab')
  })
  test('the page sends the client only service-level aggregates (no names, ids of people, or raw rows)', () => {
    const s = read('app/admin/allocation-advisor/page.tsx')
    const sent = s.slice(s.indexOf('liveServices={'), s.indexOf('errors={{'))
    expect(sent.match(/(\w+):/g)!.sort()).toEqual(
      ['estimatedWaitMinutes:', 'isBeingServed:', 'nursesOnDuty:', 'serviceId:', 'serviceName:', 'waitingCount:']
    )
  })
  test('no mutation: the page, view and model import no write action, server action, or Supabase client', () => {
    for (const p of ['app/admin/allocation-advisor/page.tsx', 'components/admin/v3/AllocationAdvisorView.tsx', 'lib/research/nurseAllocationAdvisor.ts']) {
      const s = read(p)
      expect(s, p).not.toMatch(/from '@\/app\/actions|'use server'|createClient|\.from\(|\.rpc\(/)
    }
  })
  test('live figures are never fed into the simulation', () => {
    const view = read('components/admin/v3/AllocationAdvisorView.tsx')
    const model = read('lib/research/nurseAllocationAdvisor.ts')
    expect(model).not.toMatch(/adminDashboard|liveServices/)
    expect(view).not.toMatch(/evaluateScenario\([^)]*liveServices|useState\([^)]*liveServices/)
  })
})

test.describe('layout at 1440 / 390 / 320 (real component + real compiled CSS)', () => {
  for (const state of ['live', 'empty', 'servicesError', 'coverageError'] as const) {
    for (const width of [1440, 390, 320]) {
      test(`${state} at ${width}px: the page does not scroll sideways`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.setContent(doc(r.states[state]))
        expect(await overflow(page)).toBeLessThanOrEqual(0)
      })
    }
  }

  test('wide tables scroll inside their own container, never the page, on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    await page.setContent(doc(r.states.live))
    const wrappers = page.locator('div.overflow-x-auto:has(table)')
    expect(await wrappers.count()).toBeGreaterThanOrEqual(2)
    for (let i = 0; i < (await wrappers.count()); i++) {
      const w = wrappers.nth(i)
      const [client, scroll] = await w.evaluate((el) => [el.clientWidth, el.scrollWidth])
      expect(client).toBeLessThanOrEqual(320)
      expect(scroll).toBeGreaterThanOrEqual(client)
    }
    expect(await overflow(page)).toBeLessThanOrEqual(0)
  })

  test('1440px: sidebar beside a content column of at most 1176px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.setContent(doc(r.states.live))
    expect((await page.locator('aside').boundingBox())!.width).toBe(264)
    const h1 = (await page.getByRole('heading', { level: 1 }).boundingBox())!
    expect(h1.x).toBeGreaterThan(264)
    const section = (await page.locator('section').first().boundingBox())!
    expect(section.width).toBeLessThanOrEqual(1176)
  })

  test('390px: sidebar hidden, mobile nav links to every admin area including Allocation Lab', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.setContent(doc(r.states.live))
    await expect(page.locator('aside')).toBeHidden()
    const nav = page.getByRole('navigation', { name: 'Main' })
    for (const i of ADMIN_NAV_ITEMS) await expect(nav.getByRole('link', { name: i.label, exact: true })).toBeAttached()
    await expect(nav.getByRole('link', { name: 'Allocation Lab', exact: true })).toHaveAttribute('href', '/admin/allocation-advisor')
  })

  test('controls: labelled, 44px+ touch targets; the Evaluate button and its status are present', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.setContent(doc(r.states.live))
    await expect(page.getByRole('heading', { level: 1, name: 'Smart Nurse Allocation Advisor' })).toBeVisible()
    const fields = page.getByRole('spinbutton')
    expect(await fields.count()).toBe(11) // 5 per service x 2 + the transfer delay
    for (let i = 0; i < (await fields.count()); i++) expect((await fields.nth(i).boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await expect(page.getByRole('combobox', { name: 'Scenario' })).toBeVisible()
    expect((await page.getByRole('combobox', { name: 'Scenario' }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
    const evaluate = page.getByRole('button', { name: 'Evaluate Allocation' })
    expect((await evaluate.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await expect(page.getByRole('status').filter({ hasText: 'Results match the current synthetic inputs' })).toBeVisible()
  })

  test('every control has an accessible name and the research disclaimers are on the page', async ({ page }) => {
    await page.setContent(doc(r.states.live))
    for (const c of await page.getByRole('spinbutton').all()) {
      const name = await c.evaluate((el) => (el as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? '')
      expect(name.length).toBeGreaterThan(0)
    }
    const body = await page.locator('main').innerText()
    expect(body).toContain('Research finding — not a staffing instruction')
    expect(body).toContain('does not use real patient or nurse data')
    expect(body).toContain('cannot reassign staff')
    expect(body).toContain('Policy comparison — synthetic only')
    expect(body).toContain('Assumptions and limitations')
  })

  test('keyboard: the scenario selector is reachable after the sidebar links and shows a focus ring', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.setContent(doc(r.states.live))
    const select = page.getByRole('combobox', { name: 'Scenario' })
    for (let i = 0; i < 40 && !(await select.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
    await expect(select).toBeFocused()
    expect(await select.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')
  })

  test('the Evaluate button text on #037F74 meets 4.5:1 and the muted body text meets 4.5:1', async ({ page }) => {
    await page.setContent(doc(r.states.live))
    const ratios = await page.evaluate(() => {
      const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
        return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!)
      }
      const ratio = (fg: string, bg: string) => {
        const [a, b] = [lum(parse(fg)), lum(parse(bg))].sort((x, y) => y - x)
        return (a! + 0.05) / (b! + 0.05)
      }
      const button = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Evaluate Allocation')!
      const bcs = getComputedStyle(button)
      const para = document.querySelector('section p.text-muted')!
      const pcs = getComputedStyle(para)
      return { button: ratio(bcs.color, bcs.backgroundColor), muted: ratio(pcs.color, 'rgb(255,255,255)') }
    })
    expect(ratios.button).toBeGreaterThanOrEqual(4.5)
    expect(ratios.muted).toBeGreaterThanOrEqual(4.5)
  })

  test('failed live reads are explicit, never zero', async ({ page }) => {
    await page.setContent(doc(r.states.servicesError))
    await expect(page.getByRole('alert')).toContainText('Services could not be loaded')
    await page.setContent(doc(r.states.coverageError))
    await expect(page.getByText('Unavailable', { exact: true })).toBeVisible()
    await expect(page.getByText(/an unknown value is never treated as zero/)).toBeVisible()
    await page.setContent(doc(r.states.empty))
    await expect(page.getByText('There are no active services to display.')).toBeVisible()
  })
})
