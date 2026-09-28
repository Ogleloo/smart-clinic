import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database.types'
import { CLINIC_TIMEZONE, isoNDaysAgo, todayInClinicTimezone } from '@/lib/clinicTime'

export interface SeenTodayStats {
  count: number
  avgMinutes: number | null
}

function localDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TIMEZONE }).format(new Date(iso))
}

/**
 * This nurse's own pace today — distinct from service_average (the
 * service-wide figure every nurse and the patient screen share).
 * exclude_from_prediction rows (a marked staff break) don't count as a
 * patient seen; the plausibility band that service_consultation_stats
 * applies at read time is that function's own prediction-engine
 * concern, not re-implemented here.
 *
 * A shift never spans 24h, so a coarse `started_at >= 24h ago` filter
 * safely bounds the query; the exact clinic-calendar-day boundary is
 * then applied per row with the same Intl comparison todayInClinicTimezone()
 * itself uses, rather than computing a timezone-aware day boundary as a
 * timestamp (a second, easy-to-get-wrong way to answer the same question).
 */
export async function getSeenTodayStats(
  supabase: SupabaseClient<Database>,
  nurseProfileId: string
): Promise<SeenTodayStats> {
  const { data } = await supabase
    .from('consultations')
    .select('started_at, ended_at, exclude_from_prediction')
    .eq('nurse_id', nurseProfileId)
    .not('ended_at', 'is', null)
    .gte('started_at', isoNDaysAgo(1))

  const today = todayInClinicTimezone()
  const rows = (data ?? []).filter((c) => !c.exclude_from_prediction && localDate(c.started_at) === today)

  if (rows.length === 0) return { count: 0, avgMinutes: null }

  const totalMinutes = rows.reduce(
    (sum, c) => sum + (new Date(c.ended_at!).getTime() - new Date(c.started_at).getTime()) / 60000,
    0
  )
  return { count: rows.length, avgMinutes: Math.round(totalMinutes / rows.length) }
}
