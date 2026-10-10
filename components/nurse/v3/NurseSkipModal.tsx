'use client'

import { useActionState, useCallback, useEffect, useRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { skipWaitingPatient, type WaitingSkipState } from '@/app/actions/nurse'
import type { MyQueueRow } from '@/lib/nurseQueue'

interface NurseSkipModalProps {
  row: MyQueueRow
  onClose: () => void
  onSkipped: (token: string) => void
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Figma frame 164:268 "Skip Patient" (600px card, 72px warning badge, patient card, Cancel / Skip Patient).
 *
 * Two deliberate differences from the frame:
 *  - Figma says "The patient will remain in the queue." That is false: skip_patient() marks the entry skipped
 *    and it leaves the waiting queue. The copy says what actually happens.
 *  - Figma's "Reason for skipping" and "Additional notes" are omitted. skip_patient(p_queue_entry_id,
 *    p_no_show) has nowhere to store either, and a field whose value is silently thrown away is worse than none.
 *
 * Calls skipWaitingPatient, which re-checks on the server that the entry is still waiting (a nurse's
 * skip_patient would otherwise also close an in-progress consultation).
 */
export function NurseSkipModal({ row, onClose, onSkipped }: NurseSkipModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [state, formAction, pending] = useActionState<WaitingSkipState, FormData>(skipWaitingPatient, {})
  // Two clicks can land before React re-renders `pending`; the ref closes that gap.
  const inFlight = useRef(false)

  const close = useCallback(() => {
    if (!pending) onClose()
  }, [pending, onClose])

  useEffect(() => {
    if (!pending) inFlight.current = false
  }, [pending])

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    return () => previouslyFocused?.focus?.()
  }, [])

  useEffect(() => {
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
  }, [close])

  useEffect(() => {
    if (state.skippedToken) onSkipped(state.skippedToken)
  }, [state.skippedToken, onSkipped])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[rgba(2,16,24,0.48)] p-4" onClick={close}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="skip-modal-title"
        aria-describedby="skip-modal-desc"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="relative my-auto flex w-full max-w-[600px] flex-col items-center gap-4 rounded-lg bg-surface px-5 pb-8 pt-8 shadow-[0_12px_32px_rgba(5,48,46,0.08)] outline-none sm:px-10"
      >
        <button
          type="button"
          onClick={close}
          disabled={pending}
          aria-label="Close dialog"
          className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-sm bg-[#F0F4F8] text-ink hover:bg-border disabled:opacity-50"
        >
          <X size={14} aria-hidden />
        </button>

        <span className="flex size-[72px] items-center justify-center rounded-[24px] bg-[#FFF2E0]" aria-hidden>
          <AlertTriangle size={28} className="text-[#B54708]" />
        </span>

        <h2 id="skip-modal-title" className="font-display text-[22px] font-semibold leading-7 text-ink">
          Skip Patient
        </h2>
        <div id="skip-modal-desc" className="max-w-[440px] text-center text-base leading-6 text-muted">
          <p>Are you sure you want to skip this patient?</p>
          <p>
            The patient will be marked as skipped and removed from the active waiting queue. Their history will be
            retained.
          </p>
        </div>

        <div className="w-full rounded-lg border border-border bg-surface px-5 py-4 shadow-[0_4px_12px_rgba(5,48,46,0.05)]">
          <p className="text-base leading-6 text-[#037F74]">{row.token}</p>
          <p className="break-words text-base leading-6 text-ink">{row.patientName}</p>
          {row.serviceName && <p className="text-xs leading-[18px] text-muted">{row.serviceName}</p>}
        </div>

        {state.error && (
          <p role="alert" className="w-full rounded-md bg-danger-bg px-4 py-3 text-sm font-semibold text-[#B42318]">
            {state.error}
          </p>
        )}

        <form
          action={formAction}
          onSubmit={(e) => {
            if (inFlight.current) e.preventDefault()
            else inFlight.current = true
          }}
          className="mt-2 flex w-full flex-col-reverse gap-4 sm:flex-row"
        >
          <input type="hidden" name="queue_entry_id" value={row.queueEntryId} />
          <button
            type="button"
            onClick={close}
            disabled={pending}
            className="inline-flex min-h-12 flex-1 items-center justify-center rounded-sm border-[1.5px] border-[#037F74] bg-surface px-5 text-sm font-semibold text-[#037F74] hover:bg-primary-50 disabled:opacity-50 sm:max-w-[242px]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className="inline-flex min-h-12 flex-1 items-center justify-center rounded-sm border-[1.5px] border-[#B42318] bg-surface px-5 text-sm font-semibold text-[#B42318] hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Skipping…' : 'Skip Patient'}
          </button>
        </form>
      </div>
    </div>
  )
}
