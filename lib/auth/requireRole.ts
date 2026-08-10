import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { homeForRole } from './homeForRole'
import type { UserRole } from '@/lib/types/database.types'

const DEFAULT_STAFF_IDLE_TIMEOUT_MINUTES = 30

/**
 * Server-side area guard. Not just "not logged in" (middleware already
 * covers that) — a logged-in user of the WRONG role gets redirected to
 * their own home, not left to see a staff screen whose RPCs would
 * reject them anyway. Used once per area layout (reception/admin) or
 * directly in the page (nurse, which has no separate layout).
 *
 * Also resolves the clinic's staff_idle_timeout_minutes for non-patient
 * roles, since every staff area needs it to mount IdleTimeoutMonitor and
 * none of them should duplicate this same profile+clinic_settings
 * lookup independently. null for role 'patient': idle timeout never
 * applies to patients (they legitimately leave a queue-status page open
 * for an hour; staff use shared devices, patients use personal ones).
 */
export async function requireRole(role: UserRole) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Filtered by auth_user_id, not a bare .single(): RLS lets staff see
  // many profile rows, not just their own, so an unfiltered .single()
  // throws "multiple rows" for exactly the roles this guard exists to
  // check (see the same fix in app/actions/auth.ts's login action).
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, clinic_id')
    .eq('auth_user_id', user.id)
    .single()
  if (profile?.role !== role) redirect(homeForRole(profile?.role ?? 'patient'))

  if (role === 'patient') {
    return { supabase, user, staffIdleTimeoutMinutes: null as number | null }
  }

  let staffIdleTimeoutMinutes = DEFAULT_STAFF_IDLE_TIMEOUT_MINUTES
  if (profile.clinic_id) {
    const { data: settings } = await supabase
      .from('clinic_settings')
      .select('staff_idle_timeout_minutes')
      .eq('clinic_id', profile.clinic_id)
      .maybeSingle()
    if (settings?.staff_idle_timeout_minutes != null) {
      staffIdleTimeoutMinutes = settings.staff_idle_timeout_minutes
    }
  }

  return { supabase, user, staffIdleTimeoutMinutes }
}
