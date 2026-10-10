import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database.types'
import type { NurseCurrentEntry } from '@/app/actions/nurse'
import { CLINIC_TIMEZONE, isoNDaysAgo, todayInClinicTimezone } from '@/lib/clinicTime'

type QueueRpcRow = Database['public']['Functions']['get_service_queue']['Returns'][number]

export type MyQueueStatus = 'waiting' | 'in_consultation' | 'completed'
export type MyQueueTab = 'all' | MyQueueStatus

export const MY_QUEUE_TABS: { id: MyQueueTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'in_consultation', label: 'In Consultation' },
  { id: 'completed', label: 'Completed' },
]

export interface MyQueueRow {
  /** Unique per row: a queue entry can appear once as waiting and, after an undo/recall, once as completed. */
  key: string
  queueEntryId: string
  /** Rank among *waiting* patients, in the order get_service_queue returned them (emergency priority first). null otherwise. */
  position: number | null
  token: string
  patientName: string
  serviceName: string | null
  /** checked_in_at. */
  arrivedAt: string | null
  status: MyQueueStatus
  isEmergency: boolean
  /** Minutes since check-in as get_service_queue reports it; waiting rows only. null = unknown, never 0. */
  elapsedMinutes: number | null
  /** get_wait_estimate, or null when the engine declines (e.g. nobody on duty). Waiting rows only. */
  estimatedMinutes: number | null
  /** In consultation: consultation start. Completed: consultation end. */
  at: string | null
  /** A completed consultation the nurse marked as including a break: the patient was seen, but it is not counted in averages. */
  notCounted: boolean
}

/** The nurse's own ended consultations, as read from `consultations` (RLS: nurse_id = the caller). */
export interface CompletedConsultationRow {
  id: string
  started_at: string
  ended_at: string | null
  exclusion_reason: string | null
  service_id: string
  queue_entry: {
    id: string
    token: string
    checked_in_at: string
    patient: { full_name: string } | null
  } | null
}

export interface QueueSnapshot {
  /** get_service_queue for the nurse's current service, in database order; [] when not scoped. */
  queue: QueueRpcRow[]
  estimates: Record<string, number | null>
  completed: CompletedConsultationRow[]
  errors: { queue?: string; completed?: string }
}

function clinicDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TIMEZONE }).format(new Date(iso))
}

// ---------------------------------------------------------------- pure

/**
 * A consultation counts as "completed" for this list when it ended today (clinic calendar day) and was a real
 * consultation: skips, no-shows and administrative closes (demo reset, orphaned test data) are not completed
 * patients. A marked staff break *is* a patient seen, so it is listed — flagged as not counted in averages.
 */
export function isCompletedConsultation(c: CompletedConsultationRow, today: string = todayInClinicTimezone()): boolean {
  if (!c.ended_at || !c.queue_entry) return false
  if (clinicDate(c.started_at) !== today) return false
  return c.exclusion_reason === null || c.exclusion_reason === 'staff_break'
}

/**
 * Builds the rows My Queue shows. Order: the nurse's own current patient, then the waiting queue exactly as the
 * database ordered it, then today's completed consultations, most recent first.
 *
 * In-progress rows belonging to *other* nurses on the same service are not this nurse's queue; they are counted
 * (`othersInConsultation`) rather than shown as if they were the signed-in nurse's patients.
 */
export function buildMyQueueRows(input: {
  queue: QueueRpcRow[]
  estimates?: Record<string, number | null>
  currentEntry: NurseCurrentEntry | null
  completed: CompletedConsultationRow[]
  serviceNames: Record<string, string>
  currentServiceId: string | null
  today?: string
}): { rows: MyQueueRow[]; othersInConsultation: number; nextToken: string | null } {
  const { queue, estimates = {}, currentEntry, completed, serviceNames, currentServiceId } = input
  const today = input.today ?? todayInClinicTimezone()
  const currentServiceName = currentServiceId ? (serviceNames[currentServiceId] ?? null) : null
  const rows: MyQueueRow[] = []

  if (currentEntry) {
    rows.push({
      key: `current-${currentEntry.consultationId}`,
      queueEntryId: currentEntry.queueEntryId,
      position: null,
      token: currentEntry.token,
      patientName: currentEntry.patientName,
      serviceName: serviceNames[currentEntry.serviceId] ?? null,
      arrivedAt: currentEntry.checkedInAt,
      status: 'in_consultation',
      isEmergency: currentEntry.priority > 0,
      elapsedMinutes: null,
      estimatedMinutes: null,
      at: currentEntry.startedAt,
      notCounted: false,
    })
  }

  let rank = 0
  let othersInConsultation = 0
  let nextToken: string | null = null
  for (const r of queue) {
    // The nurse's own current patient is never also "waiting" — e.g. in the moment between next_patient()
    // returning and the next queue read landing, when the last read still lists them as waiting.
    if (r.queue_entry_id === currentEntry?.queueEntryId) continue
    if (r.status !== 'waiting') {
      othersInConsultation += 1
      continue
    }
    rank += 1
    if (rank === 1) nextToken = r.token
    rows.push({
      key: `waiting-${r.queue_entry_id}`,
      queueEntryId: r.queue_entry_id,
      position: rank,
      token: r.token,
      patientName: r.patient_name,
      serviceName: currentServiceName,
      arrivedAt: r.checked_in_at,
      status: 'waiting',
      isEmergency: r.priority > 0,
      // `?? null`: typed as a number, but an unknown wait is not zero.
      elapsedMinutes: r.waiting_minutes ?? null,
      estimatedMinutes: estimates[r.queue_entry_id] ?? null,
      at: null,
      notCounted: false,
    })
  }

  const done = completed
    .filter((c) => isCompletedConsultation(c, today))
    .sort((a, b) => new Date(b.ended_at!).getTime() - new Date(a.ended_at!).getTime())
  for (const c of done) {
    rows.push({
      key: `completed-${c.id}`,
      queueEntryId: c.queue_entry!.id,
      position: null,
      token: c.queue_entry!.token,
      patientName: c.queue_entry!.patient?.full_name ?? 'Unknown patient',
      serviceName: serviceNames[c.service_id] ?? null,
      arrivedAt: c.queue_entry!.checked_in_at,
      status: 'completed',
      isEmergency: false,
      elapsedMinutes: null,
      estimatedMinutes: null,
      at: c.ended_at,
      notCounted: c.exclusion_reason === 'staff_break',
    })
  }

  return { rows, othersInConsultation, nextToken }
}

/**
 * Why a waiting-row Skip must be refused, or null when it may proceed. A nurse's skip_patient() also accepts an
 * in_progress entry (and closes its consultation), so the waiting-row action checks the status first.
 * `status` null means the entry could not be found in the nurse's clinic.
 */
export function waitingSkipRefusal(status: string | null): string | null {
  if (status === null) return 'Queue entry not found'
  if (status === 'waiting') return null
  if (status === 'in_progress') return 'This patient is already in consultation, so they can’t be skipped from the waiting list.'
  return 'That patient is no longer waiting.'
}

/** Token search ignores case and punctuation, so "gc113" finds "GC-113". */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function filterMyQueueRows(
  rows: MyQueueRow[],
  { tab, search, emergencyOnly }: { tab: MyQueueTab; search: string; emergencyOnly: boolean }
): MyQueueRow[] {
  const q = search.trim().toLowerCase()
  const qNorm = normalise(search)
  return rows.filter((r) => {
    if (tab !== 'all' && r.status !== tab) return false
    if (emergencyOnly && !r.isEmergency) return false
    if (!q) return true
    return r.patientName.toLowerCase().includes(q) || (qNorm !== '' && normalise(r.token).includes(qNorm))
  })
}

/** Tab counts are totals per tab (search and filters narrow the table, not the tab labels). */
export function countMyQueueTabs(rows: MyQueueRow[]): Record<MyQueueTab, number> {
  const counts: Record<MyQueueTab, number> = { all: rows.length, waiting: 0, in_consultation: 0, completed: 0 }
  for (const r of rows) counts[r.status] += 1
  return counts
}

// ---------------------------------------------------------------- reads

/** At most this many estimates are requested per refresh (one RPC each); rows beyond it show elapsed time only. */
export const MAX_ESTIMATES = 30

/**
 * Everything on My Queue that changes as the queue moves, read-only, under the nurse's own session. Used both by
 * the server page (first paint) and by the client on every realtime ping, focus and completed action, so the two
 * cannot disagree. Every RPC here is STABLE; the consultations read is filtered explicitly by nurse_id even though
 * RLS would already restrict it.
 */
export async function loadQueueSnapshot(
  supabase: SupabaseClient<Database>,
  { nurseProfileId, serviceId }: { nurseProfileId: string; serviceId: string | null }
): Promise<QueueSnapshot> {
  const errors: QueueSnapshot['errors'] = {}

  const [queueRes, completedRes] = await Promise.all([
    serviceId ? supabase.rpc('get_service_queue', { p_service_id: serviceId }) : Promise.resolve(null),
    supabase
      .from('consultations')
      .select(
        'id, started_at, ended_at, exclusion_reason, service_id, queue_entry:queue_entries!consultations_queue_entry_id_fkey(id, token, checked_in_at, patient:profiles!queue_entries_patient_id_fkey(full_name))'
      )
      .eq('nurse_id', nurseProfileId)
      .not('ended_at', 'is', null)
      .gte('started_at', isoNDaysAgo(1)),
  ])

  let queue: QueueRpcRow[] = []
  if (queueRes) {
    if (queueRes.error) errors.queue = queueRes.error.message
    else queue = queueRes.data ?? []
  }

  let completed: CompletedConsultationRow[] = []
  if (completedRes.error) errors.completed = completedRes.error.message
  else completed = (completedRes.data ?? []) as unknown as CompletedConsultationRow[]

  const estimates: Record<string, number | null> = {}
  const waiting = queue.filter((r) => r.status === 'waiting').slice(0, MAX_ESTIMATES)
  await Promise.all(
    waiting.map(async (r) => {
      try {
        const { data } = await supabase.rpc('get_wait_estimate', { p_queue_entry_id: r.queue_entry_id }).maybeSingle()
        estimates[r.queue_entry_id] = data?.estimated_wait_minutes ?? null
      } catch {
        estimates[r.queue_entry_id] = null
      }
    })
  )

  return { queue, estimates, completed, errors }
}
