'use client'

import { useActionState, useState } from 'react'
import { cancelAppointment, type ActionState } from '@/app/actions/appointments'
import { Button } from '@/components/ui/Button'

export function CancelAppointmentButton({ appointmentId }: { appointmentId: string }) {
  const [confirming, setConfirming] = useState(false)
  const [state, formAction, pending] = useActionState<ActionState, FormData>(cancelAppointment, {})

  if (state.success) {
    return (
      <p role="status" className="text-sm font-semibold text-success">
        {state.success}
      </p>
    )
  }

  if (!confirming) {
    return (
      <Button variant="danger" fullWidth onClick={() => setConfirming(true)}>
        Cancel appointment
      </Button>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="appointment_id" value={appointmentId} />
      <p className="text-sm font-semibold text-ink">Cancel this appointment?</p>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="tertiary" fullWidth onClick={() => setConfirming(false)}>
          Keep it
        </Button>
        <Button type="submit" variant="danger" fullWidth loading={pending}>
          Yes, cancel
        </Button>
      </div>
    </form>
  )
}
