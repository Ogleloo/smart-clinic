import { createClient } from '@/lib/supabase/server'
import { todayInClinicTimezone } from '@/lib/clinicTime'
import { LinkButton } from '@/components/ui/LinkButton'
import { ReceptionPatientSearch } from '@/components/reception/ReceptionPatientSearch'

/**
 * Reception dashboard. Three distinct counts, not one:
 *  - booked: appointments today that haven't arrived yet.
 *  - checked in: everyone who has arrived today (cumulative, walk-in or
 *    appointment) — a queue_entries row is created the moment someone
 *    checks in, so this is just "how many rows exist for today".
 *  - waiting: checked in today AND still status='waiting' right now —
 *    the live, current line length.
 */
export default async function ReceptionDashboardPage() {
  const supabase = await createClient()
  const today = todayInClinicTimezone()

  const [{ count: bookedCount }, { count: checkedInCount }, { count: waitingCount }] =
    await Promise.all([
      supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('scheduled_date', today)
        .eq('status', 'booked'),
      supabase
        .from('queue_entries')
        .select('*', { count: 'exact', head: true })
        .eq('queue_date', today),
      supabase
        .from('queue_entries')
        .select('*', { count: 'exact', head: true })
        .eq('queue_date', today)
        .eq('status', 'waiting'),
    ])

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <p className="text-xs font-semibold tracking-wide text-muted">FIND A PATIENT</p>
        <ReceptionPatientSearch />
      </section>

      <section className="grid grid-cols-3 gap-4">
        <StatTile label="Booked today" value={bookedCount ?? 0} />
        <StatTile label="Checked in today" value={checkedInCount ?? 0} />
        <StatTile label="Waiting now" value={waitingCount ?? 0} />
      </section>

      <section className="flex gap-3">
        <LinkButton href="/reception/walk-in" variant="primary">
          Register walk-in
        </LinkButton>
        <LinkButton href="/reception/appointments" variant="secondary">
          Today&rsquo;s appointments
        </LinkButton>
      </section>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <p className="text-xs font-semibold tracking-wide text-muted">{label.toUpperCase()}</p>
      <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  )
}
