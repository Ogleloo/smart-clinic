/**
 * Browser entry for the harness. Reads window.__harnessConfig (set by the test before load) and renders one of:
 *  - 'queue':   the Nurse V3 My Queue screen inside the real V3 shell
 *  - 'classic': the working screen's CurrentPatientPanel
 *  - 'header':  the working screen's NurseHeader + EndSessionControl, wired exactly as app/nurse/page.tsx does
 * window.__harnessSetProps(next) re-renders the same tree with new props — what a server re-render after
 * router.refresh() does to an already-mounted page.
 */
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MyQueueView, type MyQueueViewProps } from '../../../components/nurse/v3/MyQueueView'
import { NurseSidebar } from '../../../components/nurse/v3/NurseSidebar'
import { NurseMobileNav } from '../../../components/nurse/v3/NurseMobileNav'
import { CurrentPatientPanel } from '../../../components/nurse/CurrentPatientPanel'
import { NurseHeader } from '../../../components/nurse/NurseHeader'
import { EndSessionControl } from '../../../components/nurse/EndSessionControl'
import { createHarness } from './mocks/state'
import { createClient } from './mocks/supabase'

const cfg = window.__harnessConfig
window.__harness = createHarness(cfg.defaults ?? {}, cfg.online ?? true)
// Exposed so a test can prove the mocked client refuses writes.
;(window as unknown as { __harnessSupabase: unknown }).__harnessSupabase = createClient()

type HeaderProps = { services: { id: string; name: string }[]; isOnDuty: boolean; currentServiceId: string | null; currentServiceName: string | null }

function App() {
  const [props, setProps] = useState(cfg.props)
  useEffect(() => {
    ;(window as unknown as { __harnessSetProps: (p: Record<string, unknown>) => void }).__harnessSetProps = setProps
  }, [])

  if (cfg.mode === 'classic') {
    return (
      <main className="mx-auto max-w-[1000px] p-6">
        <CurrentPatientPanel {...(props as unknown as Parameters<typeof CurrentPatientPanel>[0])} />
      </main>
    )
  }
  if (cfg.mode === 'header') {
    const p = props as unknown as HeaderProps
    return (
      <main className="mx-auto max-w-[1000px] p-6">
        <NurseHeader
          services={p.services}
          isOnDuty={p.isOnDuty}
          currentServiceId={p.currentServiceId}
          currentServiceName={p.currentServiceName}
          endSession={<EndSessionControl isOnDuty={p.isOnDuty} currentServiceId={p.currentServiceId} />}
        />
      </main>
    )
  }
  return (
    <div className="theme-nurse min-h-dvh md:flex">
      <NurseSidebar clinicName="Test Clinic" clinicPhone="035 000 0000" />
      <div className="min-w-0 flex-1">
        <NurseMobileNav />
        <MyQueueView {...(props as unknown as MyQueueViewProps)} />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
