import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { NotificationsList } from '@/components/notifications/NotificationsList'
import { PAGE_CLASS, PageHeader } from '@/components/patient/PageHeader'

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
    <main className={PAGE_CLASS}>
      <PageHeader title="Notifications" subtitle="Updates about your queue and appointments." />
      <div className="w-full max-w-3xl">
        {error ? (
          <p className="text-sm text-danger">Couldn&rsquo;t load notifications. Try refreshing.</p>
        ) : (
          <NotificationsList initialNotifications={notifications ?? []} />
        )}
      </div>
    </main>
  )
}
