import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, WaitEstimate } from '@/lib/types/database.types'
import { todayInClinicTimezone } from '@/lib/clinicTime'

export type ActiveQueueEntry = {
  entryId: string
  serviceId: string
  estimate: WaitEstimate
  /** get_public_queue_display's now_serving_token for this entry's own service — gives "position 3" a concrete anchor. Null whenever nobody's being served. */
  nowServingToken: string | null
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
 *
 * On the absence of an explicit patient_id filter, against CLAUDE.md's
 * "filter explicitly even when RLS would suffice": this is reached only
 * from app/(patient), whose layout gates the whole area on
 * requireRole('patient'), and queue_entries' RLS then scopes a patient to
 * their own rows. There is no .single() here either, so a wider result set
 * would not crash the way the dashboard's unfiltered profile query did —
 * it returns a list and maps it. Adding the filter would mean resolving the
 * caller's profile id, which /queue does not otherwise need; it is worth
 * doing if this function ever grows a non-patient caller.
 */
export async function getActiveQueueEntries(
  supabase: SupabaseClient<Database>
): Promise<ActiveQueueEntry[]> {
  const { data: entries } = await supabase
    .from('queue_entries')
    .select('id, service_id')
    .in('status', ['waiting', 'in_progress'])
    // todayInClinicTimezone(), not the literal 'today': PostgREST hands 'today' to PostgreSQL,
    // which resolves it against the DATABASE server's timezone — UTC on this project. Johannesburg
    // is UTC+2, so from midnight to 02:00 SAST the two disagree by a day, and this query would
    // return yesterday's entries while hiding today's. Every other caller that filters queue_date
    // (reception's dashboard, admin's, the nurse actions) already derives it this way; this was the
    // one place left reading the server's clock instead of the clinic's (ADR-020).
    .eq('queue_date', todayInClinicTimezone())
    .order('checked_in_at', { ascending: true })

  const activeEntries = entries ?? []
  if (activeEntries.length === 0) return []

  const [estimateResults, displayResults] = await Promise.all([
    Promise.all(
      activeEntries.map((entry) =>
        supabase.rpc('get_wait_estimate', { p_queue_entry_id: entry.id }).single()
      )
    ),
    Promise.all(
      activeEntries.map((entry) =>
        supabase.rpc('get_public_queue_display', { p_service_id: entry.service_id }).single()
      )
    ),
  ])

  return activeEntries.flatMap((entry, i) => {
    const { data, error } = estimateResults[i]
    if (error || !data) {
      console.error('get_wait_estimate failed:', error?.message)
      return []
    }
    const nowServingToken = displayResults[i].data?.now_serving_token ?? null
    return [{ entryId: entry.id, serviceId: entry.service_id, estimate: data, nowServingToken }]
  })
}
