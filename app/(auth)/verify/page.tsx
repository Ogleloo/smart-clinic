import { redirect } from 'next/navigation'
import { VerifyForm } from '@/components/auth/VerifyForm'

/**
 * Reached from register() after signup, or from login() when Supabase
 * reports an unconfirmed account — both carry the email as a query
 * param rather than reading it off a session, since there isn't
 * necessarily one yet (see app/actions/auth.ts). No email means there's
 * nothing to verify or resend, so this isn't a valid entry point.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>
}) {
  const { email } = await searchParams
  if (!email) redirect('/register')

  return <VerifyForm email={email} />
}
