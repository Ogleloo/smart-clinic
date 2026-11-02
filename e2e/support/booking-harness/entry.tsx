/**
 * Browser entry for the isolated Booking Wizard harness. Renders the real BookingWizard with
 * app/actions/appointments and lib/supabase/client swapped for in-page mocks (see build.mjs) — no Supabase, no
 * network, no Server Action ever reached. Reads window.__bookingHarnessConfig, set by the test before load.
 */
import { createRoot } from 'react-dom/client'
import { BookingWizard } from '../../../components/booking/BookingWizard'
import { createHarness } from './mocks/state'

const { props, defaults } = window.__bookingHarnessConfig
window.__bookingHarness = createHarness(defaults ?? {})

createRoot(document.getElementById('root')!).render(
  <div className="theme-patient min-h-dvh">
    <div className="mx-auto max-w-[1176px] p-6">
      <BookingWizard {...(props as unknown as Parameters<typeof BookingWizard>[0])} />
    </div>
  </div>
)
