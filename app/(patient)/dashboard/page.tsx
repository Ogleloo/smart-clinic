import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveQueueEntries } from '@/lib/patientQueue'
import { getPatientClinic } from '@/lib/patientClinic'
import { PAGE_CLASS } from '@/components/patient/PageHeader'
import { DashboardView } from '@/components/patient/DashboardView'
import { todayInClinicTimezone } from '@/lib/clinicTime'

/**
 * Patient dashboard — V3 (Figma 40:58).
 *
 * Server Component: profile, next appointment and active queue entry are
 * all fetched server-side under the caller's session. The appointments/
 * queue_entries queries below don't filter by patient_id — RLS alone
 * scopes those to exactly this patient's own rows (ADR-010).
 *
 * profiles is different: staff can read patient profiles relationally
 * (ADR-021), so RLS returns many rows for a staff caller, not one. The
 * .eq('auth_user_id', ...) filter below isn't redundant with RLS — it's
 * what makes "exactly one row" this query's own invariant regardless of
 * caller role, so .single() fails loudly instead of throwing PGRST116
 * for a staff account that reaches this page. (This was the exact bug:
 * a staff account landing here — see the role-guard fix in this area's
 * layout — hit an unfiltered .single() against 25 visible rows.)
 *
 * All presentation lives in DashboardView, a pure component that takes
 * everything below as props — this page's only job is to fetch and
 * hand it over, which is what lets DashboardView be rendered with
 * isolated fixtures for visual testing (e2e/support/render-dashboard.tsx)
 * without a session or a database.
 */
export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name, id_number')
    .eq('auth_user_id', user.id)
    .single()

  if (profileError || !profile) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-base font-semibold text-ink">Couldn&rsquo;t load your account</p>
        <p className="text-base text-muted">
          Please refresh the page. If this keeps happening, contact the clinic.
        </p>
      </main>
    )
  }

  const [{ data: nextAppointment, error: appointmentError }, activeEntries, clinic, { count: unreadCount }] =
    await Promise.all([
      supabase
        .from('appointments')
        .select('id, scheduled_time, status, reference, service:services(name)')
        .eq('status', 'booked')
        .gte('scheduled_time', 'now')
        .order('scheduled_time', { ascending: true })
        .limit(1)
        .maybeSingle(),
      getActiveQueueEntries(supabase),
      getPatientClinic(),
      supabase.from('notifications').select('*', { count: 'exact', head: true }).is('read_at', null),
    ])

  return (
    <main className={PAGE_CLASS}>
      <DashboardView
        fullName={profile.full_name}
        idNumber={profile.id_number}
        nextAppointment={nextAppointment}
        appointmentError={!!appointmentError}
        activeEntries={activeEntries}
        clinic={clinic}
        unreadCount={unreadCount ?? 0}
        today={todayInClinicTimezone()}
      />
    </main>
  )
}
