import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database.types'
import { getNurseCurrentState, type NurseCurrentEntry } from '@/app/actions/nurse'
import { summariseSeenToday, type SeenTodayStats } from '@/lib/nurseStats'
import { CLINIC_TIMEZONE, isoNDaysAgo, todayInClinicTimezone } from '@/lib/clinicTime'

type QueueRpcRow = Database['public']['Functions']['get_service_queue']['Returns'][number]

/** Rows shown in the dashboard's Today's Queue panel; the rest are one click away in the working screen. */
export const DASHBOARD_QUEUE_ROWS = 6
export const DASHBOARD_ACTIVITY_EVENTS = 5

export interface DashboardQueueRow {
  queueEntryId: string
  /** Rank among *waiting* patients, in the order get_service_queue returned them (it already sorts emergency priority first). null for a patient already being seen. */
  position: number | null
  token: string
  patientName: string
  isEmergency: boolean
  status: 'waiting' | 'in_progress'
  /** Minutes since check-in, as get_service_queue reports it. Only meaningful for a waiting patient. */
  elapsedMinutes: number | null
  /** The prediction engine's estimate (get_wait_estimate), or null when it declines to give one — e.g. nobody on duty. */
  estimatedMinutes: number | null
}

export type ActivityKind = 'completed' | 'in_consultation' | 'skipped' | 'no_show' | 'ended'

export interface DashboardActivityEvent {
  id: string
  kind: ActivityKind
  token: string
  /** "S. Ndlovu" — initial plus surname, as in the design; the full name stays on the working screen. */
  patientLabel: string
  at: string
}

export interface NurseDashboardData {
  nurse: { fullName: string; clinicName: string | null; isOnDuty: boolean; serviceId: string | null; serviceName: string | null }
  /** On duty with an assigned service: the only state in which a service queue is read. */
  queueScoped: boolean
  currentEntry: NurseCurrentEntry | null
  queue: DashboardQueueRow[]
  queueTotal: number
  waitingCount: number | null
  seenToday: SeenTodayStats | null
  serviceAverageMinutes: number | null
  activity: DashboardActivityEvent[] | null
  /** One message per section whose read failed — the section shows it instead of a made-up zero. */
  errors: { queue?: string; stats?: string; activity?: string; current?: string }
}

// ---------------------------------------------------------------- pure mapping

/** "Nomusa Dlamini" -> "N. Dlamini"; a single name is kept whole. */
export function abbreviatePatientName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'Unknown patient'
  if (parts.length === 1) return parts[0]!
  return `${parts[0]![0]!.toUpperCase()}. ${parts[parts.length - 1]}`
}

/**
 * get_service_queue returns today's waiting and in-progress rows already
 * ordered (emergency priority, then check-in time, then token). Order is
 * kept exactly as returned — this only labels the rows.
 */
export function buildQueueRows(
  rows: QueueRpcRow[],
  estimates: Record<string, number | null> = {},
  limit: number = DASHBOARD_QUEUE_ROWS
): { rows: DashboardQueueRow[]; total: number; waitingCount: number } {
  let rank = 0
  const all: DashboardQueueRow[] = rows.map((r) => {
    const waiting = r.status === 'waiting'
    if (waiting) rank += 1
    return {
      queueEntryId: r.queue_entry_id,
      position: waiting ? rank : null,
      token: r.token,
      patientName: r.patient_name,
      isEmergency: r.priority > 0,
      status: waiting ? 'waiting' : 'in_progress',
      elapsedMinutes: waiting ? r.waiting_minutes : null,
      estimatedMinutes: waiting ? (estimates[r.queue_entry_id] ?? null) : null,
    }
  })
  return { rows: all.slice(0, limit), total: all.length, waitingCount: rank }
}

export interface ActivityConsultationRow {
  id: string
  started_at: string
  ended_at: string | null
  exclude_from_prediction: boolean
  exclusion_reason: string | null
  queue_entry: { token: string; patient: { full_name: string } | null } | null
}

function clinicDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TIMEZONE }).format(new Date(iso))
}

/**
 * One event per consultation, from the nurse's own consultation rows only —
 * nothing is inferred and nothing is invented. An open consultation is
 * "in consultation" (at its start); a closed one is "completed", or "skipped" /
 * "no-show" when reception or the nurse closed it that way, or plain "ended" for
 * a break or other excluded close. Newest first.
 */
export function buildActivityEvents(
  rows: ActivityConsultationRow[],
  today: string = todayInClinicTimezone(),
  limit: number = DASHBOARD_ACTIVITY_EVENTS
): DashboardActivityEvent[] {
  return rows
    .filter((c) => clinicDate(c.started_at) === today && c.queue_entry)
    .map((c): DashboardActivityEvent => {
      let kind: ActivityKind
      if (!c.ended_at) kind = 'in_consultation'
      else if (c.exclusion_reason === 'patient_skipped') kind = 'skipped'
      else if (c.exclusion_reason === 'patient_no_show') kind = 'no_show'
      else if (c.exclude_from_prediction) kind = 'ended'
      else kind = 'completed'
      return {
        id: c.id,
        kind,
        token: c.queue_entry!.token,
        patientLabel: abbreviatePatientName(c.queue_entry!.patient?.full_name ?? ''),
        at: c.ended_at ?? c.started_at,
      }
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit)
}

// ---------------------------------------------------------------- loader

/**
 * Everything the Nurse V3 dashboard shows, read-only. No RPC here writes:
 * get_service_queue, get_wait_estimate and service_consultation_stats are
 * STABLE, and the rest are plain selects under the nurse's own RLS. Each
 * section fails on its own so one broken read never blanks the screen — and
 * never shows a zero it didn't measure.
 *
 * A failed profile read throws: without it nothing else can be scoped.
 */
export async function getNurseDashboardData(supabase: SupabaseClient<Database>, authUserId: string): Promise<NurseDashboardData> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, is_on_duty, current_service_id, clinic_id')
    .eq('auth_user_id', authUserId)
    .single()
  if (profileError || !profile) throw new Error('Could not load your profile.')

  const serviceId = profile.current_service_id
  const queueScoped = !!profile.is_on_duty && !!serviceId
  const errors: NurseDashboardData['errors'] = {}

  const [clinicRes, serviceRes, current, seen, activityRes, queueRes, statsRes] = await Promise.all([
    profile.clinic_id
      ? supabase.from('clinics').select('name').eq('id', profile.clinic_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    serviceId
      ? supabase.from('services').select('name').eq('id', serviceId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    getNurseCurrentState(),
    getSeenTodayStatsChecked(supabase, profile.id),
    supabase
      .from('consultations')
      .select(
        'id, started_at, ended_at, exclude_from_prediction, exclusion_reason, queue_entry:queue_entries!consultations_queue_entry_id_fkey(token, patient:profiles!queue_entries_patient_id_fkey(full_name))'
      )
      .eq('nurse_id', profile.id)
      .gte('started_at', isoNDaysAgo(1)),
    queueScoped ? supabase.rpc('get_service_queue', { p_service_id: serviceId! }) : Promise.resolve(null),
    queueScoped ? supabase.rpc('service_consultation_stats', { p_service_id: serviceId! }).maybeSingle() : Promise.resolve(null),
  ])

  if (current.error) errors.current = current.error
  if (seen.error) errors.stats = seen.error
  if (statsRes?.error) errors.stats = errors.stats ?? statsRes.error.message

  let activity: DashboardActivityEvent[] | null = null
  if (activityRes.error) errors.activity = activityRes.error.message
  else activity = buildActivityEvents((activityRes.data ?? []) as unknown as ActivityConsultationRow[])

  let queue: DashboardQueueRow[] = []
  let queueTotal = 0
  let waitingCount: number | null = null
  if (queueScoped) {
    if (!queueRes || queueRes.error) {
      errors.queue = queueRes?.error?.message ?? 'Could not load the queue.'
    } else {
      const raw = queueRes.data ?? []
      // Estimates only for the rows that will be shown, in parallel; a failed or declined estimate is simply "no estimate".
      const shown = buildQueueRows(raw).rows.filter((r) => r.status === 'waiting')
      const estimates: Record<string, number | null> = {}
      await Promise.all(
        shown.map(async (r) => {
          try {
            const { data } = await supabase.rpc('get_wait_estimate', { p_queue_entry_id: r.queueEntryId }).maybeSingle()
            estimates[r.queueEntryId] = data?.estimated_wait_minutes ?? null
          } catch {
            estimates[r.queueEntryId] = null
          }
        })
      )
      const built = buildQueueRows(raw, estimates)
      queue = built.rows
      queueTotal = built.total
      waitingCount = built.waitingCount
    }
  }

  return {
    nurse: {
      fullName: profile.full_name,
      clinicName: clinicRes.data?.name ?? null,
      isOnDuty: !!profile.is_on_duty,
      serviceId,
      serviceName: serviceRes.data?.name ?? null,
    },
    queueScoped,
    currentEntry: current.entry,
    queue,
    queueTotal,
    waitingCount,
    seenToday: seen.error ? null : seen.stats,
    serviceAverageMinutes: statsRes && !statsRes.error ? (statsRes.data?.avg_minutes ?? null) : null,
    activity,
    errors,
  }
}

/**
 * getSeenTodayStats swallows query errors and returns zeros; here a failure must
 * stay visible, so this runs the same query and the same shared rule
 * (summariseSeenToday) but reports an error instead of a false "0 seen".
 */
async function getSeenTodayStatsChecked(
  supabase: SupabaseClient<Database>,
  nurseProfileId: string
): Promise<{ stats: SeenTodayStats; error?: string }> {
  const { data, error } = await supabase
    .from('consultations')
    .select('started_at, ended_at, exclude_from_prediction')
    .eq('nurse_id', nurseProfileId)
    .not('ended_at', 'is', null)
    .gte('started_at', isoNDaysAgo(1))
  if (error) return { stats: { count: 0, avgMinutes: null }, error: error.message }
  return { stats: summariseSeenToday(data ?? []) }
}
