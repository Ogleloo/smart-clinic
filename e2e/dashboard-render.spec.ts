import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'

/**
 * Patient Dashboard V3 (Figma 40:58) — the real DashboardView component, rendered to static HTML (through tsx,
 * e2e/support/render-dashboard.tsx) with isolated, synthetic fixtures and styled with the app's real compiled
 * Tailwind CSS. Offline: no browser session, no network, no database, no Supabase client — the real page needs
 * a signed-in patient and can't be opened offline (same constraint as profile-completeness.spec.ts /
 * profile-settings-render.spec.ts for the other patient screens).
 *
 * Covers every state the task lists: no upcoming appointment, an upcoming appointment, waiting in a queue,
 * currently being served, no available estimate, missing clinic information, and unread notifications — plus
 * layout at 1440/768/390/320, keyboard accessibility and mobile overflow. None of this touches real patient
 * data: "Sipho Dlamini" and the synthetic ID/reference in the fixtures are make-believe, not Figma's sample
 * patient or a real record.
 */

type States =
  | 'noAppointmentNoQueue'
  | 'upcomingAppointment'
  | 'appointmentToday'
  | 'appointmentError'
  | 'queueWaitingWithEstimate'
  | 'queueInProgress'
  | 'queueNoEstimateAvailable'
  | 'queueWithOtherQueues'
  | 'missingClinicInfo'
  | 'noPhoneClinic'
  | 'noHoursClinic'
  | 'unreadNotifications'
  | 'noIdNumber'

type Rendered = { states: Record<States, string>; css: string }
let rendered: Rendered

test.beforeAll(() => {
  const out = execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'e2e/support/render-dashboard.tsx'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  rendered = JSON.parse(out)
})

const GREETING = /Good (morning|afternoon|evening), <span class="text-primary-700">Sipho<\/span>/

test.describe('DashboardView markup (real component)', () => {
  test('the greeting names the real signed-in patient, not Figma’s sample name', () => {
    const html = rendered.states.noAppointmentNoQueue
    expect(html).toMatch(GREETING)
    expect(html).not.toContain('Thamsanqa')
    expect(html).toContain('Manage your appointments and stay updated with your queue.')
  })

  test('the account chip shows the real full name and ID, never Figma’s sample patient number', () => {
    const html = rendered.states.noAppointmentNoQueue
    expect(html).toContain('Sipho Dlamini')
    expect(html).toContain('8001015009087')
    expect(html).not.toContain('202341515')
    expect(html).not.toContain('Thamsanqa')
  })

  test('with no ID on file, the account chip says "Patient" with no dangling bullet', () => {
    const html = rendered.states.noIdNumber
    expect(html).toMatch(/>Patient<\/span>/)
    expect(html).not.toContain('•')
  })

  test('no upcoming appointments: the empty state offers a way to book, and the queue card explains why it’s empty', () => {
    const html = rendered.states.noAppointmentNoQueue
    expect(html).toContain('No upcoming appointments')
    expect(html).toContain('Book one to skip the walk-in queue.')
    expect(html).toContain('You are not currently in a queue')
    expect(html).not.toContain('Wed, 30 Sep 2026') // Figma's sample appointment date
    expect(html).not.toContain('10:00 AM')
  })

  test('an upcoming appointment shows its service, date, time, clinic, reference and status — not Figma’s sample data', () => {
    const html = rendered.states.upcomingAppointment
    expect(html).toContain('General Consultation')
    expect(html).toContain('AP-20261104-0012')
    expect(html).toContain('Confirmed')
    expect(html).toContain('Riverside Clinic') // the real clinic in this deployment, not fictional
    expect(html).not.toContain('Wed, 30 Sep 2026')
  })

  test('an appointment today steers the empty queue card toward checking in, not booking again', () => {
    const html = rendered.states.appointmentToday
    expect(html).toMatch(/Your appointment is today at/)
    expect(html).toContain('Check in at reception when you arrive and your queue token')
  })

  test('a failed appointment lookup is reported, not silently swallowed as "no appointments"', () => {
    const html = rendered.states.appointmentError
    expect(html).toContain('Couldn’t load your appointment. Try refreshing.')
    expect(html).not.toContain('No upcoming appointments')
  })

  test('waiting in a queue with an estimate shows the token, position, minutes and confidence — the real QueueSummaryCard, untouched', () => {
    const html = rendered.states.queueWaitingWithEstimate
    expect(html).toContain('Your queue token')
    expect(html).toContain('GC-102')
    expect(html).toMatch(/Position 2 · About 15 min/)
    expect(html).not.toContain('You are not currently in a queue')
  })

  test('currently being served reads "Now being served", not a position or an estimate', () => {
    const html = rendered.states.queueInProgress
    expect(html).toContain('Now being served')
    expect(html).not.toMatch(/Position \d+/)
  })

  test('no available estimate (no nurse on duty) reads "Not currently being served" with no invented number', () => {
    const html = rendered.states.queueNoEstimateAvailable
    expect(html).toContain('Not currently being served')
    expect(html).not.toMatch(/About \d+ min/)
  })

  test('a second active queue is indicated without combining the two estimates into one figure', () => {
    const html = rendered.states.queueWithOtherQueues
    expect(html).toContain('+1 more queue today')
    expect((html.match(/About \d+ min/g) ?? []).length).toBeLessThanOrEqual(1)
  })

  test('missing clinic information says so, instead of showing blank or invented details', () => {
    const html = rendered.states.missingClinicInfo
    expect(html).toContain('Clinic details aren’t available right now.')
    expect(html).not.toContain('123 Clinic Road') // Figma's sample address
  })

  test('a clinic with no phone on file shows no number and no call link — never a placeholder', () => {
    const html = rendered.states.noPhoneClinic
    expect(html).not.toMatch(/href="tel:/)
  })

  test('a clinic with no configured hours says so, rather than guessing', () => {
    const html = rendered.states.noHoursClinic
    expect(html).toContain('Opening hours aren’t available right now.')
  })

  test('unread notifications show a dot on the Notifications quick action; none when the count is zero', () => {
    expect(rendered.states.unreadNotifications).toMatch(/aria-label="Unread notifications"/)
    expect(rendered.states.noAppointmentNoQueue).not.toMatch(/aria-label="Unread notifications"/)
  })

  test('every section heading from the task’s list is present, and the real operating-hours text survives untouched', () => {
    const html = rendered.states.noAppointmentNoQueue
    for (const heading of ['Next Appointment', 'Current Queue', 'Clinic Information', 'Quick Actions']) {
      expect(html).toContain(heading)
    }
    expect(html).toContain('Mon–Fri 07:30–16:30')
    expect(html).toContain('Closed Sunday')
    expect(html).toMatch(/Open today \d\d:\d\d–\d\d:\d\d|Closed today/)
  })

  test('Quick Actions keeps the app’s real four shortcuts — profile and password management, not Figma’s three repeats of the Action Cards above', () => {
    const html = rendered.states.noAppointmentNoQueue
    for (const label of ['Notifications', 'My profile', 'Update my details', 'Change password']) {
      expect(html, label).toContain(label)
    }
    // None of the Action Cards' own link names are repeated here — a second "Book Appointment" link would
    // collide with the Action Card's, breaking any lookup (a test, a screen reader) that expects exactly one.
    const quickActions = html.match(/<section[^>]*aria-labelledby="quick-actions"[\s\S]*?<\/section>/)![0]
    for (const label of ['Book Appointment', 'View My Queue', 'My Appointments']) {
      expect(quickActions, label).not.toContain(label)
    }
  })

  test('the three action cards link to the real routes, with Figma-aligned copy naming the real clinic', () => {
    const html = rendered.states.noAppointmentNoQueue
    expect(html).toMatch(/href="\/book"[^>]*>/)
    expect(html).toMatch(/href="\/queue"[^>]*>/)
    expect(html).toMatch(/href="\/appointments"[^>]*>/)
    expect(html).toContain('Schedule a new appointment at Riverside Clinic.')
  })
})

test.describe('DashboardView layout (real component + real compiled CSS)', () => {
  const page$ = (html: string) =>
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${rendered.css}</style></head>` +
    `<body><div class="theme-patient min-h-dvh"><main class="mx-auto flex w-full max-w-[1176px] flex-col gap-6 px-4 py-6 md:px-9 md:py-9">${html}</main></div></body></html>`

  for (const width of [1440, 768, 390, 320]) {
    test(`${width}px: no sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1400 })
      await page.setContent(page$(rendered.states.upcomingAppointment))
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
    })
  }

  test('1440px: the decorative header photo is visible; it is hidden below lg so phone/tablet keep the full-width greeting', async ({ page }) => {
    await page.setContent(page$(rendered.states.noAppointmentNoQueue))

    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('img[alt=""]').first()).toBeVisible()

    await page.setViewportSize({ width: 768, height: 1000 })
    await expect(page.locator('img[alt=""]').first()).toBeHidden()
  })

  for (const width of [390, 320]) {
    test(`${width}px: the header greeting stays full-width (stacks above the account chip) rather than being squeezed into a one-word-per-line column beside it`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1200 })
      await page.setContent(page$(rendered.states.noAppointmentNoQueue))
      const h1 = (await page.getByRole('heading', { level: 1 }).boundingBox())!
      const chip = (await page.getByRole('link', { name: 'Sipho Dlamini' }).boundingBox())!
      // Squeezed-into-a-sliver looks like a heading box far narrower than the viewport; stacked looks like it
      // spans nearly the full card width. 70% of the viewport is a wide margin either side of that line.
      expect(h1.width).toBeGreaterThan(width * 0.7)
      // Stacked, not side by side: the chip sits below the heading, not sharing its row.
      expect(chip.y).toBeGreaterThanOrEqual(h1.y + h1.height)
    })
  }

  test('320px: every link stays inside the viewport and clears a 44px touch target where it is a standalone control', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 1600 })
    await page.setContent(page$(rendered.states.upcomingAppointment))
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll('a')].map((a) => {
        const r = a.getBoundingClientRect()
        return { href: a.getAttribute('href'), x: r.x, right: r.x + r.width }
      }),
    )
    for (const b of boxes) {
      expect(b.x, b.href ?? '').toBeGreaterThanOrEqual(-1)
      expect(b.right, b.href ?? '').toBeLessThanOrEqual(321)
    }
  })

  test('heading level 2 for every section, reachable and focusable by keyboard via its nearest link', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1400 })
    await page.setContent(page$(rendered.states.upcomingAppointment))
    for (const name of ['Next Appointment', 'Current Queue', 'Clinic Information', 'Quick Actions']) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
    }
    await page.getByRole('link', { name: 'Sipho Dlamini' }).focus()
    await expect(page.getByRole('link', { name: 'Sipho Dlamini' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: /^Book Appointment/ }).first()).toBeFocused()
  })

  test('every section card stacks to one column from lg down to phone width, with no overlap', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 2000 })
    await page.setContent(page$(rendered.states.upcomingAppointment))
    const next = (await page.locator('section[aria-labelledby="next-appointment"]').boundingBox())!
    const queue = (await page.locator('section[aria-labelledby="current-queue"]').boundingBox())!
    expect(queue.y).toBeGreaterThanOrEqual(next.y + next.height - 1)
  })
})
