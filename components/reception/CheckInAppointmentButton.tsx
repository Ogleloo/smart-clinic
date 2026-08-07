'use client'

import { useActionState } from 'react'
import { checkInAppointment, type CheckInState } from '@/app/actions/reception'
import { Button } from '@/components/ui/Button'
import { QueueToken } from '@/components/ui/QueueToken'

/** On success the button is replaced by the token — this is the moment the patient is told their number. */
export function CheckInAppointmentButton({ appointmentId }: { appointmentId: string }) {
  const [state, formAction, pending] = useActionState<CheckInState, FormData>(checkInAppointment, {})

  if (state.token) {
    return (
      <div className="flex items-center justify-end gap-2">
        <span className="text-xs font-semibold text-muted">Token</span>
        <QueueToken token={state.token} size="sm" />
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="appointment_id" value={appointmentId} />
      {state.error && (
        <p role="alert" className="text-xs font-semibold text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="primary" loading={pending}>
        Check in
      </Button>
    </form>
  )
}
