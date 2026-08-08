'use client'

import { useActionState, useEffect, useState } from 'react'
import { setEmergencyPriority, type EmergencyState } from '@/app/actions/nurse'
import { Button } from '@/components/ui/Button'

interface EmergencyToggleProps {
  queueEntryId: string
  isEmergency: boolean
}

/** BR-10: nurse/admin only — this screen is the one place that's allowed to offer this control. */
export function EmergencyToggle({ queueEntryId, isEmergency }: EmergencyToggleProps) {
  const [confirming, setConfirming] = useState(false)
  const [state, formAction, pending] = useActionState<EmergencyState, FormData>(
    setEmergencyPriority,
    {}
  )

  // Reacting to the server action's own result, not the click itself —
  // an onClick that also flips `confirming` synchronously raced the
  // native form submission (the button unmounting mid-click silently
  // dropped it; the RPC never fired).
  //
  // Depends on the whole `state` object, not state.success: a second
  // toggle in the same mounted row would return {success: true} again,
  // an unchanged boolean value, so an effect keyed on state.success
  // alone would only fire once, ever, per row — every toggle after the
  // first would leave the confirm form stuck open despite succeeding.
  // useActionState gives every dispatch a fresh object reference, so
  // keying on the object itself catches every one, not just the first.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (state.success) setConfirming(false)
  }, [state])

  if (!confirming) {
    return (
      <Button variant={isEmergency ? 'tertiary' : 'danger'} onClick={() => setConfirming(true)}>
        {isEmergency ? 'Clear emergency' : 'Mark emergency'}
      </Button>
    )
  }

  return (
    <form action={formAction} className="flex flex-col items-end gap-1.5">
      <input type="hidden" name="queue_entry_id" value={queueEntryId} />
      <input type="hidden" name="emergency" value={(!isEmergency).toString()} />
      <p className="max-w-[180px] text-right text-xs text-muted">
        {isEmergency
          ? 'Clear emergency status?'
          : 'Mark as emergency? This reorders other patients’ waits.'}
      </p>
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
