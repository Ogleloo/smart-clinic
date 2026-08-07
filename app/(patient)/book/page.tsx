import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { EmptyState } from '@/components/ui/EmptyState'
import { BookingWizard } from '@/components/booking/BookingWizard'

/**
 * Book an appointment (Slice 3).
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

  const { data: services, error } = await supabase
    .from('services')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 py-6">
      <h1 className="mb-5 font-display text-[22px] font-bold text-ink">Book an appointment</h1>

      {error ? (
        <p className="text-sm text-danger">Couldn&rsquo;t load services. Try refreshing.</p>
      ) : services && services.length > 0 ? (
        <BookingWizard services={services} />
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
