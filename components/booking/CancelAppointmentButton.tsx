'use client'

import { useActionState, useState } from 'react'
import { cancelAppointment, type ActionState } from '@/app/actions/appointments'
import { Button } from '@/components/ui/Button'
import type { AppointmentStatus } from '@/lib/types/database.types'

export function CancelAppointmentButton({
  appointmentId,
  status,
}: {
  appointmentId: string
  status: AppointmentStatus
}) {
  // Captured once at mount, not re-derived from `status` on every
  // render: a successful cancel changes the appointment's status on the
  // very next server revalidation, and re-deriving visibility from that
  // live prop would unmount this component — mid-success, before its
  // own "Appointment cancelled." message ever gets to display — the
  // instant it does its job.
  const [wasBooked] = useState(status === 'booked')
  const [confirming, setConfirming] = useState(false)
  const [state, formAction, pending] = useActionState<ActionState, FormData>(cancelAppointment, {})

  if (!wasBooked) return null

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
