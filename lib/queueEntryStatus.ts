import { unexpectedStatusChip, type StatusChipVariant } from '@/components/ui/StatusChip'
import type { QueueEntryStatus } from '@/lib/types/database.types'

// queue_entry_status has more states than StatusChip's spec'd variant
// set — same approach as AppointmentCard: map the extras onto the
// closest visual meaning rather than growing StatusChip for one caller.
// A previous version of this map used a plain Record and mapped no_show
// onto the same 'cancelled' variant as skipped — a patient who never
// showed up is not the same as one staff actively skipped. This switch
// form keeps the same compile-time exhaustiveness a Record gave, but
// degrades to the raw value (see unexpectedStatusChip) instead of a
// silently-wrong label for a status that isn't one of these.
//
// Plain module (no 'use client') so a Server Component (the reception
// dashboard's data-fetching) can call this directly — StatusChip.tsx
// and QueueManagementView.tsx both re-export from here rather than
// defining their own copy, since QueueManagementView is 'use client' and
// re-exporting a plain function from a client file makes it a
// client-only reference, the exact trap this used to sit in.
export function queueEntryStatusToChip(status: QueueEntryStatus): { variant: StatusChipVariant; label?: string } {
  switch (status) {
    case 'waiting':
      return { variant: 'waiting' }
    case 'in_progress':
      return { variant: 'in-progress' }
    case 'done':
      return { variant: 'done' }
    case 'skipped':
      return { variant: 'cancelled' }
    case 'no_show':
      // Distinct from skipped/cancelled — this patient never showed up.
      return { variant: 'no-show' }
    default:
      return unexpectedStatusChip(status)
  }
}
