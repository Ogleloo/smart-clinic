/**
 * Renders the real Allocation Advisor page body inside the real Admin V3 shell parts, for a few synthetic live
 * snapshots, and compiles the app's real Tailwind CSS; prints JSON. Run by e2e/allocation-advisor-layout.spec.ts
 * through `tsx`. No network, no database, no Supabase client. Every name and number is made up.
 */
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { AdminSidebar } from '../../components/admin/v3/AdminSidebar'
import { AdminMobileNav } from '../../components/admin/v3/AdminMobileNav'
import { AllocationAdvisorView } from '../../components/admin/v3/AllocationAdvisorView'
import { NO_ADMIN_ERRORS } from '../../lib/adminDashboard'

const row = (serviceId: string, serviceName: string, over: Record<string, unknown> = {}) => ({
  serviceId, serviceName, waitingCount: 3, nursesOnDuty: 2, estimatedWaitMinutes: 12, isBeingServed: true, ...over,
})
const errors = (over: Partial<typeof NO_ADMIN_ERRORS> = {}) => ({
  services: NO_ADMIN_ERRORS.services, coverage: NO_ADMIN_ERRORS.coverage, perService: NO_ADMIN_ERRORS.perService, ...over,
})
const view = (liveServices: ReturnType<typeof row>[], e = errors()) =>
  renderToStaticMarkup(createElement(AllocationAdvisorView, { liveServices: liveServices as never, errors: e }))

async function main() {
  const p = 'app/globals.css'
  const css = (await postcss([tailwind()]).process(readFileSync(p, 'utf8'), { from: p })).css
  process.stdout.write(
    JSON.stringify({
      css,
      sidebar: renderToStaticMarkup(createElement(AdminSidebar, { clinicName: 'Test Clinic', clinicPhone: '035 123 4567' })),
      mobileNav: renderToStaticMarkup(createElement(AdminMobileNav)),
      states: {
        live: view([
          row('s1', 'General Consultation'),
          row('s2', 'A service with a very long name that must wrap rather than push the page sideways', { isBeingServed: false, estimatedWaitMinutes: null, nursesOnDuty: 0 }),
        ]),
        empty: view([]),
        servicesError: view([], errors({ services: true })),
        coverageError: view([row('s1', 'General Consultation', { waitingCount: null, isBeingServed: null, estimatedWaitMinutes: null })], errors({ coverage: true })),
      },
    })
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
