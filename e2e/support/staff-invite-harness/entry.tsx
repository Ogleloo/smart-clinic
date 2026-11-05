/**
 * Browser entry for the isolated staff-invite harness. Renders the real StaffInviteForm or
 * PendingInvitations with app/actions/admin swapped for an in-page mock (see build.mjs) — no Supabase, no
 * network, no Server Action ever reached. Reads window.__staffHarnessConfig, set by the test before load.
 */
import { createRoot } from 'react-dom/client'
import { StaffInviteForm } from '../../../components/admin/v3/StaffInviteForm'
import { PendingInvitations, type InvitationRow } from '../../../components/admin/v3/PendingInvitations'
import { createHarness } from './mocks/state'

const { mode, props, defaults } = window.__staffHarnessConfig
window.__staffHarness = createHarness(defaults ?? {})

createRoot(document.getElementById('root')!).render(
  <div className="min-h-dvh">
    <div className="mx-auto flex max-w-[820px] flex-col gap-5 p-6">
      {mode === 'invitations' ? (
        <PendingInvitations invitations={(props.invitations ?? []) as InvitationRow[]} />
      ) : (
        <StaffInviteForm registrationUrl={String(props.registrationUrl ?? 'https://example.test/register')} />
      )}
    </div>
  </div>
)
