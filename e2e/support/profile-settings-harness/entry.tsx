/**
 * Browser entry for the isolated Profile Settings harness. Renders the real ProfileSettingsForm with
 * app/actions/profile and app/actions/auth swapped for in-page mocks (see build.mjs) — no Supabase, no
 * network, no Server Action ever reached. Reads window.__profileHarnessConfig, set by the test before load.
 */
import { createRoot } from 'react-dom/client'
import { ProfileSettingsForm } from '../../../components/profile/ProfileSettingsForm'
import './types'

window.__profileHarness = { calls: [] }

const { props } = window.__profileHarnessConfig

createRoot(document.getElementById('root')!).render(
  <div className="theme-patient min-h-dvh">
    <div className="mx-auto max-w-[680px] p-6">
      <ProfileSettingsForm {...props} />
    </div>
  </div>,
)
