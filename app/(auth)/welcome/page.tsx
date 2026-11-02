import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { homeForRole } from '@/lib/auth/homeForRole'
import { WelcomeView } from '@/components/auth/v3/WelcomeView'
import type { UserRole } from '@/lib/types/database.types'

export const metadata: Metadata = {
  title: 'Welcome — Riverside Clinic',
  description: 'Create an account or log in to book appointments and follow your place in the queue.',
}

/**
 * Patient V3 Welcome Entry (Figma 22:39) — the entry to the authentication flow at /welcome, deliberately not a
 * second public home page: it offers only "Get started" and "Log in", and links back to the landing page at /.
 *
 * Someone already signed in has nothing to choose here, so they go to their own home, exactly as / does. The
 * shared-device interstitial is untouched: it belongs to /login, which is where the "Log in" button leads, so a
 * deliberate log-in on a shared device still passes through it.
 */
export default async function WelcomePage() {
  let role: UserRole | null = null
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('role').eq('auth_user_id', user.id).single()
      role = (profile?.role ?? 'patient') as UserRole
    }
  } catch {
    // A failed session check means "treat as signed out": this page is public.
    role = null
  }
  if (role) redirect(homeForRole(role))

  return <WelcomeView />
}
