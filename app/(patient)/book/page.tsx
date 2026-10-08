import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPatientClinic } from '@/lib/patientClinic'
import { EmptyState } from '@/components/ui/EmptyState'
import { BookingWizard } from '@/components/booking/BookingWizard'
import { PAGE_CLASS, PageHeader } from '@/components/patient/PageHeader'

/**
 * Book an appointment — V3 three-step wizard.
 *
 * Services are read once, server-side — RLS lets any authenticated user
 * read active services. Everything after that (date, available slots)
 * is inherently interactive, so it lives in the client-side wizard.
 */
export default async function BookPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Unfiltered by clinic, deliberately: profiles.clinic_id is null for
  // patients (verified live) — only staff belong to a clinic. A patient
  // isn't scoped to one, which is why `services` on this same page has
  // never been filtered by clinic_id either. This mirrors
  // get_public_queue_display() (migration 0051), the other patient/anon
  // -facing read, which has no clinic filter for the same reason.
  const [{ data: services, error }, clinic] = await Promise.all([
    supabase.from('services').select('id, name, description').eq('is_active', true).order('name'),
    getPatientClinic(),
  ])

  return (
    <main className={PAGE_CLASS}>
      <PageHeader title="Book an appointment" subtitle="Three quick steps: service, day and time, confirm." />

      {error ? (
        <p className="text-sm text-danger">Couldn&rsquo;t load services. Try refreshing.</p>
      ) : services && services.length > 0 ? (
        <BookingWizard services={services} clinicHours={clinic?.hours ?? []} clinicName={clinic?.name ?? null} />
      ) : (
        <EmptyState
          headline="No services available"
          body="There's nothing bookable right now — check back later."
          fullWidth
        />
      )}
    </main>
  )
}
