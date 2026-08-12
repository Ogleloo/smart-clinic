export type StatusChipVariant =
  | 'waiting'
  | 'in-progress'
  | 'done'
  | 'emergency'
  | 'booked'
  | 'cancelled'
  | 'no-show'

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
  'no-show': 'bg-warning-bg text-warning',
}

const LABELS: Record<StatusChipVariant, string> = {
  waiting: 'Waiting',
  'in-progress': 'In progress',
  done: 'Done',
  emergency: 'Emergency',
  booked: 'Booked',
  cancelled: 'Cancelled',
  'no-show': 'No-show',
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

/**
 * Callers that map a database status enum onto a StatusChipVariant
 * should end their switch with `default: return unexpectedStatusChip(value)`
 * rather than a plain Record lookup or a default that reuses another
 * status's label. Passing `value` here typed as `never` means: if the
 * switch above it truly covers every case the type checker currently
 * knows about, this line only compiles because TypeScript has narrowed
 * the leftover type to `never`. Add a new enum value without adding its
 * case, and this becomes a compile error — not a silent mislabel.
 *
 * At runtime, that guarantee only holds as far as the generated types
 * are in sync with the live database — this project has twice now had
 * migrations applied and confirmed live before local types caught up.
 * If that happens here, this still renders the true value instead of
 * quietly reusing whatever the nearest-looking status is.
 */
export function unexpectedStatusChip(value: never): { variant: StatusChipVariant; label: string } {
  return { variant: 'cancelled', label: String(value) }
}
