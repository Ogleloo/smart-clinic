import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database.types'
import { todayInClinicTimezone } from '@/lib/clinicTime'
import { appointmentStatusToChip } from '@/components/ui/AppointmentCard'
import { queueEntryStatusToChip } from '@/lib/queueEntryStatus'
import type { StatusChipVariant } from '@/components/ui/StatusChip'

export type TodayBucket = 'in_queue' | 'booked' | 'completed'

export interface TodayRow {
  id: string
  bucket: TodayBucket
  token: string | null
  patientName: string
  serviceName: string
  /** Context-dependent: a scheduled time for a booked-not-arrived row, an elapsed wait for a queue row, "—" when neither applies. */
  timeLabel: string
  statusVariant: StatusChipVariant
  statusLabel?: string
  /** appointment id, only present (and only meaningful) for 'booked' rows — what CheckInAppointmentButton needs. */
  appointmentId?: string
}

export interface ActivityEvent {
  id: string
  token: string
  event: string
  at: string
}

export interface ReceptionSummary {
  waitingNow: number
  inConsultation: number
  completedToday: number
  walkInsToday: number
}

function minutesBetween(startIso: string, endIso: string): number {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000))
}

function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
}

interface QueueEntryRow {
  id: string
  token: string
  status: 'waiting' | 'in_progress' | 'done' | 'skipped' | 'no_show'
  checked_in_at: string
  called_at: string | null
  completed_at: string | null
  appointment_id: string | null
  service_id: string
  patient: { full_name: string } | null
  service: { name: string } | null
}

interface AppointmentRow {
  id: string
  scheduled_time: string
  status: 'booked' | 'checked_in' | 'cancelled' | 'no_show' | 'completed'
  patient: { full_name: string } | null
  service: { name: string } | null
}

function formatClinicTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Johannesburg',
  })
}

/**
 * Everything the V2 reception dashboard needs, fetched in as few round
 * trips as practical and derived from real timestamps only — no figure
 * here is a guess or a re-implementation of the prediction engine
 * (ADR-009 territory stays in get_public_queue_display/get_wait_estimate;
 * this only ever subtracts one real timestamp from another).
 *
 * queue_entries is the single source for the "in queue"/"completed"
 * buckets, the per-service serving/waiting counts (recomputed here
 * rather than trusted from two different snapshots — the coverage
 * strip and the activity tiles must never disagree with each other),
 * the walk-ins-today count (appointment_id is null — check_in_patient,
 * unlike check_in_appointment, never sets one), and recent activity
 * (each row can contribute up to three real events: checked in, called,
 * completed/no-show).
 */
export async function getReceptionDashboardData(supabase: SupabaseClient<Database>) {
  const today = todayInClinicTimezone()

  const [{ data: coverage }, { data: queueEntries }, { data: appointments }] = await Promise.all([
    supabase.rpc('get_public_queue_display'),
    supabase
      .from('queue_entries')
      .select(
        'id, token, status, checked_in_at, called_at, completed_at, appointment_id, service_id, patient:profiles!queue_entries_patient_id_fkey(full_name), service:services(name)'
      )
      .eq('queue_date', today)
      .order('checked_in_at', { ascending: true })
      .returns<QueueEntryRow[]>(),
    supabase
      .from('appointments')
      .select(
        'id, scheduled_time, status, patient:profiles!appointments_patient_id_fkey(full_name), service:services(name)'
      )
      .eq('scheduled_date', today)
      .in('status', ['booked', 'no_show'])
      .order('scheduled_time', { ascending: true })
      .returns<AppointmentRow[]>(),
  ])

  const entries = queueEntries ?? []
  const appts = appointments ?? []

  // Per-service serving/waiting counts, from this same snapshot.
  const servingCounts: Record<string, number> = {}
  const waitingCounts: Record<string, number> = {}
  for (const e of entries) {
    if (e.status === 'in_progress') servingCounts[e.service_id] = (servingCounts[e.service_id] ?? 0) + 1
    if (e.status === 'waiting') waitingCounts[e.service_id] = (waitingCounts[e.service_id] ?? 0) + 1
  }

  const summary: ReceptionSummary = {
    waitingNow: entries.filter((e) => e.status === 'waiting').length,
    inConsultation: entries.filter((e) => e.status === 'in_progress').length,
    completedToday: entries.filter((e) => e.status === 'done').length,
    walkInsToday: entries.filter((e) => e.appointment_id === null).length,
  }

  const todayRows: TodayRow[] = []

  for (const e of entries) {
    const chip = queueEntryStatusToChip(e.status)
    let timeLabel = '—'
    if (e.status === 'waiting') {
      timeLabel = `${minutesSince(e.checked_in_at)} min`
    } else if (e.called_at) {
      timeLabel = `${minutesBetween(e.checked_in_at, e.called_at)} min`
    }
    todayRows.push({
      id: e.id,
      bucket: e.status === 'done' || e.status === 'no_show' ? 'completed' : 'in_queue',
      token: e.token,
      patientName: e.patient?.full_name ?? 'Unknown patient',
      serviceName: e.service?.name ?? '—',
      timeLabel,
      statusVariant: chip.variant,
      statusLabel: chip.label,
    })
  }

  for (const a of appts) {
    const chip = appointmentStatusToChip(a.status)
    todayRows.push({
      id: a.id,
      bucket: 'booked',
      token: null,
      patientName: a.patient?.full_name ?? 'Unknown patient',
      serviceName: a.service?.name ?? '—',
      timeLabel: formatClinicTime(a.scheduled_time),
      statusVariant: chip.variant,
      statusLabel: chip.label,
      appointmentId: a.id,
    })
  }

  // Recent activity: each queue entry can contribute up to three real,
  // independently-timestamped events. Newest first, capped at 10 —
  // this is a glance-back list, not an audit trail.
  const recentActivity: ActivityEvent[] = []
  for (const e of entries) {
    recentActivity.push({ id: `${e.id}-checkin`, token: e.token, event: 'Checked in', at: e.checked_in_at })
    if (e.called_at) {
      recentActivity.push({ id: `${e.id}-called`, token: e.token, event: 'Called', at: e.called_at })
    }
    if (e.status === 'done' && e.completed_at) {
      recentActivity.push({ id: `${e.id}-done`, token: e.token, event: 'Completed', at: e.completed_at })
    }
    if (e.status === 'no_show') {
      recentActivity.push({ id: `${e.id}-noshow`, token: e.token, event: 'Marked no-show', at: e.completed_at ?? e.checked_in_at })
    }
  }
  recentActivity.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

  return {
    coverage: coverage ?? [],
    servingCounts,
    waitingCounts,
    summary,
    todayRows,
    recentActivity: recentActivity.slice(0, 10),
  }
}
