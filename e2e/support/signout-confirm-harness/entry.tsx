/**
 * Browser entry for the isolated sign-out-confirmation harness. Renders the real SignOutConfirm with
 * app/actions/auth swapped for an in-page mock (see build.mjs) — no Supabase, no network, no Server Action ever
 * reached. Reads window.__signOutHarnessConfig, set by the test before load.
 *
 * `instances` renders more than one copy on the same page on purpose: the sidebar and the mobile nav are both
 * mounted on every real screen (one hidden by a media query), so a dialog whose ARIA ids were module-level
 * constants would produce duplicate ids and point the wrong label at the wrong dialog. Two instances here is the
 * configuration that would catch it.
 */
import { createRoot } from 'react-dom/client'
import { LogOut } from 'lucide-react'
import { SignOutConfirm } from '../../../components/ui/SignOutConfirm'
import { createSignOutHarness } from './mocks/state'

const { instances, defaults } = window.__signOutHarnessConfig
window.__signOutHarness = createSignOutHarness(defaults ?? {})

createRoot(document.getElementById('root')!).render(
  <div className="min-h-dvh">
    <div className="mx-auto flex max-w-[820px] flex-col gap-5 p-6">
      {/* A focusable element before the trigger, so "focus returned to the trigger" is distinguishable from
          "focus fell back to the body". */}
      <a href="#elsewhere">A link before the trigger</a>
      {Array.from({ length: Math.max(1, instances) }, (_, i) => (
        <SignOutConfirm
          key={i}
          formClassName="w-full"
          buttonClassName="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-base text-muted"
        >
          <LogOut size={20} aria-hidden />
          Sign Out
        </SignOutConfirm>
      ))}
    </div>
  </div>
)
