import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database.types'
import { todayInClinicTimezone } from '@/lib/clinicTime'
import { toConfidenceLevel, type ConfidenceLevel } from '@/lib/confidence'

/**
 * A figure typed `number | null` here is null when the read behind it FAILED (or, for avgWaitTodayMinutes, when
 * nobody has been called yet). The UI shows "—" and says it could not be loaded; it never shows a failed read as a
 * healthy zero. A genuinely empty successful read is a real 0.
 */
export interface ClinicStateStats {
  /** null: today's queue could not be read. */
  waitingNow: number | null
  /** null: the nurse profiles could not be read. */
  nursesOnDuty: number | null
  nursesTotal: number | null
  /** null: the services or the live coverage could not be read. */
  servicesCovered: number | null
  /** null: the services could not be read. */
  servicesTotal: number | null
  avgWaitTodayMinutes: number | null
}

export interface AttentionAlert {
  serviceId: string
  serviceName: string
  waitingCount: number
}

export interface ServicePerformanceRow {
  serviceId: string
  serviceName: string
  /** null: live coverage could not be read. */
  waitingCount: number | null
  /** Patients in consultation for this service today (queue_entries.status = 'in_progress'). null: the queue could not be read. */
  servingCount: number | null
  /** null: available_nurses() failed for this service. */
  nursesOnDuty: number | null
  /** null: live coverage could not be read, so whether the service is being served is unknown. */
  isBeingServed: boolean | null
  estimatedWaitMinutes: number | null
  /** null: service_consultation_stats() failed for this service. */
  sampleCount: number | null
  confidence: ConfidenceLevel
}

export interface ExclusionBreakdown {
  staffBreak: number
  tooShort: number
  tooLong: number
}

export interface PredictionQualityStats {
  recordedCount: number
  excludedCount: number
  avgMinutes: number | null
  stddevMinutes: number | null
  exclusionBreakdown: ExclusionBreakdown
  minPlausibleMinutes: number
  maxPlausibleMinutes: number
}

/** Counts for today (clinic timezone). Every figure comes from one read of today's queue_entries (and appointments). null = that read failed. */
export interface TodayStats {
  /** Queue entries created today: every patient who checked in, appointment or walk-in. */
  checkIns: number | null
  walkIns: number | null
  fromAppointments: number | null
  inConsultation: number | null
  /** Appointments dated today that are not cancelled; null when that read failed. */
  scheduled: number | null
}

export type AdminActivityKind = 'checked_in' | 'called' | 'completed' | 'skipped' | 'no_show'

/** One real event derived from a timestamp on a queue entry. Tokens, not patient names: the admin view needs no identities. */
export interface AdminActivityEvent {
  id: string
  kind: AdminActivityKind
  token: string
  serviceName: string
  at: string
}

/** Which reads failed. A failed read shows "—" and says so; it is never rendered as a zero. Sections that did load are kept. */
export interface AdminDashboardErrors {
  /** today's queue_entries */
  queue: boolean
  /** today's appointment count */
  appointments: boolean
  /** get_public_queue_display() */
  coverage: boolean
  /** active services */
  services: boolean
  /** nurse profiles */
  nurses: boolean
  /** completed consultations (prediction quality) */
  consultations: boolean
  /** clinic_settings (plausibility thresholds, prediction quality) */
  settings: boolean
  /** at least one per-service available_nurses() / service_consultation_stats() call failed */
  perService: boolean
}

export const NO_ADMIN_ERRORS: AdminDashboardErrors = {
  queue: false,
  appointments: false,
  coverage: false,
  services: false,
  nurses: false,
  consultations: false,
  settings: false,
  perService: false,
}

export interface AdminDashboardData {
  clinicState: ClinicStateStats
  attentionAlerts: AttentionAlert[]
  services: ServicePerformanceRow[]
  /** null: consultations or settings could not be read, so the exclusion figures would be wrong. */
  predictionQuality: PredictionQualityStats | null
  today: TodayStats
  activity: AdminActivityEvent[]
  errors: AdminDashboardErrors
}

export interface TodayEntry {
  id: string
  token: string
  service_id: string
  status: string
  checked_in_at: string
  called_at: string | null
  completed_at: string | null
  appointment_id: string | null
}

export const ADMIN_ACTIVITY_LIMIT = 8

/** Today's counts from today's queue entries (pure). `null` entries = the read failed: every count is then null, not 0. */
export function summariseToday(entries: TodayEntry[] | null, scheduled: number | null): TodayStats {
  if (entries === null) return { checkIns: null, walkIns: null, fromAppointments: null, inConsultation: null, scheduled }
  const walkIns = entries.filter((e) => e.appointment_id === null).length
  return {
    checkIns: entries.length,
    walkIns,
    fromAppointments: entries.length - walkIns,
    inConsultation: entries.filter((e) => e.status === 'in_progress').length,
    scheduled,
  }
}

/**
 * Recent activity, newest first, built only from timestamps that exist on today's queue entries: checked in,
 * called into consultation, and the closing event for done / skipped / no-show entries. Nothing is inferred,
 * smoothed or invented, and a patient's name never leaves the database.
 */
export function buildAdminActivity(
  entries: TodayEntry[],
  serviceNames: Record<string, string>,
  limit = ADMIN_ACTIVITY_LIMIT
): AdminActivityEvent[] {
  const events: AdminActivityEvent[] = []
  for (const e of entries) {
    const serviceName = serviceNames[e.service_id] ?? 'Service'
    const base = { token: e.token, serviceName }
    events.push({ ...base, id: `${e.id}:in`, kind: 'checked_in', at: e.checked_in_at })
    if (e.called_at) events.push({ ...base, id: `${e.id}:called`, kind: 'called', at: e.called_at })
    if (e.completed_at) {
      const kind: AdminActivityKind | null =
        e.status === 'done' ? 'completed' : e.status === 'skipped' ? 'skipped' : e.status === 'no_show' ? 'no_show' : null
      if (kind) events.push({ ...base, id: `${e.id}:end`, kind, at: e.completed_at })
    }
  }
  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, limit)
}

function sampleStddev(values: number[], mean: number): number {
  if (values.length < 2) return 0
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

// ------------------------------------------------------------------------------------------ assembly (pure)

type CoverageRow = Database['public']['Functions']['get_public_queue_display']['Returns'][number]

/** What one Supabase read returned. `error` set (or `data` null on a list read) = the read failed. */
export interface Read<T> {
  data: T | null
  error: unknown | null
}

export interface RawAdminReads {
  services: Read<{ id: string; name: string }[]>
  nurses: Read<{ is_on_duty: boolean | null }[]>
  entries: Read<TodayEntry[]>
  coverage: Read<CoverageRow[]>
  consultations: Read<{ started_at: string; ended_at: string | null; exclude_from_prediction: boolean | null; exclusion_reason: string | null }[]>
  /** maybeSingle(): data null with no error means "no settings row" (defaults apply), which is not a failure. */
  settings: Read<{ min_plausible_consultation_minutes: number | null; max_plausible_consultation_minutes: number | null }>
  appointmentsCount: { count: number | null; error: unknown | null }
  /** Per active service: available_nurses() and service_consultation_stats().maybeSingle(). */
  perService: Record<string, { nurses: Read<number>; stats: Read<{ sample_count: number | null }> }>
}

const failedList = <T>(r: Read<T[]>) => !!r.error || r.data === null

/**
 * Turns the raw reads into the dashboard. Every read is judged on its own: a failure nulls only the figures that
 * depend on it, and sets its flag so the UI can say so — it never turns into a 0, an empty list, "no nurse on
 * duty" or "no estimate" that a healthy read could also have produced. The arithmetic is unchanged from the V2
 * dashboard (ADR-009: no queue logic is re-derived here).
 */
export function assembleAdminDashboard(raw: RawAdminReads): AdminDashboardData {
  const servicesFailed = failedList(raw.services)
  const nursesFailed = failedList(raw.nurses)
  const queueFailed = failedList(raw.entries)
  const coverageFailed = failedList(raw.coverage)
  const consultationsFailed = failedList(raw.consultations)
  const settingsFailed = !!raw.settings.error
  const appointmentsFailed = !!raw.appointmentsCount.error || raw.appointmentsCount.count === null

  const activeServices = servicesFailed ? [] : raw.services.data!
  const nurseRows = nursesFailed ? [] : raw.nurses.data!
  const entries = queueFailed ? [] : raw.entries.data!
  const coverageByService = new Map((coverageFailed ? [] : raw.coverage.data!).map((r) => [r.service_id, r]))

  // --- Clinic state ---
  const calledToday = entries.filter((e) => e.called_at)
  const avgWaitTodayMinutes =
    !queueFailed && calledToday.length > 0
      ? Math.round(
          calledToday.reduce(
            (sum, e) => sum + (new Date(e.called_at as string).getTime() - new Date(e.checked_in_at).getTime()) / 60000,
            0
          ) / calledToday.length
        )
      : null

  // --- Per-service performance ---
  let perServiceFailed = false
  const servicePerformance: ServicePerformanceRow[] = activeServices.map((svc) => {
    const row = coverageByService.get(svc.id)
    const extra = raw.perService[svc.id]
    const nursesOk = !!extra && !extra.nurses.error && extra.nurses.data !== null
    const statsOk = !!extra && !extra.stats.error
    if (!nursesOk || !statsOk) perServiceFailed = true
    const isBeingServed = coverageFailed ? null : (row?.is_being_served ?? false)
    return {
      serviceId: svc.id,
      serviceName: svc.name,
      waitingCount: coverageFailed ? null : (row?.waiting_count ?? 0),
      servingCount: queueFailed ? null : entries.filter((e) => e.service_id === svc.id && e.status === 'in_progress').length,
      nursesOnDuty: nursesOk ? extra!.nurses.data : null,
      isBeingServed,
      estimatedWaitMinutes: isBeingServed ? (row?.estimated_wait_minutes ?? null) : null,
      sampleCount: statsOk ? (extra!.stats.data?.sample_count ?? 0) : null,
      confidence: toConfidenceLevel(isBeingServed ? (row?.confidence ?? null) : null),
    }
  })

  const coverageKnown = !servicesFailed && !coverageFailed
  const servicesCovered = coverageKnown ? servicePerformance.filter((s) => s.isBeingServed === true).length : null

  // Needs attention: the urgent subset — uncovered *with people actually waiting*. Unknown coverage is not "fine":
  // with either read failed there are no alerts to compute, and the UI says the check is unavailable.
  const attentionAlerts: AttentionAlert[] = coverageKnown
    ? servicePerformance
        .filter((s) => s.isBeingServed === false && (s.waitingCount ?? 0) > 0)
        .map((s) => ({ serviceId: s.serviceId, serviceName: s.serviceName, waitingCount: s.waitingCount as number }))
    : []

  // --- Prediction quality ---
  let predictionQuality: PredictionQualityStats | null = null
  if (!consultationsFailed && !settingsFailed) {
    const minPlausible = raw.settings.data?.min_plausible_consultation_minutes ?? 1
    const maxPlausible = raw.settings.data?.max_plausible_consultation_minutes ?? 90
    const breakdown: ExclusionBreakdown = { staffBreak: 0, tooShort: 0, tooLong: 0 }
    const includedMinutes: number[] = []
    const consultations = raw.consultations.data!.filter((c) => c.ended_at !== null)
    for (const c of consultations) {
      const minutes = (new Date(c.ended_at as string).getTime() - new Date(c.started_at).getTime()) / 60000
      if (c.exclude_from_prediction) breakdown.staffBreak += 1
      else if (minutes < minPlausible) breakdown.tooShort += 1
      else if (minutes > maxPlausible) breakdown.tooLong += 1
      else includedMinutes.push(minutes)
    }
    const avgMinutes = includedMinutes.length > 0 ? includedMinutes.reduce((a, b) => a + b, 0) / includedMinutes.length : null
    predictionQuality = {
      recordedCount: consultations.length,
      excludedCount: breakdown.staffBreak + breakdown.tooShort + breakdown.tooLong,
      avgMinutes: avgMinutes !== null ? Math.round(avgMinutes) : null,
      stddevMinutes: avgMinutes !== null ? Math.round(sampleStddev(includedMinutes, avgMinutes)) : null,
      exclusionBreakdown: breakdown,
      minPlausibleMinutes: minPlausible,
      maxPlausibleMinutes: maxPlausible,
    }
  }

  return {
    clinicState: {
      waitingNow: queueFailed ? null : entries.filter((e) => e.status === 'waiting').length,
      nursesOnDuty: nursesFailed ? null : nurseRows.filter((n) => n.is_on_duty).length,
      nursesTotal: nursesFailed ? null : nurseRows.length,
      servicesCovered,
      servicesTotal: servicesFailed ? null : activeServices.length,
      avgWaitTodayMinutes,
    },
    attentionAlerts,
    services: servicePerformance,
    predictionQuality,
    today: summariseToday(queueFailed ? null : entries, appointmentsFailed ? null : raw.appointmentsCount.count),
    activity: queueFailed ? [] : buildAdminActivity(entries, Object.fromEntries(activeServices.map((s) => [s.id, s.name]))),
    errors: {
      queue: queueFailed,
      appointments: appointmentsFailed,
      coverage: coverageFailed,
      services: servicesFailed,
      nurses: nursesFailed,
      consultations: consultationsFailed,
      settings: settingsFailed,
      perService: perServiceFailed,
    },
  }
}

// ------------------------------------------------------------------------------------------------ loader

/**
 * Everything the admin dashboard needs. Per-service figures (nurses on duty, sample count) have no bulk RPC, so
 * this fans out available_nurses/service_consultation_stats per active service in parallel — cheap at clinic
 * scale, and each is the same function the prediction engine and the patient/reception screens call, never a
 * re-derivation of queue logic (ADR-009). Read-only.
 *
 * Unfiltered by clinic_id throughout, matching every other admin page already in this codebase — this system has
 * exactly one clinic, and introducing a filter only here would be a different, unrequested change.
 *
 * Every read's error is kept and handed to assembleAdminDashboard(), which keeps the sections that loaded.
 */
export async function getAdminDashboardData(supabase: SupabaseClient<Database>): Promise<AdminDashboardData> {
  const today = todayInClinicTimezone()

  const [services, nurses, entries, coverage, consultations, settings, appointments] = await Promise.all([
    supabase.from('services').select('id, name').eq('is_active', true).order('name'),
    supabase.from('profiles').select('is_on_duty').eq('role', 'nurse').eq('is_active', true),
    supabase
      .from('queue_entries')
      .select('id, token, service_id, status, checked_in_at, called_at, completed_at, appointment_id')
      .eq('queue_date', today),
    supabase.rpc('get_public_queue_display'),
    supabase
      .from('consultations')
      .select('started_at, ended_at, exclude_from_prediction, exclusion_reason')
      .not('ended_at', 'is', null),
    supabase.from('clinic_settings').select('min_plausible_consultation_minutes, max_plausible_consultation_minutes').maybeSingle(),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('scheduled_date', today)
      .neq('status', 'cancelled'),
  ])

  const perService: RawAdminReads['perService'] = {}
  await Promise.all(
    (services.data ?? []).map(async (svc) => {
      const [nurseCount, stats] = await Promise.all([
        supabase.rpc('available_nurses', { p_service_id: svc.id }),
        supabase.rpc('service_consultation_stats', { p_service_id: svc.id }).maybeSingle(),
      ])
      perService[svc.id] = {
        nurses: { data: nurseCount.data, error: nurseCount.error },
        stats: { data: stats.data, error: stats.error },
      }
    })
  )

  return assembleAdminDashboard({
    services,
    nurses,
    entries,
    coverage,
    consultations,
    settings,
    appointmentsCount: { count: appointments.count, error: appointments.error },
    perService,
  })
}
