import { createClient } from '@/lib/supabase/server'
import { BottomNav } from '@/components/patient/BottomNav'

/**
 * Shared shell for every patient screen. Each page still does its own
 * getUser() + redirect (unchanged from earlier slices) — this layout
 * only adds the bottom nav, so it fetches the unread count itself
 * rather than gating on auth: if there's no user, BottomNav simply
 * isn't rendered, and the page underneath handles the redirect.
 */
export default async function PatientLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let initialUnreadCount = 0
  if (user) {
    const { count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .is('read_at', null)
    initialUnreadCount = count ?? 0
  }

  return (
    <div className={user ? 'pb-16' : ''}>
      {children}
      {user && <BottomNav initialUnreadCount={initialUnreadCount} />}
    </div>
  )
}
