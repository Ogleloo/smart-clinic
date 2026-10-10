/**
 * Browser entry for the harness. Reads window.__harnessConfig (set by the test before load) and renders either
 * the Nurse V3 My Queue screen inside the real V3 shell, or the working screen's CurrentPatientPanel.
 */
import { createRoot } from 'react-dom/client'
import { MyQueueView, type MyQueueViewProps } from '../../../components/nurse/v3/MyQueueView'
import { NurseSidebar } from '../../../components/nurse/v3/NurseSidebar'
import { NurseMobileNav } from '../../../components/nurse/v3/NurseMobileNav'
import { CurrentPatientPanel } from '../../../components/nurse/CurrentPatientPanel'
import { createHarness } from './mocks/state'
import { createClient } from './mocks/supabase'

const cfg = window.__harnessConfig
window.__harness = createHarness(cfg.defaults ?? {}, cfg.online ?? true)
// Exposed so a test can prove the mocked client refuses writes.
;(window as unknown as { __harnessSupabase: unknown }).__harnessSupabase = createClient()

const root = createRoot(document.getElementById('root')!)
if (cfg.mode === 'classic') {
  root.render(
    <main className="mx-auto max-w-[1000px] p-6">
      <CurrentPatientPanel {...(cfg.props as unknown as Parameters<typeof CurrentPatientPanel>[0])} />
    </main>
  )
} else {
  root.render(
    <div className="theme-nurse min-h-dvh md:flex">
      <NurseSidebar clinicName="Test Clinic" clinicPhone="035 000 0000" />
      <div className="min-w-0 flex-1">
        <NurseMobileNav />
        <MyQueueView {...(cfg.props as unknown as MyQueueViewProps)} />
      </div>
    </div>
  )
}
