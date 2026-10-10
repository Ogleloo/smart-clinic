/**
 * Renders the real Nurse V3 dashboard components to static HTML for a set of synthetic states and prints
 * { stateName: html } as JSON. Run by e2e/nurse-v3-dashboard.spec.ts through `tsx`, because Playwright's own
 * JSX transform can't render app components. No network, no database, no Supabase client is created.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { NurseDashboardView } from '../../components/nurse/v3/NurseDashboardView'
import { NurseSidebar } from '../../components/nurse/v3/NurseSidebar'
import { buildActivityEvents, buildQueueRows, type NurseDashboardData } from '../../lib/nurseDashboard'

const base = (over: Partial<NurseDashboardData> = {}): NurseDashboardData => ({
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
})

const row = (id: string, token: string, name: string, status: 'waiting' | 'in_progress', priority: number, mins: number) => ({
  queue_entry_id: id, queue_position: 0, token, patient_name: name, priority, status, checked_in_at: '2026-10-12T08:00:00Z', waiting_minutes: mins,
})

const built = buildQueueRows(
  [
    row('a', 'GC-101', 'In Room', 'in_progress', 0, 40),
    row('b', 'GC-107', 'Emergency Person', 'waiting', 1, 3),
    row('c', 'GC-102', 'First Waiting', 'waiting', 0, 25),
  ],
  { b: 7 }
)

// A waiting row whose elapsed time the database left empty (typed as a number, but not guaranteed).
const unknownWait = buildQueueRows([{ ...row('w', 'GC-150', 'Unknown Wait', 'waiting', 0, 0), waiting_minutes: null as unknown as number }], { w: 9 })

const off = { ...base().nurse, isOnDuty: false, serviceId: null, serviceName: null }

const states: Record<string, NurseDashboardData> = {
  emptyOnDuty: base(),
  offDuty: base({ nurse: off, queueScoped: false, waitingCount: null }),
  noService: base({ nurse: { ...base().nurse, serviceId: null, serviceName: null }, queueScoped: false, waitingCount: null }),
  queueError: base({ waitingCount: null, errors: { queue: 'boom' } }),
  activityError: base({ activity: null, errors: { activity: 'boom' } }),
  unknownWait: base({ queue: unknownWait.rows, queueTotal: 1, waitingCount: 1 }),
  noClinic: base({ nurse: { ...base().nurse, clinicName: null } }),
  serviceAverageFailed: base({ seenToday: { count: 4, avgMinutes: 11 }, errors: { serviceAverage: 'boom' } }),
  populated: base({
    queue: built.rows,
    queueTotal: built.total,
    waitingCount: built.waitingCount,
    currentEntry: { token: 'GC-101' } as NurseDashboardData['currentEntry'],
    seenToday: { count: 2, avgMinutes: 12 },
    serviceAverageMinutes: 11,
    activity: buildActivityEvents(
      [{ id: 'c1', started_at: new Date().toISOString(), ended_at: null, exclude_from_prediction: false, exclusion_reason: null, queue_entry: { token: 'GC-101', patient: { full_name: 'In Room' } } }]
    ),
  }),
}

const out: Record<string, string> = {}
for (const [name, data] of Object.entries(states)) out[name] = renderToStaticMarkup(createElement(NurseDashboardView, { data }))
out.sidebarNoClinic = renderToStaticMarkup(createElement(NurseSidebar, { clinicName: null, clinicPhone: null }))
out.sidebarWithClinic = renderToStaticMarkup(createElement(NurseSidebar, { clinicName: 'Test Clinic', clinicPhone: null }))
process.stdout.write(JSON.stringify(out))
