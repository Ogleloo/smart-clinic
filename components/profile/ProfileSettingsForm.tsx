'use client'

import { useActionState } from 'react'
import { updateProfile, changePassword, type ActionState } from '@/app/actions/profile'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { LinkButton } from '@/components/ui/LinkButton'

interface ProfileSettingsFormProps {
  fullName: string
  phone: string | null
  dateOfBirth: string | null
  idNumber: string | null
  email: string
  today: string
}

function FormMessage({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-base font-semibold text-danger">
        {state.error}
      </p>
    )
  }
  if (state.success) {
    return (
      <p role="status" className="text-base font-semibold text-primary-700">
        {state.success}
      </p>
    )
  }
  return null
}

export function ProfileSettingsForm({ fullName, phone, dateOfBirth, idNumber, email, today }: ProfileSettingsFormProps) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(updateProfile, {})

  return (
    // Keyed on the saved values: after a save revalidates, the inputs
    // remount showing what was actually stored (e.g. an ID number
    // normalised to upper case without spaces), not just what was typed.
    <form
      key={[fullName, phone, dateOfBirth, idNumber].join('|')}
      action={formAction}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input label="Full name" name="full_name" autoComplete="name" required defaultValue={fullName} />
        <Input label="Phone" name="phone" type="tel" autoComplete="tel" defaultValue={phone ?? ''} placeholder="+27 82 555 0134" />
        <Input
          label="Date of birth"
          name="date_of_birth"
          type="date"
          autoComplete="bday"
          min="1900-01-01"
          max={today}
          defaultValue={dateOfBirth ?? ''}
          helper="Optional."
        />
        <Input
          label="ID or passport number"
          name="id_number"
          autoComplete="off"
          defaultValue={idNumber ?? ''}
          helper="Optional. 6–20 letters or digits."
        />
        <Input
          label="Email"
          name="email_readonly"
          type="email"
          value={email}
          readOnly
          disabled
          helper="Your email is your login and can’t be changed here."
        />
      </div>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={pending}>
          Save Changes
        </Button>
        <LinkButton href="/profile" variant="secondary">
          Cancel
        </LinkButton>
      </div>
    </form>
  )
}

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(changePassword, {})

  return (
    // key on the success message resets the fields once a change succeeds.
    <form key={state.success ?? 'form'} action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4">
        <Input label="Current password" name="current_password" type="password" autoComplete="current-password" required />
        <Input
          label="New password"
          name="new_password"
          type="password"
          autoComplete="new-password"
          required
          helper="At least 8 characters."
        />
        <Input label="Confirm new password" name="confirm_password" type="password" autoComplete="new-password" required />
      </div>
      <FormMessage state={state} />
      <div>
        <Button type="submit" variant="secondary" loading={pending}>
          Change password
        </Button>
      </div>
    </form>
  )
}
