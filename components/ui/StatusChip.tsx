export type StatusChipVariant =
  | 'waiting'
  | 'in-progress'
  | 'done'
  | 'emergency'
  | 'booked'
  | 'cancelled'

interface StatusChipProps {
  status: StatusChipVariant
  label?: string
}

/**
 * Design System: Status pill.
 * Emergency uses danger-bg (not a solid danger fill) — it flags urgency
 * without reading as an error state (§ Design System, GC-016).
 */
const STYLES: Record<StatusChipVariant, string> = {
  waiting: 'bg-subtle text-muted',
  'in-progress': 'bg-primary-50 text-primary-700',
  done: 'bg-success-bg text-success',
  emergency: 'bg-danger-bg text-danger',
  booked: 'bg-primary-50 text-primary-700',
  cancelled: 'bg-subtle text-muted',
}

const LABELS: Record<StatusChipVariant, string> = {
  waiting: 'Waiting',
  'in-progress': 'In progress',
  done: 'Done',
  emergency: 'Emergency',
  booked: 'Booked',
  cancelled: 'Cancelled',
}

export function StatusChip({ status, label }: StatusChipProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${STYLES[status]}`}
    >
      {label ?? LABELS[status]}
    </span>
  )
}
