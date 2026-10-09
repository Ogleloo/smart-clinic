import { redirect } from 'next/navigation'
import { Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getReceptionDashboardData } from '@/lib/receptionDashboard'
import { DashboardHero } from '@/components/reception/DashboardHero'
import { StatTiles, type DashboardStats } from '@/components/reception/StatTiles'
import { QueueOverviewTable } from '@/components/reception/QueueOverviewTable'
import { RecentActivity } from '@/components/reception/RecentActivity'
import { TYPE } from '@/components/reception/PageHeader'

/**
 * Reception dashboard — V3 (Figma frame 111:2). An operational screen,
 * not an analytics one: who is here, who is waiting, what to do next.
 * No emergency-priority control here — only nurses and administrators may
 * set it (BR-10), and the database itself refuses it for a receptionist.
 *
 * Data layer is unchanged from V2 (getReceptionDashboardData) — this page
 * only derives the 4 stat-tile figures from rows it already returns.
 *
 * The bottom row is a flex split, not a 50/50 grid: Figma gives Queue
 * Overview the remaining width and pins Today's Activity to 420px. Forcing
 * an even grid-cols-2 split was what squeezed the queue table narrow enough
 * to need horizontal scrolling — this is the actual fix for that.
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
    <main className="mx-auto flex w-full max-w-[1176px] flex-col gap-5 px-4 py-6 md:px-8 md:py-8">
      <DashboardHero fullName={profile?.full_name ?? 'Receptionist'} clinicName={clinic?.data?.name ?? null} />

      <StatTiles stats={stats} />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch">
        <div className="min-w-0 lg:flex-1">
          <QueueOverviewTable coverage={coverage} servingCounts={servingCounts} waitingCounts={waitingCounts} />
        </div>

        <section className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-5 shadow-[0_8px_18px_rgba(0,31,33,0.05)] lg:w-[420px] lg:shrink-0">
          <div className="flex items-center gap-4 pb-2">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
              <Clock size={22} aria-hidden />
            </span>
            <div>
              <h2 className={TYPE.section}>Today&rsquo;s Activity</h2>
              <p className="text-base text-muted">Latest updates from your clinic.</p>
            </div>
          </div>
          <RecentActivity events={recentActivity} />
        </section>
      </div>
    </main>
  )
}
