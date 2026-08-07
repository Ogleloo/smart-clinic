import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { QueueStatus } from '@/components/queue/QueueStatus'
import { EmptyState } from '@/components/ui/EmptyState'

/**
 * Patient Queue Status screen (Slice 2).
 *
 * RLS on queue_entries scopes rows to the caller (queue_select_own), so
 * this query needs no patient_id filter — the database already refuses
 * to return anyone else's entry. get_wait_estimate() is the single
 * source of truth for position/wait/confidence; nothing here computes
 * queue logic itself (see ADR-009).
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
    .order('checked_in_at', { ascending: false })
    .limit(1)

  const entry = entries?.[0] ?? null

  let initialEstimate = null
  if (entry) {
    const { data, error } = await supabase
      .rpc('get_wait_estimate', { p_queue_entry_id: entry.id })
      .single()
    if (error) console.error('get_wait_estimate failed:', error.message)
    initialEstimate = data
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 py-6">
      <h1 className="font-display text-[22px] font-bold text-ink">Your queue status</h1>

      {entry && initialEstimate ? (
        <QueueStatus
          entryId={entry.id}
          serviceId={entry.service_id}
          initialEstimate={initialEstimate}
        />
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
