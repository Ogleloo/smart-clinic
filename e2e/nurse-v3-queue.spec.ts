import { test, expect, type Page } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { ACCOUNTS, loginAs as rawLoginAs } from './helpers'
import {
  buildMyQueueRows,
  countMyQueueTabs,
  filterMyQueueRows,
  isCompletedConsultation,
  type MyQueueRow,
} from '../lib/nurseQueue'
import { NURSE_NAV_ITEMS } from '../components/nurse/v3/navItems'
import { formatActivityTime } from '../components/nurse/v3/RecentActivityPanel'
import { calls, fireQueueChange, openHarness, queueResponse, release, setDefault, type HarnessConfig } from './support/nurse-queue-harness/harness'
import {
  CALLED,
  COMPLETED,
  CURRENT,
  ESTIMATES,
  ID,
  NEXT_IN_ROOM,
  QUEUE,
  SERVICE_ID,
  TODAY,
  at,
  queueProps,
  readDefaults,
  snapshot,
} from './support/nurse-queue-harness/fixtures'

/**
 * Nurse V3 My Queue (Phase 2, Figma 161:170 + 162:534 / 164:192 / 164:268).
 *
 * Nothing here writes to the shared Supabase project:
 *  1. Pure logic — rows, order, tabs, search, the completed-consultation rule, clinic-time formatting.
 *  2. The real components in an isolated browser harness (e2e/support/nurse-queue-harness): the production
 *     MyQueueView / useNextPatientFlow / CurrentPatientPanel, with Server Actions, the Supabase client and the
 *     realtime hook replaced by in-page mocks. Every other request is aborted and recorded; each test asserts
 *     that none escaped (fail-closed).
 *  3. The live page, read-only: access control, the real nurse's data, layout. No button that mutates is
 *     clicked; next_patient, undo, skip, set_duty, end_shift and set_emergency_priority are never called.
 */

const rows = (over: Partial<Parameters<typeof buildMyQueueRows>[0]> = {}) =>
  buildMyQueueRows({
    queue: QUEUE,
    estimates: ESTIMATES,
    currentEntry: CURRENT,
    completed: COMPLETED,
    serviceNames: { [SERVICE_ID]: 'General Consultation', '00000000-0000-4000-8000-000000000002': 'Immunisation' },
    currentServiceId: SERVICE_ID,
    today: TODAY,
    ...over,
  })

// ------------------------------------------------------------------ 1. pure logic

test.describe('pure: rows, order and statuses', () => {
  test('own current patient first, then waiting in database order (emergency stays first), then completed newest first', () => {
    const { rows: r } = rows()
    expect(r.map((x) => `${x.status}:${x.token}`)).toEqual([
      'in_consultation:GC-101',
      'waiting:GC-107',
      'waiting:GC-102',
      'waiting:GC-104',
      'waiting:GC-105',
      'completed:IM-004',
      'completed:GC-090',
    ])
  })

  test('position ranks waiting patients only; the next expected token is the first waiting one', () => {
    const { rows: r, nextToken } = rows()
    expect(r.filter((x) => x.status === 'waiting').map((x) => x.position)).toEqual([1, 2, 3, 4])
    expect(r.filter((x) => x.status !== 'waiting').every((x) => x.position === null)).toBe(true)
    expect(nextToken).toBe('GC-107')
  })

  test('another nurse’s in-progress patient is counted, not shown as this nurse’s', () => {
    const { rows: r, othersInConsultation } = rows()
    expect(r.some((x) => x.token === 'GC-103')).toBe(false)
    expect(othersInConsultation).toBe(1)
  })

  test('right after a call, a stale read listing my new patient as waiting does not show them twice or as next', () => {
    const stale = rows({ currentEntry: { ...CURRENT, queueEntryId: ID.emergency, token: 'GC-107' } })
    expect(stale.rows.filter((x) => x.token === 'GC-107').map((x) => x.status)).toEqual(['in_consultation'])
    expect(stale.nextToken).toBe('GC-102')
  })

  test('In Consultation comes from the nurse’s own open consultation, not from queue status', () => {
    const none = rows({ currentEntry: null })
    expect(none.rows.filter((x) => x.status === 'in_consultation')).toHaveLength(0)
    // With no current entry, GC-101's in_progress row belongs to someone else.
    expect(none.othersInConsultation).toBe(2)
  })

  test('elapsed and estimate stay separate; a missing estimate or elapsed time stays null, never 0', () => {
    const r = rows().rows
    const by = (t: string) => r.find((x) => x.token === t)!
    expect(by('GC-102')).toMatchObject({ elapsedMinutes: 25, estimatedMinutes: 7 })
    expect(by('GC-104')).toMatchObject({ elapsedMinutes: 19, estimatedMinutes: null })
    expect(by('GC-105')).toMatchObject({ elapsedMinutes: null, estimatedMinutes: 12 })
  })

  test('completed = ended today and a real consultation; skips, no-shows, admin closes and other days are excluded', () => {
    const base = COMPLETED[0]!
    expect(isCompletedConsultation(base, TODAY)).toBe(true)
    expect(isCompletedConsultation({ ...base, exclusion_reason: 'staff_break' }, TODAY)).toBe(true)
    for (const reason of ['patient_skipped', 'patient_no_show', 'demo_reset', 'orphaned_test_data']) {
      expect(isCompletedConsultation({ ...base, exclusion_reason: reason }, TODAY)).toBe(false)
    }
    expect(isCompletedConsultation({ ...base, ended_at: null }, TODAY)).toBe(false)
    expect(isCompletedConsultation({ ...base, queue_entry: null }, TODAY)).toBe(false)
    expect(isCompletedConsultation({ ...base, started_at: '2026-01-01T08:00:00Z' }, TODAY)).toBe(false)
    const brk = rows().rows.find((x) => x.token === 'IM-004')!
    expect(brk).toMatchObject({ notCounted: true, serviceName: 'Immunisation' })
  })

  test('clinic day boundary: 22:30 UTC is already the next day in Johannesburg', () => {
    const late = { ...COMPLETED[0]!, started_at: '2026-10-11T22:30:00Z', ended_at: '2026-10-11T22:45:00Z' }
    expect(isCompletedConsultation(late, '2026-10-12')).toBe(true)
    expect(isCompletedConsultation(late, '2026-10-11')).toBe(false)
  })

  test('times display in Africa/Johannesburg: 07:12 UTC is 09:12 AM', () => {
    expect(formatActivityTime(at('07:12'))).toBe('09:12 AM')
  })
})

test.describe('pure: no skip route from the Nurse V3 UI', () => {
  test('no V3 nurse file imports or calls a skip action, and the V3 skip Server Action no longer exists', () => {
    const roots = ['components/nurse/v3', 'app/nurse/(v3)', 'lib/hooks', 'lib/nurseQueue.ts']
    const files: string[] = []
    const walk = (p: string) => {
      if (p.endsWith('.ts') || p.endsWith('.tsx')) return void files.push(p)
      for (const e of readdirSync(p, { withFileTypes: true })) walk(path.join(p, e.name))
    }
    roots.forEach(walk)
    expect(files.length).toBeGreaterThan(5)
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/\bskipPatient\b|\bskipWaitingPatient\b|skip_patient'|SkipButton|SkipPatientModal|skipQueueEntry/)
    }
    expect(readFileSync('app/actions/nurse.ts', 'utf8')).not.toMatch(/export async function skipWaitingPatient/)
  })
})

test.describe('pure: tabs, search and filter', () => {
  const all = rows().rows
  const tokens = (r: MyQueueRow[]) => r.map((x) => x.token)

  test('tab counts are per-status totals', () => {
    expect(countMyQueueTabs(all)).toEqual({ all: 7, waiting: 4, in_consultation: 1, completed: 2 })
  })

  test('each tab shows only its status', () => {
    expect(tokens(filterMyQueueRows(all, { tab: 'waiting', search: '', emergencyOnly: false }))).toEqual(['GC-107', 'GC-102', 'GC-104', 'GC-105'])
    expect(tokens(filterMyQueueRows(all, { tab: 'in_consultation', search: '', emergencyOnly: false }))).toEqual(['GC-101'])
    expect(tokens(filterMyQueueRows(all, { tab: 'completed', search: '', emergencyOnly: false }))).toEqual(['IM-004', 'GC-090'])
  })

  test('search matches name (case-insensitive) or token (ignoring punctuation), and combines with the tab', () => {
    expect(tokens(filterMyQueueRows(all, { tab: 'all', search: 'harness first', emergencyOnly: false }))).toEqual(['GC-102'])
    expect(tokens(filterMyQueueRows(all, { tab: 'all', search: 'gc102', emergencyOnly: false }))).toEqual(['GC-102'])
    expect(tokens(filterMyQueueRows(all, { tab: 'completed', search: 'gc', emergencyOnly: false }))).toEqual(['GC-090'])
    expect(filterMyQueueRows(all, { tab: 'waiting', search: 'done', emergencyOnly: false })).toEqual([])
    expect(filterMyQueueRows(all, { tab: 'all', search: '   ', emergencyOnly: false })).toHaveLength(7)
  })

  test('emergency filter keeps only emergency-priority rows', () => {
    expect(tokens(filterMyQueueRows(all, { tab: 'all', search: '', emergencyOnly: true }))).toEqual(['GC-107'])
  })

  test('empty inputs are empty, not errors', () => {
    const e = rows({ queue: [], completed: [], currentEntry: null })
    expect(e.rows).toEqual([])
    expect(e.nextToken).toBeNull()
    expect(countMyQueueTabs(e.rows)).toEqual({ all: 0, waiting: 0, in_consultation: 0, completed: 0 })
  })
})

test.describe('pure: navigation and contrast', () => {
  test('sidebar: My Queue opens /nurse/queue; no links to unbuilt screens', () => {
    expect(NURSE_NAV_ITEMS.map((i) => [i.label, i.href])).toEqual([
      ['Dashboard', '/nurse/dashboard'],
      ['My Queue', '/nurse/queue'],
    ])
  })

  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
  }
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
    return (x! + 0.05) / (y! + 0.05)
  }
  for (const [name, fg, bg] of [
    ['active tab / primary button: white on #037F74', '#FFFFFF', '#037F74'],
    ['outline buttons, tokens: #037F74 on white', '#037F74', '#FFFFFF'],
    ['Waiting pill', '#8A5600', '#FFF5DB'],
    ['Completed pill', '#067647', '#ECFDF3'],
    ['In consultation pill', '#037F74', '#E6FBF7'],
    ['Skip confirm: #B42318 on white', '#B42318', '#FFFFFF'],
    ['search placeholder (muted #5B6B8D) on white', '#5B6B8D', '#FFFFFF'],
    ['muted text #5B6B8D on header band #F0FDFA', '#5B6B8D', '#F0FDFA'],
  ] as const) {
    test(`${name} ≥ 4.5:1`, () => {
      expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5)
    })
  }
})

// ------------------------------------------------------------------ 2. isolated harness (mocked actions)

let escapes: string[] = []
async function open(page: Page, cfg: Partial<HarnessConfig> = {}) {
  const full: HarnessConfig = { mode: 'queue', props: queueProps() as never, defaults: readDefaults(), ...cfg }
  const res = await openHarness(page, full)
  escapes = res.escapes
  const ready =
    full.mode === 'classic'
      ? page.getByText('CURRENT PATIENT', { exact: true })
      : full.mode === 'header'
        ? page.getByText(/^(On duty · .+|Off duty)$/)
        : page.getByRole('heading', { level: 1, name: 'My Queue' })
  await expect(ready).toBeVisible()
}

const panel = (page: Page) => page.locator('#my-queue-panel')
const tableRows = (page: Page) => panel(page).locator('tbody tr')
const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Same-tick clicks: Playwright's click() waits for a button to be enabled, which would hide a double-submit bug. */
async function tripleClick(page: Page, selector: string) {
  await page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel)!
    el.click()
    el.click()
    el.click()
  }, selector)
}

test.describe('harness: rendering and states', () => {
  test.afterEach(() => expect(escapes, 'a request escaped the harness').toEqual([]))

  test('populated: real order, Figma columns, statuses, times, wait wording, informational Next marker; no per-row Start button', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    await expect(page.locator('thead th')).toHaveText(['#', 'Token', 'Patient Name', 'Service', 'Arrival Time', 'Wait Time', 'Status', 'Actions'])
    await expect(tableRows(page).locator('td:nth-child(2)')).toHaveText(['GC-101', 'GC-107', 'GC-102', 'GC-104', 'GC-105', 'IM-004', 'GC-090'])
    const emergency = tableRows(page).nth(1)
    await expect(emergency).toContainText('Next')
    await expect(emergency).toContainText('Emergency')
    await expect(emergency).toContainText('09:40 AM')
    await expect(tableRows(page).nth(2)).toContainText('25 min waited')
    await expect(tableRows(page).nth(4)).toContainText('Unavailable')
    await expect(tableRows(page).nth(4)).not.toContainText('0 min waited')
    await expect(tableRows(page).nth(5)).toContainText('Break · not in average')
    await expect(page.getByText('1 other patient is in consultation with another nurse')).toBeVisible()
    await expect(page.getByRole('button', { name: /start consult/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /view details/i })).toHaveCount(0)
    await expect(page.getByText('Patients assigned to you')).toHaveCount(0)
    for (const name of ['Nomusa', 'Sipho', 'Thandiwe', 'Mkhize', 'Riverside']) await expect(page.getByText(name)).toHaveCount(0)
    await expect(tab(page, /^All \(7\)$/)).toHaveAttribute('aria-selected', 'true')
    await expect(tab(page, /^Waiting \(4\)$/)).toBeVisible()
    await expect(tab(page, /^In Consultation \(1\)$/)).toBeVisible()
    await expect(tab(page, /^Completed \(2\)$/)).toBeVisible()
  })

  test('loading invokes no mutating action (only reads)', async ({ page }) => {
    await open(page)
    await page.waitForTimeout(300)
    const names = new Set((await calls(page)).map((c) => c.name))
    for (const n of names) {
      expect(['rpc:get_service_queue', 'rpc:get_wait_estimate', 'from:consultations', 'checkEndSessionImpact', 'getNurseCurrentState']).toContain(n)
    }
  })

  test('skip and emergency only on waiting rows; current patient links to its panel; completed rows have no actions', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    // Skip is shown on waiting rows only, and only as an unavailable control (see the fail-closed tests).
    await expect(panel(page).getByRole('button', { name: /^Skip .* — unavailable$/ })).toHaveCount(4)
    await expect(tableRows(page).nth(0).getByRole('button')).toHaveCount(0)
    await expect(tableRows(page).nth(0).getByRole('link', { name: 'Go to current patient' })).toHaveAttribute('href', '#current-patient')
    await expect(tableRows(page).nth(5).getByRole('button')).toHaveCount(0)
    await expect(tableRows(page).nth(6).getByRole('button')).toHaveCount(0)
  })

  test('tabs and search work together; search survives a tab change', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    await tab(page, /^Waiting/).click()
    await expect(tableRows(page)).toHaveCount(4)
    await page.getByPlaceholder('Search by name or token...').fill('gc104')
    await expect(tableRows(page)).toHaveCount(1)
    await expect(tableRows(page).first()).toContainText('Harness Second')
    await tab(page, /^Completed/).click()
    await expect(page.getByPlaceholder('Search by name or token...')).toHaveValue('gc104')
    await expect(panel(page)).toContainText('No patients match “gc104”.')
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect(tableRows(page)).toHaveCount(2)
    await tab(page, /^In Consultation/).click()
    await expect(tableRows(page)).toHaveCount(1)
    await expect(tableRows(page).first()).toContainText('GC-101')
  })

  test('filters: emergency only', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    await page.getByRole('button', { name: 'Filters' }).click()
    await page.getByLabel('Emergency priority only').check()
    await expect(tableRows(page)).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Filters (1)' })).toBeVisible()
  })

  test('keyboard: arrow keys move between tabs', async ({ page }) => {
    await open(page)
    await tab(page, /^All/).focus()
    await page.keyboard.press('ArrowRight')
    await expect(tab(page, /^Waiting/)).toBeFocused()
    await expect(tab(page, /^Waiting/)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(tab(page, /^Completed/)).toHaveAttribute('aria-selected', 'true')
  })

  test('empty queue while on duty', async ({ page }) => {
    const empty = snapshot({ queue: [], completed: [], estimates: {} })
    await open(page, { props: queueProps({ initialSnapshot: empty, initialEntry: null }) as never, defaults: readDefaults(empty, null) })
    await expect(panel(page)).toContainText('The queue is empty')
    await expect(page.getByRole('button', { name: 'Call next patient' })).toBeVisible()
    await expect(page.getByText('No one is waiting.')).toBeVisible()
    await tab(page, /^Waiting/).click()
    await expect(panel(page)).toContainText('No one is waiting')
    await tab(page, /^In Consultation/).click()
    await expect(panel(page)).toContainText('No patient in consultation')
    await tab(page, /^Completed/).click()
    await expect(panel(page)).toContainText('No completed consultations yet today')
  })

  test('off duty: duty control shown, no call panel, no queue read; own completed consultations still listed', async ({ page }) => {
    const off = queueProps({
      nurse: { ...queueProps().nurse, isOnDuty: false, serviceId: null, serviceName: null },
      initialSnapshot: snapshot({ queue: [], estimates: {} }),
      initialEntry: null,
    })
    await open(page, { props: off as never, defaults: readDefaults(snapshot({ queue: [] }), null) })
    await expect(page.getByText('Off duty', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start session' })).toBeVisible()
    await expect(page.getByRole('button', { name: /call next patient/i })).toHaveCount(0)
    await expect(tab(page, /^Completed \(2\)$/)).toBeVisible()
    await tab(page, /^Waiting/).click()
    await expect(panel(page)).toContainText('You’re off duty.')
    await page.waitForTimeout(300)
    expect(await calls(page, 'rpc:get_service_queue')).toHaveLength(0)
  })

  test('going on duty submits the chosen service through the existing duty action', async ({ page }) => {
    const off = queueProps({ nurse: { ...queueProps().nurse, isOnDuty: false, serviceId: null, serviceName: null }, initialSnapshot: snapshot({ queue: [] }), initialEntry: null })
    await open(page, { props: off as never, defaults: { ...readDefaults(snapshot({ queue: [] }), null), setDuty: { value: {} } } })
    await page.getByLabel('Service', { exact: true }).selectOption({ label: 'Immunisation' })
    await page.getByRole('button', { name: 'Start session' }).click()
    await expect.poll(async () => (await calls(page, 'setDuty')).length).toBe(1)
    expect((await calls(page, 'setDuty'))[0]!.args[0]).toEqual({ service_id: '00000000-0000-4000-8000-000000000002', on_duty: 'true' })
  })

  test('on duty without a service: says so, no call panel', async ({ page }) => {
    const noSvc = queueProps({ nurse: { ...queueProps().nurse, serviceId: null, serviceName: null }, initialSnapshot: snapshot({ queue: [] }), initialEntry: null })
    await open(page, { props: noSvc as never, defaults: readDefaults(snapshot({ queue: [] }), null) })
    await expect(page.getByText('You’re on duty without an assigned service.')).toBeVisible()
    await expect(page.getByRole('button', { name: /call next patient/i })).toHaveCount(0)
  })

  test('read failures: an alert, never an empty queue', async ({ page }) => {
    const failed = snapshot({ queue: [], completed: [], errors: { queue: 'boom', completed: 'boom' } })
    const stillFailing = {
      ...readDefaults(failed, null),
      'rpc:get_service_queue': { value: { data: null, error: { message: 'boom' } } },
      'from:consultations': { value: { data: null, error: { message: 'boom' } } },
    }
    await open(page, { props: queueProps({ initialSnapshot: failed, initialEntry: null }) as never, defaults: stillFailing })
    await expect(panel(page).getByRole('alert')).toHaveCount(2)
    await expect(panel(page)).not.toContainText('The queue is empty')
  })

  test('current consultation restored after a reload: shown from the open consultation; nothing is called on mount', async ({ page }) => {
    await open(page)
    const cp = page.locator('#current-patient')
    await expect(cp).toContainText('GC-101')
    await expect(cp).toContainText('Harness Current')
    await expect(cp).toContainText('In consultation')
    await expect(cp).toContainText('Checked in 09:05 AM')
    await expect(cp.getByRole('button', { name: 'Next patient' })).toBeVisible()
    await expect(cp).toContainText('GC-107 is next in line')
    expect(await calls(page, 'nextPatient')).toHaveLength(0)
  })

  test('null service average is shown as "—", not a number', async ({ page }) => {
    await open(page, { props: queueProps({ serviceAverageMinutes: null }) as never })
    await expect(page.locator('#current-patient')).toContainText('Service average—')
  })
})

test.describe('harness: Call next, retry, long consultation, Undo', () => {
  test.afterEach(() => expect(escapes, 'a request escaped the harness').toEqual([]))

  test('Call next: one request per press (same-tick clicks), loading state, authoritative re-read, Patient Called confirmation, queue refresh, toast', async ({ page }) => {
    await open(page)
    await queueResponse(page, 'nextPatient', { hold: true, value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } })
    const readsBefore = (await calls(page, 'rpc:get_service_queue')).length
    await tripleClick(page, '#current-patient button')
    await page.waitForTimeout(200)
    expect(await calls(page, 'nextPatient')).toHaveLength(1)
    await expect(page.locator('#current-patient').getByRole('button', { name: 'Please wait…' })).toBeDisabled()
    const [actionId, decision] = (await calls(page, 'nextPatient'))[0]!.args as [string, string | null]
    expect(actionId).toMatch(UUID)
    expect(decision).toBeNull()
    await release(page, 'nextPatient')
    const cp = page.locator('#current-patient')
    await expect(cp.getByRole('heading', { name: 'Patient called successfully' })).toBeVisible()
    await expect(cp).toContainText('GC-107 — Harness Emergency is now in consultation.')
    await expect(cp).toContainText('Called at')
    await expect(cp).toContainText(formatActivityTime(NEXT_IN_ROOM.startedAt))
    await expect(cp).toContainText('In consultation')
    await expect(cp).toContainText('GC-101’s consultation ended after 30 min.')
    await expect(cp.getByRole('button', { name: /Undo call, \d+ seconds left/ })).toBeVisible()
    await expect(cp.getByRole('button', { name: /start consultation/i })).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: 'Queue updated' })).toContainText('GC-101 moved to Completed')
    expect((await calls(page, 'router.refresh')).length).toBeGreaterThanOrEqual(1)
    await expect.poll(async () => (await calls(page, 'rpc:get_service_queue')).length).toBeGreaterThan(readsBefore)
    // The read after the call still lists GC-107 as waiting (stale); it must appear once, as in consultation.
    await expect(tableRows(page).filter({ hasText: 'GC-107' })).toHaveCount(1)
    await expect(cp).toContainText('GC-102 is next in line')
    // The In Consultation row follows the re-read, not the old patient.
    await tab(page, /^In Consultation/).click()
    await expect(panel(page)).toContainText('GC-107')
  })

  test('retry after a failure reuses the same action id; the next press after success gets a new one', async ({ page }) => {
    await open(page)
    await queueResponse(page, 'nextPatient', { value: { error: 'timeout' } }, { value: { data: CALLED } }, { value: { data: { ...CALLED, token: 'GC-102' } } })
    await queueResponse(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } }, { value: { entry: NEXT_IN_ROOM } })
    const cp = page.locator('#current-patient')
    await cp.getByRole('button', { name: 'Next patient' }).click()
    await expect(cp.getByRole('alert')).toContainText('timeout')
    await cp.getByRole('button', { name: 'Next patient' }).click()
    await expect(cp.getByRole('heading', { name: 'Patient called successfully' })).toBeVisible()
    await cp.getByRole('button', { name: 'Next patient' }).click()
    await expect.poll(async () => (await calls(page, 'nextPatient')).length).toBe(3)
    const ids = (await calls(page, 'nextPatient')).map((c) => c.args[0])
    expect(ids[1]).toBe(ids[0])
    expect(ids[2]).not.toBe(ids[0])
  })

  test('a thrown request (connection lost) is retryable with the same id instead of sticking on "Please wait…"', async ({ page }) => {
    await open(page)
    await queueResponse(page, 'nextPatient', { throws: 'Failed to fetch' }, { value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } })
    const cp = page.locator('#current-patient')
    await cp.getByRole('button', { name: 'Next patient' }).click()
    await expect(cp.getByRole('alert')).toContainText('Couldn’t reach the server')
    await expect(cp.getByRole('button', { name: 'Next patient' })).toBeEnabled()
    await cp.getByRole('button', { name: 'Next patient' }).click()
    await expect(cp.getByRole('heading', { name: 'Patient called successfully' })).toBeVisible()
    const ids = (await calls(page, 'nextPatient')).map((c) => c.args[0])
    expect(ids).toHaveLength(2)
    expect(ids[1]).toBe(ids[0])
  })

  test('long consultation: Record / Break resubmits the same action id with the decision', async ({ page }) => {
    await open(page)
    await queueResponse(page, 'nextPatient', { value: { data: { status: 'long_consultation', queue_entry_id: ID.current, duration_minutes: 62.4, threshold_minutes: 45 } } }, { value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } })
    const cp = page.locator('#current-patient')
    await cp.getByRole('button', { name: 'Next patient' }).click()
    await expect(cp).toContainText('This consultation has been open for 62 minutes')
    await expect(cp.getByRole('button', { name: 'Break occurred' })).toBeVisible()
    await cp.getByRole('button', { name: 'Record 62 min' }).click()
    await expect(cp.getByRole('heading', { name: 'Patient called successfully' })).toBeVisible()
    const c = await calls(page, 'nextPatient')
    expect(c.map((x) => x.args[1])).toEqual([null, 'record'])
    expect(c[1]!.args[0]).toBe(c[0]!.args[0])
  })

  test('Undo targets the original action id, once (same-tick clicks), then re-reads authoritative state', async ({ page }) => {
    await open(page)
    await queueResponse(page, 'nextPatient', { value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } }, { value: { entry: CURRENT } })
    await queueResponse(page, 'undoAction', { hold: true, value: { data: { status: 'undone', restored_token: 'GC-101' } } })
    const cp = page.locator('#current-patient')
    await cp.getByRole('button', { name: 'Next patient' }).click()
    await expect(cp.getByRole('button', { name: /Undo call/ })).toBeVisible()
    const actionId = (await calls(page, 'nextPatient'))[0]!.args[0]
    await tripleClick(page, '#current-patient button[aria-label^="Undo call"]')
    await expect(cp.getByRole('button', { name: /Undo call/ })).toHaveText('Please wait…')
    expect(await calls(page, 'undoAction')).toHaveLength(1)
    expect((await calls(page, 'undoAction'))[0]!.args[0]).toBe(actionId)
    await release(page, 'undoAction')
    await expect(cp.getByText('CURRENT PATIENT')).toBeVisible()
    await expect(cp).toContainText('GC-101')
    expect((await calls(page, 'getNurseCurrentState')).length).toBeGreaterThanOrEqual(2)
  })

  test('Undo refused by the server (e.g. window expired server-side): reason shown, Undo gone, panel collapses', async ({ page }) => {
    await open(page)
    await queueResponse(page, 'nextPatient', { value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } })
    await queueResponse(page, 'undoAction', { value: { error: 'Undo window has expired' } })
    const cp = page.locator('#current-patient')
    await cp.getByRole('button', { name: 'Next patient' }).click()
    await cp.getByRole('button', { name: /Undo call/ }).click()
    await expect(cp).toContainText('Undo window has expired')
    await expect(cp.getByRole('button', { name: /Undo call/ })).toHaveCount(0)
    await expect(cp.getByText('CURRENT PATIENT')).toBeVisible({ timeout: 6000 })
    await expect(cp).toContainText('GC-107')
  })

  test('Undo that never reached the server stays available and retries the same id', async ({ page }) => {
    await open(page)
    await queueResponse(page, 'nextPatient', { value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } }, { value: { entry: CURRENT } })
    await queueResponse(page, 'undoAction', { throws: 'Failed to fetch' }, { value: { data: { status: 'undone', restored_token: 'GC-101' } } })
    const cp = page.locator('#current-patient')
    await cp.getByRole('button', { name: 'Next patient' }).click()
    await cp.getByRole('button', { name: /Undo call/ }).click()
    await expect(cp.getByRole('alert')).toContainText('Couldn’t reach the server')
    await cp.getByRole('button', { name: /Undo call/ }).click()
    await expect(cp.getByText('CURRENT PATIENT')).toBeVisible()
    const ids = (await calls(page, 'undoAction')).map((c) => c.args[0])
    expect(ids).toHaveLength(2)
    expect(ids[1]).toBe(ids[0])
  })

  test('Undo countdown is accurate and expires: the button disappears and nothing can be undone', async ({ page }) => {
    await open(page, { props: queueProps({ undoWindowSeconds: 3 }) as never })
    await queueResponse(page, 'nextPatient', { value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } })
    const cp = page.locator('#current-patient')
    await cp.getByRole('button', { name: 'Next patient' }).click()
    await expect(cp.locator('button[aria-label^="Undo call"]')).toHaveText(/^Undo call \([123]s\)$/)
    await expect(cp).toContainText('Undo window has closed', { timeout: 6000 })
    await expect(cp.getByRole('button', { name: /Undo call/ })).toHaveCount(0)
    expect(await calls(page, 'undoAction')).toHaveLength(0)
  })

  test('queue empty: "Consultation completed", Undo only when a consultation was actually ended', async ({ page }) => {
    await open(page)
    await queueResponse(page, 'nextPatient', {
      value: { data: { status: 'queue_empty', ended_consultation_id: CURRENT.consultationId, ended_token: 'GC-101', ended_minutes: 14, ended_counted: false, ended_exclusion_reason: 'staff_break' } },
    })
    const cp = page.locator('#current-patient')
    await cp.getByRole('button', { name: 'Next patient' }).click()
    await expect(cp.getByRole('heading', { name: 'Consultation completed' })).toBeVisible()
    await expect(cp).toContainText('No patients are waiting.')
    await expect(cp).toContainText('GC-101’s consultation ended after 14 min (break).')
    await expect(cp.getByRole('button', { name: /Undo call/ })).toBeVisible()
  })
})

test.describe('harness: Skip is disabled fail-closed on Nurse V3', () => {
  test.afterEach(() => expect(escapes, 'a request escaped the harness').toEqual([]))

  test('every waiting-row Skip is aria-disabled, explained, and does nothing when clicked or activated by keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    const note = page.locator('#my-queue-skip-unavailable')
    await expect(note).toContainText('Skip is temporarily unavailable on My Queue')
    await expect(note).toContainText('ask reception to skip them')
    const skip = panel(page).getByRole('button', { name: 'Skip GC-102, Harness First — unavailable' })
    await expect(skip).toHaveAttribute('aria-disabled', 'true')
    await expect(skip).toHaveAttribute('aria-describedby', 'my-queue-skip-unavailable')
    await expect(skip).toHaveAccessibleDescription(/Skip is temporarily unavailable on My Queue/)
    await skip.click({ force: true }) // Playwright otherwise waits for an aria-disabled control to become enabled
    await skip.focus()
    await expect(skip).toBeFocused()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const names = (await calls(page)).map((c) => c.name)
    expect(names.filter((n) => /skip/i.test(n))).toEqual([])
  })

  test('the same on the stacked mobile cards', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page)
    const skip = panel(page).getByRole('button', { name: 'Skip GC-102, Harness First — unavailable' })
    await expect(skip).toHaveAttribute('aria-disabled', 'true')
    await skip.click({ force: true }) // Playwright otherwise waits for an aria-disabled control to become enabled
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect((await calls(page)).filter((c) => /skip/i.test(c.name))).toEqual([])
  })

  test('no explanation note when there is nothing to skip', async ({ page }) => {
    const empty = snapshot({ queue: [], completed: [], estimates: {} })
    await open(page, { props: queueProps({ initialSnapshot: empty, initialEntry: null }) as never, defaults: readDefaults(empty, null) })
    await expect(page.locator('#my-queue-skip-unavailable')).toHaveCount(0)
  })

  test('emergency control on a waiting row is the existing action, with its confirmation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page, { defaults: { ...readDefaults(), setEmergencyPriority: { value: { success: true } } } })
    const row = tableRows(page).filter({ hasText: 'GC-102' })
    await row.getByRole('button', { name: 'Mark emergency' }).click()
    await row.getByRole('button', { name: 'Confirm' }).click()
    await expect.poll(async () => (await calls(page, 'setEmergencyPriority')).length).toBe(1)
    expect((await calls(page, 'setEmergencyPriority'))[0]!.args[0]).toEqual({ queue_entry_id: ID.first, emergency: 'true' })
  })
})

test.describe('harness: realtime, reconciliation and stale reads', () => {
  test.afterEach(() => expect(escapes, 'a request escaped the harness').toEqual([]))

  test('a realtime ping re-reads: a new check-in appears; tab, search and filter are preserved', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    await tab(page, /^Waiting/).click()
    await page.getByPlaceholder('Search by name or token...').fill('harness')
    const withNew = [...QUEUE, { ...QUEUE[2]!, queue_entry_id: ID.newCheckIn, token: 'GC-108', patient_name: 'Harness Newcomer', checked_in_at: at('08:05') }]
    await setDefault(page, 'rpc:get_service_queue', { value: { data: withNew, error: null } })
    await fireQueueChange(page)
    await expect(tableRows(page).filter({ hasText: 'GC-108' })).toHaveCount(1)
    await expect(tab(page, /^Waiting \(5\)$/)).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByPlaceholder('Search by name or token...')).toHaveValue('harness')
    expect(await calls(page, 'nextPatient')).toHaveLength(0)
  })

  test('the queue becoming empty after another nurse calls the last patient', async ({ page }) => {
    await open(page, { props: queueProps({ initialEntry: null }) as never, defaults: readDefaults(snapshot(), null) })
    await setDefault(page, 'rpc:get_service_queue', { value: { data: [], error: null } })
    await fireQueueChange(page)
    await tab(page, /^Waiting/).click()
    await expect(panel(page)).toContainText('No one is waiting')
    await expect(page.locator('#current-patient')).toContainText('No one is waiting.')
  })

  test('a slow read that started before an action can’t overwrite what the action produced', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    await page.waitForTimeout(200)
    const stale = QUEUE // the queue before the call: no GC-108
    const fresh = [...QUEUE.filter((r) => r.queue_entry_id !== ID.emergency), { ...QUEUE[2]!, queue_entry_id: ID.newCheckIn, token: 'GC-108', patient_name: 'Harness Newcomer' }]
    await queueResponse(page, 'rpc:get_service_queue', { hold: true, value: { data: stale, error: null } }, { value: { data: fresh, error: null } })
    await fireQueueChange(page) // read #1 starts and hangs
    await queueResponse(page, 'nextPatient', { value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } })
    await page.locator('#current-patient').getByRole('button', { name: 'Next patient' }).click()
    await expect(tableRows(page).filter({ hasText: 'GC-108' })).toHaveCount(1) // read #2 (after the action) applied
    await release(page, 'rpc:get_service_queue') // the stale read #1 now resolves
    await page.waitForTimeout(400)
    await expect(tableRows(page).filter({ hasText: 'GC-108' })).toHaveCount(1)
  })

  test('another tab advanced the queue: on focus this tab re-reads and shows the new current patient', async ({ page }) => {
    await open(page)
    await setDefault(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.locator('#current-patient')).toContainText('GC-107')
    expect(await calls(page, 'nextPatient')).toHaveLength(0)
  })

  test('a failed current-state read on focus keeps the patient on screen (not "no patient")', async ({ page }) => {
    await open(page)
    await setDefault(page, 'getNurseCurrentState', { value: { entry: null, error: 'network' } })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForTimeout(300)
    await expect(page.locator('#current-patient')).toContainText('GC-101')
  })

  test('lost connection: banner; a failed refresh keeps the last list and says it may be stale', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    await page.evaluate(() => window.__harness.setOnline(false))
    await expect(panel(page).getByText('Connection lost — reconnecting…')).toBeVisible()
    await setDefault(page, 'rpc:get_service_queue', { value: { data: null, error: { message: 'fetch failed' } } })
    await fireQueueChange(page)
    await expect(panel(page)).toContainText('Couldn’t refresh the queue')
    await expect(tableRows(page).filter({ hasText: 'GC-102' })).toHaveCount(1)
  })
})

test.describe('harness: the working screen still uses the same state machine', () => {
  test.afterEach(() => expect(escapes, 'a request escaped the harness').toEqual([]))

  const classic = (over: Record<string, unknown> = {}): Partial<HarnessConfig> => ({
    mode: 'classic',
    props: { initialEntry: CURRENT, serviceId: SERVICE_ID, undoWindowSeconds: 60, serviceAverageMinutes: 11, initialNextToken: 'GC-107', ...over },
  })

  test('CurrentPatientPanel: call, retry with the same id, undo with the original id', async ({ page }) => {
    await open(page, classic())
    await queueResponse(page, 'nextPatient', { value: { error: 'timeout' } }, { value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } }, { value: { entry: CURRENT } })
    await queueResponse(page, 'undoAction', { value: { data: { status: 'undone', restored_token: 'GC-101' } } })
    await page.getByRole('button', { name: 'Next patient' }).click()
    await expect(page.getByRole('alert')).toContainText('timeout')
    await page.getByRole('button', { name: 'Next patient' }).click()
    await expect(page.getByText('Harness Emergency')).toBeVisible()
    await page.getByRole('button', { name: /^Undo \(\d+s\)$/ }).click()
    await expect(page.getByText('Harness Current')).toBeVisible()
    const n = (await calls(page, 'nextPatient')).map((c) => c.args[0])
    expect(n[1]).toBe(n[0])
    expect((await calls(page, 'undoAction'))[0]!.args[0]).toBe(n[0])
  })

  test('CurrentPatientPanel: long-consultation decision and a single request for same-tick clicks', async ({ page }) => {
    await open(page, classic())
    await queueResponse(page, 'nextPatient', { value: { data: { status: 'long_consultation', queue_entry_id: ID.current, duration_minutes: 50, threshold_minutes: 45 } } }, { hold: true, value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } })
    await page.getByRole('button', { name: 'Next patient' }).click()
    await expect(page.getByText('This consultation has been open for 50 minutes')).toBeVisible()
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.startsWith('Break occurred'))!
      b.click()
      b.click()
    })
    await release(page, 'nextPatient')
    await expect(page.getByText('Harness Emergency')).toBeVisible()
    expect((await calls(page, 'nextPatient')).map((c) => c.args[1])).toEqual([null, 'break'])
  })
})

test.describe('harness: classic CurrentPatientPanel regressions (shared hook)', () => {
  test.afterEach(() => expect(escapes, 'a request escaped the harness').toEqual([]))
  const classic = (over: Record<string, unknown> = {}): Partial<HarnessConfig> => ({
    mode: 'classic',
    props: { initialEntry: CURRENT, serviceId: SERVICE_ID, undoWindowSeconds: 60, serviceAverageMinutes: 11, initialNextToken: 'GC-107', ...over },
  })

  test('same-tick clicks send one request', async ({ page }) => {
    await open(page, classic())
    await queueResponse(page, 'nextPatient', { hold: true, value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } })
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Next patient')!
      b.click()
      b.click()
      b.click()
    })
    await page.waitForTimeout(200)
    expect(await calls(page, 'nextPatient')).toHaveLength(1)
    await release(page, 'nextPatient')
    await expect(page.getByText('Harness Emergency')).toBeVisible()
  })

  test('a thrown request is retryable with the same id', async ({ page }) => {
    await open(page, classic())
    await queueResponse(page, 'nextPatient', { throws: 'Failed to fetch' }, { value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } })
    await page.getByRole('button', { name: 'Next patient' }).click()
    await expect(page.getByRole('alert')).toContainText('Couldn’t reach the server')
    await page.getByRole('button', { name: 'Next patient' }).click()
    await expect(page.getByText('Harness Emergency')).toBeVisible()
    const ids = (await calls(page, 'nextPatient')).map((c) => c.args[0])
    expect(ids).toHaveLength(2)
    expect(ids[1]).toBe(ids[0])
  })

  test('Undo expiry: countdown, "Undo window has closed", no undo sent', async ({ page }) => {
    await open(page, classic({ undoWindowSeconds: 2 }))
    await queueResponse(page, 'nextPatient', { value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } })
    await page.getByRole('button', { name: 'Next patient' }).click()
    await expect(page.getByRole('button', { name: /^Undo \([12]s\)$/ })).toBeVisible()
    await expect(page.getByText('Undo window has closed')).toBeVisible({ timeout: 6000 })
    await expect(page.getByRole('button', { name: /^Undo/ })).toHaveCount(0)
    expect(await calls(page, 'undoAction')).toHaveLength(0)
  })

  test('Undo that never reached the server stays available and retries the same id', async ({ page }) => {
    await open(page, classic())
    await queueResponse(page, 'nextPatient', { value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } }, { value: { entry: CURRENT } })
    await queueResponse(page, 'undoAction', { throws: 'Failed to fetch' }, { value: { data: { status: 'undone', restored_token: 'GC-101' } } })
    await page.getByRole('button', { name: 'Next patient' }).click()
    await page.getByRole('button', { name: /^Undo/ }).click()
    await expect(page.getByRole('alert')).toContainText('Couldn’t reach the server')
    await page.getByRole('button', { name: /^Undo/ }).click()
    await expect(page.getByText('Harness Current')).toBeVisible()
    const ids = (await calls(page, 'undoAction')).map((c) => c.args[0])
    expect(ids).toEqual([ids[0], ids[0]])
    expect(ids[0]).toBe((await calls(page, 'nextPatient'))[0]!.args[0])
  })

  test('focus reconciliation shows what another tab did; a failed read keeps the patient', async ({ page }) => {
    await open(page, classic())
    await setDefault(page, 'getNurseCurrentState', { value: { entry: null, error: 'network' } })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForTimeout(300)
    await expect(page.getByText('Harness Current')).toBeVisible()
    await setDefault(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByText('Harness Emergency')).toBeVisible()
    expect(await calls(page, 'nextPatient')).toHaveLength(0)
  })

  test('queue empty: "No patients waiting", Undo offered only because a consultation was ended', async ({ page }) => {
    await open(page, classic())
    await queueResponse(page, 'nextPatient', {
      value: { data: { status: 'queue_empty', ended_consultation_id: CURRENT.consultationId, ended_token: 'GC-101', ended_minutes: 12, ended_counted: true, ended_exclusion_reason: null } },
    })
    await page.getByRole('button', { name: 'Next patient' }).click()
    await expect(page.getByText('Consultation completed. No patients waiting.')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Undo/ })).toBeVisible()
  })

  test('queue empty with nothing open before: no Undo', async ({ page }) => {
    await open(page, classic({ initialEntry: null, initialNextToken: null }))
    await queueResponse(page, 'nextPatient', {
      value: { data: { status: 'queue_empty', ended_consultation_id: null, ended_token: null, ended_minutes: null, ended_counted: null, ended_exclusion_reason: null } },
    })
    await page.getByRole('button', { name: 'Call next patient' }).click()
    await expect(page.getByText('Consultation completed. No patients waiting.')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Undo/ })).toHaveCount(0)
  })
})

test.describe('harness: End session report survives going off duty', () => {
  test.afterEach(() => expect(escapes, 'a request escaped the harness').toEqual([]))
  const ended = { value: { data: { status: 'shift_ended', closed_consultation: true, closed_token: 'GC-101', closed_minutes: 30.2, excluded: false } } }
  const header = (onDuty: boolean) => ({
    services: [{ id: SERVICE_ID, name: 'General Consultation' }],
    isOnDuty: onDuty,
    currentServiceId: onDuty ? SERVICE_ID : null,
    currentServiceName: onDuty ? 'General Consultation' : null,
  })
  /** What the server re-render after router.refresh() does: the same mounted tree receives new props. */
  const rerender = (page: Page, props: unknown) =>
    page.evaluate((p) => (window as unknown as { __harnessSetProps: (x: unknown) => void }).__harnessSetProps(p), props)

  test('classic /nurse header: after end_shift and the page re-render, "Session ended…" is still shown', async ({ page }) => {
    await open(page, { mode: 'header', props: header(true), defaults: { checkEndSessionImpact: { value: { impact: null } }, endShift: ended } })
    await page.getByRole('button', { name: 'End session' }).click()
    await expect.poll(async () => (await calls(page, 'router.refresh')).length).toBe(1)
    await rerender(page, header(false))
    await expect(page.getByText('Off duty', { exact: true })).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('Session ended. GC-101 closed at 30 min.')
    expect(await calls(page, 'endShift')).toHaveLength(1)
  })

  test('the report clears when a new session starts', async ({ page }) => {
    await open(page, { mode: 'header', props: header(true), defaults: { checkEndSessionImpact: { value: { impact: null } }, endShift: ended } })
    await page.getByRole('button', { name: 'End session' }).click()
    await expect.poll(async () => (await calls(page, 'router.refresh')).length).toBe(1)
    await rerender(page, header(false))
    await expect(page.getByText(/^Session ended/)).toBeVisible()
    await rerender(page, header(true))
    await expect(page.getByText(/^Session ended/)).toHaveCount(0)
  })

  test('Nurse V3 My Queue: the report survives too, while the queue body resets to off duty', async ({ page }) => {
    await open(page, { defaults: { ...readDefaults(), endShift: ended } })
    await page.getByRole('button', { name: 'End session' }).click()
    await expect.poll(async () => (await calls(page, 'router.refresh')).length).toBe(1)
    await rerender(page, queueProps({ nurse: { ...queueProps().nurse, isOnDuty: false, serviceId: null, serviceName: null }, initialSnapshot: snapshot({ queue: [], estimates: {} }), initialEntry: null }))
    await expect(page.getByText('Off duty', { exact: true })).toBeVisible()
    await expect(page.getByText('Session ended. GC-101 closed at 30 min.')).toBeVisible()
    await expect(page.locator('#current-patient')).toHaveCount(0)
    await expect(tab(page, /^Waiting \(0\)$/)).toBeVisible()
  })
})

test.describe('harness: fail-closed interception', () => {
  test('a request to Supabase or a Server Action POST from the page is aborted and recorded', async ({ page }) => {
    await open(page)
    await page.evaluate(async () => {
      await fetch('https://bffhjvpkfivtbzqielve.supabase.co/rest/v1/queue_entries', { method: 'PATCH' }).catch(() => {})
      await fetch('/nurse/queue', { method: 'POST', headers: { 'next-action': 'x' } }).catch(() => {})
    })
    expect(escapes).toHaveLength(2)
    expect(escapes[0]).toContain('supabase.co')
    escapes = []
  })

  test('an action with no configured response fails visibly, never silently succeeds; the mocked client refuses writes', async ({ page }) => {
    await open(page)
    const cp = page.locator('#current-patient')
    await cp.getByRole('button', { name: 'Next patient' }).click()
    await expect(cp.getByRole('alert')).toContainText('Couldn’t reach the server')
    await expect(cp.getByRole('heading', { name: 'Patient called successfully' })).toHaveCount(0)
    const err = await page.evaluate(() => {
      try {
        ;(window as unknown as { __harnessSupabase: { from: (t: string) => { update: (v: unknown) => unknown } } }).__harnessSupabase.from('queue_entries').update({})
        return 'no error'
      } catch (e) {
        return (e as Error).message
      }
    })
    expect(err).toContain('write attempted')
    expect(escapes).toEqual([])
  })
})

test.describe('harness: responsive layout and accessibility', () => {
  test.afterEach(() => expect(escapes, 'a request escaped the harness').toEqual([]))

  for (const [width, height] of [
    [1440, 1024],
    [1280, 900],
    [1024, 900],
    [900, 900],
    [768, 1024],
    [390, 844],
  ] as const) {
    test(`${width}px: no horizontal page scroll; tabs, search, Call next and actions usable`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await open(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      for (const loc of [tab(page, /^All/), tab(page, /^Completed/), page.getByPlaceholder('Search by name or token...'), page.getByRole('button', { name: 'Filters' }), page.locator('#current-patient').getByRole('button', { name: 'Next patient' })]) {
        await expect(loc).toBeVisible()
        const box = (await loc.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
      }
      if (width >= 1280) {
        await expect(panel(page).locator('table')).toBeVisible()
      } else {
        await expect(panel(page).locator('table')).toBeHidden()
        await expect(panel(page).locator('ul > li')).toHaveCount(7)
        const skip = panel(page).getByRole('button', { name: 'Skip GC-102, Harness First — unavailable' })
        await expect(skip).toBeVisible()
        const b = (await skip.boundingBox())!
        expect(b.height).toBeGreaterThanOrEqual(44)
      }
      if (width < 768) {
        const signOut = page.getByRole('navigation', { name: 'Main' }).filter({ visible: true }).getByRole('button', { name: 'Sign Out' })
        await expect(signOut).toBeVisible()
        const s = (await signOut.boundingBox())!
        expect(s.x + s.width).toBeLessThanOrEqual(width)
      }
    })
  }

  test('1440: Figma geometry — 264px sidebar, title at x=304, 1096px content column', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    const h1 = (await page.getByRole('heading', { level: 1 }).boundingBox())!
    expect(Math.round(h1.x)).toBe(304)
    expect(Math.round(h1.y)).toBe(40)
    const search = (await page.getByPlaceholder('Search by name or token...').locator('xpath=ancestor::label').boundingBox())!
    expect(Math.round(search.height)).toBe(46)
    const tbl = (await panel(page).boundingBox())!
    expect(Math.round(tbl.x)).toBe(304)
    expect(Math.round(tbl.width)).toBe(1096)
    const filters = (await page.getByRole('button', { name: 'Filters' }).boundingBox())!
    expect(Math.round(filters.height)).toBe(48)
    expect(Math.round(filters.x + filters.width)).toBe(1400)
  })

  test('structure: one h1, one main, labelled regions, tablist/tabpanel, captioned table with 8 column headers, labelled search', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.locator('main')).toHaveCount(1)
    await expect(page.getByRole('tablist', { name: 'Filter by status' })).toBeVisible()
    await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'my-queue-tab-all')
    await expect(panel(page).locator('caption')).toHaveCount(1)
    await expect(panel(page).locator('th[scope=col]')).toHaveCount(8)
    await expect(page.getByRole('searchbox', { name: 'Search by patient name or token' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Current patient' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Signed in as' })).toContainText('Harness Nurse')
  })

  test('keyboard: Call next is reachable by Tab and shows a focus ring', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    const btn = page.locator('#current-patient').getByRole('button', { name: 'Next patient' })
    for (let i = 0; i < 20 && !(await btn.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
    await expect(btn).toBeFocused()
    expect(await btn.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')
  })
})

// ------------------------------------------------------------------ 3. live, read-only

const QUEUE_URL = '/nurse/queue'

async function loginAs(page: Page, email: string, password: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await rawLoginAs(page, email, password)
    try {
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 90_000 })
      return
    } catch {
      if (attempt === 1) throw new Error('sign-in did not complete')
    }
  }
}

test.describe('My Queue — access', () => {
  test.describe.configure({ timeout: 300_000 })

  test('signed-out visitors are sent to login', async ({ page }) => {
    await page.goto(QUEUE_URL)
    await expect(page).toHaveURL(/\/login/, { timeout: 90_000 })
  })

  for (const role of ['patient', 'receptionist'] as const) {
    test(`a ${role} account is redirected away, not shown My Queue`, async ({ page }) => {
      await loginAs(page, ACCOUNTS[role].email, ACCOUNTS[role].password)
      await page.goto(QUEUE_URL)
      await page.waitForLoadState('domcontentloaded')
      await expect(page).not.toHaveURL(/\/nurse\/queue/, { timeout: 90_000 })
      await expect(page.getByRole('heading', { level: 1, name: 'My Queue' })).toHaveCount(0)
    })
  }
})

test.describe('My Queue — live, read-only', () => {
  test.describe.configure({ timeout: 300_000 })

  async function openQueue(page: Page) {
    await loginAs(page, ACCOUNTS.nurse.email, ACCOUNTS.nurse.password)
    await page.goto(QUEUE_URL)
    await expect(page.getByRole('heading', { level: 1, name: 'My Queue' })).toBeVisible({ timeout: 90_000 })
  }

  test('real nurse, real duty state, four tabs; no Figma example data; nothing is mutated on load', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await openQueue(page)
    const chip = page.getByRole('group', { name: 'Signed in as' })
    await expect(chip).toContainText(/Nurse/)
    await expect(chip).not.toContainText('Mkhize')
    for (const name of [/^All \(\d+\)$/, /^Waiting \(\d+\)$/, /^In Consultation \(\d+\)$/, /^Completed \(\d+\)$/]) await expect(tab(page, name)).toBeVisible()
    await expect(page.getByText(/On duty · |Off duty/).first()).toBeVisible()
    for (const name of ['Nomusa Dlamini', 'Sipho Zulu', 'Sr. L. Mkhize']) await expect(page.getByText(name)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /start consult/i })).toHaveCount(0)
  })

  test('its Waiting count agrees with the classic screen’s WAITING tile', async ({ page }) => {
    await openQueue(page)
    const v3 = Number(/\((\d+)\)/.exec((await tab(page, /^Waiting/).textContent()) ?? '')![1])
    await page.goto('/nurse')
    await expect(page.getByRole('heading', { level: 1, name: /^Nurse/ })).toBeVisible({ timeout: 90_000 })
    const tile = page.locator('p', { hasText: /^WAITING$/ }).locator('xpath=following-sibling::p[1]')
    if (await tile.count()) await expect(tile).toHaveText(String(v3))
  })

  test('sidebar marks My Queue; the classic screen is one click away and still loads', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await openQueue(page)
    const nav = page.getByRole('navigation', { name: 'Main' }).first()
    await expect(nav.getByRole('link', { name: 'My Queue' })).toHaveAttribute('aria-current', 'page')
    await page.getByRole('link', { name: 'Open the classic nurse screen' }).click()
    await expect(page).toHaveURL(/\/nurse$/, { timeout: 90_000 })
    await expect(page.getByRole('heading', { level: 1, name: /^Nurse/ })).toBeVisible({ timeout: 90_000 })
  })

  for (const [w, h] of [
    [1440, 1024],
    [1280, 900],
    [1024, 900],
    [900, 900],
    [768, 1024],
    [390, 844],
  ] as const) {
    test(`${w}px: no page-level horizontal scroll on the real page`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await openQueue(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      if (w < 768) {
        await expect(page.getByRole('navigation', { name: 'Main' }).filter({ visible: true }).getByRole('button', { name: 'Sign Out' })).toBeVisible()
      }
    })
  }
})
