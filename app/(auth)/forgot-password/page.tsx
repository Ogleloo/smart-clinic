'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { requestPasswordReset, type ActionState } from '@/app/actions/auth'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    requestPasswordReset, {}
  )

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6">
      <div className="h-14 w-14 rounded-full bg-primary-700" aria-hidden />
      <h1 className="font-display text-[26px] font-bold text-ink">Reset your password</h1>
      <p className="text-center text-sm text-muted">
        Enter your email and we&apos;ll send you a reset link.
      </p>

      <form action={formAction} className="flex w-full flex-col gap-4">
        <Input label="Email" name="email" type="email" autoComplete="email" required
               placeholder="you@email.com" />

        {state.error && (
          <p role="alert" className="text-sm font-semibold text-danger">{state.error}</p>
        )}
        {state.success && (
          <p role="status" className="text-sm font-semibold text-success">{state.success}</p>
        )}

        <Button type="submit" fullWidth loading={pending}>Send reset link</Button>
      </form>

      <Link href="/login" className="text-sm font-semibold text-primary-700">Back to login</Link>
    </main>
  )
}
