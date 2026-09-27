import type { ReactNode } from 'react'
import Link from 'next/link'
import { StatusChip, unexpectedStatusChip, type StatusChipVariant } from './StatusChip'
import type { AppointmentStatus } from '@/lib/types/database.types'
import { CLINIC_TIMEZONE } from '@/lib/clinicTime'

interface AppointmentCardProps {
  serviceName: string
  /** appointments.scheduled_time — a full timestamptz, not a bare time-of-day. */
  scheduledAt: string
  status: AppointmentStatus
  action?: ReactNode
  fullWidth?: boolean
  /** Wraps the card in a Link to that appointment's details. Omit when already on that appointment's own page. */
  href?: string
}

// appointment_status has more states than the shared StatusChip's spec'd
// variant set — map the ones StatusChip doesn't name onto the closest
// visual meaning rather than growing StatusChip's variants for one caller.
// A previous version of this map used a plain Record and mapped no_show
// onto the same 'cancelled' variant as an actual cancellation — visually
// indistinguishable, even though a no-show is not a cancellation. This
// switch form gets the same compile-time exhaustiveness a Record gave,
// but degrades to the raw value (see unexpectedStatusChip) instead of a
// silently-wrong label if a status shows up that isn't one of these.
export function appointmentStatusToChip(status: AppointmentStatus): { variant: StatusChipVariant; label?: string } {
  switch (status) {
    case 'booked':
      return { variant: 'booked' }
    case 'checked_in':
      return { variant: 'in-progress' }
    case 'completed':
      return { variant: 'done' }
    case 'cancelled':
      return { variant: 'cancelled' }
    case 'no_show':
      // Distinct from cancelled — the patient didn't cancel this, they missed it.
      return { variant: 'no-show' }
    default:
      return unexpectedStatusChip(status)
  }
}

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
  href,
}: AppointmentCardProps) {
  const chip = appointmentStatusToChip(status)
  const className = `flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 ${fullWidth ? 'w-full' : 'inline-flex'} ${href ? 'hover:bg-subtle' : ''}`
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-base font-semibold text-ink">{serviceName}</p>
          <p className="mt-0.5 text-sm text-muted">{formatDateTime(scheduledAt)}</p>
        </div>
        <StatusChip status={chip.variant} label={chip.label} />
      </div>
      {action}
    </>
  )

  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    )
  }

  return <div className={className}>{body}</div>
}
