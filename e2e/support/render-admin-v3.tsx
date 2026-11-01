/**
 * Renders the real Admin V3 shell and dashboard components to static HTML for a set of synthetic states, and
 * compiles the app's real Tailwind CSS, then prints JSON. Run by e2e/admin-v3-dashboard.spec.ts through `tsx`.
 * No network, no database, no Supabase client is created. All names, tokens and numbers below are made up.
 */
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { AdminSidebar } from '../../components/admin/v3/AdminSidebar'
import { AdminMobileNav } from '../../components/admin/v3/AdminMobileNav'
import { AdminContentFrame } from '../../components/admin/v3/AdminContentFrame'
import { AdminDashboardView } from '../../components/admin/v3/AdminDashboardView'
import AdminLoading from '../../app/admin/loading'
import AdminError from '../../app/admin/error'
import { buildAdminActivity, summariseToday, type AdminDashboardData, type ServicePerformanceRow, type TodayEntry } from '../../lib/adminDashboard'

const svc = (id: string, name: string, over: Partial<ServicePerformanceRow> = {}): ServicePerformanceRow => ({
  serviceId: id, serviceName: name, waitingCount: 0, servingCount: 0, nursesOnDuty: 1, isBeingServed: true,
  estimatedWaitMinutes: 12, sampleCount: 14, confidence: 'high', ...over,
})

const entry = (id: string, token: string, service_id: string, status: string, at: string, over: Partial<TodayEntry> = {}): TodayEntry => ({
  id, token, service_id, status, checked_in_at: at, called_at: null, completed_at: null, appointment_id: null, ...over,
})
const T = (hhmm: string) => `2026-11-02T${hhmm}:00+02:00`
export const ENTRIES: TodayEntry[] = [
  entry('e1', 'GC-001', 's1', 'done', T('08:05'), { called_at: T('08:20'), completed_at: T('08:35'), appointment_id: 'a1' }),
  entry('e2', 'GC-002', 's1', 'in_progress', T('08:15'), { called_at: T('08:40') }),
  entry('e3', 'GC-003', 's1', 'waiting', T('08:30')),
  entry('e4', 'IM-001', 's2', 'waiting', T('08:45'), { appointment_id: 'a2' }),
  entry('e5', 'GC-004', 's1', 'skipped', T('08:10'), { completed_at: T('08:25') }),
  entry('e6', 'GC-005', 's1', 'no_show', T('08:12'), { completed_at: T('08:50') }),
]
const names = { s1: 'General Consultation', s2: 'Immunisation', s3: 'Pharmacy' }

const base = (over: Partial<AdminDashboardData> = {}): AdminDashboardData => ({
  clinicState: { waitingNow: 2, nursesOnDuty: 2, nursesTotal: 3, servicesCovered: 2, servicesTotal: 3, avgWaitTodayMinutes: 14 },
  attentionAlerts: [],
  services: [
    svc('s1', 'General Consultation', { waitingCount: 1, servingCount: 1, nursesOnDuty: 2, estimatedWaitMinutes: 8 }),
    svc('s2', 'Immunisation', { waitingCount: 1, estimatedWaitMinutes: null, confidence: 'low', sampleCount: 2 }),
    svc('s3', 'Pharmacy', { nursesOnDuty: 0, isBeingServed: false, estimatedWaitMinutes: null, sampleCount: 0, confidence: 'low' }),
  ],
  predictionQuality: {
    recordedCount: 40, excludedCount: 4, avgMinutes: 12, stddevMinutes: 4,
    exclusionBreakdown: { staffBreak: 2, tooShort: 1, tooLong: 1 }, minPlausibleMinutes: 1, maxPlausibleMinutes: 90,
  },
  today: summariseToday(ENTRIES, 9),
  activity: buildAdminActivity(ENTRIES, names),
  errors: { queue: false, appointments: false, coverage: false },
  ...over,
})

const identity = { fullName: 'Test Administrator', clinicName: 'Test Clinic' }
const view = (data: AdminDashboardData, id = identity) => renderToStaticMarkup(createElement(AdminDashboardView, { data, identity: id }))
const h = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

async function main() {
  const p = 'app/globals.css'
  const css = (await postcss([tailwind()]).process(readFileSync(p, 'utf8'), { from: p })).css
  const states = {
    populated: view(base()),
    attention: view(base({ attentionAlerts: [{ serviceId: 's3', serviceName: 'Pharmacy', waitingCount: 3 }] })),
    empty: view(
      base({
        clinicState: { waitingNow: 0, nursesOnDuty: 0, nursesTotal: 0, servicesCovered: 0, servicesTotal: 0, avgWaitTodayMinutes: null },
        services: [], today: summariseToday([], 0), activity: [],
      })
    ),
    queueError: view(base({ errors: { queue: true, appointments: false, coverage: false }, activity: [] })),
    coverageError: view(base({ errors: { queue: false, appointments: false, coverage: true } })),
    appointmentsError: view(base({ today: { ...summariseToday(ENTRIES, null) }, errors: { queue: false, appointments: true, coverage: false } })),
    longName: view(base(), { fullName: 'Dr. Nomvula Thandiwe Mkhwanazi-Van Der Merwe', clinicName: 'Riverside Community Clinic and Wellness Centre' }),
  }
  process.stdout.write(
    JSON.stringify({
      css,
      states,
      sidebar: h(createElement(AdminSidebar, { clinicName: 'Test Clinic', clinicPhone: '035 123 4567' })),
      mobileNav: h(createElement(AdminMobileNav)),
      loading: h(createElement(AdminLoading)),
      error: h(createElement(AdminError, { error: new Error('boom'), retry: () => {} })),
      subpageFrame: h(createElement(AdminContentFrame, null, createElement('h2', null, 'Staff'))),
    })
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
