import { Check } from 'lucide-react'

/**
 * Figma frame 114:1353. The Figma copy names the next token ("Next patient
 * is now GC-014") — deliberately not reproduced: naming a specific next
 * patient is a prediction this component has no data to back, and Skip must
 * never imply a nurse has called the next patient.
 */
export function QueueUpdatedToast({ message = 'The queue has been updated.' }: { message?: string }) {
  return (
    <div
      role="status"
      className="flex w-full max-w-[380px] items-center gap-3 rounded-full bg-surface px-3 py-2 shadow-[0_12px_32px_rgba(5,48,46,0.08)]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success text-white">
        <Check size={20} aria-hidden />
      </span>
      <span className="flex flex-col">
        <span className="text-sm font-semibold text-ink">Queue updated</span>
        <span className="text-xs text-muted">{message}</span>
      </span>
    </div>
  )
}
