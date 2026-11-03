/**
 * Browser entry for the isolated CancelAppointmentButton harness. Renders the real component with
 * app/actions/appointments swapped for an in-page mock (see build.mjs) — no Supabase, no network, no Server
 * Action ever reached. Reads window.__cancelHarnessConfig, set by the test before load.
 */
import { createRoot } from 'react-dom/client'
import { CancelAppointmentButton } from '../../../components/booking/CancelAppointmentButton'
import { createHarness } from './mocks/state'

const { props, defaults } = window.__cancelHarnessConfig
window.__cancelHarness = createHarness(defaults ?? {})

createRoot(document.getElementById('root')!).render(
  <div className="theme-patient min-h-dvh">
    <div className="mx-auto max-w-[680px] p-6">
      <CancelAppointmentButton {...(props as unknown as Parameters<typeof CancelAppointmentButton>[0])} />
    </div>
  </div>
)
