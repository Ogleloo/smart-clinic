'use client'

import { useActionState, useCallback, useEffect, useRef } from 'react'
import { SkipForward, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { skipQueueEntry, type SkipState } from '@/app/actions/reception'
import type { QueueRow } from './ServiceQueueSync'

interface SkipPatientModalProps {
  entry: QueueRow
  onClose: () => void
  onSkipped: (token: string) => void
}

/**
 * Figma frame 114:1204. The Figma "Reason (optional)" field is omitted:
 * skip_patient()'s signature (`p_queue_entry_id uuid, p_no_show boolean
 * default false`) has nowhere to persist a reason, and a field whose value
 * is silently discarded is worse than no field.
 */
export function SkipPatientModal({ entry, onClose, onSkipped }: SkipPatientModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [state, formAction, pending] = useActionState<SkipState, FormData>(skipQueueEntry, {})

  const inFlight = useRef(false)

  const close = useCallback(() => {
    if (!pending) onClose()
  }, [pending, onClose])

  useEffect(() => {
    if (!pending) inFlight.current = false
  }, [pending])

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [close])

  useEffect(() => {
    if (state.skippedToken) onSkipped(state.skippedToken)
  }, [state.skippedToken, onSkipped])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(5,20,26,0.5)] p-4"
      onClick={close}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="skip-modal-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-[600px] flex-col items-center gap-5 rounded-xl border border-border bg-surface p-10 shadow-[0_12px_16px_rgba(5,48,46,0.08)] outline-none"
      >
        <button
          type="button"
          onClick={close}
          disabled={pending}
          aria-label="Close dialog"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-paper hover:text-ink"
        >
          <X size={20} aria-hidden />
        </button>

        <span className="flex h-[72px] w-[72px] items-center justify-center rounded-3xl bg-primary-50">
          <SkipForward size={28} className="text-primary-700" aria-hidden />
        </span>

        <h2 id="skip-modal-title" className="font-display text-xl font-semibold text-ink">
          Skip patient
        </h2>
        <p className="text-center text-base text-muted">Are you sure you want to skip this waiting patient?</p>

        <div className="flex w-full items-center gap-4 rounded-xl bg-primary-50/60 p-4">
          <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-primary-50">
            <Users size={20} className="text-primary-700" aria-hidden />
          </span>
          <div className="flex flex-col text-base">
            <span className="font-medium text-ink">
              {entry.token} &middot; {entry.patient_name}
            </span>
            <span className="text-muted">
              {entry.serviceName} &middot; {entry.waiting_minutes} min wait
            </span>
          </div>
        </div>

        {state.error && (
          <p role="alert" className="w-full rounded-lg bg-danger-bg px-4 py-3 text-left text-sm text-danger">
            {state.error}
          </p>
        )}

        <form
          action={formAction}
          onSubmit={(e) => {
            // Two clicks can land before React re-renders `pending`; the ref closes that gap.
            if (inFlight.current) e.preventDefault()
            else inFlight.current = true
          }}
          className="flex w-full gap-4"
        >
          <input type="hidden" name="queue_entry_id" value={entry.queue_entry_id} />
          <Button type="button" variant="secondary" fullWidth onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="danger-outline" fullWidth loading={pending}>
            <SkipForward size={16} className="mr-2 inline" aria-hidden />
            Skip patient
          </Button>
        </form>
      </div>
    </div>
  )
}
