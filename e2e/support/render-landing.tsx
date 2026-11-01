/**
 * Renders the real public landing page view to static HTML for several synthetic states and compiles the app's real
 * Tailwind CSS; prints JSON. Run by e2e/landing-page.spec.ts through `tsx`. No network, no database, no Supabase
 * client. Service names, counts and hours below are made up.
 */
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { LandingPageView } from '../../components/landing/LandingPageView'
import type { HoursState, ServicesState } from '../../components/landing/content'

const row = (service_id: string, service_name: string, over: Record<string, unknown> = {}) => ({
  service_id, service_name, waiting_count: 0, estimated_wait_minutes: 0, is_being_served: true, confidence: 'high',
  next_token: 'GC-099', now_serving_token: 'GC-098', updated_at: '2026-11-02T08:00:00+02:00', ...over,
})

const OK_SERVICES = {
  status: 'ok',
  rows: [
    row('11111111-aaaa-4aaa-8aaa-000000000001', 'General Consultation', { waiting_count: 3, estimated_wait_minutes: 12 }),
    row('11111111-aaaa-4aaa-8aaa-000000000002', 'Immunisation', { waiting_count: 0 }),
    row('11111111-aaaa-4aaa-8aaa-000000000003', 'Chronic Care', { waiting_count: 2, is_being_served: false }),
    row('11111111-aaaa-4aaa-8aaa-000000000004', 'Family Planning', { waiting_count: 0, is_being_served: false }),
  ],
} as unknown as ServicesState
const OK_HOURS: HoursState = { status: 'ok', lines: ['Mon–Fri 07:30–16:30', 'Sat 08:00–12:00', 'Closed Sunday'] }

const view = (services: ServicesState, hours: HoursState) => renderToStaticMarkup(createElement(LandingPageView, { services, hours }))

async function main() {
  const p = 'app/globals.css'
  const css = (await postcss([tailwind()]).process(readFileSync(p, 'utf8'), { from: p })).css
  process.stdout.write(
    JSON.stringify({
      css,
      states: {
        populated: view(OK_SERVICES, OK_HOURS),
        empty: view({ status: 'empty' }, { status: 'empty' }),
        unavailable: view({ status: 'unavailable' }, { status: 'unavailable' }),
        longName: view(
          { status: 'ok', rows: [row('11111111-aaaa-4aaa-8aaa-000000000009', 'An unusually long service name that has to wrap onto several lines without breaking the layout at 320px', { waiting_count: 1, estimated_wait_minutes: 7 })] } as unknown as ServicesState,
          OK_HOURS
        ),
      },
    })
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
