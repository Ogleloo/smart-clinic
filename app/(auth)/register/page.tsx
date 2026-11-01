'use client'

import Link from 'next/link'
import { useActionState, useState, type FormEvent } from 'react'
import { register, type RegisterState } from '@/app/actions/auth'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { todayInClinicTimezone } from '@/lib/clinicTime'
import {
  REGISTRATION_FIELD_ORDER,
  registrationInputFrom,
  validateRegistration,
  type RegistrationErrors,
} from '@/lib/registrationValidation'

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState<RegisterState, FormData>(register, {})
  const [clientErrors, setClientErrors] = useState<RegistrationErrors | null>(null)

  // noValidate: the browser's own bubbles would pre-empt these messages and
  // differ from the server's wording. The same rules (lib/registrationValidation)
  // run here and again in the Server Action, which is the one that counts.
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    const form = e.currentTarget
    const { errors } = validateRegistration(registrationInputFrom(new FormData(form)), todayInClinicTimezone())
    const first = REGISTRATION_FIELD_ORDER.find((f) => errors[f])
    if (!first) {
      setClientErrors(null)
      return
    }
    // Stops the form action: nothing is sent while the form is incomplete.
    e.preventDefault()
    setClientErrors(errors)
    ;(form.elements.namedItem(first) as HTMLElement | null)?.focus()
  }

  const errors = clientErrors ?? state.fieldErrors ?? {}
  // A server error that is not about one field (e.g. "User already registered").
  const formError = state.error && !state.fieldErrors ? state.error : undefined

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6">
      <div className="h-14 w-14 rounded-full bg-primary-700" aria-hidden />
      <h1 className="font-display text-[26px] font-bold text-ink">Create your account</h1>
      <p className="text-center text-sm text-muted">Book appointments and skip the queue</p>

      <form action={formAction} onSubmit={handleSubmit} noValidate className="flex w-full flex-col gap-4">
        <Input label="Full name" name="full_name" autoComplete="name" required
               placeholder="Thabo Mokoena" error={errors.full_name} />
        <Input label="Email" name="email" type="email" autoComplete="email" required
               placeholder="you@email.com" error={errors.email} />
        <Input label="Phone (optional)" name="phone" type="tel" autoComplete="tel"
               placeholder="+27 82 555 0134" />
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Date of birth" name="date_of_birth" type="date" autoComplete="bday" required
                 min="1900-01-01" max={todayInClinicTimezone()} error={errors.date_of_birth} />
          <Input label="ID or passport number" name="id_number" autoComplete="off" required
                 helper="SA ID (13 digits) or passport number." error={errors.id_number} />
        </div>
        <PasswordInput label="Password" name="password" autoComplete="new-password"
                       required placeholder="••••••••" helper="At least 8 characters."
                       error={errors.password} />

        {formError && (
          <p role="alert" className="text-sm font-semibold text-danger">{formError}</p>
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
