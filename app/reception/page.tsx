import { createClient } from '@/lib/supabase/server'
import { getReceptionDashboardData } from '@/lib/receptionDashboard'
import { ReceptionPatientSearch } from '@/components/reception/ReceptionPatientSearch'
import { CoverageStrip } from '@/components/reception/CoverageStrip'
import { ActivitySummary } from '@/components/reception/ActivitySummary'
import { TodayInClinicList } from '@/components/reception/TodayInClinicList'
import { RecentActivity } from '@/components/reception/RecentActivity'
import { LinkButton } from '@/components/ui/LinkButton'

/**
 * Reception dashboard V2 (Figma "04 · Screens V2" — "Dashboard —
 * Reception V2"). An operational screen, not an analytics one: who is
 * here, who is waiting, what to do next. No emergency-priority control
 * here — only nurses and administrators may set it (BR-10), and the
 * database itself refuses it for a receptionist; reception registers
 * and checks in, clinical urgency is a clinical judgement.
 */
export default async function ReceptionDashboardPage() {
  const supabase = await createClient()
  const { coverage, servingCounts, waitingCounts, summary, todayRows, recentActivity } =
    await getReceptionDashboardData(supabase)

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <p className="text-xs font-semibold tracking-wide text-muted">FIND A PATIENT</p>
        <ReceptionPatientSearch />
      </section>

      <section className="flex flex-col gap-3">
        <p className="text-xs font-semibold tracking-wide text-muted">SERVICE COVERAGE</p>
        <CoverageStrip coverage={coverage} servingCounts={servingCounts} waitingCounts={waitingCounts} />
      </section>

      <section className="flex flex-col gap-3">
        <p className="text-xs font-semibold tracking-wide text-muted">TODAY&rsquo;S ACTIVITY</p>
        <ActivitySummary summary={summary} />
      </section>

      <section className="flex flex-col gap-3">
        <p className="text-xs font-semibold tracking-wide text-muted">TODAY IN THE CLINIC</p>
        <TodayInClinicList rows={todayRows} />
      </section>

      <section className="flex flex-col gap-3">
        <p className="text-xs font-semibold tracking-wide text-muted">RECENT ACTIVITY</p>
        <RecentActivity events={recentActivity} />
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
