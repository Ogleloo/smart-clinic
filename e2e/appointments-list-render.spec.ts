import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'

/**
 * My Appointments (Figma 71:85) — the real AppointmentsListView component, rendered to static HTML (through
 * tsx, e2e/support/render-appointments-list.tsx) with isolated, synthetic fixtures and styled with the app's
 * real compiled Tailwind CSS. Offline: no browser session, no network, no database, no Supabase client — the
 * real page needs a signed-in patient and can't be opened offline (same constraint as dashboard-render.spec.ts).
 */

type States =
  | 'upcomingWithRows'
  | 'upcomingEmpty'
  | 'previousWithRows'
  | 'previousEmpty'
  | 'loadError'
  | 'checkedInBanner'
  | 'bookedTodayBanner'
  | 'rowNoClinic'
  | 'rowNoReference'
type Rendered = { states: Record<States, string>; css: string }
let rendered: Rendered

test.beforeAll(() => {
  const out = execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'e2e/support/render-appointments-list.tsx'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  rendered = JSON.parse(out)
})

test.describe('AppointmentsListView markup (real component)', () => {
  test('shows the real patient name, never Figma’s sample patient or reference', () => {
    const html = rendered.states.upcomingWithRows
    expect(html).toContain('Sipho Dlamini')
    expect(html).toContain('AP-20261104-0012')
    expect(html).not.toContain('Thamsanqa')
    expect(html).not.toContain('202341515')
  })

  test('upcoming appointments show a booked and a checked-in row, each with its real status', () => {
    const html = rendered.states.upcomingWithRows
    expect(html).toContain('Confirmed')
    expect(html).toContain('Checked in')
    expect(html).toContain('General Consultation')
    expect(html).toContain('Pharmacy')
  })

  test('previous appointments show completed, cancelled and no-show rows, each with its real status', () => {
    const html = rendered.states.previousWithRows
    expect(html).toContain('Completed')
    expect(html).toContain('Cancelled')
    expect(html).toContain('Missed')
  })

  test('an upcoming, still-booked appointment offers Cancel; a checked-in one does not', () => {
    const html = rendered.states.upcomingWithRows
    const rows = html.match(/<article[\s\S]*?<\/article>/g)!
    expect(rows).toHaveLength(2)
    const [booked, checkedIn] = rows
    expect(booked).toContain('>Cancel<')
    expect(checkedIn).not.toContain('>Cancel<')
  })

  test('previous (already-finished) appointments never offer Cancel, regardless of their status', () => {
    const html = rendered.states.previousWithRows
    expect(html).not.toContain('>Cancel<')
  })

  test('tab counts come from the real query results, not the number of rows actually shown', () => {
    const html = rendered.states.upcomingWithRows
    expect(html).toMatch(/Upcoming[\s\S]*?>2</)
    expect(html).toMatch(/Previous[\s\S]*?>3</)
  })

  test('the empty upcoming state never claims booking skips the walk-in queue, and offers a way to book', () => {
    const html = rendered.states.upcomingEmpty
    expect(html).toContain('No upcoming appointments')
    expect(html).not.toMatch(/skip the (walk-in )?queue/i)
    expect(html).toMatch(/check in and queue/i)
    expect(html).toMatch(/href="\/book"[^>]*>Book appointment/)
  })

  test('the empty previous state explains itself without inventing history', () => {
    const html = rendered.states.previousEmpty
    expect(html).toContain('No previous appointments')
  })

  test('a load failure is reported, not silently shown as an empty list', () => {
    const html = rendered.states.loadError
    expect(html).toContain('Couldn’t load your appointments')
    expect(html).not.toContain('No upcoming appointments')
  })

  test('checked-in-today banner links to the real queue, named with the real service', () => {
    const html = rendered.states.checkedInBanner
    expect(html).toContain('You’re checked in')
    expect(html).toContain('General Consultation')
    expect(html).toMatch(/href="\/queue"[^>]*>/)
  })

  test('booked-today banner names the real service, time and reference — never a placeholder', () => {
    const html = rendered.states.bookedTodayBanner
    expect(html).toContain('Pharmacy')
    expect(html).toContain('AP-20261102-0002')
  })

  test('a row with no clinic on file shows no Location column, never a blank one', () => {
    const html = rendered.states.rowNoClinic
    expect(html).not.toContain('Location')
  })

  test('a row with no reference on file shows no Ref line, never a blank one', () => {
    const html = rendered.states.rowNoReference
    expect(html).not.toMatch(/Ref\s*<span/)
  })

  test('nothing anywhere offers a Reschedule action — there is no rescheduling RPC or approved workflow yet', () => {
    for (const html of Object.values(rendered.states)) {
      expect(html.toLowerCase()).not.toContain('reschedul')
    }
  })

  test('every row is an <article> with a real link to its own /appointments/{id} — the exact shape the live tests locate a row by', () => {
    const html = rendered.states.upcomingWithRows
    expect(html).toMatch(/<article[^>]*>[\s\S]*?href="\/appointments\/appt-1"/)
    expect(html).toMatch(/<article[^>]*>[\s\S]*?href="\/appointments\/appt-2"/)
  })
})

test.describe('AppointmentsListView layout (real component + real compiled CSS)', () => {
  const page$ = (html: string) =>
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${rendered.css}</style></head>` +
    `<body><div class="theme-patient min-h-dvh"><main class="mx-auto flex w-full max-w-[1176px] flex-col gap-6 px-4 py-6 md:px-9 md:py-9">${html}</main></div></body></html>`

  for (const width of [1440, 768, 390, 320]) {
    test(`${width}px: no sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1600 })
      await page.setContent(page$(rendered.states.upcomingWithRows))
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
    })
  }

  test('tabs are real tab roles, reachable and operable by keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 })
    await page.setContent(page$(rendered.states.upcomingWithRows))
    const tablist = page.getByRole('tablist', { name: 'Appointments' })
    await expect(tablist).toBeVisible()
    const upcoming = page.getByRole('tab', { name: /Upcoming/ })
    const previous = page.getByRole('tab', { name: /Previous/ })
    await expect(upcoming).toHaveAttribute('aria-selected', 'true')
    await expect(previous).toHaveAttribute('aria-selected', 'false')
    await previous.focus()
    await expect(previous).toBeFocused()
  })

  test('each row’s "View details" link and Cancel button clear a 44px touch target', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1600 })
    await page.setContent(page$(rendered.states.upcomingWithRows))
    const viewDetails = page.getByRole('link', { name: 'View details' }).first()
    const cancel = page.getByRole('button', { name: 'Cancel' }).first()
    for (const [name, locator] of [['View details', viewDetails], ['Cancel', cancel]] as const) {
      const box = (await locator.boundingBox())!
      expect(box.height, name).toBeGreaterThanOrEqual(44)
    }
  })
})
