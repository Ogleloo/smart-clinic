import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPatientClinic } from '@/lib/patientClinic'
import { EmptyState } from '@/components/ui/EmptyState'
import { BookingWizard } from '@/components/booking/BookingWizard'
import { PatientHeaderBanner } from '@/components/patient/PatientHeaderBanner'
import { PAGE_CLASS } from '@/components/patient/PageHeader'

/**
 * Book an appointment — V3 three-step wizard (Figma 48:77 / 52:348 / 57:101).
 *
 * Services and the signed-in patient's name are read once, server-side —
 * RLS lets any authenticated user read active services. Everything after
 * that (date, available slots, the booking submission itself) is
 * inherently interactive, so it lives in the client-side wizard.
 */
export default async function BookPage() {
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
      <PatientHeaderBanner
        title="Book an appointment"
        subtitle="Choose a service to get started. We'll guide you through the next steps to find a time that works for you."
        fullName={profile.full_name}
      />

      {error ? (
        <p className="text-base text-danger">Couldn&rsquo;t load services. Try refreshing.</p>
      ) : services && services.length > 0 ? (
        <BookingWizard services={services} clinic={clinic} />
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
