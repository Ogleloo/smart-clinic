import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { QueueStatus } from '@/components/queue/QueueStatus'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Notification, WaitEstimate } from '@/lib/types/database.types'

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
 * so this fetches every 'waiting'/'in_progress' row and calls
 * get_wait_estimate for each individually. Each queue has its own
 * position and estimate; they are never combined into one number, since
 * that figure doesn't come from the database and nothing here re-derives
 * queue logic (ADR-009 again).
 */
export default async function QueuePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: entries } = await supabase
    .from('queue_entries')
    .select('id, service_id')
    .in('status', ['waiting', 'in_progress'])
    .eq('queue_date', 'today')
    .order('checked_in_at', { ascending: true })

  const activeEntries = entries ?? []
  const entryIds = activeEntries.map((e) => e.id)

  let estimates: { entryId: string; serviceId: string; initialEstimate: WaitEstimate }[] = []
  let initialNotifications: Notification[] = []

  if (activeEntries.length > 0) {
    const [estimateResults, { data: notifications }] = await Promise.all([
      Promise.all(
        activeEntries.map((entry) =>
          supabase.rpc('get_wait_estimate', { p_queue_entry_id: entry.id }).single()
        )
      ),
      supabase
        .from('notifications')
        .select('*')
        .in('queue_entry_id', entryIds)
        .order('created_at', { ascending: false })
        .limit(3),
    ])

    estimates = activeEntries.flatMap((entry, i) => {
      const { data, error } = estimateResults[i]
      if (error || !data) {
        console.error('get_wait_estimate failed:', error?.message)
        return []
      }
      return [{ entryId: entry.id, serviceId: entry.service_id, initialEstimate: data }]
    })
    initialNotifications = notifications ?? []
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 py-6">
      <h1 className="font-display text-[22px] font-bold text-ink">Your queue status</h1>

      {estimates.length > 0 ? (
        <QueueStatus entries={estimates} entryIds={entryIds} initialNotifications={initialNotifications} />
      ) : (
        <EmptyState
          headline="No active queue entry"
          body="Check in at reception to join the queue."
          fullWidth
        />
      )}
    </main>
  )
}
