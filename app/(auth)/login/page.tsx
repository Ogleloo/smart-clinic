import { redirect } from 'next/navigation'
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
 *
 * It must equally never fire in place of a recovery or confirmation
 * flow: those carry their own explicit intent, which overrides
 * whichever account happens to already be signed in on this device. A
 * recovery/confirmation link that points at /login instead of
 * /auth/callback (stale bookmark, template drift) is forwarded there
 * rather than verified twice. Any other non-empty `reason` — an
 * invalid link, a just-updated password, an idle timeout — means this
 * isn't a plain visit either, so the interstitial stays off.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; token_hash?: string; type?: string; code?: string }>
}) {
  const { reason, token_hash: tokenHash, type, code } = await searchParams

  if (tokenHash && type) {
    redirect(`/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(type)}`)
  }
  if (code) {
    redirect(`/auth/callback?code=${encodeURIComponent(code)}`)
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user && !reason) {
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
