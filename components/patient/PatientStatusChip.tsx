import type { AppointmentStatus } from '@/lib/types/database.types'

/**
 * Patient V3 appointment status chip (Figma). Separate from the shared
 * StatusChip so staff screens keep their own labels: a patient's
 * successfully booked slot reads "Confirmed" on a solid teal chip.
 *
 * Same exhaustiveness pattern as appointmentStatusToChip — an unknown
 * status renders its raw value rather than borrowing another label.
 */
function chipFor(status: AppointmentStatus): { label: string; className: string } {
  switch (status) {
    case 'booked':
      return { label: 'Confirmed', className: 'bg-primary-700 text-white' }
    case 'checked_in':
      return { label: 'Checked in', className: 'bg-card-mint text-primary-700' }
    case 'completed':
      return { label: 'Completed', className: 'bg-card-blue text-ink' }
    case 'cancelled':
      return { label: 'Cancelled', className: 'bg-danger-bg text-danger' }
    case 'no_show':
      return { label: 'Missed', className: 'bg-warning-bg text-warning' }
    default: {
      const unknown: never = status
      return { label: String(unknown), className: 'bg-subtle text-muted' }
    }
  }
}

export function PatientStatusChip({ status }: { status: AppointmentStatus }) {
  const { label, className } = chipFor(status)
  return (
    <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-sm font-semibold ${className}`}>
      {label}
    </span>
  )
}
