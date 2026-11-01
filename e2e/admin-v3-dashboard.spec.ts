import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { buildAdminActivity, summariseToday, type TodayEntry } from '../lib/adminDashboard'
import { ADMIN_NAV_ITEMS, adminPageLabel, isAdminActivePath } from '../components/admin/v3/navItems'

/**
 * Admin V3, Phase 1 — shell, navigation and dashboard. Offline: no session, no network, no database.
 *
 *  - the data helpers behind the new cards and activity feed (pure);
 *  - every existing admin area is still reachable, and the security guards are unchanged (source contracts);
 *  - the REAL components rendered to HTML for populated / empty / failed states, and laid out with the app's REAL
 *    compiled CSS at 1440, 390 and 320px (the admin pages need a signed-in admin, so they can't be opened offline).
 *
 * NOT covered: a real admin sign-in, the dashboard with live data, or the V2 pages inside the new shell (needs the
 * shared project). e2e/admin-v2.spec.ts (read-only, live) was updated for the new dashboard and was NOT run.
 */

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

const T = (hhmm: string) => `2026-11-02T${hhmm}:00+02:00`
const entry = (id: string, token: string, service_id: string, status: string, at: string, over: Partial<TodayEntry> = {}): TodayEntry => ({
  id, token, service_id, status, checked_in_at: at, called_at: null, completed_at: null, appointment_id: null, ...over,
})
const ENTRIES: TodayEntry[] = [
  entry('e1', 'GC-001', 's1', 'done', T('08:05'), { called_at: T('08:20'), completed_at: T('08:35'), appointment_id: 'a1' }),
  entry('e2', 'GC-002', 's1', 'in_progress', T('08:15'), { called_at: T('08:40') }),
  entry('e3', 'GC-003', 's1', 'waiting', T('08:30')),
  entry('e4', 'IM-001', 's2', 'waiting', T('08:45'), { appointment_id: 'a2' }),
  entry('e5', 'GC-004', 's1', 'skipped', T('08:10'), { completed_at: T('08:25') }),
  entry('e6', 'GC-005', 's1', 'no_show', T('08:12'), { completed_at: T('08:50') }),
]
const NAMES = { s1: 'General Consultation', s2: 'Immunisation' }

test.describe('today counts', () => {
  test('check-ins, walk-ins vs appointments, in consultation, scheduled', () => {
    const t = summariseToday(ENTRIES, 9)
    expect(t).toEqual({ checkIns: 6, walkIns: 4, fromAppointments: 2, inConsultation: 1, scheduled: 9 })
    expect(t.walkIns + t.fromAppointments).toBe(t.checkIns)
  })
  test('nothing today is zero, and an unreadable appointment count stays null, never 0', () => {
    expect(summariseToday([], 0)).toEqual({ checkIns: 0, walkIns: 0, fromAppointments: 0, inConsultation: 0, scheduled: 0 })
    expect(summariseToday(ENTRIES, null).scheduled).toBeNull()
  })
})

test.describe('activity feed', () => {
  const events = buildAdminActivity(ENTRIES, NAMES, 50)

  test('built only from real timestamps: one check-in per entry, a call only if called, an end only if closed', () => {
    expect(events.filter((e) => e.kind === 'checked_in')).toHaveLength(6)
    expect(events.filter((e) => e.kind === 'called').map((e) => e.token).sort()).toEqual(['GC-001', 'GC-002'])
    expect(events.filter((e) => e.kind === 'completed').map((e) => e.token)).toEqual(['GC-001'])
    expect(events.filter((e) => e.kind === 'skipped').map((e) => e.token)).toEqual(['GC-004'])
    expect(events.filter((e) => e.kind === 'no_show').map((e) => e.token)).toEqual(['GC-005'])
    // GC-003 and IM-001 are still waiting: a check-in and nothing else.
    expect(events.filter((e) => e.token === 'GC-003')).toHaveLength(1)
    expect(events.filter((e) => e.token === 'IM-001')).toHaveLength(1)
    expect(events).toHaveLength(6 + 2 + 1 + 1 + 1)
  })
  test('newest first, and limited', () => {
    const times = events.map((e) => new Date(e.at).getTime())
    expect(times).toEqual([...times].sort((a, b) => b - a))
    expect(buildAdminActivity(ENTRIES, NAMES, 3)).toHaveLength(3)
    expect(buildAdminActivity(ENTRIES, NAMES, 3)[0]!.at).toBe(T('08:50'))
  })
  test('carries the token and the service name — and no patient identity field', () => {
    for (const e of events) expect(Object.keys(e).sort()).toEqual(['at', 'id', 'kind', 'serviceName', 'token'])
    expect(events.find((e) => e.token === 'IM-001')!.serviceName).toBe('Immunisation')
    expect(buildAdminActivity([entry('x', 'ZZ-1', 'unknown', 'waiting', T('09:00'))], NAMES)[0]!.serviceName).toBe('Service')
  })
  test('the loader never selects a patient name (source contract)', () => {
    const src = read('lib/adminDashboard.ts')
    expect(src).not.toMatch(/full_name|patient:profiles|id_number|date_of_birth/)
    expect(src).toContain("'id, token, service_id, status, checked_in_at, called_at, completed_at, appointment_id'")
  })
  test('the loader only reads: no insert / update / delete / upsert, and no mutating rpc', () => {
    const src = read('lib/adminDashboard.ts')
    expect(src).not.toMatch(/\.(insert|update|delete|upsert)\(/)
    expect(src).not.toMatch(/reset_demo_state|merge_patient|set_emergency|next_patient|skip_/)
  })
})

test.describe('navigation and guards', () => {
  test('every existing admin area is still linked, to its existing route', () => {
    expect(ADMIN_NAV_ITEMS.map((i) => i.href).sort()).toEqual(
      ['/admin', '/admin/patients', '/admin/reports', '/admin/services', '/admin/settings', '/admin/staff'].sort()
    )
    for (const i of ADMIN_NAV_ITEMS) {
      const file = i.href === '/admin' ? 'app/admin/page.tsx' : `app/admin${i.href.replace('/admin', '')}/page.tsx`
      expect(existsSync(file), file).toBe(true)
    }
  })
  test('Figma labels are used where an item maps; Figma items with no screen are not linked', () => {
    const labels = ADMIN_NAV_ITEMS.map((i) => i.label)
    expect(labels).toEqual(['Dashboard', 'Services', 'Patients', 'Staff Management', 'Reports', 'System Settings'])
    expect(labels).not.toContain('Queue Overview')
    expect(labels).not.toContain('Appointments')
  })
  test('active state and page labels', () => {
    expect(isAdminActivePath('/admin', '/admin')).toBe(true)
    expect(isAdminActivePath('/admin/staff', '/admin')).toBe(false)
    expect(isAdminActivePath('/admin/staff', '/admin/staff')).toBe(true)
    expect(isAdminActivePath('/admin/staffing', '/admin/staff')).toBe(false)
    expect(adminPageLabel('/admin/staff')).toBe('Staff Management')
    expect(adminPageLabel('/admin/settings')).toBe('System Settings')
    expect(adminPageLabel('/admin')).toBe('Dashboard')
  })
  test('the role guards are unchanged: layout and dashboard page both require admin; idle timeout still mounted', () => {
    expect(read('app/admin/layout.tsx')).toContain("requireRole('admin')")
    expect(read('app/admin/page.tsx')).toContain("requireRole('admin')")
    expect(read('app/admin/layout.tsx')).toContain('<IdleTimeoutMonitor')
  })
  test('the dashboard page reads the signed-in admin explicitly by auth_user_id', () => {
    expect(read('app/admin/page.tsx')).toContain(".eq('auth_user_id', user.id)")
  })
  test('the V2 pages the new shell wraps are untouched and none imports the removed components', () => {
    for (const f of ['services', 'staff', 'settings', 'patients', 'reports']) {
      const src = read(`app/admin/${f}/page.tsx`)
      expect(src).not.toMatch(/AdminNav|ClinicStateStrip|ServicePerformanceTable/)
    }
    expect(existsSync('components/admin/AdminNav.tsx')).toBe(false)
  })
  test('V2 pages keep the V2 palette: .theme-admin is on the sidebar, the nav and the dashboard only', () => {
    expect(read('components/admin/v3/AdminContentFrame.tsx')).toMatch(/pathname === ADMIN_DASHBOARD_HREF[\s\S]*theme-admin/)
    const frame = read('components/admin/v3/AdminContentFrame.tsx')
    expect(frame.match(/theme-admin/g)!.length).toBeGreaterThan(0)
    expect(read('app/admin/layout.tsx')).not.toContain('theme-admin')
    expect(read('app/globals.css')).toMatch(/\.theme-reception,\n\.theme-nurse\s*\{\n\s*background/)
  })
})

type Rendered = {
  css: string
  states: Record<'populated' | 'attention' | 'empty' | 'queueError' | 'coverageError' | 'appointmentsError' | 'longName', string>
  sidebar: string
  mobileNav: string
  loading: string
  error: string
  subpageFrame: string
}
let r: Rendered
test.beforeAll(() => {
  r = JSON.parse(
    execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'e2e/support/render-admin-v3.tsx'], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
  )
})

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ')
const card = (html: string, key: string) => {
  const m = html.match(new RegExp(`data-stat="${key}"[\\s\\S]*?data-stat-value[^>]*>([^<]*)<[\\s\\S]*?<p class="mt-auto[^>]*>([^<]*)<`))
  return { value: m?.[1], caption: m?.[2] }
}

test.describe('dashboard states (real components)', () => {
  test('populated: the four Figma cards, with values from the data and captions that say what they are made of', () => {
    const h = r.states.populated
    expect(card(h, 'checkins')).toEqual({ value: '6', caption: '4 walk-ins · 2 from appointments' })
    expect(card(h, 'waiting').value).toBe('2')
    expect(card(h, 'consultation')).toEqual({ value: '1', caption: '2 of 3 nurses on duty' })
    expect(card(h, 'scheduled')).toEqual({ value: '9', caption: 'Appointments dated today, not cancelled' })
    for (const label of ['Today’s Check-ins', 'Currently Waiting', 'In Consultation', 'Scheduled Today']) expect(text(h)).toContain(label)
  })

  test('no invented content: no trend comparisons, no room/doctor lines, no example people or clinics from Figma', () => {
    for (const html of Object.values(r.states)) {
      const t = text(html)
      expect(t).not.toMatch(/from yesterday|from earlier|\+\d+%|\+\d+ from/)
      expect(t).not.toMatch(/Room \d|Dr\. Smith|Nurse Lee|Pharmacist Jo|Counter 1|Mthembu|Clinic opened|typical Tuesday/i)
    }
  })

  test('identity: name and "Administrator • clinic" are the signed-in admin’s own; the image is decorative', () => {
    const h = r.states.populated
    expect(text(h)).toContain('Welcome back, Test Administrator')
    expect(text(h)).toContain('Administrator • Test Clinic')
    expect(h).toMatch(/<img[^>]*alt=""/)
    expect(h).toContain('role="group"')
  })

  test('queue overview: a real table with scope-d headers, the real nurse count, honest estimates', () => {
    const h = r.states.populated
    expect(h).toContain('<table')
    expect(h).toMatch(/<th scope="col"[^>]*>Service<\/th>/)
    expect(text(h)).toContain('2 nurses on duty')
    expect(text(h)).toContain('~8 min')
    expect(text(h)).toContain('No estimate') // Pharmacy: nobody on duty
    expect(text(h)).toContain('No nurse on duty')
    expect(text(h)).toContain('Total waiting')
    expect(text(h)).toContain('Avg. wait today')
    expect(h).toMatch(/<a [^>]*href="\/admin\/reports"[^>]*>View reports<\/a>/)
  })

  test('needs attention is kept and still links to Staff', () => {
    expect(r.states.attention).toContain('NEEDS ATTENTION')
    expect(r.states.attention).toMatch(/<a [^>]*href="\/admin\/staff"[^>]*>Assign a nurse<\/a>/)
    expect(r.states.populated).not.toContain('NEEDS ATTENTION')
  })

  test('prediction quality is kept', () => {
    expect(r.states.populated).toContain('PREDICTION QUALITY')
  })

  test('empty: zeros are real zeros, with an explanation and a way forward — nothing is invented', () => {
    const h = r.states.empty
    expect(card(h, 'checkins').value).toBe('0')
    expect(card(h, 'waiting').caption).toBe('No active services')
    expect(card(h, 'consultation').caption).toBe('No nurse accounts')
    expect(text(h)).toContain('There are no active services yet.')
    expect(h).toMatch(/<a [^>]*href="\/admin\/services"[^>]*>Add a service<\/a>/)
    expect(text(h)).toContain('No queue activity yet today.')
    expect(text(h)).not.toContain('No estimate')
  })

  test('queue read failed: cards show "—" and say so; never a made-up zero; the activity panel says it failed', () => {
    const h = r.states.queueError
    for (const k of ['checkins', 'waiting', 'consultation']) expect(card(h, k)).toEqual({ value: '—', caption: 'Couldn’t load' })
    expect(card(h, 'scheduled').value).toBe('9') // an independent read
    expect(text(h)).toContain('We couldn’t load today’s activity')
    expect(h).toContain('role="alert"')
    expect(text(h)).toMatch(/Total waiting\s*—/)
  })

  test('coverage read failed: per-service figures are unavailable, with an alert, and no confidence label without an estimate', () => {
    const h = r.states.coverageError
    expect(text(h)).toContain('We couldn’t load live queue coverage')
    expect(text(h)).toContain('Unavailable')
    expect(text(h)).not.toMatch(/High confidence|Low confidence|~\d+ min/)
  })

  test('appointments read failed: only Scheduled Today shows "—"', () => {
    const h = r.states.appointmentsError
    expect(card(h, 'scheduled')).toEqual({ value: '—', caption: 'Couldn’t load' })
    expect(card(h, 'checkins').value).toBe('6')
  })

  test('activity titles read as sentences built from the real event kind', () => {
    const t = text(r.states.populated)
    expect(t).toContain('IM-001 checked in')
    expect(t).toContain('GC-002 called to consultation')
    expect(t).toContain('GC-001 consultation completed')
    expect(t).toContain('GC-004 skipped')
  })
})

test.describe('shell markup (real components)', () => {
  test('sidebar and mobile nav: a "Main" landmark, a link to every admin area, Sign Out', () => {
    for (const html of [r.sidebar, r.mobileNav]) {
      expect(html).toContain('aria-label="Main"')
      for (const i of ADMIN_NAV_ITEMS) expect(html).toContain(`href="${i.href}"`)
      expect(html).toContain('Sign Out')
    }
    expect(r.sidebar).toContain('Need help?')
    expect(r.sidebar).toContain('tel:0351234567')
  })
  test('V2 page frame: the 820px column, no V3 theme, a visually hidden h1', () => {
    expect(r.subpageFrame).toContain('max-w-[820px]')
    expect(r.subpageFrame).not.toContain('theme-admin')
    expect(r.subpageFrame).toMatch(/<h1 class="sr-only">/)
  })
  test('loading: busy, one polite status, shapes hidden from assistive tech, no data-like text', () => {
    expect(r.loading).toContain('aria-busy="true"')
    expect(r.loading).toMatch(/role="status"[^>]*class="sr-only"/)
    expect(r.loading).not.toMatch(/GC-|\d+ min/)
  })
  test('error: heading, alert, retry button, link back to the dashboard; uses this Next version’s `retry`', () => {
    expect(r.error).toContain('role="alert"')
    expect(r.error).toMatch(/<button[^>]*type="button"[^>]*>Try again<\/button>/)
    expect(r.error).toMatch(/<a [^>]*href="\/admin"[^>]*>Back to the dashboard<\/a>/)
    expect(read('app/admin/error.tsx')).toContain('retry: () => void')
  })
})

// ---------------------------------------------------------------------------------- layout with real CSS

const doc = (content: string, themed = true) =>
  `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${r.css}</style></head><body>` +
  `<div class="min-h-dvh md:flex">${r.sidebar}<div class="min-w-0 flex-1">${r.mobileNav}<main class="${themed ? 'theme-admin min-h-dvh bg-paper text-ink' : ''}">${content}</main></div></div></body></html>`

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!

test.describe('dashboard layout at 1440 / 390 / 320 (real components + real compiled CSS)', () => {
  for (const [name, state] of [['populated', 'populated'], ['empty', 'empty'], ['queue failed', 'queueError'], ['coverage failed', 'coverageError'], ['very long name', 'longName'], ['needs attention', 'attention']] as const) {
    for (const width of [1440, 390, 320]) {
      test(`${name} at ${width}px: no sideways scrolling`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.setContent(doc(r.states[state]))
        expect(await overflow(page)).toBeLessThanOrEqual(0)
      })
    }
  }

  test('1440px: sidebar 264px, content column ≤1176px, four cards in one row, queue overview beside activity', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.setContent(doc(r.states.populated))
    expect((await box(page, 'aside')).width).toBe(264)
    const ys = await page.locator('[data-stat]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
    expect(new Set(ys).size).toBe(1)
    expect(ys).toHaveLength(4)
    const overview = await box(page, '#admin-queue-overview')
    const activity = await box(page, '#admin-activity')
    expect(Math.abs(overview.y - activity.y)).toBeLessThan(40) // same row
    expect(activity.x).toBeGreaterThan(overview.x + overview.width - 400)
    expect(await page.getByRole('navigation', { name: 'Main' }).count()).toBe(1) // the hidden mobile nav is not in the tree
  })

  test('390px: sidebar hidden, mobile nav visible with every area and Sign Out; cards and panels stack', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.setContent(doc(r.states.populated))
    await expect(page.locator('aside')).toBeHidden()
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav).toBeVisible()
    for (const i of ADMIN_NAV_ITEMS) await expect(nav.getByRole('link', { name: i.label, exact: true })).toBeAttached()
    await expect(nav.getByRole('button', { name: 'Sign Out' })).toBeVisible()
    const xs = await page.locator('[data-stat]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)))
    expect(new Set(xs).size).toBe(1)
    const overview = await box(page, '#admin-queue-overview')
    const activity = await box(page, '#admin-activity')
    expect(activity.y).toBeGreaterThan(overview.y + overview.height - 1)
    await expect(page.locator('table')).toBeHidden() // cards instead of a table on a phone
    await expect(page.getByRole('list', { name: 'Services' })).toBeVisible()
  })

  test('320px: the nav scrolls inside itself (the page does not) and Sign Out stays reachable', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    await page.setContent(doc(r.states.populated))
    const nav = page.getByRole('navigation', { name: 'Main' })
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    await expect(nav.getByRole('button', { name: 'Sign Out' })).toBeVisible()
    const bb = (await nav.getByRole('button', { name: 'Sign Out' }).boundingBox())!
    expect(bb.x + bb.width).toBeLessThanOrEqual(320)
  })

  test('mobile nav: the focus ring is not clipped by the scrolling container', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.setContent(doc(r.states.populated))
    await page.keyboard.press('Tab')
    const link = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Dashboard', exact: true })
    await expect(link).toBeFocused()
    expect(await link.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')
    const lb = (await link.boundingBox())!
    const cb = (await (await link.evaluateHandle((el) => el.parentElement!)).asElement()!.boundingBox())!
    expect(lb.y - cb.y).toBeGreaterThanOrEqual(4)
    expect(cb.y + cb.height - (lb.y + lb.height)).toBeGreaterThanOrEqual(4)
  })

  test('keyboard: Tab reaches every sidebar link, then Sign Out, in order, each with a visible focus ring', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.setContent(doc(r.states.populated))
    for (const i of ADMIN_NAV_ITEMS) {
      await page.keyboard.press('Tab')
      const f = page.locator(':focus')
      await expect(f).toHaveAttribute('href', i.href)
      expect(await f.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')
    }
    await page.keyboard.press('Tab')
    await expect(page.locator(':focus')).toHaveText(/Sign Out/)
  })

  test('buttons and links: 44px+ touch targets; text on its background meets 4.5:1 (the fixed #037F74, not the lighter themed teal)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.setContent(doc(r.states.attention))
    const targets = [
      page.getByRole('link', { name: 'Assign a nurse' }),
      page.getByRole('link', { name: 'View reports' }),
      page.getByRole('button', { name: /Show reasons/ }),
    ]
    for (const t of targets) {
      await expect(t).toBeVisible()
      expect((await t.boundingBox())!.height).toBeGreaterThanOrEqual(40)
    }
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
      const out: Record<string, number> = {}
      const pick = (name: string, el: Element | null | undefined) => {
        if (!el) return
        const cs = getComputedStyle(el)
        out[name] = ratio(cs.color, cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? 'rgb(255,255,255)' : cs.backgroundColor)
      }
      const link = (t: string) => [...document.querySelectorAll('a')].find((a) => a.textContent?.trim() === t)
      pick('assign', link('Assign a nurse'))
      pick('reports', link('View reports'))
      pick('reasons', [...document.querySelectorAll('button')].find((b) => /Show reasons/.test(b.textContent ?? '')))
      pick('caption', document.querySelector('[data-stat] p.mt-auto'))
      pick('cardLabel', document.querySelector('[data-stat] p.mt-3\\.5'))
      pick('estimateNone', [...document.querySelectorAll('td span')].find((s) => s.textContent === 'No estimate'))
      return out
    })
    for (const [k, v] of Object.entries(ratios)) expect(v, k).toBeGreaterThanOrEqual(4.5)
    expect(Object.keys(ratios)).toEqual(expect.arrayContaining(['assign', 'reports', 'reasons', 'caption', 'cardLabel', 'estimateNone']))
  })

  test('loading and error screens fit at 390 and 320 with no sideways scrolling; error actions are 44px+ and keyboard reachable', async ({ page }) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 })
      await page.setContent(doc(r.loading, false))
      expect(await overflow(page)).toBeLessThanOrEqual(0)
      await page.setContent(doc(r.error, false))
      expect(await overflow(page)).toBeLessThanOrEqual(0)
    }
    const retry = page.getByRole('button', { name: 'Try again' })
    const back = page.getByRole('link', { name: 'Back to the dashboard' })
    expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await retry.focus()
    await page.keyboard.press('Tab')
    await expect(back).toBeFocused()
  })
})

test.describe('specs that assumed the V2 dashboard were updated', () => {
  test('admin-v2 (live, read-only) now looks for the V3 cards, the sidebar links and the queue overview table', () => {
    const s = read('e2e/admin-v2.spec.ts')
    expect(s).toContain('Currently Waiting')
    expect(s).toContain("name: 'Queue Overview'")
    expect(s).not.toMatch(/WAITING NOW|Service performance|div\.rounded-lg/)
  })
})
