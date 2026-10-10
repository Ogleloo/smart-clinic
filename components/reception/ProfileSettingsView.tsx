'use client'

import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Info, KeyRound, LogOut } from 'lucide-react'
import { logout } from '@/app/actions/auth'
import type { ActionState } from '@/app/actions/profile'
import type { StaffProfileState } from '@/app/actions/receptionProfile'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { AVATAR_ACCEPT, checkAvatarFile } from '@/lib/avatarFile'
import { initials } from '@/lib/initials'

type SaveAction = (prev: StaffProfileState, formData: FormData) => Promise<StaffProfileState>
type PasswordAction = (prev: ActionState, formData: FormData) => Promise<ActionState>
type PhotoResult = { error?: string }

interface ProfileSettingsViewProps {
  fullName: string
  phone: string | null
  roleLabel: string
  clinicName: string | null
  /** Belongs to Supabase Auth, not `profiles`; read-only here (no verified email-change flow exists). */
  email: string
  saveAction: SaveAction
  passwordAction: PasswordAction
  /**
   * False until a photo bucket, column and policies exist (see
   * docs/PROPOSAL_profile_photos.md). While false, Upload is disabled and says
   * so — it never pretends to save. onUploadPhoto/onRemovePhoto/photoUrl are
   * only consulted when this is true.
   */
  photoUploadAvailable: boolean
  photoUrl?: string | null
  onUploadPhoto?: (file: File) => Promise<PhotoResult>
  onRemovePhoto?: () => Promise<PhotoResult>
}

const CARD = 'rounded-lg border border-border bg-surface shadow-[0_12px_32px_rgba(5,48,46,0.08)]'
const FIELD_LABEL = 'text-xs uppercase leading-[18px] text-muted'
const INPUT_BASE = 'h-12 w-full rounded-sm border border-border px-3.5 text-base'
const FIELD_INPUT = `${INPUT_BASE} bg-surface text-ink`
const READONLY_INPUT = `${INPUT_BASE} bg-subtle text-muted`
const BTN_SM = '!h-10 !min-h-10 !rounded-sm !px-4 !text-sm'
// Figma's #08B9A8 fill gives white text only 2.47:1 (and the theme's #039486, used by the shared primary
// Button, 3.76:1). #037F74 is the nearest shade of the same teal that clears WCAG AA for 14px text: 4.89:1
// (hover #026B62, 6.40:1). Scoped to this screen; the app-wide button colour is a separate decision.
const PRIMARY_ACTION = '!bg-[#037F74] hover:!bg-[#026B62] !text-white'
const SECONDARY_ACTION = '!border-[#037F74] !text-[#037F74]'
// Same reasoning for text: the theme's danger #FF4D4D is 3.27:1 on white and #039486 3.76:1.
const DANGER_TEXT = 'text-[#D12F2F]' // 5.05:1 on white
const SUCCESS_TEXT = 'text-[#037F74]' // 4.89:1 on white, 4.54:1 on primary-50

function Avatar({ name, photoUrl, className }: { name: string; photoUrl?: string | null; className: string }) {
  return photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- a user photo from a signed URL or a local blob preview, not a static asset
    <img src={photoUrl} alt="" className={`shrink-0 rounded-full object-cover ${className}`} />
  ) : (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-primary-500 text-base text-white ${className}`}
    >
      {initials(name) || '–'}
    </span>
  )
}

function ResultMessage({ state }: { state: { error?: string; success?: string } }) {
  if (state.error) {
    return (
      <p role="alert" className={`text-sm font-semibold ${DANGER_TEXT}`}>
        {state.error}
      </p>
    )
  }
  if (state.success) {
    return (
      <p role="status" className={`text-sm font-semibold ${SUCCESS_TEXT}`}>
        {state.success}
      </p>
    )
  }
  return null
}

export function ProfileSettingsView(props: ProfileSettingsViewProps) {
  const { roleLabel, clinicName, email, saveAction, passwordAction } = props
  const [state, formAction, pending] = useActionState<StaffProfileState, FormData>(saveAction, {})

  const [saved, setSaved] = useState({ fullName: props.fullName, phone: props.phone ?? '' })
  const [fullName, setFullName] = useState(props.fullName)
  const [phone, setPhone] = useState(props.phone ?? '')
  const [seenState, setSeenState] = useState(state)
  const [resultStale, setResultStale] = useState(false)
  const inFlight = useRef(false)

  // A new action result: adopt what the server actually stored (trimmed name,
  // normalised phone) and show its message. Derived during render, not in an effect.
  if (state !== seenState) {
    setSeenState(state)
    setResultStale(false)
    if (state.saved) {
      setSaved(state.saved)
      setFullName(state.saved.fullName)
      setPhone(state.saved.phone)
    }
  }

  useEffect(() => {
    if (!pending) inFlight.current = false
  }, [pending])

  const dirty = fullName !== saved.fullName || phone !== saved.phone

  function edit(setter: (v: string) => void, value: string) {
    setter(value)
    setResultStale(true)
  }

  function cancel() {
    setFullName(saved.fullName)
    setPhone(saved.phone)
    setResultStale(true)
  }

  // Photo state lives here so the form avatar and the preview card stay in step.
  const [photoUrl, setPhotoUrl] = useState<string | null>(props.photoUrl ?? null)
  const [localPreview, setLocalPreview] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const photoErrorId = useId()

  // Object URLs this component created. One is released only when it stops being shown: replaced by a newer
  // photo, removed, a failed upload's preview, or on unmount — never at the moment it is promoted from
  // "uploading preview" to "saved photo" (an earlier version did exactly that and left the saved photo
  // pointing at a revoked URL). URLs from the server (signed URLs) are never in this set, so never revoked.
  const ownedUrls = useRef(new Set<string>())
  const release = (url: string | null) => {
    if (url && ownedUrls.current.delete(url)) URL.revokeObjectURL(url)
  }
  useEffect(() => {
    const urls = ownedUrls.current
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u))
      urls.clear()
    }
  }, [])

  async function onFile(file: File | undefined) {
    if (!file || !props.onUploadPhoto) return
    setPhotoError(null)
    const check = await checkAvatarFile(file)
    if (!check.ok) {
      setPhotoError(check.error)
      return
    }
    // Local preview only: nothing counts as saved until the backend says so. The buttons are disabled while
    // busy, so photoUrl can't change underneath this await.
    const previous = photoUrl
    const preview = URL.createObjectURL(file)
    ownedUrls.current.add(preview)
    setLocalPreview(preview)
    setPhotoBusy(true)
    const result = await props.onUploadPhoto(file)
    setPhotoBusy(false)
    setLocalPreview(null)
    if (result.error) {
      setPhotoError(result.error)
      release(preview)
      return
    }
    setPhotoUrl(preview)
    release(previous)
  }

  async function onRemove() {
    if (!props.onRemovePhoto) return
    setPhotoError(null)
    setPhotoBusy(true)
    const result = await props.onRemovePhoto()
    setPhotoBusy(false)
    if (result.error) {
      setPhotoError(result.error)
      return
    }
    release(photoUrl)
    setPhotoUrl(null)
  }

  const canUpload = props.photoUploadAvailable && !!props.onUploadPhoto
  const shownPhoto = localPreview ?? photoUrl
  const hasSavedPhoto = props.photoUploadAvailable && !!photoUrl
  const previewName = fullName.trim() || saved.fullName

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_416px]">
      <section aria-labelledby="profile-information" className={`${CARD} p-[27px] pb-[59px] shadow-[0_8px_20px_rgba(5,48,46,0.05)]`}>
        <h2 id="profile-information" className="font-display text-[22px] font-semibold leading-7 text-ink">
          Profile Information
        </h2>
        <p className="text-base text-muted">Update your personal details and contact information.</p>
        <div className="mt-1.5 h-px bg-border" />

        <p className={`mt-[17px] ${FIELD_LABEL}`}>Profile photo</p>
        <div className="mt-0.5 flex flex-col gap-4 sm:flex-row">
          <Avatar name={previewName} photoUrl={shownPhoto} className="size-[100px]" />
          <div className="flex min-w-0 flex-col gap-1 sm:pt-3">
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInput}
                type="file"
                accept={AVATAR_ACCEPT}
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  void onFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
              <Button
                type="button"
                className={`${BTN_SM} ${PRIMARY_ACTION} sm:w-[200px]`}
                disabled={!canUpload || photoBusy}
                loading={photoBusy}
                aria-describedby={photoErrorId}
                onClick={() => fileInput.current?.click()}
              >
                Upload / Change Photo
              </Button>
              <Button
                type="button"
                variant="secondary"
                className={`${BTN_SM} w-[116px] !px-3 whitespace-nowrap !border-border !text-muted disabled:!opacity-45`}
                disabled={!hasSavedPhoto || photoBusy}
                onClick={() => void onRemove()}
              >
                Remove Photo
              </Button>
            </div>
            <p className="text-xs leading-[18px] text-muted">JPG or PNG, max 5 MB.</p>
            {!props.photoUploadAvailable && (
              <p className="text-xs leading-[18px] text-muted">
                Photo upload isn&rsquo;t available yet. Your initials are shown instead.
              </p>
            )}
            <p id={photoErrorId} role="alert" className={photoError ? `text-xs font-semibold ${DANGER_TEXT}` : 'sr-only'}>
              {photoError ?? ''}
            </p>
          </div>
        </div>

        <form
          action={formAction}
          onSubmit={(e) => {
            // Two submits can land before React re-renders `pending`; this closes that gap.
            if (inFlight.current) e.preventDefault()
            else inFlight.current = true
          }}
          noValidate
        >
          <div className="mt-[22px] flex flex-col">
            <label htmlFor="full_name" className={FIELD_LABEL}>
              Full name
            </label>
            <input
              id="full_name"
              name="full_name"
              autoComplete="name"
              maxLength={120}
              required
              value={fullName}
              onChange={(e) => edit(setFullName, e.target.value)}
              className={FIELD_INPUT}
            />
          </div>

          <div className="mt-3.5 grid gap-x-8 gap-y-3.5 md:grid-cols-2">
            <div className="flex min-w-0 flex-col">
              <label htmlFor="role" className={FIELD_LABEL}>
                Role
              </label>
              <input id="role" value={roleLabel} readOnly aria-readonly className={READONLY_INPUT} />
            </div>
            <div className="flex min-w-0 flex-col">
              <label htmlFor="clinic" className={FIELD_LABEL}>
                Clinic
              </label>
              <input id="clinic" value={clinicName ?? ''} placeholder="—" readOnly aria-readonly className={READONLY_INPUT} />
            </div>
          </div>

          <div className="mt-3.5 flex flex-col">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <label htmlFor="email" className={FIELD_LABEL}>
                Email address
              </label>
              <span id="email-note" className="text-xs leading-[18px] text-muted">
                Your email is your login and can&rsquo;t be changed here.
              </span>
            </div>
            <input id="email" type="email" value={email} readOnly aria-readonly aria-describedby="email-note" className={READONLY_INPUT} />
          </div>

          <div className="mt-3.5 flex flex-col">
            <label htmlFor="phone" className={FIELD_LABEL}>
              Phone number
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={30}
              placeholder="+27 82 123 4567"
              value={phone}
              onChange={(e) => edit(setPhone, e.target.value)}
              className={FIELD_INPUT}
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-3 border-t border-border pt-[19px]">
            <Button type="button" variant="secondary" className={`!h-12 !rounded-sm w-[148px] ${SECONDARY_ACTION}`} disabled={!dirty || pending} onClick={cancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              className={`!h-12 !rounded-sm w-[220px] ${PRIMARY_ACTION}`}
              disabled={!dirty}
              loading={pending}
            >
              Save Changes
            </Button>
            <div className="min-w-0 basis-full sm:basis-auto sm:pl-1">{!resultStale && <ResultMessage state={state} />}</div>
          </div>
        </form>
      </section>

      <aside className="flex flex-col gap-4">
        <section aria-labelledby="avatar-preview" className={`${CARD} flex flex-col items-center p-[23px] pb-[15px]`}>
          <div className="self-start">
            <h2 id="avatar-preview" className="text-base leading-6 text-ink">
              Avatar Preview
            </h2>
            <p className="text-xs leading-[18px] text-muted">How your avatar appears across the system.</p>
          </div>
          <div className="mt-2 h-px w-full bg-border" />
          <Avatar name={previewName} photoUrl={shownPhoto} className="mt-[17px] size-[120px]" />
          <p className="mt-4 max-w-full break-words text-center text-base leading-6 text-ink">{previewName}</p>
          <p className="-mt-0.5 max-w-full break-words text-center text-xs leading-[18px] text-muted">
            {roleLabel}
            {clinicName ? ` • ${clinicName}` : ''}
          </p>
          <span className={`mt-2.5 rounded-[12px] bg-primary-50 px-4 py-1 text-xs leading-[18px] ${SUCCESS_TEXT}`}>
            Initials: {initials(previewName) || '–'}
          </span>
        </section>

        <section aria-labelledby="photo-and-initials" className="rounded-lg border border-border bg-primary-50 p-[19px] pb-[21px] shadow-[0_12px_32px_rgba(5,48,46,0.08)]">
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-primary-700">
              <Info size={22} aria-hidden />
            </span>
            <h2 id="photo-and-initials" className="text-base leading-6 text-ink">
              Photo and initials
            </h2>
          </div>
          <div className="mt-2.5 h-px bg-border" />
          <p className="mt-[11px] text-xs leading-[18px] text-muted">
            Your photo appears on your profile. If you remove it, we&rsquo;ll show your initials.
          </p>
        </section>

        <QuickActions passwordAction={passwordAction} />
      </aside>
    </div>
  )
}

function QuickActions({ passwordAction }: { passwordAction: PasswordAction }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const row =
    'flex h-11 w-full items-center gap-2.5 rounded-sm border border-border bg-surface px-[11px] text-left text-base text-ink hover:bg-paper'

  return (
    <section aria-labelledby="quick-actions" className={`${CARD} p-[23px] pb-[35px]`}>
      <h2 id="quick-actions" className="text-base leading-6 text-ink">
        Quick Actions
      </h2>
      <div className="mt-1 h-px bg-border" />
      <div className="mt-[13px] flex flex-col gap-2.5">
        <button type="button" className={row} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
          <KeyRound size={22} aria-hidden className="shrink-0 text-primary-700" />
          Change Password
          <ChevronDown size={16} aria-hidden className={`ml-auto mr-1 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        <div id={panelId} hidden={!open}>
          {open && <PasswordPanel action={passwordAction} />}
        </div>

        {/* Same logout() Server Action the sidebar uses. No chevron: Figma's would promise a menu that doesn't exist. */}
        <form action={logout}>
          <button type="submit" className={row}>
            <LogOut size={22} aria-hidden className="shrink-0" />
            Sign Out
          </button>
        </form>
      </div>
    </section>
  )
}

function PasswordPanel({ action }: { action: PasswordAction }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {})
  const inFlight = useRef(false)
  const first = useRef<HTMLDivElement>(null)

  useEffect(() => {
    first.current?.querySelector('input')?.focus()
  }, [])
  useEffect(() => {
    if (!pending) inFlight.current = false
  }, [pending])

  return (
    // key on the success message clears the fields once a change succeeds.
    <form
      key={state.success ?? 'form'}
      action={formAction}
      onSubmit={(e) => {
        if (inFlight.current) e.preventDefault()
        else inFlight.current = true
      }}
      className="flex flex-col gap-3 rounded-sm border border-border bg-paper p-3"
      aria-label="Change password"
    >
      <div ref={first} className="flex flex-col gap-3">
        <Input label="Current password" name="current_password" type="password" autoComplete="current-password" required />
        <Input label="New password" name="new_password" type="password" autoComplete="new-password" required helper="At least 8 characters." />
        <Input label="Confirm new password" name="confirm_password" type="password" autoComplete="new-password" required />
      </div>
      <ResultMessage state={state} />
      <Button type="submit" className={`!rounded-sm ${PRIMARY_ACTION}`} loading={pending}>
        Update password
      </Button>
    </form>
  )
}
