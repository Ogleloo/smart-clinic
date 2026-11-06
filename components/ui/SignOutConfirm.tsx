'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { LogOut } from 'lucide-react'
import { logout } from '@/app/actions/auth'

/**
 * Confirmation step in front of the sign-out Server Action, shared by every surface that signs a person out
 * (patient sidebar and mobile profile page, nurse/reception/admin sidebars and mobile navs, both profile-settings
 * screens, the classic /nurse header, and the "use another account" button on /login).
 *
 * `logout` itself is untouched and still the only thing that runs on confirm — this component adds a step in
 * front of it, it does not reimplement it. Nothing here signs anyone out on its own.
 *
 * Progressive enhancement is deliberate and is why the trigger is still a real submit button inside a real
 * `<form action={logout}>`. Before hydration (or with JavaScript off) the button posts to the Server Action and
 * signs out exactly as it did before this component existed; once hydrated, onSubmit intercepts and opens the
 * dialog instead. The failure mode of the confirmation step is therefore "no confirmation", never "no way to
 * sign out" — which matters most on the shared clinic devices where /login tells people to sign out before
 * walking away.
 *
 * Styling is passed in rather than decided here: each surface already had its own trigger (a 52px sidebar row, a
 * 36px mobile icon button, a full-width danger outline button) and this must look identical to what it replaces,
 * so `formClassName`, `buttonClassName`, `ariaLabel` and `children` are copied from the markup it replaced.
 */
interface SignOutConfirmProps {
  /** Trigger contents — the icon and label the surface used before, unchanged. */
  children: React.ReactNode
  /** Classes for the wrapping form (layout: `px-4`, `shrink-0`, `w-full md:hidden`, …). */
  formClassName?: string
  /** Classes for the trigger button, so it renders exactly as the submit button it replaced. */
  buttonClassName?: string
  /** For triggers whose visible label is `sr-only` at small sizes (the mobile navs). */
  ariaLabel?: string
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

export function SignOutConfirm({ children, formClassName, buttonClassName, ariaLabel }: SignOutConfirmProps) {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // Several of these render on one page (a sidebar and a mobile nav are both mounted, one of them hidden by a
  // media query), so the ARIA ids have to be per-instance or they would collide and point at the wrong dialog.
  const titleId = useId()
  const descId = useId()

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    // Cancel takes focus, not Confirm: the safe choice is the one Enter and Space land on.
    cancelRef.current?.focus()
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        return
      }
      // Keep Tab inside the dialog while it is open.
      if (e.key !== 'Tab' || !dialogRef.current) return
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const first = items[0]!
      const last = items[items.length - 1]!
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, close])

  return (
    <>
      <form
        action={logout}
        className={formClassName}
        onSubmit={(e) => {
          // Hydrated: ask first. Not hydrated: this handler does not exist and the form posts to logout().
          e.preventDefault()
          setOpen(true)
        }}
      >
        <button type="submit" aria-label={ariaLabel} aria-haspopup="dialog" className={buttonClassName}>
          {children}
        </button>
      </form>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[rgba(2,16,24,0.48)] p-4"
          onClick={close}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="relative my-auto flex w-full max-w-[440px] flex-col items-center gap-4 rounded-lg bg-surface px-5 pb-8 pt-8 text-center shadow-[0_12px_32px_rgba(5,48,46,0.08)] outline-none sm:px-10"
          >
            <span className="flex size-[72px] items-center justify-center rounded-[24px] bg-[#FFF2E0]" aria-hidden>
              <LogOut size={28} className="text-[#B54708]" />
            </span>

            <h2 id={titleId} className="font-display text-[22px] font-semibold leading-7 text-ink">
              Sign out?
            </h2>
            <p id={descId} className="max-w-[360px] text-base leading-6 text-muted">
              You’ll need to sign in again to get back to this device.
            </p>

            <ConfirmButtons onCancel={close} cancelRef={cancelRef} />
          </div>
        </div>
      )}
    </>
  )
}

/**
 * The buttons live inside the confirm form so `useFormStatus` can report that form's pending state (the hook only
 * sees a form it is rendered within — the documented Next.js pattern). Both buttons are disabled while the action
 * is in flight so a second click cannot fire a second sign-out, and Cancel cannot strand a pending request.
 */
function ConfirmButtons({
  onCancel,
  cancelRef,
}: {
  onCancel: () => void
  cancelRef: React.RefObject<HTMLButtonElement | null>
}) {
  return (
    <form action={logout} className="mt-2 flex w-full flex-col-reverse gap-4 sm:flex-row">
      <ConfirmButtonsInner onCancel={onCancel} cancelRef={cancelRef} />
    </form>
  )
}

function ConfirmButtonsInner({
  onCancel,
  cancelRef,
}: {
  onCancel: () => void
  cancelRef: React.RefObject<HTMLButtonElement | null>
}) {
  const { pending } = useFormStatus()
  return (
    <>
      <button
        type="button"
        ref={cancelRef}
        onClick={onCancel}
        disabled={pending}
        className="inline-flex min-h-12 flex-1 items-center justify-center rounded-sm border-[1.5px] border-[#037F74] bg-surface px-5 text-sm font-semibold text-[#037F74] hover:bg-primary-50 disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="inline-flex min-h-12 flex-1 items-center justify-center rounded-sm border-[1.5px] border-[#B42318] bg-surface px-5 text-sm font-semibold text-[#B42318] hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Signing out…' : 'Sign Out'}
      </button>
    </>
  )
}
