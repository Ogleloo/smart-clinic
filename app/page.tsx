import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { homeForRole } from '@/lib/auth/homeForRole'
import { formatOpeningHours } from '@/lib/clinicHours'
import type { UserRole } from '@/lib/types/database.types'
import { LandingPageView } from '@/components/landing/LandingPageView'
import type { HoursState, ServicesState } from '@/components/landing/content'

export const metadata: Metadata = {
  title: 'Riverside Clinic — Know where you stand',
  description: 'Book appointments, follow the queue, and see your estimated wait — all in one place.',
}

/**
 * get_public_queue_display(), called with no argument, returns one row per active service directly (migration 0051)
 * — no need to enumerate services first, which anon couldn't do anyway (services_read is authenticated-only). Its
 * columns are service-level counts and estimates; it carries no patient names, identification or clinical detail.
 *
 * A failed read and a successful empty one are different states ('unavailable' vs 'empty'): the page says so honestly
 * and never invents services or figures. Neither blocks the rest of the page.
 */
async function getServices(): Promise<ServicesState> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('get_public_queue_display')
    if (error || !data) return { status: 'unavailable' }
    return data.length === 0 ? { status: 'empty' } : { status: 'ok', rows: data }
  } catch {
    return { status: 'unavailable' }
  }
}

/**
 * clinic_hours is public information (on the door of the clinic, on this same page) and anon-readable by grant, not
 * through a second anon-callable function — ADR-028's "exactly one" assertion covers functions, not table grants.
 * Degrades to a plain statement rather than a stale hardcoded fallback: showing old hours as if they were current
 * would be exactly the kind of guess this feature exists to remove.
 */
async function getHours(): Promise<HoursState> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from('clinic_hours').select('*').order('day_of_week')
    if (error || !data) return { status: 'unavailable' }
    const line = data.length === 0 ? '' : formatOpeningHours(data)
    return line ? { status: 'ok', lines: line.split(' · ') } : { status: 'empty' }
  } catch {
    return { status: 'unavailable' }
  }
}

/** A failed session check means "treat as signed out" — the page is public. */
async function getSignedInRole(): Promise<UserRole | null> {
  let role: UserRole | null = null
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null
    const { data: profile } = await supabase.from('profiles').select('role').eq('auth_user_id', user.id).single()
    role = (profile?.role ?? 'patient') as UserRole
  } catch {
    return null
  }
  return role
}

export default async function LandingPage() {
  // Signed-in users never see the landing page: they go to their own home. redirect() throws, so it stays outside any try.
  const role = await getSignedInRole()
  if (role) redirect(homeForRole(role))

  const [services, hours] = await Promise.all([getServices(), getHours()])
  return <LandingPageView services={services} hours={hours} />
}
