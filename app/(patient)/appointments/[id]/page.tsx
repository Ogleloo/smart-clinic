import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PAGE_CLASS } from '@/components/patient/PageHeader'
import { AppointmentDetailsView, type TypicalTime } from '@/components/patient/AppointmentDetailsView'

/**
 * service_consultation_stats() is the same history the wait estimate is
 * built on — completed, plausible-length consultations for this service.
 * With no completed visits there is nothing to state, so nothing is
 * stated: no default, no fallback to services.default_consultation_minutes.
 * The confidence label also comes from the database (confidence_label),
 * so a thin sample is flagged the same way it is on the queue screen.
 */
async function getTypicalTime(
  supabase: Awaited<ReturnType<typeof createClient>>,
  serviceId: string
): Promise<TypicalTime> {
  const { data: stats, error } = await supabase
    .rpc('service_consultation_stats', { p_service_id: serviceId })
    .maybeSingle()
  if (error) return { kind: 'unavailable' }
  if (!stats || stats.sample_count === 0 || stats.avg_minutes === null) return { kind: 'no_data' }

  const { data: confidence } = await supabase.rpc('confidence_label', {
    p_service_id: serviceId,
    p_count: stats.sample_count,
    p_stddev: stats.stddev_minutes,
  })

  return {
    kind: 'known',
    minutes: Math.max(1, Math.round(stats.avg_minutes)),
    sampleCount: stats.sample_count,
    confidence: confidence ?? 'low',
  }
}

/**
 * Appointment details — V3 (Figma 88:470).
 *
 * RLS scopes appointments to the caller (ADR-010): if this id belongs to
 * someone else, the query returns 0 rows — not an authorization error —
 * so it's handled the same as "doesn't exist" via notFound().
 *
 * All presentation lives in AppointmentDetailsView, a pure component
 * that takes the appointment, the patient's name and the typical-time
 * result as props — this page's only job is to fetch and hand them
 * over.
 */
export default async function AppointmentDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
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

  const { data: appointment, error } = await supabase
    .from('appointments')
    .select(
      'id, scheduled_time, status, reference, service_id, service:services(name, description, clinic:clinics(name, city))'
    )
    .eq('id', id)
    .maybeSingle()

  if (error) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-base font-semibold text-ink">Couldn&rsquo;t load this appointment</p>
        <p className="text-base text-muted">Please refresh the page.</p>
      </main>
    )
  }
  if (!appointment) notFound()

  const typical = await getTypicalTime(supabase, appointment.service_id)

  return (
    <main className={PAGE_CLASS}>
      <AppointmentDetailsView fullName={profile.full_name} appointment={appointment} typical={typical} />
    </main>
  )
}
