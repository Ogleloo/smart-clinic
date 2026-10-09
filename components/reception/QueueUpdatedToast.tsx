import { Check } from 'lucide-react'

/**
 * Figma frame 114:1353. Not wired into any live flow yet: Skip Patient is
 * blocked (see SkipPatientModal) pending a fix for the clinic-isolation gap
 * in skip_patient(), so nothing in this app currently produces a genuine
 * "queue updated" event to show this for. Built now, matching the approved
 * design, so wiring it up is a one-line change once that fix ships —
 * verified against Figma via a disposable local harness (see PR), not a
 * live skip, since there is no safe real trigger for it yet.
 *
 * The Figma copy names the next token ("Next patient is now GC-014") —
 * deliberately not reproduced: naming a specific next patient is a
 * prediction this component has no data to back, and the brief is explicit
 * that Skip must never imply a nurse has called the next patient.
 */
export function QueueUpdatedToast({ message = 'Patient skipped successfully.' }: { message?: string }) {
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
