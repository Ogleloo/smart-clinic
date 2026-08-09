'use client'

import { useActionState, useEffect, useState } from 'react'
import { skipPatient, type SkipState } from '@/app/actions/nurse'
import { Button } from '@/components/ui/Button'

interface SkipButtonProps {
  queueEntryId: string
  patientName: string
}

/**
 * Skip now applies only to waiting (not yet called) patients — see the
 * nurse-workflow ADR for why it can no longer safely target the current
 * in-progress one: next_patient always creates a consultation the
 * moment it calls someone, and skip_patient never touches consultations,
 * so skipping the current patient would leave that consultation open
 * and dangling.
 */
export function SkipButton({ queueEntryId, patientName }: SkipButtonProps) {
  const [confirming, setConfirming] = useState(false)
  const [state, formAction, pending] = useActionState<SkipState, FormData>(skipPatient, {})

  // Reacting to the action's own result, not the click — see
  // EmergencyToggle for why (an onClick that also flips local state
  // synchronously can race the native form submission).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (state.skipped) setConfirming(false)
  }, [state])

  if (!confirming) {
    return (
      <Button variant="tertiary" onClick={() => setConfirming(true)}>
        Skip
      </Button>
    )
  }

  return (
    <form action={formAction} className="flex flex-col items-end gap-1.5">
      <input type="hidden" name="queue_entry_id" value={queueEntryId} />
      <p className="max-w-[180px] text-right text-xs text-muted">Skip {patientName}?</p>
      {state.error && (
        <p role="alert" className="text-xs text-danger">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="tertiary" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
        <Button type="submit" variant="danger" loading={pending}>
          Confirm
        </Button>
      </div>
    </form>
  )
}
