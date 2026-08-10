import { createClient } from '@/lib/supabase/server'
import { homeForRole } from '@/lib/auth/homeForRole'
import { logout } from '@/app/actions/auth'
import { LoginForm } from '@/components/auth/LoginForm'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import type { UserRole } from '@/lib/types/database.types'

/**
 * Staff use shared clinic devices; sessions effectively never expire
 * (Supabase refresh tokens renew indefinitely) and nobody presses Log
 * out. Walking up to /login while already signed in as someone else
 * must never silently continue as them — this interstitial makes
 * whoever is currently signed in explicit, and requires a deliberate
 * choice before landing in their role home or switching accounts.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, role')
      .eq('auth_user_id', user.id)
      .single()

    const role = (profile?.role ?? 'patient') as UserRole
    const fullName = profile?.full_name ?? 'you'
    const firstName = fullName.split(' ')[0]
    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1)

    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="h-14 w-14 rounded-full bg-primary-700" aria-hidden />
        <h1 className="font-display text-[22px] font-bold text-ink">
          Signed in as {fullName} — {roleLabel}
        </h1>
        <p className="text-sm text-muted">
          On a shared device, sign out before leaving it unattended.
        </p>

        <LinkButton href={homeForRole(role)} variant="primary" fullWidth>
          Continue as {firstName}
        </LinkButton>
        <form action={logout} className="w-full">
          <Button type="submit" variant="tertiary" fullWidth>
            Sign out and use another account
          </Button>
        </form>
      </main>
    )
  }

  return <LoginForm reason={reason} />
}
