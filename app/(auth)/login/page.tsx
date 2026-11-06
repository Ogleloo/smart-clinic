import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { homeForRole } from '@/lib/auth/homeForRole'
import { SignOutConfirm } from '@/components/ui/SignOutConfirm'
import { LoginForm } from '@/components/auth/LoginForm'
import { AuthBrand, AuthShell } from '@/components/auth/v3/AuthShell'
import { BTN_PRIMARY, BTN_SECONDARY, HEADING, SUBHEADING } from '@/components/auth/v3/authStyles'
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
 *
 * V3 only restyles it into the shared auth card; none of the above changed.
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
      <AuthShell blobs="login">
        <div className="flex flex-col items-center gap-8 text-center">
          <AuthBrand />
          <div className="flex flex-col items-center gap-3">
            <h1 className={HEADING}>
              Signed in as {fullName} — {roleLabel}
            </h1>
            <p className={SUBHEADING}>On a shared device, sign out before leaving it unattended.</p>
          </div>
          <div className="flex w-full flex-col gap-4">
            <Link href={homeForRole(role)} className={BTN_PRIMARY}>
              Continue as {firstName}
            </Link>
            <SignOutConfirm formClassName="w-full" buttonClassName={BTN_SECONDARY}>
              Sign out and use another account
            </SignOutConfirm>
          </div>
        </div>
      </AuthShell>
    )
  }

  return <LoginForm reason={reason} />
}
