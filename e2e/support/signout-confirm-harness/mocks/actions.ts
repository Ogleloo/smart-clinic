/**
 * Stand-in for app/actions/auth.ts. SignOutConfirm imports exactly one thing from it — logout — and the point of
 * the harness is that the confirmation step decides WHETHER that function runs, never what it does. The real
 * logout() calls supabase.auth.signOut() and redirects; here it only records that it was reached, so a test can
 * assert "Cancel signed nobody out" as the absence of a call rather than as the absence of a redirect.
 */
import { respond } from './state'

export async function logout(): Promise<void> {
  await respond('logout')
}
