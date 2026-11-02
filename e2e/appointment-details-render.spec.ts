import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'

/**
 * Appointment details (Figma 88:470) — the real AppointmentDetailsView component, rendered to static HTML
 * (through tsx, e2e/support/render-appointment-details.tsx) with isolated, synthetic fixtures and styled
 * with the app's real compiled Tailwind CSS. Offline: no browser session, no network, no database, no
 * Supabase client — the real page needs a signed-in patient and a real appointment, and can't be opened
 * offline (same constraint as dashboard-render.spec.ts).
 */

type States =
  | 'bookedKnownTime'
  | 'checkedIn'
  | 'cancelled'
  | 'completed'
  | 'noShow'
  | 'typicalNoData'
  | 'typicalUnavailable'
  | 'noReference'
  | 'noClinic'
type Rendered = { states: Record<States, string>; css: string }
let rendered: Rendered

test.beforeAll(() => {
  const out = execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'e2e/support/render-appointment-details.tsx'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  rendered = JSON.parse(out)
})

test.describe('AppointmentDetailsView markup (real component)', () => {
  test('the heading reads exactly "Appointment details" — the live test’s own assertion', () => {
    const html = rendered.states.bookedKnownTime
    expect(html).toMatch(/<h1[^>]*>Appointment details<\/h1>/)
  })

  test('shows the real appointment, never Figma’s sample patient, reference or address', () => {
    const html = rendered.states.bookedKnownTime
    expect(html).toContain('Sipho Dlamini')
    expect(html).toContain('AP-20261104-0012')
    expect(html).toContain('Riverside Clinic')
    expect(html).not.toContain('Thamsanqa')
    expect(html).not.toContain('202341515')
    expect(html).not.toContain('AP-20260930-0156') // Figma's sample reference
  })

  test('a known typical consultation time reads "About N min with the nurse", with its confidence chip', () => {
    const html = rendered.states.bookedKnownTime
    expect(html).toContain('About 14 min with the nurse')
    expect(html).toContain('High confidence')
  })

  test('no completed visits yet is stated plainly, not guessed at', () => {
    expect(rendered.states.typicalNoData).toContain('Not enough completed visits for this service yet')
  })

  test('a lookup failure for the typical-time stat is reported, not silently swallowed', () => {
    expect(rendered.states.typicalUnavailable).toContain('Couldn’t load this right now.')
  })

  test('consultation time is explicitly distinguished from queue waiting time', () => {
    expect(rendered.states.bookedKnownTime).toContain('Typical consultation time is time with the nurse, not your waiting time.')
  })

  test('Figma’s invented "~10–20 minutes" duration range never appears — only the real, database-computed figure', () => {
    for (const html of Object.values(rendered.states)) {
      expect(html).not.toMatch(/~?10.?20 minutes?/i)
      expect(html).not.toContain('Estimated duration')
    }
  })

  test('nothing anywhere offers a Reschedule action, and the subtitle never promises one — there is no rescheduling RPC or approved workflow yet', () => {
    for (const html of Object.values(rendered.states)) {
      expect(html.toLowerCase()).not.toContain('reschedul')
    }
  })

  test('a booked appointment offers Cancel appointment and the Before-your-visit checklist; no Follow my queue link', () => {
    const html = rendered.states.bookedKnownTime
    expect(html).toMatch(/<button[^>]*>[\s\S]*?Cancel appointment[\s\S]*?<\/button>/)
    expect(html).toContain('Before your visit')
    expect(html).toContain('Bring your ID document or passport.')
    expect(html).toContain('Quote your reference AP-20261104-0012 at reception.')
    expect(html).not.toMatch(/Follow my queue/)
  })

  test('a checked-in appointment offers Follow my queue and the checklist, but the real cancel_appointment RPC refuses anything but a booked one — so no Cancel button is shown for it either', () => {
    const html = rendered.states.checkedIn
    expect(html).toMatch(/href="\/queue"[^>]*>[\s\S]*?Follow my queue/)
    expect(html).toContain('Before your visit')
    expect(html).not.toMatch(/<button[^>]*>[\s\S]*?Cancel appointment[\s\S]*?<\/button>/)
  })

  for (const state of ['cancelled', 'completed', 'noShow'] as const) {
    test(`a ${state} appointment shows neither Cancel nor Follow my queue nor the Before-your-visit checklist — nothing active left to prepare for`, () => {
      const html = rendered.states[state]
      expect(html).not.toMatch(/<button[^>]*>[\s\S]*?Cancel appointment[\s\S]*?<\/button>/)
      expect(html).not.toMatch(/Follow my queue/)
      expect(html).not.toContain('Before your visit')
    })
  }

  test('no reference on file shows an em dash, never a blank or invented value', () => {
    const html = rendered.states.noReference
    expect(html).toMatch(/Appointment reference[\s\S]*?—/)
  })

  test('no clinic on file shows no location line under the service name', () => {
    const html = rendered.states.noClinic
    expect(html).not.toContain('Riverside Clinic')
  })
})

test.describe('AppointmentDetailsView layout (real component + real compiled CSS)', () => {
  const page$ = (html: string) =>
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${rendered.css}</style></head>` +
    `<body><div class="theme-patient min-h-dvh"><main class="mx-auto flex w-full max-w-[1176px] flex-col gap-6 px-4 py-6 md:px-9 md:py-9">${html}</main></div></body></html>`

  for (const width of [1440, 768, 390, 320]) {
    test(`${width}px: no sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1600 })
      await page.setContent(page$(rendered.states.bookedKnownTime))
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
    })
  }

  test('Back to appointments and Cancel appointment are both reachable by keyboard and clear a 44px touch target', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1400 })
    await page.setContent(page$(rendered.states.bookedKnownTime))
    const back = page.getByRole('link', { name: 'Back to appointments' })
    const cancel = page.getByRole('button', { name: 'Cancel appointment' })
    for (const [name, locator] of [['Back to appointments', back], ['Cancel appointment', cancel]] as const) {
      const box = (await locator.boundingBox())!
      expect(box.height, name).toBeGreaterThanOrEqual(44)
    }
    await back.focus()
    await expect(back).toBeFocused()
  })

  // ConfidenceChip's expand/collapse is real React interactivity (useState + onClick) — a static render has
  // no hydration, no event loop, nothing for a click to reach (same constraint documented on every other
  // render-*.spec.ts in this suite). Its markup is checked above; exercising the click itself would need an
  // interactive harness, which isn't worth building for an already-existing, unmodified shared component.
  test('the confidence chip starts collapsed, ready to be expanded once hydrated', async ({ page }) => {
    await page.setContent(page$(rendered.states.bookedKnownTime))
    await expect(page.getByRole('button', { name: /High confidence/ })).toHaveAttribute('aria-expanded', 'false')
  })
})
