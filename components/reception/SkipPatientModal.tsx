'use client'

import { useEffect, useRef } from 'react'
import { SkipForward, ShieldAlert, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { QueueRow } from './ServiceQueueSync'

interface SkipPatientModalProps {
  entry: QueueRow
  onClose: () => void
}

/**
 * Figma frame 114:1204. Visually complete per the approved design, but the
 * Confirm action is intentionally disabled — see the blocker explained
 * inline and in docs/SESSION_HANDOFF.md: `skip_patient()` has no clinic
 * isolation check (any authenticated receptionist/nurse/admin can skip any
 * clinic's queue entry, not just their own), so wiring a real call here
 * would be shipping a known cross-clinic authorization gap. Per the Phase 3
 * brief: "STOP the Skip write integration and report the security
 * blocker" rather than hide it behind a UI restriction that a direct RPC
 * call would bypass anyway.
 *
 * The Figma "Reason (optional)" field is also omitted: skip_patient()'s
 * signature (`p_queue_entry_id uuid, p_no_show boolean default false`) has
 * nowhere to persist a reason, and a field whose value is silently
 * discarded is worse than no field.
 */
export function SkipPatientModal({ entry, onClose }: SkipPatientModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialogRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(5,20,26,0.5)] p-4"
      onClick={onClose}
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
          onClick={onClose}
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

        <div role="alert" className="flex w-full items-start gap-3 rounded-lg bg-warning-bg p-4 text-left">
          <ShieldAlert size={20} className="mt-0.5 shrink-0 text-warning" aria-hidden />
          <p className="text-sm text-warning">
            Skip Patient is temporarily unavailable. A backend authorization gap was found in this action during
            Phase 3 review, so it has been blocked pending a security fix — no changes have been made to this
            patient&rsquo;s queue entry.
          </p>
        </div>

        <div className="flex w-full gap-4">
          <Button variant="secondary" fullWidth onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger-outline" fullWidth disabled aria-disabled title="Blocked pending a security fix">
            <SkipForward size={16} className="mr-2 inline" aria-hidden />
            Skip patient
          </Button>
        </div>
      </div>
    </div>
  )
}
