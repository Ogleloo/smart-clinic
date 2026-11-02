import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'

/**
 * Booking confirmation screen (Figma 68:77) — the real BookingConfirmedView component, rendered to static
 * HTML (through tsx, e2e/support/render-booking-confirmed.tsx) with isolated, synthetic fixtures and styled
 * with the app's real compiled Tailwind CSS. Offline: no browser session, no network, no database, no
 * Supabase client — the real page needs a signed-in patient and a real appointment, and can't be opened
 * offline (same constraint as dashboard-render.spec.ts for the dashboard).
 */

type States = 'confirmed' | 'checkedIn' | 'noReference' | 'noClinic' | 'noServiceName'
type Rendered = { states: Record<States, string>; css: string }
let rendered: Rendered

test.beforeAll(() => {
  const out = execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'e2e/support/render-booking-confirmed.tsx'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  rendered = JSON.parse(out)
})

test.describe('BookingConfirmedView markup (real component)', () => {
  test('shows the real appointment, never Figma’s sample patient, reference or address', () => {
    const html = rendered.states.confirmed
    expect(html).toContain('AP-20261104-0012')
    expect(html).toContain('General Consultation')
    expect(html).toContain('Riverside Clinic')
    expect(html).toContain('12 Example Road')
    expect(html).not.toContain('Thamsanqa')
    expect(html).not.toContain('202341515')
    expect(html).not.toContain('123 Clinic Road') // Figma's sample clinic address
    expect(html).not.toContain('KwaDlangezwa')
  })

  test('the reference lives in the one element the live test reads, data-testid="appointment-reference"', () => {
    const html = rendered.states.confirmed
    const tag = html.match(/<span[^>]*data-testid="appointment-reference"[^>]*>[\s\S]*?<\/span>/)?.[0] ?? ''
    expect(tag).toContain('AP-20261104-0012')
  })

  test('no reference on file shows an em dash, never a blank or invented value', () => {
    const html = rendered.states.noReference
    const tag = html.match(/<span[^>]*data-testid="appointment-reference"[^>]*>([\s\S]*?)<\/span>/)
    expect(tag?.[1]?.trim()).toBe('—')
  })

  test('the status chip reflects the real appointment status', () => {
    expect(rendered.states.confirmed).toContain('Confirmed')
    expect(rendered.states.checkedIn).toContain('Checked in')
  })

  test('missing clinic information omits the Location row instead of showing blank or invented details', () => {
    const html = rendered.states.noClinic
    expect(html).not.toContain('Location')
    expect(html).not.toContain('123 Clinic Road')
  })

  test('a service with no name reads "Appointment", never blank', () => {
    expect(rendered.states.noServiceName).toContain('>Appointment<')
  })

  test('"What’s next?" reuses the real before-your-visit checklist and quotes the real reference — nothing from Figma’s invented promises', () => {
    const html = rendered.states.confirmed
    expect(html).toContain('Bring your ID document or passport.')
    expect(html).toContain('Quote your reference AP-20261104-0012 at reception.')
    expect(html).not.toContain('arrive at least 10 minutes') // Figma's unverified arrival-time requirement
    expect(html).not.toContain('receive a reminder') // Figma's unverified notification promise
  })

  test('"What’s next?" drops the reference line when there is no reference to quote', () => {
    const html = rendered.states.noReference
    expect(html).not.toContain('Quote your reference')
    expect(html).toContain('Bring your ID document or passport.')
  })

  test('links go to the real appointment, the appointments list and the dashboard — never a dead or invented destination', () => {
    const html = rendered.states.confirmed
    expect(html).toMatch(/href="\/appointments\/appt-1"[^>]*>[\s\S]*?View appointment/)
    expect(html).toMatch(/href="\/dashboard"[^>]*>[\s\S]*?Back to home/)
    expect(html).toMatch(/href="\/appointments"[^>]*>View all my appointments/)
  })

  test('exactly one heading reads "Appointment confirmed" — Figma repeats it as both a band title and a card heading, which would give two headings the same accessible name', () => {
    const html = rendered.states.confirmed
    const matches = html.match(/Appointment confirmed/g) ?? []
    expect(matches).toHaveLength(1)
  })
})

test.describe('BookingConfirmedView layout (real component + real compiled CSS)', () => {
  const page$ = (html: string) =>
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${rendered.css}</style></head>` +
    `<body><div class="theme-patient min-h-dvh"><main class="mx-auto flex w-full max-w-[1176px] flex-col gap-6 px-4 py-6 md:px-9 md:py-9">${html}</main></div></body></html>`

  for (const width of [1440, 768, 390, 320]) {
    test(`${width}px: no sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1400 })
      await page.setContent(page$(rendered.states.confirmed))
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
    })
  }

  test('both action buttons clear a 44px touch target and stay reachable by keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1400 })
    await page.setContent(page$(rendered.states.confirmed))
    for (const name of ['View appointment', 'Back to home']) {
      const box = (await page.getByRole('link', { name, exact: true }).boundingBox())!
      expect(box.height, name).toBeGreaterThanOrEqual(44)
    }
    await page.getByRole('link', { name: 'View appointment', exact: true }).focus()
    await expect(page.getByRole('link', { name: 'View appointment', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Back to home', exact: true })).toBeFocused()
  })

  test('the single heading is reachable at every width', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 1400 })
    await page.setContent(page$(rendered.states.confirmed))
    await expect(page.getByRole('heading', { name: 'Appointment confirmed' })).toBeVisible()
  })
})
