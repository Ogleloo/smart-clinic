'use client'

import Link from 'next/link'
import { useActionState, useState, type ChangeEvent, type FormEvent } from 'react'
import { IdCard, Lock, Mail, Phone, User } from 'lucide-react'
import { register, type RegisterState } from '@/app/actions/auth'
import { Input } from '@/components/ui/Input'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { AuthBrand, AuthShell } from '@/components/auth/v3/AuthShell'
import { BTN_PRIMARY, HEADING, LINK, SUBHEADING } from '@/components/auth/v3/authStyles'
import { formatCalendarDate, todayInClinicTimezone } from '@/lib/clinicTime'
import { passwordsMatch } from '@/lib/passwordValidation'
import { saIdBirthDateCandidates } from '@/lib/profileValidation'
import {
  REGISTRATION_FIELD_ORDER,
  registrationInputFrom,
  validateRegistration,
  type RegistrationErrors,
} from '@/lib/registrationValidation'

/** The same normalisation the server and handle_new_user() apply before the number is stored. */
const normaliseId = (raw: string) => raw.replace(/\s/g, '').toUpperCase()

/**
 * Patient V3 registration (Figma 33:49).
 *
 * The design shows five fields; the account needs seven. Date of birth and ID/passport number are required by
 * the Server Action, by handle_new_user() and by the supervisor's identification requirement, so they are added
 * to the V3 card rather than dropped to match the drawing — side by side from sm, stacked below it. Everything
 * else about the rules is untouched: the same validateRegistration runs here and again on the server.
 */
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
    const data = new FormData(form)
    const { errors } = validateRegistration(registrationInputFrom(data), todayInClinicTimezone())
    const match = passwordsMatch(String(data.get('password') ?? ''), String(data.get('confirm') ?? ''))
    const all: RegistrationErrors = { ...errors, ...(match.ok ? {} : { confirm: match.error }) }
    const first = REGISTRATION_FIELD_ORDER.find((f) => all[f])
    if (!first) {
      setClientErrors(null)
      return
    }
    // Stops the form action: nothing is sent while the form is incomplete.
    e.preventDefault()
    setClientErrors(all)
    ;(form.elements.namedItem(first) as HTMLElement | null)?.focus()
  }

  const errors = clientErrors ?? state.fieldErrors ?? {}
  // A server error that is not about one field (e.g. "User already registered").
  const formError = state.error && !state.fieldErrors ? state.error : undefined

  return (
    <AuthShell>
      <div className="flex flex-col items-center gap-7">
        <AuthBrand />

        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className={HEADING}>Create your account</h1>
          <p className={SUBHEADING}>
            Join Smart Clinic to book appointments, track your queue position, and stay updated — all in one place.
          </p>
        </div>

        <form action={formAction} onSubmit={handleSubmit} noValidate className="flex w-full flex-col gap-4">
          <Input
            variant="auth"
            label="Full name"
            name="full_name"
            autoComplete="name"
            required
            placeholder="Enter your full name"
            leading={<User aria-hidden size={20} />}
            error={errors.full_name}
          />
          <Input
            variant="auth"
            label="Email address"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@email.com"
            leading={<Mail aria-hidden size={20} />}
            error={errors.email}
          />
          {/* Figma pairs this with a "+27" country selector. There is no country list behind it and the validator
              accepts an international number as typed (a passport holder may not have an SA number), so the
              prefix lives in the placeholder instead of a control that could only ever offer one choice. */}
          <Input
            variant="auth"
            label="Mobile number (optional)"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="+27 82 555 0134"
            leading={<Phone aria-hidden size={20} />}
            error={errors.phone}
          />

          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              variant="auth"
              label="ID or passport number"
              name="id_number"
              autoComplete="off"
              required
              value={idNumber}
              onChange={handleIdChange}
              placeholder="SA ID or passport"
              leading={<IdCard aria-hidden size={20} />}
              helper="SA ID (13 digits) or passport number."
              error={errors.id_number}
            />
            <Input
              variant="auth"
              label="Date of birth"
              name="date_of_birth"
              type="date"
              autoComplete="bday"
              required
              value={dob}
              onChange={handleDobChange}
              min="1900-01-01"
              max={todayInClinicTimezone()}
              error={errors.date_of_birth}
            />
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
              <fieldset className="flex flex-col gap-2 rounded-[12px] border border-border bg-surface p-3">
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
                      className="h-5 w-5 accent-[#037F74]"
                    />
                    {formatCalendarDate(iso)}
                  </label>
                ))}
              </fieldset>
            )}
          </div>

          <PasswordInput
            variant="auth"
            label="Password"
            name="password"
            autoComplete="new-password"
            required
            placeholder="Create a password"
            leading={<Lock aria-hidden size={20} />}
            // Figma asks for "a mix of letters, numbers and a symbol"; the rule actually enforced is length
            // alone, and stating a rule the system does not apply would be false.
            helper="At least 8 characters, not counting spaces."
            error={errors.password}
          />
          <PasswordInput
            variant="auth"
            label="Confirm password"
            name="confirm"
            autoComplete="new-password"
            required
            placeholder="Confirm your password"
            leading={<Lock aria-hidden size={20} />}
            error={errors.confirm}
          />

          {formError && (
            <p role="alert" className="text-sm font-semibold text-danger">
              {formError}
            </p>
          )}

          <button type="submit" className={`${BTN_PRIMARY} mt-2`} disabled={pending}>
            {pending ? 'Creating your account…' : 'Create account →'}
          </button>
        </form>

        <p className="text-base text-ink">
          Already have an account?{' '}
          <Link href="/login" className={LINK}>
            Log in
          </Link>
        </p>
      </div>
    </AuthShell>
  )
}
