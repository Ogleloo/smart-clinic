import { test, expect as baseExpect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { ACCOUNTS, loginAs as rawLoginAs } from './helpers'
import {
  abbreviatePatientName,
  buildActivityEvents,
  buildQueueRows,
  getNurseDashboardData,
  type ActivityConsultationRow,
  type NurseDashboardData,
} from '../lib/nurseDashboard'
import { summariseSeenToday } from '../lib/nurseStats'
import { todayInClinicTimezone } from '../lib/clinicTime'
import { buildStatCards } from '../components/nurse/v3/NurseStatCards'
import { formatActivityTime } from '../components/nurse/v3/RecentActivityPanel'
import { NURSE_NAV_ITEMS } from '../components/nurse/v3/navItems'

/**
 * Nurse V3 dashboard (Phase 1, Figma frame 161:3).
 *
 * Three kinds of test, none of which changes a row in the shared project:
 *  1. Pure logic — the mapping from database rows to what the screen shows.
 *  2. The real components rendered to static HTML with synthetic props (e2e/support/render-nurse-dashboard-
 *     states.tsx, run through tsx), to check every duty / failure state without touching the database. The
 *     page's own reads are server-side, so page.route cannot fake them; a presentational view fed by
 *     props can be exercised directly instead.
 *  3. The live page, read-only: sign in as the demo nurse and look. Nothing here calls next_patient,
 *     undo, skip, set_duty or end_shift, and no Server Action is invoked (asserted below).
 */

// ------------------------------------------------------------------ fixtures

type QueueRpcRow = Parameters<typeof buildQueueRows>[0][number]
const q = (id: string, token: string, name: string, status: 'waiting' | 'in_progress', priority: number, mins: number): QueueRpcRow => ({
  queue_entry_id: id,
  queue_position: 0,
  token,
  patient_name: name,
  priority,
  status,
  checked_in_at: '2026-10-12T08:00:00Z',
  waiting_minutes: mins,
})

const cons = (
  id: string,
  token: string,
  name: string | null,
  started: string,
  ended: string | null,
  excluded = false,
  reason: string | null = null
): ActivityConsultationRow => ({
  id,
  started_at: started,
  ended_at: ended,
  exclude_from_prediction: excluded,
  exclusion_reason: reason,
  queue_entry: { token, patient: name === null ? null : { full_name: name } },
})

function baseData(over: Partial<NurseDashboardData> = {}): NurseDashboardData {
  return {
    nurse: { fullName: 'Test Nurse', clinicName: 'Test Clinic', isOnDuty: true, serviceId: 's1', serviceName: 'General Consultation' },
    queueScoped: true,
    currentEntry: null,
    queue: [],
    queueTotal: 0,
    waitingCount: 0,
    seenToday: { count: 0, avgMinutes: null },
    serviceAverageMinutes: null,
    activity: [],
    errors: {},
    ...over,
  }
}

const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

// ------------------------------------------------------------------ 1. pure logic

test.describe('queue rows: order, position, elapsed vs estimate', () => {
  const rows = [
    q('a', 'GC-101', 'In Room', 'in_progress', 0, 40),
    q('b', 'GC-107', 'Emergency Person', 'waiting', 1, 3),
    q('c', 'GC-102', 'First Waiting', 'waiting', 0, 25),
    q('d', 'GC-103', 'Second Waiting', 'waiting', 0, 15),
  ]

  test('keeps the order the database returned (emergency stays ahead of an earlier check-in)', () => {
    const { rows: out } = buildQueueRows(rows)
    expect(out.map((r) => r.token)).toEqual(['GC-101', 'GC-107', 'GC-102', 'GC-103'])
    expect(out[1]!.isEmergency).toBe(true)
    expect(out[2]!.isEmergency).toBe(false)
  })

  test('position ranks only the waiting patients; someone already being seen has none', () => {
    const { rows: out, waitingCount } = buildQueueRows(rows)
    expect(out.map((r) => r.position)).toEqual([null, 1, 2, 3])
    expect(waitingCount).toBe(3)
  })

  test('real statuses are kept, not collapsed', () => {
    const { rows: out } = buildQueueRows(rows)
    expect(out.map((r) => r.status)).toEqual(['in_progress', 'waiting', 'waiting', 'waiting'])
  })

  test('elapsed minutes are the database figure; the estimate is separate and absent unless the engine gave one', () => {
    const { rows: out } = buildQueueRows(rows, { b: 7, c: null })
    expect(out[1]).toMatchObject({ elapsedMinutes: 3, estimatedMinutes: 7 })
    expect(out[2]).toMatchObject({ elapsedMinutes: 25, estimatedMinutes: null })
    expect(out[3]).toMatchObject({ elapsedMinutes: 15, estimatedMinutes: null }) // no entry in the map at all
    expect(out[0]).toMatchObject({ elapsedMinutes: null, estimatedMinutes: null }) // being seen: neither applies
  })

  test('a waiting row whose elapsed time is empty stays unknown (null), never 0', () => {
    const { rows: out } = buildQueueRows([{ ...q('n', 'GC-150', 'No Clock', 'waiting', 0, 0), waiting_minutes: null as unknown as number }], { n: 9 })
    expect(out[0]).toMatchObject({ elapsedMinutes: null, estimatedMinutes: 9 })
  })

  test('only the first N rows are returned, with the true total and waiting count', () => {
    const many = Array.from({ length: 9 }, (_, i) => q(`w${i}`, `GC-${200 + i}`, `Patient ${i}`, 'waiting', 0, i))
    const out = buildQueueRows(many, {}, 6)
    expect(out.rows).toHaveLength(6)
    expect(out.total).toBe(9)
    expect(out.waitingCount).toBe(9)
  })

  test('an empty queue is empty, not an error', () => {
    expect(buildQueueRows([])).toEqual({ rows: [], total: 0, waitingCount: 0 })
  })
})

test.describe('recent activity events', () => {
  const today = '2026-10-12'

  test('one event per consultation, labelled from what actually happened, newest first', () => {
    const events = buildActivityEvents(
      [
        cons('1', 'GC-1', 'Sipho Ndlovu', '2026-10-12T07:00:00Z', '2026-10-12T07:10:00Z'),
        cons('2', 'GC-2', 'Nomusa Dlamini', '2026-10-12T07:20:00Z', '2026-10-12T07:25:00Z', true, 'patient_skipped'),
        cons('3', 'GC-3', 'Thandi Zulu', '2026-10-12T07:30:00Z', '2026-10-12T07:31:00Z', true, 'patient_no_show'),
        cons('4', 'GC-4', 'Bongani Khumalo', '2026-10-12T07:40:00Z', '2026-10-12T08:55:00Z', true, 'staff_break'),
        cons('5', 'GC-5', 'Lindiwe Mokoena', '2026-10-12T09:00:00Z', null),
      ],
      today
    )
    expect(events.map((e) => [e.token, e.kind])).toEqual([
      ['GC-5', 'in_consultation'],
      ['GC-4', 'ended'],
      ['GC-3', 'no_show'],
      ['GC-2', 'skipped'],
      ['GC-1', 'completed'],
    ])
  })

  test('only today (clinic calendar day) counts: 22:30 UTC is already tomorrow in Johannesburg', () => {
    const rows = [
      cons('late', 'GC-9', 'Late Night', '2026-10-11T22:30:00Z', '2026-10-11T22:40:00Z'), // 00:30 on the 12th SAST
      cons('yesterday', 'GC-8', 'Yesterday Person', '2026-10-11T20:00:00Z', '2026-10-11T20:10:00Z'), // 22:00 on the 11th SAST
    ]
    expect(buildActivityEvents(rows, '2026-10-12').map((e) => e.token)).toEqual(['GC-9'])
  })

  test('a consultation without a readable queue entry is dropped rather than shown half-empty', () => {
    const row = { ...cons('x', 'GC-1', 'A B', '2026-10-12T07:00:00Z', null), queue_entry: null }
    expect(buildActivityEvents([row], today)).toEqual([])
  })

  test('limit applies after sorting', () => {
    const rows = Array.from({ length: 8 }, (_, i) => cons(`${i}`, `GC-${i}`, 'A B', `2026-10-12T0${i}:00:00Z`, `2026-10-12T0${i}:05:00Z`))
    const events = buildActivityEvents(rows, today, 5)
    expect(events).toHaveLength(5)
    expect(events[0]!.token).toBe('GC-7')
  })

  test('patients are shown as initial + surname, as in the design', () => {
    expect(abbreviatePatientName('Sipho Ndlovu')).toBe('S. Ndlovu')
    expect(abbreviatePatientName('  thandi   van der Merwe ')).toBe('T. Merwe')
    expect(abbreviatePatientName('Cher')).toBe('Cher')
    expect(abbreviatePatientName('')).toBe('Unknown patient')
  })

  test('times render in Africa/Johannesburg, 12-hour: 08:42 UTC is 10:42 AM', () => {
    expect(formatActivityTime('2026-10-12T08:42:00Z')).toBe('10:42 AM')
    expect(formatActivityTime('2026-10-12T13:05:00Z')).toBe('03:05 PM')
  })
})

test.describe('seen today: the rule shared with the working screen', () => {
  const today = '2026-10-12'
  test('counts ended, counted, same-day consultations and averages their minutes', () => {
    const out = summariseSeenToday(
      [
        { started_at: '2026-10-12T07:00:00Z', ended_at: '2026-10-12T07:10:00Z', exclude_from_prediction: false },
        { started_at: '2026-10-12T07:20:00Z', ended_at: '2026-10-12T07:40:00Z', exclude_from_prediction: false },
        { started_at: '2026-10-12T08:00:00Z', ended_at: '2026-10-12T09:30:00Z', exclude_from_prediction: true }, // a break: not a patient seen
        { started_at: '2026-10-12T09:40:00Z', ended_at: null, exclude_from_prediction: false }, // still open
        { started_at: '2026-10-11T07:00:00Z', ended_at: '2026-10-11T07:10:00Z', exclude_from_prediction: false }, // yesterday
      ],
      today
    )
    expect(out).toEqual({ count: 2, avgMinutes: 15 })
  })
  test('nothing seen means no average, not zero', () => {
    expect(summariseSeenToday([], today)).toEqual({ count: 0, avgMinutes: null })
  })
})

// A minimal stand-in for the Supabase client: only what getNurseDashboardData touches. No network.
type Reply = { data: unknown; error: { message: string } | null }
function fakeSupabase(opts: { consultations?: Reply; serviceStats?: Reply }) {
  const today = todayInClinicTimezone()
  // 10:00 on the clinic's "today" (08:00 UTC is 10:00 SAST), so the test cannot straddle midnight.
  const rows = [
    {
      id: 'c1',
      started_at: `${today}T08:00:00Z`,
      ended_at: `${today}T08:10:00Z`,
      exclude_from_prediction: false,
      exclusion_reason: null,
      queue_entry: { token: 'GC-1', patient: { full_name: 'Sipho Ndlovu' } },
    },
  ]
  const consultations: Reply = opts.consultations ?? { data: rows, error: null }
  const chain = (reply: Reply) => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'gte', 'not', 'in', 'is', 'order', 'limit']) c[m] = () => c
    c.single = async () => reply
    c.maybeSingle = async () => reply
    c.then = (resolve: (r: Reply) => unknown) => resolve(reply)
    return c
  }
  const tables: Record<string, Reply> = {
    profiles: { data: { id: 'p1', full_name: 'Test Nurse', is_on_duty: true, current_service_id: 's1', clinic_id: 'c1' }, error: null },
    clinics: { data: { name: 'Test Clinic' }, error: null },
    services: { data: { name: 'General Consultation' }, error: null },
    consultations,
  }
  const rpcs: Record<string, Reply> = {
    get_service_queue: { data: [], error: null },
    service_consultation_stats: opts.serviceStats ?? { data: { avg_minutes: 12.4, sample_count: 9, stddev_minutes: 1 }, error: null },
  }
  return {
    from: (t: string) => chain(tables[t] ?? { data: null, error: null }),
    rpc: (n: string) => chain(rpcs[n] ?? { data: null, error: null }),
  } as unknown as Parameters<typeof getNurseDashboardData>[0]
}
const noOpenConsultation = { getCurrentState: async () => ({ entry: null }) }

test.describe('independent statistics failures (regression)', () => {
  const statCards = (d: NurseDashboardData) => Object.fromEntries(buildStatCards(d).map((c) => [c.key, c]))

  test('a service-average failure does not hide the nurse’s own figures', async () => {
    const data = await getNurseDashboardData(
      fakeSupabase({ serviceStats: { data: null, error: { message: 'stats down' } } }),
      'auth-1',
      noOpenConsultation
    )
    expect(data.errors.serviceAverage).toBe('stats down')
    expect(data.errors.stats, 'the nurse’s own query succeeded, so no personal-stats error').toBeUndefined()
    expect(data.seenToday).toEqual({ count: 1, avgMinutes: 10 })
    expect(data.serviceAverageMinutes).toBeNull()

    const cards = statCards(data)
    expect(cards.completed).toMatchObject({ value: '1', caption: 'Consultations you completed' })
    expect(cards.avg).toMatchObject({ value: '10 min', caption: 'Yours today · service avg unavailable' })
  })

  test('the reverse: the nurse’s own read failing does not hide a service average that loaded', async () => {
    const data = await getNurseDashboardData(
      fakeSupabase({ consultations: { data: null, error: { message: 'consultations down' } } }),
      'auth-1',
      noOpenConsultation
    )
    expect(data.errors.stats).toBe('consultations down')
    expect(data.errors.serviceAverage).toBeUndefined()
    expect(data.seenToday).toBeNull()
    expect(data.serviceAverageMinutes).toBe(12.4)

    const cards = statCards(data)
    expect(cards.completed).toMatchObject({ value: '—', caption: 'Couldn’t load' })
    expect(cards.avg).toMatchObject({ value: '—', caption: 'Yours unavailable · service avg 12 min' })
  })

  test('both succeeding is unchanged, and both failing marks both', async () => {
    const ok = await getNurseDashboardData(fakeSupabase({}), 'auth-1', noOpenConsultation)
    expect(ok.errors).toEqual({})
    expect(statCards(ok).avg).toMatchObject({ value: '10 min', caption: 'Yours today · service avg 12 min' })

    const both = await getNurseDashboardData(
      fakeSupabase({ consultations: { data: null, error: { message: 'a' } }, serviceStats: { data: null, error: { message: 'b' } } }),
      'auth-1',
      noOpenConsultation
    )
    expect(both.errors).toMatchObject({ stats: 'a', serviceAverage: 'b' })
    expect(statCards(both).avg).toMatchObject({ value: '—', caption: 'Yours unavailable · service avg unavailable' })
  })
})

test.describe('the four statistic cards', () => {
  const byKey = (d: NurseDashboardData) => Object.fromEntries(buildStatCards(d).map((c) => [c.key, c]))

  test('populated: every card reads its own real figure', () => {
    const cards = byKey(
      baseData({
        waitingCount: 6,
        currentEntry: { token: 'GC-101' } as NurseDashboardData['currentEntry'],
        seenToday: { count: 12, avgMinutes: 14 },
        serviceAverageMinutes: 13.4,
      })
    )
    expect(cards.queue).toMatchObject({ value: '6', caption: 'Waiting in General Consultation' })
    expect(cards.consultation).toMatchObject({ value: '1', caption: 'Current patient · GC-101' })
    expect(cards.completed).toMatchObject({ value: '12' })
    expect(cards.avg).toMatchObject({ value: '14 min', caption: 'Yours today · service avg 13 min' })
  })

  test('personal and service-wide averages are labelled apart, and neither stands in for the other', () => {
    const none = byKey(baseData({ seenToday: { count: 0, avgMinutes: null }, serviceAverageMinutes: 10 })).avg!
    expect(none.value).toBe('—')
    expect(none.caption).toContain('service avg 10 min')
    expect(byKey(baseData()).avg!).toMatchObject({ value: '—', caption: 'No completed consultations yet' })
  })

  test('off duty: no queue figure, not a zero', () => {
    const cards = byKey(baseData({ nurse: { ...baseData().nurse, isOnDuty: false, serviceId: null, serviceName: null }, queueScoped: false, waitingCount: null }))
    expect(cards.queue).toMatchObject({ value: '—', caption: 'Off duty — no queue' })
  })

  test('a failed read shows "—" and says so, never a made-up zero', () => {
    const cards = byKey(baseData({ waitingCount: null, seenToday: null, errors: { queue: 'x', stats: 'x', current: 'x' } }))
    for (const k of ['queue', 'consultation', 'completed', 'avg']) {
      expect(cards[k]!.value, k).toBe('—')
      expect(cards[k]!.caption, k).toMatch(/Couldn.t load/)
    }
  })

  test('no trend lines: nothing compares with yesterday or "earlier"', () => {
    for (const d of [baseData(), baseData({ waitingCount: 5, seenToday: { count: 3, avgMinutes: 9 }, serviceAverageMinutes: 8 })]) {
      for (const c of buildStatCards(d)) expect(c.caption).not.toMatch(/yesterday|earlier|%|\+\d|-\d/i)
    }
  })
})

// ------------------------------------------------------------------ 2. rendered states (no database)

test.describe('rendered states (real components, synthetic props)', () => {
  let rendered: Record<string, string>
  test.beforeAll(() => {
    const out = execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'e2e/support/render-nurse-dashboard-states.tsx'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
    rendered = JSON.parse(out)
  })

  test('queue empty while on duty', () => {
    const t = text(rendered.emptyOnDuty!)
    expect(t).toContain('No one is waiting')
    expect(t).toContain('On duty · General Consultation')
    expect(t).toContain('No activity yet today')
  })

  test('off duty: says so and points to the working screen, with no queue table', () => {
    const markup = rendered.offDuty!
    const t = text(markup)
    expect(t).toContain('Off duty')
    expect(t).toContain('You’re off duty.')
    expect(markup).not.toContain('<table')
    expect(markup).toContain('href="/nurse"')
  })

  test('on duty but no assigned service', () => {
    const t = text(rendered.noService!)
    expect(t).toContain('You have no assigned service.')
    expect(t).toContain('No service assigned')
  })

  test('queue read failure: an alert, not an empty queue', () => {
    const markup = rendered.queueError!
    expect(markup).toMatch(/role="alert"[^>]*>\s*We couldn’t load your queue/)
    expect(text(markup)).not.toContain('No one is waiting')
  })

  test('activity read failure: an alert, not "no activity"', () => {
    const markup = rendered.activityError!
    expect(markup).toMatch(/role="alert"[^>]*>\s*We couldn’t load your recent activity/)
    expect(text(markup)).not.toContain('No activity yet today')
  })

  test('populated queue: order, emergency flag, real statuses and elapsed-vs-estimate wording', () => {
    const t = text(rendered.populated!)
    expect(t.indexOf('GC-101')).toBeLessThan(t.indexOf('GC-107'))
    expect(t.indexOf('GC-107')).toBeLessThan(t.indexOf('GC-102'))
    expect(t).toContain('In consultation')
    expect(t).toContain('Emergency')
    expect(t).toContain('3 min elapsed')
    expect(t).toContain('~7 min to go')
    expect(t).toContain('25 min elapsed')
    expect(t.match(/to go/g)).toHaveLength(2) // the desktop table and the mobile card list, for the one row that has an estimate — none invented for the other
  })

  test('an unknown wait time says so; it is never shown as 0 minutes', () => {
    const t = text(rendered.unknownWait!)
    expect(t).toContain('Wait time unavailable')
    expect(t).not.toMatch(/\b0 min elapsed/)
    expect(t).toContain('~9 min to go') // the estimate is independent and still shown
  })

  test('a failed service average leaves the nurse’s own statistics on screen', () => {
    const t = text(rendered.serviceAverageFailed!)
    expect(t).toContain('Yours today · service avg unavailable')
    expect(t).toMatch(/Completed Today\s+4\s+Consultations you completed/)
    expect(t).toMatch(/Avg\. Consult Time\s+11 min/)
  })

  test('missing clinic name: the sidebar says "Clinic", the chip drops the clinic, and no example clinic appears', () => {
    const side = text(rendered.sidebarNoClinic!)
    expect(side).toMatch(/Smart Clinic\s+Clinic\s+Dashboard/)
    expect(side).not.toContain('Riverside')
    expect(text(rendered.sidebarWithClinic!)).toMatch(/Smart Clinic\s+Test Clinic\s+Dashboard/)
    const chip = text(rendered.noClinic!)
    expect(chip).toMatch(/Test Nurse\s+Nurse\s/)
    expect(chip).not.toContain('Nurse •')
    expect(chip).not.toContain('Riverside')
  })

  test('nothing from the Figma example data leaks in', () => {
    for (const markup of Object.values(rendered)) {
      const t = text(markup)
      for (const invented of ['Mkhize', 'Nomusa', 'Sipho Zulu', 'Thandiwe', 'GC-113', 'from yesterday', 'from earlier', '10:42', 'CityMD', 'Riverside']) {
        expect(t).not.toContain(invented)
      }
    }
  })

  test('accessibility basics: one h1, one main, labelled regions, a captioned table with column headers', () => {
    const markup = rendered.populated!
    expect(markup.match(/<h1/g)).toHaveLength(1)
    expect(markup.match(/<main/g)).toHaveLength(1)
    expect(markup).toContain('aria-labelledby="todays-queue"')
    expect(markup).toContain('aria-labelledby="recent-activity"')
    expect(markup).toContain('<caption')
    expect((markup.match(/<th scope="col"/g) ?? []).length).toBe(6)
    expect(markup).toContain('role="group" aria-label="Signed in as"')
    expect(markup).toContain('<time dateTime=')
  })

  test('navigation only offers routes that exist', () => {
    expect(NURSE_NAV_ITEMS.map((i) => i.href)).toEqual(['/nurse/dashboard', '/nurse'])
  })
})

test.describe('text contrast of the colours this screen introduces (WCAG AA, 4.5:1)', () => {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
  }
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)]
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }
  for (const [name, fg, bg] of [
    ['body ink on page', '#07172F', '#F5FFFD'],
    ['muted on white', '#5B6B8D', '#FFFFFF'],
    ['muted on page', '#5B6B8D', '#F5FFFD'],
    ['muted on table header', '#5B6B8D', '#F0FDFA'],
    ['teal text on white', '#037F74', '#FFFFFF'],
    ['teal text on soft teal', '#037F74', '#E6FBF7'],
    ['Waiting chip', '#8A5600', '#FFF5DB'],
    ['Emergency chip', '#B42318', '#FBEAE8'],
    ['avatar initials', '#FFFFFF', '#037F74'],
    ['name accent on page', '#039486', '#F5FFFD'],
  ] as const) {
    test(name, () => {
      const r = ratio(fg, bg)
      // The hero's 40px bold name is "large text" (3:1 floor); everything else must reach 4.5:1.
      expect(r).toBeGreaterThanOrEqual(name === 'name accent on page' ? 3 : 4.5)
    })
  }
})

// ------------------------------------------------------------------ 3. live page, read-only

const expect = baseExpect.configure({ timeout: 30_000 })
const DASHBOARD = '/nurse/dashboard'

/** Dev pages and the demo backend are slow (several sequential Supabase calls per load), and a sign-in can fail transiently: wait for the redirect and retry once. */
async function loginAs(page: Page, email: string, password: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await rawLoginAs(page, email, password)
    try {
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 90_000 })
      return
    } catch (e) {
      if (attempt === 1) throw e
    }
  }
}

/**
 * A Server Action is a browser POST carrying a `next-action` header, sent to the URL of the page that made it.
 * Optionally narrowed to one path: signing in lands on /nurse, whose own screen reads state through a (read-only)
 * Server Action as it hydrates, and that must not be blamed on the page under test.
 */
function trackActions(page: Page, onlyPath?: string) {
  const posts: string[] = []
  page.on('request', (req) => {
    if (req.method() !== 'POST' || !req.headers()['next-action']) return
    if (onlyPath && new URL(req.url()).pathname !== onlyPath) return
    posts.push(req.url())
  })
  return posts
}

async function openDashboard(page: Page) {
  await loginAs(page, ACCOUNTS.nurse.email, ACCOUNTS.nurse.password)
  await page.goto(DASHBOARD)
  await expect(page.getByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible({ timeout: 90_000 })
}

test.describe('Nurse V3 dashboard — access', () => {
  test.describe.configure({ timeout: 300_000 })

  test('signed-out visitors are sent to login', async ({ page }) => {
    await page.goto(DASHBOARD)
    await expect(page).toHaveURL(/\/login/)
  })

  for (const [role, account, home] of [
    ['receptionist', ACCOUNTS.receptionist, '/reception'],
    ['patient', ACCOUNTS.patient, '/dashboard'],
  ] as const) {
    test(`a ${role} account is redirected away, not shown the nurse dashboard`, async ({ page }) => {
      await loginAs(page, account.email, account.password)
      await page.goto(DASHBOARD)
      await page.waitForURL((u) => !u.pathname.startsWith('/nurse'), { timeout: 90_000 })
      expect(new URL(page.url()).pathname.startsWith(home)).toBe(true)
      await expect(page.getByRole('heading', { name: /Welcome back/ })).toHaveCount(0)
    })
  }
})

test.describe('Nurse V3 dashboard — live, read-only', () => {
  test.describe.configure({ timeout: 300_000 })

  test('shows the real signed-in nurse, their service and a duty line; invents nothing; invokes no Server Action', async ({ page }) => {
    await loginAs(page, ACCOUNTS.nurse.email, ACCOUNTS.nurse.password)
    const actions = trackActions(page, DASHBOARD) // Server Actions posted from the dashboard page itself
    await page.goto(DASHBOARD)
    await expect(page.getByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible({ timeout: 90_000 })
    const main = page.getByRole('main')

    // Same name the working screen shows ("Nurse — <name>").
    const name = (await main.getByRole('group', { name: 'Signed in as' }).innerText()).split('\n')[1]!.trim()
    expect(name.length).toBeGreaterThan(1)
    await expect(main.getByRole('heading', { level: 1 })).toContainText(name)
    await expect(main.getByRole('group', { name: 'Signed in as' })).toContainText('Nurse • ')

    await expect(main.getByLabel('Duty status')).toContainText(/On duty · .+|Off duty/)

    const body = await main.innerText()
    for (const invented of ['Mkhize', 'from yesterday', 'from earlier', 'Nomusa Dlamini', 'GC-113']) expect(body).not.toContain(invented)

    expect(actions, 'loading the dashboard must not invoke any Server Action').toEqual([])
  })

  test('four statistic cards with the four Figma labels', async ({ page }) => {
    await openDashboard(page)
    const cards = page.getByRole('list', { name: 'Your numbers' }).getByRole('listitem')
    await expect(cards).toHaveCount(4)
    await expect(cards.nth(0)).toContainText('My Queue')
    await expect(cards.nth(1)).toContainText('In Consultation')
    await expect(cards.nth(2)).toContainText('Completed Today')
    await expect(cards.nth(3)).toContainText('Avg. Consult Time')
    for (let i = 0; i < 4; i++) await expect(cards.nth(i).locator('[data-stat-value]')).toHaveText(/^(\d+( min)?|—)$/)
  })

  test('its figures agree with the existing working screen (My Queue = Waiting, Completed = Seen today)', async ({ page }) => {
    await openDashboard(page)
    const cards = page.getByRole('list', { name: 'Your numbers' }).getByRole('listitem')
    const dash = {
      queue: await cards.nth(0).locator('[data-stat-value]').innerText(),
      completed: await cards.nth(2).locator('[data-stat-value]').innerText(),
    }

    await page.goto('/nurse')
    await expect(page.getByRole('heading', { level: 1, name: /^Nurse/ })).toBeVisible({ timeout: 90_000 })
    if (dash.queue === '—') {
      // Off duty: the working screen shows no waiting list, so there is nothing to compare for the queue figure.
      await expect(page.getByText(/Go on duty to see/)).toBeVisible()
    } else {
      const waitingTile = page.locator('p', { hasText: /^WAITING$/ }).locator('xpath=following-sibling::p[1]')
      await expect(waitingTile).toHaveText(dash.queue)
      const seenTile = page.locator('p', { hasText: /^SEEN TODAY$/ }).locator('xpath=following-sibling::p[1]')
      await expect(seenTile).toContainText(new RegExp(`^${dash.completed}\\b`))
    }
  })

  test('View all opens the existing working screen, which still loads', async ({ page }) => {
    await openDashboard(page)
    await page.getByRole('link', { name: 'View all' }).click()
    await expect(page).toHaveURL(/\/nurse$/, { timeout: 90_000 })
    await expect(page.getByRole('heading', { level: 1, name: /^Nurse/ })).toBeVisible({ timeout: 90_000 })
  })

  test('sidebar offers only working routes, marks the current page, and has a visible Sign Out', async ({ page }) => {
    await openDashboard(page)
    const nav = page.getByRole('navigation', { name: 'Main' }).first()
    await expect(nav.getByRole('link')).toHaveText(['Dashboard', 'My Queue'])
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
    await expect(nav.getByRole('button', { name: 'Sign Out' })).toBeVisible()
    await nav.getByRole('link', { name: 'My Queue' }).click()
    await expect(page).toHaveURL(/\/nurse$/, { timeout: 90_000 })
  })

  test('Sign Out from the dashboard lands on /login', async ({ page }) => {
    await openDashboard(page)
    await page.getByRole('navigation', { name: 'Main' }).first().getByRole('button', { name: 'Sign Out' }).click()
    await expect(page).toHaveURL(/\/login/, { timeout: 90_000 })
  })

  test('mobile: top bar has the routes and a visible Sign Out; no page-level horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openDashboard(page)
    const nav = page.getByRole('navigation', { name: 'Main' }).filter({ visible: true })
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'My Queue' })).toBeVisible()
    const signOut = nav.getByRole('button', { name: 'Sign Out' })
    await expect(signOut).toBeVisible()
    const box = (await signOut.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  })

  test('keyboard: View all is reachable by Tab and shows a visible focus ring', async ({ page }) => {
    await openDashboard(page)
    const link = page.getByRole('link', { name: 'View all' })
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      if (await link.evaluate((el) => el === document.activeElement)) break
    }
    await expect(link).toBeFocused()
    expect(await link.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')
  })

  test('every link and button on the page has an accessible name; exactly one h1 and one main', async ({ page }) => {
    await openDashboard(page)
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('a, button')]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .filter((el) => !(el.getAttribute('aria-label') || el.textContent?.trim()))
        .map((el) => el.outerHTML.slice(0, 100))
    )
    expect(unnamed).toEqual([])
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.locator('main')).toHaveCount(1)
  })

  test('geometry at 1440×1024 matches Figma frame 161:3', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await openDashboard(page)
    const sidebar = (await page.locator('aside').boundingBox())!
    expect(Math.round(sidebar.width)).toBe(264)
    const cards = page.getByRole('list', { name: 'Your numbers' }).getByRole('listitem')
    const boxes = await Promise.all([0, 1, 2, 3].map(async (i) => (await cards.nth(i).boundingBox())!))
    for (const b of boxes) {
      expect(Math.round(b.width)).toBe(270)
      expect(b.height).toBeGreaterThanOrEqual(180)
    }
    expect(Math.round(boxes[1]!.x - boxes[0]!.x)).toBe(286) // 270 + 16 gap
    const queue = (await page.locator('section[aria-labelledby="todays-queue"]').boundingBox())!
    const activity = (await page.locator('section[aria-labelledby="recent-activity"]').boundingBox())!
    expect(Math.abs(queue.width - 730)).toBeLessThanOrEqual(2)
    expect(Math.round(activity.width)).toBe(380)
    expect(Math.round(activity.x - (queue.x + queue.width))).toBe(18)
    expect(queue.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height)
  })

  for (const width of [1440, 1280, 1024, 900, 768, 390]) {
    test(`layout at ${width}px: no horizontal scroll, hero image keeps a real width, panels ${width >= 1280 ? 'side by side' : 'stacked'}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width >= 1280 ? 1024 : 900 })
      await openDashboard(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      const hero = (await page.locator('main section[aria-label="Welcome"] img').boundingBox())!
      expect(hero.width).toBeGreaterThan(300)
      const queue = (await page.locator('section[aria-labelledby="todays-queue"]').boundingBox())!
      const activity = (await page.locator('section[aria-labelledby="recent-activity"]').boundingBox())!
      if (width >= 1280) expect(Math.abs(queue.y - activity.y)).toBeLessThanOrEqual(1)
      else expect(activity.y).toBeGreaterThan(queue.y + queue.height - 1)
    })
  }
})
