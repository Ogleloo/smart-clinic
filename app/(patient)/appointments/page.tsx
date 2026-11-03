import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PAGE_CLASS } from '@/components/patient/PageHeader'
import { AppointmentsListView, type Tab } from '@/components/patient/AppointmentsListView'
import { todayInClinicTimezone } from '@/lib/clinicTime'
import type { AppointmentStatus } from '@/lib/types/database.types'

type Row = {
  id: string
  scheduled_time: string
  scheduled_date: string
  status: AppointmentStatus
  reference: string | null
  service: {
    name: string
    description: string | null
    clinic: { name: string; city: string | null } | null
  } | null
}

const SELECT =
  'id, scheduled_time, scheduled_date, status, reference, service:services(name, description, clinic:clinics(name, city))'

/**
 * My Appointments — V3 (Figma 71:85). Upcoming / Previous tabs.
 *
 * Upcoming: still-active bookings (booked or checked in) from today on.
 * Previous: everything else — any earlier date, or anything already
 * finished with (completed, cancelled, missed) — so a cancelled future
 * slot doesn't keep sitting among the visits the patient still has.
 *
 * "Today" is the clinic's date (ADR-020), compared against
 * scheduled_date, which the backend derives in the same timezone. A
 * booking from earlier today that hasn't been marked a no-show yet stays
 * under Upcoming until mark_overdue_no_shows says otherwise.
 *
 * The tab lives in the URL (?tab=previous) so it's server-rendered,
 * linkable, and survives a refresh.
 *
 * All presentation lives in AppointmentsListView, a pure component that
 * takes everything as props — this page's only job is to fetch and
 * hand it over, the same split used by the dashboard (PR #47) and the
 * booking screens (PR #48).
 */
export default async function AppointmentsListPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>
}) {
  const { tab: rawTab } = await searchParams
  const tab: Tab = rawTab === 'previous' ? 'previous' : 'upcoming'

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('auth_user_id', user.id)
    .single()

  if (profileError || !profile) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-base font-semibold text-ink">Couldn&rsquo;t load your account</p>
        <p className="text-base text-muted">Please refresh the page. If this keeps happening, contact the clinic.</p>
      </main>
    )
  }

  const today = todayInClinicTimezone()

  const [{ data: upcoming, error: upcomingError }, { data: previous, error: previousError }] = await Promise.all([
    supabase
      .from('appointments')
      .select(SELECT)
      .in('status', ['booked', 'checked_in'])
      .gte('scheduled_date', today)
      .order('scheduled_time', { ascending: true }),
    supabase
      .from('appointments')
      .select(SELECT)
      .or(`status.in.(cancelled,no_show,completed),scheduled_date.lt.${today}`)
      .order('scheduled_time', { ascending: false }),
  ])

  const error = !!(upcomingError || previousError)
  const todays = ((upcoming ?? []) as Row[]).filter((a) => a.scheduled_date === today)
  const checkedInToday = todays.find((a) => a.status === 'checked_in') ?? null
  const bookedToday = todays.find((a) => a.status === 'booked') ?? null
  const rows = ((tab === 'upcoming' ? upcoming : previous) ?? []) as Row[]

  return (
    <main className={PAGE_CLASS}>
      <AppointmentsListView
        fullName={profile.full_name}
        tab={tab}
        upcomingCount={upcoming?.length ?? 0}
        previousCount={previous?.length ?? 0}
        rows={rows}
        error={error}
        checkedInToday={checkedInToday}
        bookedToday={bookedToday}
      />
    </main>
  )
}
