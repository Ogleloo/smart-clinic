import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveQueueEntries } from '@/lib/patientQueue'
import { QueueStatus } from '@/components/queue/QueueStatus'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'
import { PAGE_CLASS, PageHeader } from '@/components/patient/PageHeader'
import type { Notification } from '@/lib/types/database.types'

/**
 * Patient Queue Status screen (Slice 2).
 *
 * RLS on queue_entries scopes rows to the caller (queue_select_own), so
 * this query needs no patient_id filter — the database already refuses
 * to return anyone else's entry. get_wait_estimate() is the single
 * source of truth for position/wait/confidence; nothing here computes
 * queue logic itself (see ADR-009).
 *
 * A patient can legitimately hold more than one active entry at once —
 * e.g. checked in for General Consultation, then referred to Pharmacy —
 * so getActiveQueueEntries fetches every 'waiting'/'in_progress' row
 * and calls get_wait_estimate for each individually. Each queue has its
 * own position and estimate; they are never combined into one number,
 * since that figure doesn't come from the database and nothing here
 * re-derives queue logic (ADR-009 again). The dashboard's
 * QueueSummaryCard shares this exact same fetch, so the two can't drift
 * apart on what counts as "active" or how an estimate is derived.
 */
export default async function QueuePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const activeEntries = await getActiveQueueEntries(supabase)
  const entryIds = activeEntries.map((e) => e.entryId)

  let initialNotifications: Notification[] = []
  if (activeEntries.length > 0) {
    const { data: notifications } = await supabase
      .from('notifications')
      .select('*')
      .in('queue_entry_id', entryIds)
      .order('created_at', { ascending: false })
      .limit(3)
    initialNotifications = notifications ?? []
  }

  const estimates = activeEntries.map((e) => ({
    entryId: e.entryId,
    serviceId: e.serviceId,
    initialEstimate: e.estimate,
    initialNowServingToken: e.nowServingToken,
  }))

  return (
    <main className={PAGE_CLASS}>
      <PageHeader title="Your queue status" subtitle="Updates live as the queue moves." />

      {/* The V2 queue cards and explainability panel, unchanged — capped
          to a readable width beside the V3 sidebar on desktop. */}
      <div className="w-full max-w-2xl">
        {estimates.length > 0 ? (
          <QueueStatus entries={estimates} entryIds={entryIds} initialNotifications={initialNotifications} />
        ) : (
          <EmptyState
            headline="No active queue entry"
            body="Check in at reception to join the queue."
            action={
              <LinkButton href="/appointments" variant="secondary">
                My appointments
              </LinkButton>
            }
            fullWidth
          />
        )}
      </div>
    </main>
  )
}
