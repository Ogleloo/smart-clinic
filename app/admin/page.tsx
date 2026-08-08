import { createClient } from '@/lib/supabase/server'
import { todayInClinicTimezone } from '@/lib/clinicTime'

/**
 * Today's totals, computed here from a small, bounded, already-fetched
 * dataset (one clinic's entries for one day) rather than a stored
 * aggregate — this is an admin report, not a patient-facing estimate,
 * so simple arithmetic over fetched rows is fine (unlike ADR-009, which
 * is specifically about not recomputing queue *logic* client-side).
 */
export default async function AdminOverviewPage() {
  const supabase = await createClient()
  const today = todayInClinicTimezone()

  const [{ count: appointmentsCount }, { data: entries }] = await Promise.all([
    supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('scheduled_date', today),
    supabase
      .from('queue_entries')
      .select('status, checked_in_at, called_at, appointment_id')
      .eq('queue_date', today),
  ])

  const rows = entries ?? []
  const currentlyWaiting = rows.filter((r) => r.status === 'waiting').length
  const walkIns = rows.filter((r) => r.appointment_id === null).length
  const completedConsultations = rows.filter((r) => r.status === 'done').length

  const calledRows = rows.filter((r) => r.called_at)
  const avgWaitMinutes =
    calledRows.length > 0
      ? Math.round(
          calledRows.reduce(
            (sum, r) =>
              sum + (new Date(r.called_at as string).getTime() - new Date(r.checked_in_at).getTime()) / 60000,
            0
          ) / calledRows.length
        )
      : null

  return (
    <div className="grid grid-cols-5 gap-4">
      <StatTile label="Appointments today" value={appointmentsCount ?? 0} />
      <StatTile label="Walk-ins today" value={walkIns} />
      <StatTile label="Completed" value={completedConsultations} />
      <StatTile label="Avg wait" value={avgWaitMinutes === null ? '—' : `${avgWaitMinutes} min`} />
      <StatTile label="Waiting now" value={currentlyWaiting} />
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-semibold tracking-wide text-muted">{label.toUpperCase()}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  )
}
