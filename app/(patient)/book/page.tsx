import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'

/** Booking flow lands in a later slice — this stub gives the dashboard's "Book appointment" action a real destination instead of a dead link. */
export default async function BookPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 py-6">
      <EmptyState
        headline="Booking is coming soon"
        body="This flow isn&rsquo;t built yet — check back shortly."
        action={<LinkButton href="/dashboard" variant="secondary">Back to dashboard</LinkButton>}
        fullWidth
      />
    </main>
  )
}
