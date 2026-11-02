import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPatientClinic } from '@/lib/patientClinic'
import { confirmationDestination } from '@/lib/bookingConfirmation'
import { LinkButton } from '@/components/ui/LinkButton'
import { PAGE_CLASS } from '@/components/patient/PageHeader'
import { BookingConfirmedView } from '@/components/booking/BookingConfirmedView'

/**
 * Booking success (Figma 68:77).
 *
 * The reference shown here is appointments.reference, written by the
 * trg_appointment_reference trigger on insert — this page only ever
 * reads it back.
 *
 * Same RLS scoping as the details page: someone else's appointment id
 * returns zero rows, handled as notFound().
 *
 * This URL is reachable for as long as the appointment id exists, not just in the moment right after
 * booking — a bookmarked or revisited link must never present a since-changed status (checked in, cancelled,
 * no-show, completed) as a fresh confirmation. confirmationDestination() is the single source of truth for
 * that: anything other than still-'booked' redirects to the appointment's own, already-authorized details
 * page instead of rendering here.
 *
 * All presentation lives in BookingConfirmedView, a pure component that
 * takes the appointment and clinic as props — this page's only job is
 * to fetch and hand them over.
 */
export default async function BookingConfirmedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: appointment, error }, clinic] = await Promise.all([
    supabase.from('appointments').select('id, scheduled_time, status, reference, service:services(name)').eq('id', id).maybeSingle(),
    getPatientClinic(),
  ])

  if (error) {
    return (
      <main className={PAGE_CLASS}>
        <p className="text-base font-semibold text-ink">Your booking went through, but we couldn&rsquo;t load it here.</p>
        <LinkButton href="/appointments" variant="secondary">
          Go to my appointments
        </LinkButton>
      </main>
    )
  }
  if (!appointment) notFound()
  if (confirmationDestination(appointment.status) === 'details') redirect(`/appointments/${id}`)

  return (
    <main className={PAGE_CLASS}>
      <BookingConfirmedView appointment={appointment} clinic={clinic} />
    </main>
  )
}
