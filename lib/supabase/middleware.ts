import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/lib/types/database.types'

/**
 * Refreshes the auth session on every request and guards routes.
 *
 * Without this, server-rendered pages see an expired token and log the
 * user out unexpectedly. This is the most important piece of Supabase
 * + Next.js SSR auth.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() revalidates the token with Supabase.
  // Never use getSession() for authorization: it reads the cookie
  // without verifying it.
  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isPublic =
    path === '/' ||
    path.startsWith('/login') ||
    path.startsWith('/register') ||
    path.startsWith('/forgot-password') ||
    path.startsWith('/reset-password') ||
    path.startsWith('/auth') ||
    // Waiting-room display board (ADR-028): no login, meant to run
    // unattended on a screen in the clinic with nobody signed in.
    path.startsWith('/display')

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // /login deliberately does NOT redirect an already-authenticated
  // caller away — on a shared clinic device, silently dropping whoever
  // opens /login into the previous session's role home is the exact
  // shared-device security gap this closes. The login page itself
  // checks auth and shows an interstitial ("Signed in as X — Role")
  // instead. /register still redirects: there's no "already
  // registering as someone else" state worth surfacing.
  if (user && path.startsWith('/register')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
