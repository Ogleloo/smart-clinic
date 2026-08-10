'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { login, type ActionState } from '@/app/actions/auth'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

interface LoginFormProps {
  /** Set when middleware/idleLogout sent someone here for a specific reason, e.g. "idle". */
  reason?: string
}

export function LoginForm({ reason }: LoginFormProps) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(login, {})

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6">
      <div className="h-14 w-14 rounded-full bg-primary-700" aria-hidden />
      <h1 className="font-display text-[28px] font-bold text-ink">Riverside Clinic</h1>
      <p className="text-center text-sm text-muted">
        Log in to see your queue and appointments
      </p>

      {reason === 'idle' && (
        <p role="status" className="text-center text-sm font-semibold text-warning">
          You were signed out because this device was inactive.
        </p>
      )}

      <form action={formAction} className="flex w-full flex-col gap-4">
        <Input label="Email" name="email" type="email" autoComplete="email" required
               placeholder="you@email.com" />
        <Input label="Password" name="password" type="password"
               autoComplete="current-password" required placeholder="••••••••" />

        {state.error && (
          <p role="alert" className="text-sm font-semibold text-danger">{state.error}</p>
        )}

        <Button type="submit" fullWidth loading={pending}>Log in</Button>
      </form>

      <Link href="/forgot-password" className="text-sm font-semibold text-primary-700">
        Forgot password?
      </Link>
      <p className="text-sm text-muted">
        New here?{' '}
        <Link href="/register" className="font-semibold text-primary-700">Create an account</Link>
      </p>
    </main>
  )
}
