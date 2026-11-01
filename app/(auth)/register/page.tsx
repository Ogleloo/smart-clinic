'use client'

import Link from 'next/link'
import { useActionState, useState, type ChangeEvent, type FormEvent } from 'react'
import { register, type RegisterState } from '@/app/actions/auth'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { formatCalendarDate, todayInClinicTimezone } from '@/lib/clinicTime'
import { saIdBirthDateCandidates } from '@/lib/profileValidation'
import {
  REGISTRATION_FIELD_ORDER,
  registrationInputFrom,
  validateRegistration,
  type RegistrationErrors,
} from '@/lib/registrationValidation'

/** The same normalisation the server and handle_new_user() apply before the number is stored. */
const normaliseId = (raw: string) => raw.replace(/\s/g, '').toUpperCase()

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState<RegisterState, FormData>(register, {})
  const [clientErrors, setClientErrors] = useState<RegistrationErrors | null>(null)
  const [idNumber, setIdNumber] = useState('')
  const [dob, setDob] = useState('')
  // True while the date in the field came from the ID number (not typed by the person), so a
  // changed ID number may replace it — and a date they typed themselves is never overwritten.
  const [dobFromId, setDobFromId] = useState(false)

  const candidates = saIdBirthDateCandidates(normaliseId(idNumber), todayInClinicTimezone())

  function handleIdChange(e: ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    setIdNumber(value)
    const found = saIdBirthDateCandidates(normaliseId(value), todayInClinicTimezone())
    if (found.length === 1 && (dob === '' || dobFromId)) {
      setDob(found[0])
      setDobFromId(true)
    } else if (found.length !== 1 && dobFromId) {
      // The ID changed (or stopped being a valid SA ID): a date taken from it no longer stands.
      setDob('')
      setDobFromId(false)
    }
  }

  function handleDobChange(e: ChangeEvent<HTMLInputElement>) {
    setDob(e.target.value)
    setDobFromId(false)
  }

  function chooseCandidate(iso: string) {
    setDob(iso)
    setDobFromId(true)
  }

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
               placeholder="+27 82 555 0134" error={errors.phone} />
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="ID or passport number" name="id_number" autoComplete="off" required
                 value={idNumber} onChange={handleIdChange}
                 helper="SA ID (13 digits) or passport number." error={errors.id_number} />
          <Input label="Date of birth" name="date_of_birth" type="date" autoComplete="bday" required
                 value={dob} onChange={handleDobChange}
                 min="1900-01-01" max={todayInClinicTimezone()} error={errors.date_of_birth} />
        </div>

        {/* What the ID number says about the date of birth. It is a convenience and a consistency
            check, not identity verification. A passport number never produces a suggestion. */}
        <div aria-live="polite" className="flex flex-col gap-2">
          {candidates.length === 1 && dob === candidates[0] && dobFromId && (
            <p role="status" className="text-xs text-muted">
              Date of birth filled in from your ID number ({formatCalendarDate(candidates[0])}). Check it is correct.
            </p>
          )}
          {candidates.length === 2 && (
            <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-[13px] font-semibold text-muted">
                Your ID number fits two birth years. Which is yours?
              </legend>
              {candidates.map((iso) => (
                <label key={iso} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-ink">
                  <input
                    type="radio"
                    name="dob_choice"
                    value={iso}
                    checked={dob === iso}
                    onChange={() => chooseCandidate(iso)}
                    className="h-5 w-5 accent-primary-700"
                  />
                  {formatCalendarDate(iso)}
                </label>
              ))}
            </fieldset>
          )}
        </div>

        <PasswordInput label="Password" name="password" autoComplete="new-password"
                       required placeholder="••••••••" helper="At least 8 characters, not counting spaces."
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
