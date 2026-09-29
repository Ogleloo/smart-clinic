import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database.types'
import { todayInClinicTimezone } from '@/lib/clinicTime'
import { toConfidenceLevel, type ConfidenceLevel } from '@/lib/confidence'

export interface ClinicStateStats {
  waitingNow: number
  nursesOnDuty: number
  nursesTotal: number
  servicesCovered: number
  servicesTotal: number
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
  waitingCount: number
  nursesOnDuty: number
  isBeingServed: boolean
  estimatedWaitMinutes: number | null
  sampleCount: number
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

export interface AdminDashboardData {
  clinicState: ClinicStateStats
  attentionAlerts: AttentionAlert[]
  services: ServicePerformanceRow[]
  predictionQuality: PredictionQualityStats
}

function sampleStddev(values: number[], mean: number): number {
  if (values.length < 2) return 0
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

/**
 * Everything the V2 admin dashboard needs. Per-service figures
 * (nurses on duty, sample count) have no bulk RPC, so this fans out
 * available_nurses/service_consultation_stats per active service in
 * parallel — cheap at clinic scale, and each is already the same
 * function the prediction engine and the patient/reception screens
 * call, never a re-derivation of queue logic (ADR-009).
 *
 * Unfiltered by clinic_id throughout, matching every other admin page
 * already in this codebase (app/admin/page.tsx's own V1 queries,
 * services/staff/reports) — this system has exactly one clinic, and
 * introducing a filter only here, for a restyle task, would be a
 * different, unrequested change.
 */
export async function getAdminDashboardData(supabase: SupabaseClient<Database>): Promise<AdminDashboardData> {
  const today = todayInClinicTimezone()

  const [
    { data: services },
    { data: nurses },
    { data: todayEntries },
    { data: coverage },
    { data: consultations },
    { data: settings },
  ] = await Promise.all([
    supabase.from('services').select('id, name').eq('is_active', true).order('name'),
    supabase.from('profiles').select('is_on_duty').eq('role', 'nurse').eq('is_active', true),
    supabase.from('queue_entries').select('status, checked_in_at, called_at').eq('queue_date', today),
    supabase.rpc('get_public_queue_display'),
    supabase
      .from('consultations')
      .select('started_at, ended_at, exclude_from_prediction, exclusion_reason')
      .not('ended_at', 'is', null),
    supabase.from('clinic_settings').select('min_plausible_consultation_minutes, max_plausible_consultation_minutes').maybeSingle(),
  ])

  const activeServices = services ?? []
  const nurseRows = nurses ?? []
  const entries = todayEntries ?? []
  const coverageRows = coverage ?? []

  // --- Clinic state strip ---
  const waitingNow = entries.filter((e) => e.status === 'waiting').length
  const calledToday = entries.filter((e) => e.called_at)
  const avgWaitTodayMinutes =
    calledToday.length > 0
      ? Math.round(
          calledToday.reduce(
            (sum, e) => sum + (new Date(e.called_at as string).getTime() - new Date(e.checked_in_at).getTime()) / 60000,
            0
          ) / calledToday.length
        )
      : null

  const coverageByService = new Map(coverageRows.map((r) => [r.service_id, r]))

  // --- Per-service performance (nurses on duty + sample count have no
  // bulk RPC — fan out in parallel, one pair of calls per active
  // service). ---
  const perServiceExtras = await Promise.all(
    activeServices.map(async (svc) => {
      const [{ data: nurseCount }, { data: stats }] = await Promise.all([
        supabase.rpc('available_nurses', { p_service_id: svc.id }),
        supabase.rpc('service_consultation_stats', { p_service_id: svc.id }).maybeSingle(),
      ])
      return { serviceId: svc.id, nurseCount: nurseCount ?? 0, stats }
    })
  )
  const extrasByService = new Map(perServiceExtras.map((e) => [e.serviceId, e]))

  const servicePerformance: ServicePerformanceRow[] = activeServices.map((svc) => {
    const row = coverageByService.get(svc.id)
    const extra = extrasByService.get(svc.id)
    return {
      serviceId: svc.id,
      serviceName: svc.name,
      waitingCount: row?.waiting_count ?? 0,
      nursesOnDuty: extra?.nurseCount ?? 0,
      isBeingServed: row?.is_being_served ?? false,
      estimatedWaitMinutes: row?.is_being_served ? (row.estimated_wait_minutes ?? null) : null,
      sampleCount: extra?.stats?.sample_count ?? 0,
      confidence: toConfidenceLevel(row?.is_being_served ? row.confidence : null),
    }
  })

  const servicesCovered = servicePerformance.filter((s) => s.isBeingServed).length

  // Needs attention: the urgent subset — not merely uncovered, but
  // uncovered *with people actually waiting* (same distinction
  // lib/queueCoverage.ts's coverageVariant already draws for the
  // patient-facing warning state, applied here for the same reason).
  const attentionAlerts: AttentionAlert[] = servicePerformance
    .filter((s) => !s.isBeingServed && s.waitingCount > 0)
    .map((s) => ({ serviceId: s.serviceId, serviceName: s.serviceName, waitingCount: s.waitingCount }))

  // --- Prediction quality ---
  const minPlausible = settings?.min_plausible_consultation_minutes ?? 1
  const maxPlausible = settings?.max_plausible_consultation_minutes ?? 90

  const breakdown: ExclusionBreakdown = { staffBreak: 0, tooShort: 0, tooLong: 0 }
  const includedMinutes: number[] = []

  for (const c of consultations ?? []) {
    const minutes = (new Date(c.ended_at as string).getTime() - new Date(c.started_at).getTime()) / 60000
    if (c.exclude_from_prediction) {
      breakdown.staffBreak += 1
    } else if (minutes < minPlausible) {
      breakdown.tooShort += 1
    } else if (minutes > maxPlausible) {
      breakdown.tooLong += 1
    } else {
      includedMinutes.push(minutes)
    }
  }

  const avgMinutes =
    includedMinutes.length > 0 ? includedMinutes.reduce((a, b) => a + b, 0) / includedMinutes.length : null

  return {
    clinicState: {
      waitingNow,
      nursesOnDuty: nurseRows.filter((n) => n.is_on_duty).length,
      nursesTotal: nurseRows.length,
      servicesCovered,
      servicesTotal: activeServices.length,
      avgWaitTodayMinutes,
    },
    attentionAlerts,
    services: servicePerformance,
    predictionQuality: {
      recordedCount: consultations?.length ?? 0,
      excludedCount: breakdown.staffBreak + breakdown.tooShort + breakdown.tooLong,
      avgMinutes: avgMinutes !== null ? Math.round(avgMinutes) : null,
      stddevMinutes: avgMinutes !== null ? Math.round(sampleStddev(includedMinutes, avgMinutes)) : null,
      exclusionBreakdown: breakdown,
      minPlausibleMinutes: minPlausible,
      maxPlausibleMinutes: maxPlausible,
    },
  }
}
