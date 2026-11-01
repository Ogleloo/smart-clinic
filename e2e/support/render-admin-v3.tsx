/**
 * Renders the real Admin V3 shell and dashboard components to static HTML for a set of synthetic states, and
 * compiles the app's real Tailwind CSS, then prints JSON. Run by e2e/admin-v3-dashboard.spec.ts through `tsx`.
 * No network, no database, no Supabase client is created. All names, tokens and numbers below are made up.
 *
 * Every dashboard state is produced by the REAL assembleAdminDashboard() from synthetic raw reads, so a failed read
 * goes through exactly the code path a failed Supabase call would.
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
import { assembleAdminDashboard, type RawAdminReads, type TodayEntry } from '../../lib/adminDashboard'
import { baseReads, failed } from './admin-fixtures'

const identity = { fullName: 'Test Administrator', clinicName: 'Test Clinic' }
const view = (raw: RawAdminReads, id = identity) => renderToStaticMarkup(createElement(AdminDashboardView, { data: assembleAdminDashboard(raw), identity: id }))
const h = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

async function main() {
  const p = 'app/globals.css'
  const css = (await postcss([tailwind()]).process(readFileSync(p, 'utf8'), { from: p })).css
  const b = baseReads()
  const emptyEntries: TodayEntry[] = []
  const states = {
    populated: view(b),
    attention: view(baseReads({ attention: true })),
    empty: view({
      ...b,
      services: { data: [], error: null },
      nurses: { data: [], error: null },
      entries: { data: emptyEntries, error: null },
      coverage: { data: [], error: null },
      consultations: { data: [], error: null },
      appointmentsCount: { count: 0, error: null },
      perService: {},
    }),
    queueError: view({ ...b, entries: failed() }),
    coverageError: view({ ...b, coverage: failed() }),
    appointmentsError: view({ ...b, appointmentsCount: { count: null, error: { message: 'boom' } } }),
    servicesError: view({ ...b, services: failed(), perService: {} }),
    nursesError: view({ ...b, nurses: failed() }),
    consultationsError: view({ ...b, consultations: failed() }),
    settingsError: view({ ...b, settings: { data: null, error: { message: 'boom' } } }),
    perServiceError: view({
      ...b,
      perService: { ...b.perService, s1: { nurses: failed(), stats: failed() } },
    }),
    allFailed: view({
      services: failed(), nurses: failed(), entries: failed(), coverage: failed(), consultations: failed(),
      settings: { data: null, error: { message: 'boom' } }, appointmentsCount: { count: null, error: { message: 'boom' } }, perService: {},
    }),
    longName: view(b, { fullName: 'Dr. Nomvula Thandiwe Mkhwanazi-Van Der Merwe', clinicName: 'Riverside Community Clinic and Wellness Centre' }),
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
