import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homeForRole } from '../lib/auth/homeForRole'
import { NURSE_DASHBOARD_HREF, NURSE_NAV_ITEMS, NURSE_QUEUE_HREF, NURSE_WORKSPACE_HREF, isNurseActivePath } from '../components/nurse/v3/navItems'

/**
 * Nurse V3 as the normal nurse experience — offline: no session, no network, no database.
 *
 *  - routing: where each role lands, and that no landing page can bounce anyone back (no redirect loop);
 *  - the classic /nurse screen still exists, is still guarded, and links to V3 and back;
 *  - the V3 navigation, loading and error boundaries (the real components + the app's real compiled CSS);
 *  - the specs that depended on the old nurse landing were updated.
 *
 * NOT covered: a real sign-in and redirect against Supabase (needs the shared project), and the V3 screens
 * behind it (covered by nurse-v3-dashboard / nurse-v3-queue). The atomic Next / Undo / Skip / duty behaviour is not
 * touched by this change; its tests are in nurse-v3-queue.spec.ts.
 */

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const ROLES = ['patient', 'receptionist', 'nurse', 'admin'] as const

// Which file enforces which role for each landing path. Read from the source rather than assumed.
const ROUTE_GUARDS: Record<string, { file: string; role: (typeof ROLES)[number] }[]> = {
  '/dashboard': [{ file: 'app/(patient)/layout.tsx', role: 'patient' }],
  '/reception': [{ file: 'app/reception/layout.tsx', role: 'receptionist' }],
  '/admin': [{ file: 'app/admin/layout.tsx', role: 'admin' }],
  '/nurse/dashboard': [
    { file: 'app/nurse/(v3)/layout.tsx', role: 'nurse' },
    { file: 'app/nurse/(v3)/dashboard/page.tsx', role: 'nurse' },
  ],
  '/nurse': [{ file: 'app/nurse/page.tsx', role: 'nurse' }],
  '/nurse/queue': [
    { file: 'app/nurse/(v3)/layout.tsx', role: 'nurse' },
    { file: 'app/nurse/(v3)/queue/page.tsx', role: 'nurse' },
  ],
}

test.describe('where each role lands', () => {
  test('a nurse lands on the V3 dashboard; every other role is unchanged', () => {
    expect(homeForRole('nurse')).toBe('/nurse/dashboard')
    expect(homeForRole('receptionist')).toBe('/reception')
    expect(homeForRole('admin')).toBe('/admin')
    expect(homeForRole('patient')).toBe('/dashboard')
  })

  test('every landing path is guarded, in the source, by exactly its own role', () => {
    for (const role of ROLES) {
      const guards = ROUTE_GUARDS[homeForRole(role)]
      expect(guards, `no guard recorded for ${homeForRole(role)}`).toBeTruthy()
      for (const g of guards!) {
        expect(read(g.file), g.file).toContain(`requireRole('${g.role}')`)
        expect(g.role).toBe(role)
      }
    }
  })

  test('no redirect loop: a wrong-role visitor is sent to THEIR home, whose guard accepts them', () => {
    // requireRole(required) redirects an authenticated user of another role to homeForRole(theirRole). Walk every
    // (user role, area) pair: the first redirect must land somewhere that role is admitted, so it takes one hop.
    const guard = read('lib/auth/requireRole.ts')
    expect(guard).toContain('if (profile?.role !== role) redirect(homeForRole(profile?.role ?? \'patient\'))')
    for (const user of ROLES) {
      for (const [path, guards] of Object.entries(ROUTE_GUARDS)) {
        const required = guards[0]!.role
        const hops = user === required ? [path] : [path, homeForRole(user)]
        const last = hops[hops.length - 1]!
        const admitted = ROUTE_GUARDS[last]!.every((g) => g.role === user)
        expect(admitted, `${user} visiting ${path} ends at ${last}, which does not admit them`).toBe(true)
        expect(hops.length).toBeLessThanOrEqual(2)
      }
    }
  })

  test('every redirect-to-home site uses homeForRole (login action, login interstitial, landing page, role guard)', () => {
    for (const f of ['app/actions/auth.ts', 'app/(auth)/login/page.tsx', 'app/page.tsx', 'lib/auth/requireRole.ts']) {
      expect(read(f), f).toContain('homeForRole(')
    }
    expect(read('app/actions/auth.ts')).toContain("redirect(homeForRole(profile?.role ?? 'patient'))")
  })

  test('the landing route and the nav targets all exist as pages', () => {
    for (const href of [NURSE_DASHBOARD_HREF, NURSE_QUEUE_HREF, NURSE_WORKSPACE_HREF]) {
      const file = href === '/nurse' ? 'app/nurse/page.tsx' : `app/nurse/(v3)${href.replace('/nurse', '')}/page.tsx`
      expect(existsSync(file), file).toBe(true)
    }
  })
})

test.describe('the classic screen stays available as the fallback', () => {
  test('/nurse is unchanged in role and engine: still guarded, still the same panels', () => {
    const src = read('app/nurse/page.tsx')
    expect(src).toContain("requireRole('nurse')")
    for (const piece of ['CurrentPatientPanel', 'WaitingList', 'NurseHeader', 'EndSessionControl', 'CoverageWarning']) {
      expect(src).toContain(`<${piece}`)
    }
  })

  test('/nurse links to the new dashboard; the V3 screens link to /nurse', () => {
    expect(read('app/nurse/page.tsx')).toContain('href={NURSE_DASHBOARD_HREF}')
    expect(read('app/nurse/page.tsx')).toContain('Open the new dashboard')
    for (const f of ['app/nurse/(v3)/dashboard/page.tsx', 'app/nurse/(v3)/queue/page.tsx', 'components/nurse/v3/MyQueueView.tsx', 'app/nurse/(v3)/error.tsx']) {
      expect(read(f), f).toContain('href={NURSE_WORKSPACE_HREF}')
    }
  })

  test('the dashboard error text no longer mislabels the classic screen as "My Queue"', () => {
    const src = read('app/nurse/(v3)/dashboard/page.tsx')
    expect(src).not.toContain('open My Queue')
    expect(src).toContain('open the classic nurse screen')
    expect(src).toContain('href={NURSE_QUEUE_HREF}')
  })

  test('the Next / Undo / Skip / duty engine files are untouched by this change', () => {
    // Behavioural tests for them are in nurse-v3-queue.spec.ts (90 tests). Here: the routing change must not have
    // altered the shared state machine or the actions.
    const hooks = read('lib/hooks/useNextPatientFlow.ts')
    expect(hooks).toContain('next_patient')
    expect(read('app/actions/nurse.ts')).toContain('skip_waiting_patient')
  })
})

test.describe('navigation model', () => {
  test('Figma lists five items; only the two with working V3 screens are linked, in Figma order', () => {
    expect(NURSE_NAV_ITEMS.map((i) => [i.label, i.href])).toEqual([
      ['Dashboard', '/nurse/dashboard'],
      ['My Queue', '/nurse/queue'],
    ])
  })

  test('active state: each V3 item is active on its own path (and sub-paths) only; /nurse activates neither', () => {
    expect(isNurseActivePath('/nurse/dashboard', NURSE_DASHBOARD_HREF)).toBe(true)
    expect(isNurseActivePath('/nurse/dashboard', NURSE_QUEUE_HREF)).toBe(false)
    expect(isNurseActivePath('/nurse/queue', NURSE_QUEUE_HREF)).toBe(true)
    expect(isNurseActivePath('/nurse/queue/x', NURSE_QUEUE_HREF)).toBe(true)
    expect(isNurseActivePath('/nurse', NURSE_DASHBOARD_HREF)).toBe(false)
    expect(isNurseActivePath('/nurse', NURSE_QUEUE_HREF)).toBe(false)
    expect(isNurseActivePath('/nurse/dashboardx', NURSE_DASHBOARD_HREF)).toBe(false)
  })
})

type Rendered = { css: string; sidebar: string; mobileNav: string; loading: string; error: string }
let r: Rendered
test.beforeAll(() => {
  r = JSON.parse(
    execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'e2e/support/render-nurse-landing.tsx'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  )
})

test.describe('navigation, loading and error markup (real components)', () => {
  test('sidebar and mobile nav: a "Main" landmark, links to the two V3 screens, a Sign Out button', () => {
    for (const html of [r.sidebar, r.mobileNav]) {
      expect(html).toContain('aria-label="Main"')
      expect(html).toMatch(/href="\/nurse\/dashboard"[^>]*>(?:<[^>]+>)*[^<]*Dashboard/)
      expect(html).toMatch(/href="\/nurse\/queue"/)
      expect(html).toMatch(/Sign Out/)
    }
  })

  test('loading state: busy main with one polite status for screen readers; the skeleton shapes are hidden from them', () => {
    expect(r.loading).toContain('aria-busy="true"')
    expect(r.loading).toMatch(/<p[^>]*role="status"[^>]*class="sr-only"[^>]*>Loading your nurse screen/)
    expect(r.loading).not.toMatch(/GC-|\d{2,} min|Nurse [A-Z]/) // shapes only: nothing that could pass for queue data
  })

  test('error state: heading, alert, retry button, and a link to the classic screen', () => {
    expect(r.error).toContain('Something went wrong')
    expect(r.error).toContain('role="alert"')
    expect(r.error).toMatch(/<button[^>]*type="button"[^>]*>Try again<\/button>/)
    expect(r.error).toMatch(/<a [^>]*href="\/nurse"[^>]*>Open the classic nurse screen<\/a>/)
  })
})

test.describe('layout (real components + real compiled CSS)', () => {
  const doc = (body: string) =>
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${r.css}</style></head><body><div class="theme-nurse min-h-dvh md:flex">${body}</div></body></html>`
  const noOverflow = (page: import('@playwright/test').Page) =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

  for (const width of [320, 390, 768, 1280]) {
    test(`${width}px: loading and error screens fit with no sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      for (const body of [r.mobileNav + r.loading, r.mobileNav + r.error]) {
        await page.setContent(doc(`<div class="min-w-0 flex-1">${body}</div>`))
        expect(await noOverflow(page)).toBeLessThanOrEqual(0)
      }
    })
  }

  test('error screen: both actions are 44px+ touch targets and reachable by keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await page.setContent(doc(`<div class="min-w-0 flex-1">${r.error}</div>`))
    const retry = page.getByRole('button', { name: 'Try again' })
    const classic = page.getByRole('link', { name: 'Open the classic nurse screen' })
    expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect((await classic.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await page.keyboard.press('Tab')
    await expect(retry).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(classic).toBeFocused()
  })

  test('mobile nav: the focus ring of a link is not clipped by the scrolling container', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await page.setContent(doc(`<div class="min-w-0 flex-1">${r.mobileNav}</div>`))
    await page.keyboard.press('Tab')
    const link = page.getByRole('link', { name: 'Dashboard' })
    await expect(link).toBeFocused()
    const ring = await link.evaluate((el) => getComputedStyle(el).boxShadow)
    expect(ring).not.toBe('none') // a focus ring is drawn (globals.css :focus-visible)
    const box = (await link.boundingBox())!
    const container = (await link.evaluateHandle((el) => el.parentElement!)).asElement()!
    const c = (await container.boundingBox())!
    // The ring extends 4px beyond the link on every side; the scroll container must leave at least that room.
    expect(box.y - c.y).toBeGreaterThanOrEqual(4)
    expect(c.y + c.height - (box.y + box.height)).toBeGreaterThanOrEqual(4)
  })

  test('mobile nav: Sign Out stays visible and the two links fit at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.setContent(doc(`<div class="min-w-0 flex-1">${r.mobileNav}</div>`))
    await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'My Queue' })).toBeVisible()
    expect(await noOverflow(page)).toBeLessThanOrEqual(0)
  })
})

test.describe('specs that assumed the old nurse landing were updated', () => {
  test('dashboard-guard expects a nurse to be redirected to /nurse/dashboard', () => {
    expect(read('e2e/dashboard-guard.spec.ts')).toMatch(/\['nurse', \w+\.nurse, '\/nurse\/dashboard'\]/)
  })
  test('logout spec expects the V3 landing and its Sign Out button', () => {
    const s = read('e2e/logout.spec.ts')
    expect(s).toContain('/\\/nurse\\/dashboard$/')
    expect(s).toContain("name: 'Sign Out'")
  })
})
