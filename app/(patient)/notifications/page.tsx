import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { NotificationsList } from '@/components/notifications/NotificationsList'

/**
 * RLS scopes notifications to the caller (recipient_id) — no explicit
 * filter here, same ADR-010 pattern as every other patient screen.
 */
export default async function NotificationsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: notifications, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 py-6">
      <h1 className="font-display text-[22px] font-bold text-ink">Notifications</h1>
      {error ? (
        <p className="text-sm text-danger">Couldn&rsquo;t load notifications. Try refreshing.</p>
      ) : (
        <NotificationsList initialNotifications={notifications ?? []} />
      )}
    </main>
  )
}
