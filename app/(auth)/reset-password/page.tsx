'use client'

import { useActionState } from 'react'
import { updatePassword, type ActionState } from '@/app/actions/auth'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export default function ResetPasswordPage() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(updatePassword, {})

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6">
      <div className="h-14 w-14 rounded-full bg-primary-700" aria-hidden />
      <h1 className="font-display text-[26px] font-bold text-ink">Set a new password</h1>
      <p className="text-center text-sm text-muted">
        Choose a strong password you&apos;ll remember.
      </p>

      <form action={formAction} className="flex w-full flex-col gap-4">
        <Input label="New password" name="password" type="password"
               autoComplete="new-password" required placeholder="••••••••" />
        <Input label="Confirm password" name="confirm" type="password"
               autoComplete="new-password" required placeholder="••••••••" />

        {state.error && (
          <p role="alert" className="text-sm font-semibold text-danger">{state.error}</p>
        )}

        <Button type="submit" fullWidth loading={pending}>Update password</Button>
      </form>
    </main>
  )
}
