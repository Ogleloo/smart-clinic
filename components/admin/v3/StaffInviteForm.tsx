'use client'

import { useActionState, useRef, useState, type FormEvent } from 'react'
import { Info, UserPlus, X } from 'lucide-react'
import { inviteStaffMember, type StaffInviteState } from '@/app/actions/admin'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  INVITABLE_ROLES,
  ROLE_LABELS,
  STAFF_INVITE_FIELD_ORDER,
  validateStaffInvite,
  type StaffInviteErrors,
} from '@/lib/staffInvitationValidation'

/**
 * Add Staff Member (Figma 168:412's "Button-Add-Staff" / "Add Staff Member"). The form stays collapsed until
 * it's asked for, matching Figma's single button in the toolbar row.
 *
 * The confirmation deliberately does NOT say an email was sent, because nothing sends one: this system has
 * no outbound mail, and admin_invite_staff() only writes a row. What the invitee receives is the ordinary
 * signup OTP, and only when they themselves register. So the confirmation shows the administrator exactly
 * what they now have to pass on, including the fact that the address must match character for character —
 * accept_staff_invitation() matches on the verified email, so a different address silently gets no role.
 */
export function StaffInviteForm({ registrationUrl }: { registrationUrl: string }) {
  const [open, setOpen] = useState(false)
  const [clientErrors, setClientErrors] = useState<StaffInviteErrors | null>(null)
  const [state, formAction, pending] = useActionState<StaffInviteState, FormData>(inviteStaffMember, {})
  const formRef = useRef<HTMLFormElement>(null)

  // Controlled, so a rejected submission keeps what was typed. React resets a <form action={...}> once the
  // action resolves, and the most likely rejection here — "An account already exists for this email address"
  // — is exactly the case where the administrator needs their input back to correct one field rather than
  // retype all three.
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<string>('nurse')

  const errors = clientErrors ?? state.fieldErrors ?? {}

  function reset() {
    setFullName('')
    setEmail('')
    setRole('nurse')
    setClientErrors(null)
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    const form = e.currentTarget
    const data = new FormData(form)
    const { errors: found, values } = validateStaffInvite({
      full_name: String(data.get('full_name') ?? ''),
      email: String(data.get('email') ?? ''),
      role: String(data.get('role') ?? ''),
    })
    if (values) {
      setClientErrors(null)
      return
    }
    e.preventDefault()
    setClientErrors(found)
    const first = STAFF_INVITE_FIELD_ORDER.find((f) => found[f])
    if (first) (form.elements.namedItem(first) as HTMLElement | null)?.focus()
  }

  if (state.invited) {
    return (
      <section className="flex flex-col gap-4 rounded-lg border border-primary-700 bg-primary-50 p-5" aria-labelledby="invite-recorded">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-primary-700">
            <Info size={20} aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <h3 id="invite-recorded" className="text-base font-semibold text-ink">
              Invitation recorded for {state.invited.full_name}
            </h3>
            <p className="text-sm text-muted">
              No email has been sent — this system doesn&rsquo;t send invitations. Pass these instructions to them yourself.
            </p>
          </div>
        </div>

        <ol className="flex flex-col gap-2 text-sm text-ink">
          <li className="flex gap-2">
            <span className="font-semibold text-primary-700">1.</span>
            <span>
              They register at <span className="font-mono text-ink">{registrationUrl}</span>
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-primary-700">2.</span>
            <span>
              They must use exactly this address: <span className="font-mono font-semibold text-ink">{state.invited.email}</span>
              <span className="block text-muted">A different address gets no {ROLE_LABELS[state.invited.role]} role — the invitation is matched on the verified email.</span>
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-primary-700">3.</span>
            <span>They verify the emailed code. Their {ROLE_LABELS[state.invited.role]} access is applied the moment that succeeds.</span>
          </li>
        </ol>

        <p className="text-xs text-muted">The invitation expires in 7 days, and appears under Pending invitations below until it&rsquo;s used.</p>

        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(true)
              reset()
            }}
          >
            Invite someone else
          </Button>
        </div>
      </section>
    )
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setOpen(true)}>
          <UserPlus size={18} className="mr-2" aria-hidden />
          Add Staff Member
        </Button>
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5" aria-labelledby="add-staff">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 id="add-staff" className="text-base font-semibold text-ink">
            Add a staff member
          </h3>
          <p className="text-sm text-muted">
            This records an invitation. The person registers themselves and their role is applied once they verify their email.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-subtle"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      <form ref={formRef} action={formAction} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <Input
          label="Full name"
          name="full_name"
          autoComplete="off"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          error={errors.full_name}
        />
        <Input
          label="Work email address"
          name="email"
          type="email"
          autoComplete="off"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs uppercase leading-[18px] text-muted">Role</legend>
          <div className="flex flex-wrap gap-4">
            {INVITABLE_ROLES.map((option) => (
              <label key={option} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="role"
                  value={option}
                  checked={role === option}
                  onChange={() => setRole(option)}
                  className="h-5 w-5 accent-primary-700"
                />
                {ROLE_LABELS[option]}
              </label>
            ))}
          </div>
          {errors.role && (
            <p role="alert" className="text-sm text-danger">
              {errors.role}
            </p>
          )}
          <p className="text-xs text-muted">
            Administrator accounts can&rsquo;t be created here — only nurses and receptionists.
          </p>
        </fieldset>

        {state.error && (
          <p role="alert" className="text-sm font-semibold text-danger">
            {state.error}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          {/* "Record", not "Send": nothing is emailed from here. See the component doc comment. */}
          <Button type="submit" variant="primary" loading={pending}>
            Record invitation
          </Button>
          <Button type="button" variant="tertiary" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    </section>
  )
}
