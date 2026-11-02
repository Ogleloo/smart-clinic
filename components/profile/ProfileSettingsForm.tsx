'use client'

import { useActionState, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ChevronDown, KeyRound, LogOut } from 'lucide-react'
import { logout } from '@/app/actions/auth'
import { updateProfile, changePassword, type ActionState } from '@/app/actions/profile'
import {
  profileEditInputFrom,
  validateProfileEdit,
  PROFILE_EDIT_FIELD_ORDER,
  type ProfileEditCurrent,
  type ProfileEditErrors,
  type ProfileEditInput,
} from '@/lib/profileEditValidation'
import type { DocumentType } from '@/lib/registrationValidation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { LinkButton } from '@/components/ui/LinkButton'
import { initials } from '@/lib/initials'

const ID_NUMBER_DIGITS = 13
const CAPTION = 'text-xs uppercase leading-[18px] text-muted'

/**
 * Which field can even DISPLAY the existing value without the South African ID field's digit filter mangling
 * it — not a validation decision (an untouched value is never re-validated regardless of which field shows it;
 * see validateProfileEdit in lib/profileEditValidation.ts), only a display one. A legacy value that isn't
 * exactly 13 digits would be silently cut down to whatever digits it happens to contain if shown in the South
 * African ID field, so it starts in Passport instead — the one field that can hold it unmodified.
 */
function initialDocumentType(idNumber: string | null): DocumentType {
  return idNumber && !/^\d{13}$/.test(idNumber) ? 'passport' : 'sa_id'
}

interface ProfileSettingsFormProps {
  fullName: string
  phone: string | null
  dateOfBirth: string | null
  idNumber: string | null
  email: string
  roleLabel: string
  clinicName: string | null
  today: string
}

function FormMessage({ state, quiet }: { state: ActionState; quiet: boolean }) {
  if (quiet) return null
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

/**
 * Profile Information card (Figma 222:2091) — editable details, the disabled photo row, and Save/Cancel.
 *
 * Figma shows five fields: full name, role, clinic, email, phone. The account also needs date of birth and
 * an ID/passport number — registration requires both, handle_new_user() stores them, and the dashboard's wait
 * estimate and the "Complete your profile" notice both depend on them — so, the same way registration adds two
 * fields beyond its own Figma frame, they stay here too, below the fields Figma does show.
 *
 * The ID/passport field is a South African ID / Passport choice, not a single ambiguous field, matching
 * registration (PR #45). Which radio starts selected only decides which of the two fields can DISPLAY an
 * existing value without its digit filter mangling it (initialDocumentType, below) — it is not a validation
 * decision: a value the person never touched is written back to the database exactly as it already was,
 * never re-validated against today's stricter rule and never silently cleared, whichever field happened to
 * show it. Switching document type by hand always starts the field blank — see lib/profileEditValidation.ts.
 */
export function ProfileSettingsForm(props: ProfileSettingsFormProps) {
  // useActionState lives here, in the component instance that never remounts, so a save's result (the
  // success message, or a server-side field error) survives the inner component remounting below it. Only
  // the per-field editing state — which SHOULD reset to the freshly saved values — lives in the inner
  // component, keyed on those values so a successful save (new props, once the page revalidates) remounts it.
  const [state, formAction, pending] = useActionState<ActionState, FormData>(updateProfile, {})
  return (
    <ProfileSettingsFormInner
      key={[props.fullName, props.phone, props.dateOfBirth, props.idNumber].join('|')}
      {...props}
      state={state}
      formAction={formAction}
      pending={pending}
    />
  )
}

type ProfileSettingsFormInnerProps = ProfileSettingsFormProps & {
  state: ActionState
  formAction: (payload: FormData) => void
  pending: boolean
}

function ProfileSettingsFormInner({
  fullName,
  phone,
  dateOfBirth,
  idNumber,
  email,
  roleLabel,
  clinicName,
  today,
  state,
  formAction,
  pending,
}: ProfileSettingsFormInnerProps) {
  const [clientErrors, setClientErrors] = useState<ProfileEditErrors | null>(null)
  const [documentType, setDocumentType] = useState<DocumentType>(() => initialDocumentType(idNumber))
  const [idValue, setIdValue] = useState(idNumber ?? '')
  const [dobValue, setDobValue] = useState(dateOfBirth ?? '')
  const formRef = useRef<HTMLFormElement>(null)

  // What the database holds right now, for the two fields that carry a rule stricter than when some existing
  // profiles were first saved. Stable for this component's lifetime — a save remounts the whole form (the key
  // above) with fresh props once the page revalidates, so this never goes stale underneath an open edit.
  const current: ProfileEditCurrent = { id_number: idNumber, date_of_birth: dateOfBirth }

  /** Mirrors the registration page's recheck(): re-validates on every change, but only once something has
   * actually been submitted (client-side or server-side) — see app/(auth)/register/page.tsx for the full
   * reasoning. Nothing here is flagged before the first attempt. */
  function recheck(partial: Partial<ProfileEditInput> = {}) {
    if ((clientErrors === null && !state.fieldErrors) || !formRef.current) return
    const data = new FormData(formRef.current)
    const input: ProfileEditInput = {
      ...profileEditInputFrom(data),
      document_type: documentType,
      id_number: idValue,
      date_of_birth: dobValue,
      ...partial,
    }
    const { errors } = validateProfileEdit(input, current, today)
    setClientErrors(errors)
  }

  function handleFieldChange() {
    recheck()
  }

  function handleDocumentTypeChange(type: DocumentType) {
    setDocumentType(type)
    // Different value shapes (digits only vs. letters and digits); carrying one into the other is never
    // meaningful, and switching never infers which kind an existing value was.
    setIdValue('')
    // Clears a stale id_number error regardless of where it came from — a client-side attempt (clientErrors)
    // or a server round-trip (state.fieldErrors, read when clientErrors is still null because nothing has
    // failed on the client yet — e.g. the very first submit went straight to the server with no client-side
    // check in between). Switching document type always starts the field blank, so neither source's complaint
    // about the OLD value says anything about the new, empty one. Every OTHER field's error — whichever source
    // it came from — is carried over untouched; a genuine, unrelated failure is never hidden by this.
    const base = clientErrors ?? state.fieldErrors ?? {}
    if (!('id_number' in base)) return
    const rest = { ...base }
    delete rest.id_number
    setClientErrors(rest)
  }

  function handleIdChange(e: ChangeEvent<HTMLInputElement>) {
    if (documentType === 'sa_id') {
      const digits = e.target.value.replace(/\D/g, '').slice(0, ID_NUMBER_DIGITS)
      setIdValue(digits)
      recheck({ id_number: digits })
    } else {
      setIdValue(e.target.value)
      recheck({ id_number: e.target.value })
    }
  }

  function handleDobChange(e: ChangeEvent<HTMLInputElement>) {
    setDobValue(e.target.value)
    recheck({ date_of_birth: e.target.value })
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    const form = e.currentTarget
    const data = new FormData(form)
    const { errors } = validateProfileEdit(profileEditInputFrom(data), current, today)
    const first = PROFILE_EDIT_FIELD_ORDER.find((f) => errors[f])
    if (!first) {
      setClientErrors(null)
      return
    }
    e.preventDefault()
    setClientErrors(errors)
    ;(form.elements.namedItem(first) as HTMLElement | null)?.focus()
  }

  const errors = clientErrors ?? state.fieldErrors ?? {}
  const formError = state.error && !state.fieldErrors ? state.error : undefined

  return (
    <div className="flex flex-col gap-4">
      {/* Figma shows Upload / Remove Photo as live controls. There is no photo column or storage bucket behind
          them (docs/PROPOSAL_profile_photos.md is a proposal only — not approved, not applied, no migration,
          no bucket, no secret key), so both stay disabled and say so. The initials preview is the real,
          working fallback, not a placeholder standing in for a future feature. */}
      <div className="flex flex-col gap-1.5">
        <p className={CAPTION}>Profile photo</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <span
            className="flex size-[100px] shrink-0 items-center justify-center rounded-[24px] bg-primary-700 font-display text-[22px] font-semibold text-white"
            aria-hidden
          >
            {initials(fullName) || '–'}
          </span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled className="w-[200px]">
                Upload / Change Photo
              </Button>
              <Button type="button" variant="secondary" disabled className="w-[116px] !px-3">
                Remove Photo
              </Button>
            </div>
            <p className="text-xs leading-[18px] text-muted">JPG or PNG, max 5 MB.</p>
            <p className="text-xs leading-[18px] text-muted">Photo upload isn&rsquo;t available yet. Your initials are shown instead.</p>
          </div>
        </div>
      </div>

      <div className="h-px bg-border" />

      <form ref={formRef} action={formAction} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <Input
          label="Full name"
          name="full_name"
          autoComplete="name"
          required
          defaultValue={fullName}
          onChange={handleFieldChange}
          error={errors.full_name}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input label="Role" name="role_readonly" value={roleLabel} readOnly disabled aria-readonly />
          <Input label="Clinic" name="clinic_readonly" value={clinicName ?? ''} placeholder="—" readOnly disabled aria-readonly />
        </div>

        <Input
          label="Email address"
          name="email_readonly"
          type="email"
          value={email}
          readOnly
          disabled
          aria-readonly
          helper="Your email is your login and can’t be changed here."
        />

        <Input
          label="Phone number"
          name="phone"
          type="tel"
          autoComplete="tel"
          defaultValue={phone ?? ''}
          placeholder="+27 82 555 0134"
          onChange={handleFieldChange}
          error={errors.phone}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className={CAPTION}>Identification</legend>
          <div className="flex flex-wrap gap-4">
            {(
              [
                ['sa_id', 'South African ID'],
                ['passport', 'Passport'],
              ] as const
            ).map(([type, label]) => (
              <label key={type} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="document_type"
                  value={type}
                  checked={documentType === type}
                  onChange={() => handleDocumentTypeChange(type)}
                  className="h-5 w-5 accent-primary-700"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {documentType === 'sa_id' ? (
            <Input
              label="South African ID number"
              name="id_number"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={idValue}
              onChange={handleIdChange}
              placeholder="13-digit ID number"
              helper={idValue ? `${idValue.length}/${ID_NUMBER_DIGITS} digits` : 'Optional.'}
              error={errors.id_number}
            />
          ) : (
            <Input
              label="Passport number"
              name="id_number"
              type="text"
              autoComplete="off"
              value={idValue}
              onChange={handleIdChange}
              maxLength={20}
              placeholder="Passport number"
              helper="Optional. Letters and numbers, 6–20 characters."
              error={errors.id_number}
            />
          )}
          <Input
            label="Date of birth"
            name="date_of_birth"
            type="date"
            autoComplete="bday"
            min="1900-01-01"
            max={today}
            value={dobValue}
            onChange={handleDobChange}
            helper="Optional."
            error={errors.date_of_birth}
          />
        </div>

        <div className="h-px bg-border" />

        <FormMessage state={{ error: formError, success: state.success }} quiet={!!clientErrors} />

        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={pending}>
            Save Changes
          </Button>
          <LinkButton href="/profile" variant="secondary">
            Cancel
          </LinkButton>
        </div>
      </form>
    </div>
  )
}

/**
 * Quick Actions card (Figma 222:2091): Change Password as an accessible expandable panel (never its own
 * full-page section — the password rules are unchanged, see app/actions/profile.ts's changePassword()), plus
 * Sign Out. The password fields are "Update password" rather than "Change password" so the toggle and the
 * submit button inside it never share an accessible name.
 */
export function QuickActions() {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const row = 'flex h-11 w-full items-center gap-2.5 rounded-sm border border-border bg-surface px-3 text-left text-base text-ink hover:bg-paper'

  return (
    <div className="flex flex-col gap-2.5">
      <button type="button" className={row} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        <KeyRound size={20} aria-hidden className="shrink-0 text-primary-700" />
        Change Password
        <ChevronDown size={16} aria-hidden className={`ml-auto mr-1 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <div id={panelId} hidden={!open}>
        {open && (
          <div className="rounded-sm border border-border bg-paper p-3">
            <ChangePasswordForm />
          </div>
        )}
      </div>

      {/* Same logout() Server Action the sidebar uses. */}
      <form action={logout}>
        <button type="submit" className={`${row} text-danger`}>
          <LogOut size={20} aria-hidden className="shrink-0" />
          Sign Out
        </button>
      </form>
    </div>
  )
}

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(changePassword, {})

  return (
    // key on the success message resets the fields once a change succeeds.
    <form key={state.success ?? 'form'} action={formAction} aria-label="Change password" className="flex flex-col gap-4">
      <Input label="Current password" name="current_password" type="password" autoComplete="current-password" required autoFocus />
      <Input
        label="New password"
        name="new_password"
        type="password"
        autoComplete="new-password"
        required
        helper="At least 8 characters."
      />
      <Input label="Confirm new password" name="confirm_password" type="password" autoComplete="new-password" required />
      <FormMessage state={state} quiet={false} />
      <div>
        <Button type="submit" variant="secondary" loading={pending}>
          Update password
        </Button>
      </div>
    </form>
  )
}
