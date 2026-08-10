import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, WaitEstimate } from '@/lib/types/database.types'

export type ActiveQueueEntry = {
  entryId: string
  serviceId: string
  estimate: WaitEstimate
}

/**
 * The one place that turns "this patient's active queue_entries" into
 * "position/estimate/confidence per entry". /queue and the dashboard's
 * QueueSummaryCard both call this — previously the dashboard fetched
 * queue_entries directly without ever calling get_wait_estimate, which
 * is how it regressed to showing only a bare token. Sharing this
 * function is what keeps that from happening again: there is no second
 * copy of "which entries count as active" or "how to turn one into an
 * estimate" left to drift out of sync (ADR-009 — get_wait_estimate is
 * the single source of truth for queue logic, never re-derived here).
 *
 * A patient can legitimately hold more than one active entry at once
 * (consultation, then pharmacy) — this returns one estimate per entry,
 * ordered by check-in time, and never combines them into one figure.
 */
export async function getActiveQueueEntries(
  supabase: SupabaseClient<Database>
): Promise<ActiveQueueEntry[]> {
  const { data: entries } = await supabase
    .from('queue_entries')
    .select('id, service_id')
    .in('status', ['waiting', 'in_progress'])
    .eq('queue_date', 'today')
    .order('checked_in_at', { ascending: true })

  const activeEntries = entries ?? []
  if (activeEntries.length === 0) return []

  const estimateResults = await Promise.all(
    activeEntries.map((entry) =>
      supabase.rpc('get_wait_estimate', { p_queue_entry_id: entry.id }).single()
    )
  )

  return activeEntries.flatMap((entry, i) => {
    const { data, error } = estimateResults[i]
    if (error || !data) {
      console.error('get_wait_estimate failed:', error?.message)
      return []
    }
    return [{ entryId: entry.id, serviceId: entry.service_id, estimate: data }]
  })
}
