'use client'

import { useActionState, useState } from 'react'
import { cancelAppointment, type ActionState } from '@/app/actions/appointments'
import { Button } from '@/components/ui/Button'
import type { AppointmentStatus } from '@/lib/types/database.types'

export function CancelAppointmentButton({
  appointmentId,
  status,
  compact = false,
}: {
  appointmentId: string
  status: AppointmentStatus
  /** List rows: a plain-width "Cancel" next to "View details" instead of a full-width block. */
  compact?: boolean
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
      <p role="status" className="text-base font-semibold text-primary-700">
        {state.success}
      </p>
    )
  }

  if (!confirming) {
    return compact ? (
      <Button variant="danger-outline" onClick={() => setConfirming(true)}>
        Cancel
      </Button>
    ) : (
      <Button variant="danger-outline" fullWidth onClick={() => setConfirming(true)}>
        Cancel appointment
      </Button>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="appointment_id" value={appointmentId} />
      <p className="text-base font-semibold text-ink">Cancel this appointment?</p>
      {state.error && (
        <p role="alert" className="text-base text-danger">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="tertiary" fullWidth={!compact} onClick={() => setConfirming(false)}>
          Keep it
        </Button>
        <Button type="submit" variant="danger" fullWidth={!compact} loading={pending}>
          Yes, cancel
        </Button>
      </div>
    </form>
  )
}
