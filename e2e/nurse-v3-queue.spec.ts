import { test, expect, type Page } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
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

test.describe('pure: V3 waiting-row Skip goes only through the safe shared action', () => {
  /** Source with comments removed, so documentation can mention what the code must not do. */
  const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const v3Files = () => {
    const roots = ['components/nurse/v3', 'app/nurse/(v3)', 'lib/hooks', 'lib/nurseQueue.ts']
    const files: string[] = []
    const walk = (p: string) => {
      if (p.endsWith('.ts') || p.endsWith('.tsx')) return void files.push(p)
      for (const e of readdirSync(p, { withFileTypes: true })) walk(path.join(p, e.name))
    }
    roots.forEach(walk)
    return files
  }

  test('no V3 file calls skip_patient, reception’s action or any RPC directly; only the modal imports the shared skipPatient action', () => {
    const files = v3Files()
    expect(files.length).toBeGreaterThan(5)
    const importers: string[] = []
    for (const f of files) {
      const src = codeOnly(readFileSync(f, 'utf8'))
      expect(src, f).not.toMatch(/skip_patient|skipQueueEntry|SkipPatientModal|SkipButton|skipWaitingPatient|waitingSkipRefusal|skip_waiting_patient'/)
      if (/import[^;]*\bskipPatient\b[^;]*from/.test(src)) importers.push(f.replaceAll('\\', '/'))
    }
    expect(importers).toEqual(['components/nurse/v3/NurseSkipModal.tsx'])
    expect(readFileSync('components/nurse/v3/NurseSkipModal.tsx', 'utf8')).toMatch(/import \{ skipPatient[^}]*\} from '@\/app\/actions\/nurse'/)
  })

  test('the shared action all skip UIs use calls skip_waiting_patient and never skip_patient', () => {
    const src = readFileSync('app/actions/nurse.ts', 'utf8')
    const fn = src.slice(src.indexOf('export async function skipPatient'), src.indexOf('export type EmergencyState'))
    expect(fn.length).toBeGreaterThan(100)
    expect(fn).toContain(".rpc('skip_waiting_patient'")
    expect(fn).not.toContain("'skip_patient'")
    expect(src).not.toMatch(/\.rpc\('skip_patient'/)
  })

  test('the modal has no Reason or Notes inputs and does not claim the patient stays in the queue', () => {
    const src = codeOnly(readFileSync('components/nurse/v3/NurseSkipModal.tsx', 'utf8'))
    expect(src).not.toMatch(/<select|<textarea|type="text"|name="reason"|name="notes"/)
    expect(src).not.toMatch(/remain in the queue|will remain|stay in the queue/)
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
    await expect(panel(page).getByRole('button', { name: /^Skip GC/ })).toHaveCount(4)
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

test.describe('harness: Skip Patient dialog on Nurse V3', () => {
  test.afterEach(() => expect(escapes, 'a request escaped the harness').toEqual([]))

  const skipButton = (page: Page, token = 'GC-102', name = 'Harness First') => panel(page).getByRole('button', { name: `Skip ${token}, ${name}` })
  const skipCalls = async (page: Page) => (await calls(page)).filter((c) => /skip/i.test(c.name))
  /** The queue as another nurse leaves it after calling GC-102: that patient is in progress, not waiting. */
  const queueAfterAnotherNurseCalled = QUEUE.map((r) => (r.queue_entry_id === ID.first ? { ...r, status: 'in_progress' as const } : r))

  test('opening the dialog sends nothing; it shows the right patient, the corrected wording and no Reason or Notes fields', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    await skipButton(page).click()
    const dialog = page.getByRole('dialog', { name: 'Skip Patient' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('GC-102')
    await expect(dialog).toContainText('Harness First')
    await expect(dialog).toContainText('General Consultation')
    await expect(dialog).toContainText(
      'The patient will be marked as skipped and removed from the active waiting queue. Their history will be retained.'
    )
    await expect(dialog).not.toContainText('remain in the queue')
    await expect(dialog.locator('select, textarea, input:not([type=hidden])')).toHaveCount(0)
    expect(await skipCalls(page)).toEqual([])
  })

  test('Cancel, Escape, the close button and a click on the backdrop dismiss without skipping; focus returns to the row button', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    const trigger = skipButton(page)
    await trigger.click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await trigger.click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await trigger.click()
    await page.getByRole('button', { name: 'Close dialog' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await trigger.click()
    await page.mouse.click(5, 5)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await skipCalls(page)).toEqual([])
  })

  test('keyboard: the dialog takes focus, Tab and Shift+Tab stay inside it, Enter on Skip Patient confirms', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    await queueResponse(page, 'skipPatient', { value: { skipped: true } })
    await skipButton(page).focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeFocused()
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true)
    }
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Shift+Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true)
    }
    await dialog.getByRole('button', { name: 'Skip Patient' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await skipCalls(page)).toHaveLength(1)
  })

  test('confirm: one request for same-tick clicks, loading state, success closes, toast, queue re-read, focus lands on the list', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    await queueResponse(page, 'skipPatient', { hold: true, value: { skipped: true } })
    const after = snapshot({ queue: QUEUE.filter((r) => r.queue_entry_id !== ID.first) })
    await setDefault(page, 'rpc:get_service_queue', { value: { data: after.queue, error: null } })
    const readsBefore = (await calls(page, 'rpc:get_service_queue')).length
    await skipButton(page).click()
    await tripleClick(page, '[role=dialog] button[type=submit]')
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Skipping…' })).toBeDisabled()
    expect(await skipCalls(page)).toHaveLength(1)
    // The same shared action the classic screen uses, carrying only the queue entry id.
    expect((await calls(page, 'skipPatient'))[0]!.args[0]).toEqual({ queue_entry_id: ID.first })
    await release(page, 'skipPatient')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: 'Queue updated' })).toContainText('GC-102 was skipped and removed from the waiting queue')
    await expect(tableRows(page).filter({ hasText: 'GC-102' })).toHaveCount(0)
    await expect(tab(page, /^Waiting \(3\)$/)).toBeVisible()
    expect((await calls(page, 'rpc:get_service_queue')).length).toBeGreaterThan(readsBefore)
    await expect(panel(page)).toBeFocused()
    expect(await skipCalls(page)).toHaveLength(1)
  })

  test('the patient was called by another nurse while the dialog was open: refused, explained, nothing skipped, the stale list is refreshed', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    await skipButton(page).click()
    await queueResponse(page, 'skipPatient', { value: { error: 'This patient is already in consultation and can’t be skipped from the waiting list' } })
    await setDefault(page, 'rpc:get_service_queue', { value: { data: queueAfterAnotherNurseCalled, error: null } })
    const readsBefore = (await calls(page, 'rpc:get_service_queue')).length
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Skip Patient' }).click()
    await expect(dialog.getByRole('alert')).toContainText('already in consultation')
    await expect(dialog.getByRole('alert')).toContainText('Nothing was changed for this patient')
    await expect(dialog.getByRole('button', { name: 'Skip Patient' })).toHaveCount(0) // retrying cannot succeed
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible()
    await expect.poll(async () => (await calls(page, 'rpc:get_service_queue')).length).toBeGreaterThan(readsBefore)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // The row behind the dialog now reflects reality: no longer a waiting row, so no Skip button for it.
    await expect(skipButton(page)).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: 'was skipped' })).toHaveCount(0)
    expect(await skipCalls(page)).toHaveLength(1)
  })

  test('the patient was skipped by someone else meanwhile ("no longer waiting"): refused the same way, list refreshed', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    await skipButton(page).click()
    await queueResponse(page, 'skipPatient', { value: { error: 'That patient is no longer waiting' } })
    await setDefault(page, 'rpc:get_service_queue', { value: { data: QUEUE.filter((r) => r.queue_entry_id !== ID.first), error: null } })
    await page.getByRole('dialog').getByRole('button', { name: 'Skip Patient' }).click()
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('no longer waiting')
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(tableRows(page).filter({ hasText: 'GC-102' })).toHaveCount(0)
  })

  test('another clinic’s or a missing entry ("Queue entry not found") and an unauthorised caller are refused with the server’s message', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    await queueResponse(page, 'skipPatient', { value: { error: 'Queue entry not found' } }, { value: { error: 'Not authorised' } })
    await skipButton(page).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Skip Patient' }).click()
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Queue entry not found')
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    // "Not authorised" is not a stale-list refusal: the confirm button stays for a deliberate retry.
    await skipButton(page, 'GC-104', 'Harness Second').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Skip Patient' }).click()
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Not authorised')
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Skip Patient' })).toBeEnabled()
  })

  test('a dropped connection becomes an error in the dialog (not a crash) and a deliberate retry can succeed', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    await queueResponse(page, 'skipPatient', { throws: 'Failed to fetch' }, { value: { skipped: true } })
    await skipButton(page).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Skip Patient' }).click()
    await expect(dialog.getByRole('alert')).toContainText('Couldn’t reach the server')
    await expect(dialog.getByRole('button', { name: 'Skip Patient' })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Skip Patient' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await skipCalls(page)).toHaveLength(2)
    await expect(page.getByRole('heading', { level: 1, name: 'My Queue' })).toBeVisible()
  })

  test('Skip appears only on waiting rows', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    await expect(panel(page).getByRole('button', { name: /^Skip GC/ })).toHaveCount(4)
    await expect(tableRows(page).nth(0).getByRole('button')).toHaveCount(0) // current patient
    await expect(tableRows(page).nth(5).getByRole('button')).toHaveCount(0) // completed
  })

  test('off duty: no Skip button anywhere (completed rows only)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    const off = queueProps({ nurse: { ...queueProps().nurse, isOnDuty: false, serviceId: null, serviceName: null }, initialSnapshot: snapshot({ queue: [] }), initialEntry: null })
    await open(page, { props: off as never, defaults: readDefaults(snapshot({ queue: [] }), null) })
    await expect(panel(page).locator('tbody tr')).toHaveCount(2)
    await expect(panel(page).getByRole('button', { name: /^Skip / })).toHaveCount(0)
  })

  test('the same dialog from the stacked mobile cards, fitting a 390px screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 })
    await open(page)
    await skipButton(page).click()
    const dialog = page.getByRole('dialog')
    const box = (await dialog.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    for (const name of ['Cancel', 'Skip Patient']) {
      const btn = dialog.getByRole('button', { name })
      await btn.scrollIntoViewIfNeeded()
      await expect(btn).toBeInViewport()
    }
    expect((await skipButton(page).boundingBox())!.height).toBeGreaterThanOrEqual(44)
  })

  test('Skip never goes through a direct RPC from the browser: the only mutating call is the shared Server Action', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await open(page)
    await queueResponse(page, 'skipPatient', { value: { skipped: true } })
    await skipButton(page).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Skip Patient' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const names = new Set((await calls(page)).map((c) => c.name))
    expect([...names].filter((n) => /skip/i.test(n))).toEqual(['skipPatient'])
    expect([...names].filter((n) => n.startsWith('rpc:') && !['rpc:get_service_queue', 'rpc:get_wait_estimate'].includes(n))).toEqual([])
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

test.describe('harness: unknown consultation state fails closed (V3 My Queue)', () => {
  test.afterEach(() => expect(escapes, 'a request escaped the harness').toEqual([]))
  const UNKNOWN = 'We couldn’t confirm your current consultation'
  const readFailed = { value: { entry: null, error: 'network' } }
  const cp = (page: Page) => page.locator('#current-patient')
  const nextBtn = (page: Page) => cp(page).getByRole('button', { name: /^(Next patient|Call next patient)$/ })

  test('initial read failed: Call next disabled, explained, and inert; a read-only retry that succeeds with no patient enables it', async ({ page }) => {
    await open(page, { props: queueProps({ currentError: 'boom' }) as never, defaults: { ...readDefaults(), getNurseCurrentState: { value: { entry: null } } } })
    await expect(cp(page).getByRole('alert')).toContainText(UNKNOWN)
    await expect(cp(page)).toContainText('Current consultation not confirmed.')
    await expect(cp(page)).not.toContainText('No patient in consultation.')
    await expect(nextBtn(page)).toBeDisabled()
    await nextBtn(page).click({ force: true })
    await tab(page, /^In Consultation/).click()
    await expect(panel(page)).toContainText('Your current consultation couldn’t be confirmed')
    expect(await calls(page, 'nextPatient')).toHaveLength(0)
    const readsBefore = (await calls(page, 'getNurseCurrentState')).length
    await cp(page).getByRole('button', { name: 'Check again' }).click()
    await expect(cp(page).getByRole('alert')).toHaveCount(0)
    expect((await calls(page, 'getNurseCurrentState')).length).toBe(readsBefore + 1)
    await expect(cp(page)).toContainText('No patient in consultation.')
    await expect(cp(page).getByRole('button', { name: 'Call next patient' })).toBeEnabled()
    await queueResponse(page, 'nextPatient', { value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } })
    await cp(page).getByRole('button', { name: 'Call next patient' }).click()
    await expect(cp(page).getByRole('heading', { name: 'Patient called successfully' })).toBeVisible()
    expect(await calls(page, 'nextPatient')).toHaveLength(1)
  })

  test('initial read failed, retry fails again (stays paused), then succeeds with an open consultation (shown)', async ({ page }) => {
    await open(page, { props: queueProps({ currentError: 'boom' }) as never })
    await queueResponse(page, 'getNurseCurrentState', { throws: 'Failed to fetch' }, { value: { entry: CURRENT } })
    await cp(page).getByRole('button', { name: 'Check again' }).click()
    await expect(cp(page).getByRole('button', { name: 'Check again' })).toBeEnabled()
    await expect(cp(page).getByRole('alert')).toContainText(UNKNOWN)
    await expect(nextBtn(page)).toBeDisabled()
    await cp(page).getByRole('button', { name: 'Check again' }).click()
    await expect(cp(page).getByRole('alert')).toHaveCount(0)
    await expect(cp(page)).toContainText('GC-101')
    await expect(cp(page).getByRole('button', { name: 'Next patient' })).toBeEnabled()
    expect(await calls(page, 'nextPatient')).toHaveLength(0)
  })

  test('a legitimate read with no open consultation (no error) allows calling', async ({ page }) => {
    await open(page, { props: queueProps({ initialEntry: null }) as never, defaults: readDefaults(snapshot(), null) })
    await expect(cp(page).getByRole('alert')).toHaveCount(0)
    await expect(cp(page).getByRole('button', { name: 'Call next patient' })).toBeEnabled()
  })

  test('call succeeded but the follow-up read failed: result, action id and Undo kept; Next blocked; no second call; a later retry reconciles', async ({ page }) => {
    await open(page)
    await queueResponse(page, 'nextPatient', { value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', readFailed, { value: { entry: NEXT_IN_ROOM } })
    await cp(page).getByRole('button', { name: 'Next patient' }).click()
    await expect(cp(page).getByRole('heading', { name: 'Patient called successfully' })).toBeVisible()
    await expect(cp(page)).toContainText('GC-107 — Harness Emergency is now in consultation.')
    await expect(cp(page)).toContainText('Consultation status unavailable')
    await expect(cp(page).getByRole('alert')).toContainText(UNKNOWN)
    await expect(cp(page).locator('button[aria-label^="Undo call"]')).toBeEnabled()
    await expect(nextBtn(page)).toBeDisabled()
    await nextBtn(page).click({ force: true })
    await page.waitForTimeout(200)
    expect(await calls(page, 'nextPatient')).toHaveLength(1)
    // The previous patient is not shown as current, and no row claims to be this nurse's consultation.
    await tab(page, /^In Consultation \(0\)$/).click()
    await expect(panel(page)).toContainText('couldn’t be confirmed')
    await cp(page).getByRole('button', { name: 'Check again' }).click()
    await expect(cp(page).getByRole('alert')).toHaveCount(0)
    await expect(cp(page)).toContainText('In consultation')
    await expect(cp(page)).not.toContainText('Consultation status unavailable')
    await expect(cp(page).getByRole('button', { name: 'Next patient' })).toBeEnabled()
    expect(await calls(page, 'nextPatient')).toHaveLength(1)
  })

  test('the same when the follow-up read throws (connection lost)', async ({ page }) => {
    await open(page)
    await queueResponse(page, 'nextPatient', { value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', { throws: 'Failed to fetch' })
    await cp(page).getByRole('button', { name: 'Next patient' }).click()
    await expect(cp(page).getByRole('alert')).toContainText(UNKNOWN)
    await expect(nextBtn(page)).toBeDisabled()
  })

  test('Undo still works from the unknown state, with the original action id, and its read re-establishes the state', async ({ page }) => {
    await open(page)
    await queueResponse(page, 'nextPatient', { value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', readFailed, { value: { entry: CURRENT } })
    await queueResponse(page, 'undoAction', { value: { data: { status: 'undone', restored_token: 'GC-101' } } })
    await cp(page).getByRole('button', { name: 'Next patient' }).click()
    await expect(cp(page).getByRole('alert')).toContainText(UNKNOWN)
    await cp(page).locator('button[aria-label^="Undo call"]').click()
    await expect(cp(page)).toContainText('GC-101')
    await expect(cp(page).getByRole('alert')).toHaveCount(0)
    expect((await calls(page, 'undoAction'))[0]!.args[0]).toBe((await calls(page, 'nextPatient'))[0]!.args[0])
  })

  test('Undo window expires while the state is unknown: still paused (never "no patient"), nothing sent; retry reconciles', async ({ page }) => {
    await open(page, { props: queueProps({ undoWindowSeconds: 2 }) as never })
    await queueResponse(page, 'nextPatient', { value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', readFailed, { value: { entry: NEXT_IN_ROOM } })
    await cp(page).getByRole('button', { name: 'Next patient' }).click()
    await expect(cp(page)).toContainText('Undo window has closed', { timeout: 6000 })
    await expect(cp(page).getByText('Current patient', { exact: true })).toBeVisible({ timeout: 6000 })
    await expect(cp(page)).toContainText('Current consultation not confirmed.')
    await expect(cp(page)).not.toContainText('No patient in consultation.')
    await expect(nextBtn(page)).toBeDisabled()
    expect(await calls(page, 'undoAction')).toHaveLength(0)
    await cp(page).getByRole('button', { name: 'Check again' }).click()
    await expect(cp(page)).toContainText('GC-107')
    await expect(cp(page).getByRole('button', { name: 'Next patient' })).toBeEnabled()
    expect(await calls(page, 'nextPatient')).toHaveLength(1)
  })

  test('Undo succeeded but its follow-up read failed: paused with a warning, not "no patient"; retry reconciles', async ({ page }) => {
    await open(page)
    await queueResponse(page, 'nextPatient', { value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } }, readFailed, { value: { entry: CURRENT } })
    await queueResponse(page, 'undoAction', { value: { data: { status: 'undone', restored_token: 'GC-101' } } })
    await cp(page).getByRole('button', { name: 'Next patient' }).click()
    await cp(page).locator('button[aria-label^="Undo call"]').click()
    await expect(cp(page).getByRole('alert')).toContainText(UNKNOWN)
    await expect(cp(page)).toContainText('Current consultation not confirmed.')
    await expect(nextBtn(page)).toBeDisabled()
    await cp(page).getByRole('button', { name: 'Check again' }).click()
    await expect(cp(page)).toContainText('GC-101')
    await expect(cp(page).getByRole('button', { name: 'Next patient' })).toBeEnabled()
    expect(await calls(page, 'nextPatient')).toHaveLength(1)
  })

  test('off duty with a failed read: the warning and read-only retry are still offered', async ({ page }) => {
    const off = queueProps({ nurse: { ...queueProps().nurse, isOnDuty: false, serviceId: null, serviceName: null }, initialSnapshot: snapshot({ queue: [] }), initialEntry: null, currentError: 'boom' })
    await open(page, { props: off as never, defaults: { ...readDefaults(snapshot({ queue: [] }), null) } })
    await expect(page.getByRole('alert').filter({ hasText: UNKNOWN })).toBeVisible()
    await page.getByRole('button', { name: 'Check again' }).click()
    await expect(page.getByRole('alert').filter({ hasText: UNKNOWN })).toHaveCount(0)
  })
})

test.describe('harness: unknown consultation state fails closed (classic CurrentPatientPanel)', () => {
  test.afterEach(() => expect(escapes, 'a request escaped the harness').toEqual([]))
  const UNKNOWN = 'We couldn’t confirm your current consultation'
  const classic = (over: Record<string, unknown> = {}): Partial<HarnessConfig> => ({
    mode: 'classic',
    props: { initialEntry: CURRENT, serviceId: SERVICE_ID, undoWindowSeconds: 60, serviceAverageMinutes: 11, initialNextToken: 'GC-107', ...over },
  })

  test('initial read failed: Next disabled with a warning; a successful read-only retry enables it', async ({ page }) => {
    await open(page, { ...classic({ initialStateError: 'boom' }), defaults: { getNurseCurrentState: { value: { entry: null } } } })
    await expect(page.getByRole('alert')).toContainText(UNKNOWN)
    await expect(page.getByText('Current consultation not confirmed.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Call next patient' })).toBeDisabled()
    await page.getByRole('button', { name: 'Check again' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Call next patient' })).toBeEnabled()
    expect(await calls(page, 'nextPatient')).toHaveLength(0)
  })

  test('call succeeded, follow-up read failed: Undo kept with the original id, Next blocked, no second call; retry reconciles', async ({ page }) => {
    await open(page, classic())
    await queueResponse(page, 'nextPatient', { value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', { value: { entry: null, error: 'network' } }, { value: { entry: NEXT_IN_ROOM } })
    await page.getByRole('button', { name: 'Next patient' }).click()
    await expect(page.getByText('Harness Emergency')).toBeVisible()
    await expect(page.getByRole('alert')).toContainText(UNKNOWN)
    await expect(page.getByRole('button', { name: /^Undo \(\d+s\)$/ })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Next patient' })).toBeDisabled()
    // The ended patient's check-in time must not be shown under the new patient's name.
    await expect(page.getByText('Checked in')).toHaveCount(0)
    await page.getByRole('button', { name: 'Check again' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Next patient' })).toBeEnabled()
    expect(await calls(page, 'nextPatient')).toHaveLength(1)
  })

  test('undo succeeded, follow-up read failed: paused, not "no patient"; retry reconciles', async ({ page }) => {
    await open(page, classic())
    await queueResponse(page, 'nextPatient', { value: { data: CALLED } })
    await queueResponse(page, 'getNurseCurrentState', { value: { entry: NEXT_IN_ROOM } }, { value: { entry: null, error: 'network' } }, { value: { entry: CURRENT } })
    await queueResponse(page, 'undoAction', { value: { data: { status: 'undone', restored_token: 'GC-101' } } })
    await page.getByRole('button', { name: 'Next patient' }).click()
    await page.getByRole('button', { name: /^Undo/ }).click()
    await expect(page.getByRole('alert')).toContainText(UNKNOWN)
    await expect(page.getByText('No patient in consultation.')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^(Next patient|Call next patient)$/ })).toBeDisabled()
    await page.getByRole('button', { name: 'Check again' }).click()
    await expect(page.getByText('Harness Current')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Next patient' })).toBeEnabled()
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
        const skip = panel(page).getByRole('button', { name: 'Skip GC-102, Harness First' })
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
