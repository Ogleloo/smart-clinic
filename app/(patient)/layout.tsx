import { requireRole } from '@/lib/auth/requireRole'
import { BottomNav } from '@/components/patient/BottomNav'

/**
 * Shared shell for every patient screen.
 *
 * Until now this only checked "is there a user at all" — the same
 * (weaker) check every page under here duplicated individually — never
 * the role, unlike reception/nurse/admin, which each gate their whole
 * area on requireRole() in their layout. A logged-in staff account is a
 * valid user, so it sailed straight through every page's own check and
 * into queries whose "exactly one row" invariant assumed a patient
 * caller (see the dashboard profile query: RLS lets staff read many
 * profile rows relationally, so .single() threw for them, never for an
 * actual patient). requireRole('patient') here closes that off for the
 * whole area at once, the same way the other three areas already work.
 */
export default async function PatientLayout({ children }: { children: React.ReactNode }) {
  const { supabase } = await requireRole('patient')

  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .is('read_at', null)

  return (
    <div className="pb-16">
      {children}
      <BottomNav initialUnreadCount={count ?? 0} />
    </div>
  )
}
