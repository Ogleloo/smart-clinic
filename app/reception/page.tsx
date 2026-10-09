import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getReceptionDashboardData } from '@/lib/receptionDashboard'
import { DashboardHero } from '@/components/reception/DashboardHero'
import { StatTiles, type DashboardStats } from '@/components/reception/StatTiles'
import { QueueOverviewTable } from '@/components/reception/QueueOverviewTable'
import { RecentActivity } from '@/components/reception/RecentActivity'
import { PAGE_CLASS, TYPE } from '@/components/reception/PageHeader'

/**
 * Reception dashboard — V3 (Figma frame 111:2). An operational screen,
 * not an analytics one: who is here, who is waiting, what to do next.
 * No emergency-priority control here — only nurses and administrators may
 * set it (BR-10), and the database itself refuses it for a receptionist.
 *
 * Data layer is unchanged from V2 (getReceptionDashboardData) — this page
 * only derives the 4 stat-tile figures from rows it already returns.
 */
export default async function ReceptionDashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, clinic_id')
    .eq('auth_user_id', user.id)
    .single()

  const [{ coverage, servingCounts, waitingCounts, summary, todayRows, recentActivity }, clinic] = await Promise.all([
    getReceptionDashboardData(supabase),
    profile?.clinic_id
      ? supabase.from('clinics').select('name').eq('id', profile.clinic_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const stats: DashboardStats = {
    todaysCheckIns: todayRows.filter((r) => r.bucket === 'in_queue' || r.bucket === 'completed').length,
    currentlyWaiting: summary.waitingNow,
    inConsultation: summary.inConsultation,
    scheduledToday: todayRows.filter((r) => r.bucket === 'booked').length,
  }

  return (
    <main className={PAGE_CLASS}>
      <DashboardHero fullName={profile?.full_name ?? 'Receptionist'} clinicName={clinic?.data?.name ?? null} />

      <StatTiles stats={stats} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <QueueOverviewTable coverage={coverage} servingCounts={servingCounts} waitingCounts={waitingCounts} />

        <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
          <div>
            <h2 className={TYPE.section}>Today&rsquo;s Activity</h2>
            <p className="text-xs text-muted">Latest updates from your clinic.</p>
          </div>
          <RecentActivity events={recentActivity} />
        </section>
      </div>
    </main>
  )
}
