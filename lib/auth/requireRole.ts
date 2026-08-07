import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { homeForRole } from './homeForRole'
import type { UserRole } from '@/lib/types/database.types'

/**
 * Server-side area guard. Not just "not logged in" (middleware already
 * covers that) — a logged-in user of the WRONG role gets redirected to
 * their own home, not left to see a staff screen whose RPCs would
 * reject them anyway. Used once per area layout (reception now; nurse
 * and admin reuse this unchanged when those areas are built).
 */
export async function requireRole(role: UserRole) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Filtered by auth_user_id, not a bare .single(): RLS lets staff see
  // many profile rows (their own plus every patient at their clinic),
  // so an unfiltered .single() throws "multiple rows" for exactly the
  // roles this guard exists to check (see the same fix in
  // app/actions/auth.ts's login action).
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('auth_user_id', user.id)
    .single()
  if (profile?.role !== role) redirect(homeForRole(profile?.role ?? 'patient'))

  return { supabase, user }
}
