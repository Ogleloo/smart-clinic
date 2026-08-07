import type { ReactNode } from 'react'
import { StatusChip, type StatusChipVariant } from './StatusChip'
import type { AppointmentStatus } from '@/lib/types/database.types'

interface AppointmentCardProps {
  serviceName: string
  /** appointments.scheduled_time — a full timestamptz, not a bare time-of-day. */
  scheduledAt: string
  status: AppointmentStatus
  action?: ReactNode
  fullWidth?: boolean
}

// appointment_status has more states than the shared StatusChip's spec'd
// variant set — map the ones StatusChip doesn't name onto the closest
// visual meaning rather than growing StatusChip's variants for one caller.
const STATUS_TO_CHIP: Record<AppointmentStatus, StatusChipVariant> = {
  booked: 'booked',
  checked_in: 'in-progress',
  completed: 'done',
  cancelled: 'cancelled',
  no_show: 'cancelled',
}

// Always the clinic's timezone, never the viewer's (ADR-020) — a patient
// or server rendering this from outside Africa/Johannesburg must still
// see the time the clinic means.
const CLINIC_TIMEZONE = 'Africa/Johannesburg'

function formatDateTime(scheduledAt: string) {
  const when = new Date(scheduledAt)
  const datePart = when.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: CLINIC_TIMEZONE,
  })
  const timePart = when.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: CLINIC_TIMEZONE,
  })
  return `${datePart} · ${timePart}`
}

/** Design System: Appointment summary card. Hugs its content by default (no fixed width or height) — pass fullWidth to fill the parent. */
export function AppointmentCard({
  serviceName,
  scheduledAt,
  status,
  action,
  fullWidth = false,
}: AppointmentCardProps) {
  return (
    <div
      className={`inline-flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 ${fullWidth ? 'w-full' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-base font-semibold text-ink">{serviceName}</p>
          <p className="mt-0.5 text-sm text-muted">{formatDateTime(scheduledAt)}</p>
        </div>
        <StatusChip status={STATUS_TO_CHIP[status]} />
      </div>
      {action}
    </div>
  )
}
