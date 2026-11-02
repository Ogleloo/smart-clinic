'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Lock, Mail } from 'lucide-react'
import { login, type ActionState } from '@/app/actions/auth'
import { Input } from '@/components/ui/Input'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { AuthBrand, AuthShell } from '@/components/auth/v3/AuthShell'
import { BTN_PRIMARY, HEADING, LINK, LINK_ROW, SUBHEADING } from '@/components/auth/v3/authStyles'

interface LoginFormProps {
  /** Set when middleware/idleLogout/the auth callback sent someone here for a specific reason. */
  reason?: string
}

/** Patient V3 login (Figma 28:40). Behaviour — the login Server Action, its errors and its redirects — is unchanged. */
export function LoginForm({ reason }: LoginFormProps) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(login, {})

  return (
    <AuthShell blobs="login">
      <div className="flex flex-col items-center gap-8">
        <AuthBrand />

        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className={HEADING}>Log in to see your queue and appointments</h1>
          <p className={SUBHEADING}>
            Access your appointments, track your queue position, and stay updated — all in one place.
          </p>
        </div>

        {reason === 'idle' && (
          <p role="status" className="w-full rounded-md bg-warning-bg p-3 text-center text-sm font-semibold text-warning">
            You were signed out because this device was inactive.
          </p>
        )}
        {reason === 'link_invalid' && (
          <p role="alert" className="w-full rounded-md bg-danger-bg p-3 text-center text-sm font-semibold text-danger">
            That link is invalid or has expired. Request a new one below.
          </p>
        )}
        {reason === 'password_updated' && (
          <p role="status" className="w-full rounded-md bg-primary-50 p-3 text-center text-sm font-semibold text-[#037F74]">
            Password updated. Log in with your new password.
          </p>
        )}

        <form action={formAction} className="flex w-full flex-col gap-5">
          <Input
            variant="auth"
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@email.com"
            leading={<Mail aria-hidden size={20} />}
          />
          <PasswordInput
            variant="auth"
            label="Password"
            name="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            leading={<Lock aria-hidden size={20} />}
          />

          {state.error && (
            <p role="alert" className="text-sm font-semibold text-danger">
              {state.error}
            </p>
          )}

          <button type="submit" className={BTN_PRIMARY} disabled={pending}>
            {pending ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <div className="flex flex-col items-center gap-1">
          <Link href="/forgot-password" className={LINK_ROW}>
            Forgot password?
          </Link>
          <p className="text-base text-ink">
            New here?{' '}
            <Link href="/register" className={LINK}>
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </AuthShell>
  )
}
