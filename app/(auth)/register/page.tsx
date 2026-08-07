'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { register, type ActionState } from '@/app/actions/auth'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(register, {})

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6">
      <div className="h-14 w-14 rounded-full bg-primary-700" aria-hidden />
      <h1 className="font-display text-[26px] font-bold text-ink">Create your account</h1>
      <p className="text-center text-sm text-muted">Book appointments and skip the queue</p>

      <form action={formAction} className="flex w-full flex-col gap-4">
        <Input label="Full name" name="full_name" autoComplete="name" required
               placeholder="Thabo Mokoena" />
        <Input label="Email" name="email" type="email" autoComplete="email" required
               placeholder="you@email.com" />
        <Input label="Phone" name="phone" type="tel" autoComplete="tel"
               placeholder="+27 82 555 0134" />
        <Input label="Password" name="password" type="password" autoComplete="new-password"
               required placeholder="••••••••" helper="At least 8 characters." />

        {state.error && (
          <p role="alert" className="text-sm font-semibold text-danger">{state.error}</p>
        )}

        <Button type="submit" fullWidth loading={pending}>Create account</Button>
      </form>

      <p className="text-sm text-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-primary-700">Log in</Link>
      </p>
    </main>
  )
}
