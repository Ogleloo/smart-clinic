import Link from 'next/link'
import { requireRole } from '@/lib/auth/requireRole'
import { getNurseDashboardData, type NurseDashboardData } from '@/lib/nurseDashboard'
import { NurseDashboardView } from '@/components/nurse/v3/NurseDashboardView'
import { NURSE_WORKSPACE_HREF } from '@/components/nurse/v3/navItems'

export const metadata = { title: 'Nurse Dashboard · Smart Clinic' }

/**
 * Nurse V3 dashboard (Figma frame 161:3), Phase 1 of the staged Nurse V3 rollout. Strictly read-only: it
 * never calls next_patient, undo, skip, set_duty, end_shift or anything else that changes a row. Acting on
 * the queue stays on the existing working screen at /nurse, which this page links to and does not replace.
 *
 * requireRole runs outside the try block on purpose: its redirect is thrown, and a catch would swallow it.
 */
export default async function NurseDashboardPage() {
  const { supabase, user } = await requireRole('nurse')

  let data: NurseDashboardData
  try {
    data = await getNurseDashboardData(supabase, user.id)
  } catch {
    return (
      <main className="mx-auto flex w-full max-w-[1176px] flex-col gap-4 px-4 py-6 sm:px-6">
        <h1 className="font-display text-[40px] font-bold leading-[44px] text-ink">Dashboard</h1>
        <p role="alert" className="rounded-md border border-border bg-danger-bg p-4 text-sm font-semibold text-[#B42318]">
          We couldn’t load your dashboard. Reload the page to try again.
        </p>
        <p className="text-sm text-muted">
          Your working screen is unaffected:{' '}
          <Link href={NURSE_WORKSPACE_HREF} className="font-semibold text-[#037F74] underline underline-offset-2">
            open My Queue
          </Link>
          .
        </p>
      </main>
    )
  }

  return <NurseDashboardView data={data} />
}
