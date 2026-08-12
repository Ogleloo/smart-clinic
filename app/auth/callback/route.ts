import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Single entry point for every emailed auth link — password recovery,
 * signup confirmation, email change. Supabase's hosted verify endpoint
 * forwards here as either an OTP (`token_hash` + `type`) or a PKCE
 * `code`; handle both instead of assuming one.
 *
 * Recovery always lands on /reset-password, regardless of `next`: a
 * recovery link is an explicit intent to set a new password, not a
 * generic "continue to wherever" redirect, and it must never fall
 * through to /login's signed-in interstitial.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  const supabase = await createClient()

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (!error) {
      return NextResponse.redirect(`${origin}${type === 'recovery' ? '/reset-password' : next}`)
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}${next}`)
  }

  return NextResponse.redirect(`${origin}/login?reason=link_invalid`)
}
