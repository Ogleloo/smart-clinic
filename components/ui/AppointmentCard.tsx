import type { ReactNode } from 'react'
import { StatusChip, type StatusChipVariant } from './StatusChip'
import type { AppointmentStatus } from '@/lib/types/database.types'

interface AppointmentCardProps {
  serviceName: string
  /** appointments.scheduled_time — a full timestamptz, not a bare time-of-day. */
  scheduledAt: string
  status: AppointmentStatus
  action?: ReactNode
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

function formatDateTime(scheduledAt: string) {
  const when = new Date(scheduledAt)
  const datePart = when.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  const timePart = when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${datePart} · ${timePart}`
}

/** Design System: Appointment summary card. Hugs its content — no fixed or min height. */
export function AppointmentCard({ serviceName, scheduledAt, status, action }: AppointmentCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
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
