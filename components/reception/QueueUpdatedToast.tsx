import { Check } from 'lucide-react'

/**
 * Figma frame 114:1353 (node 114:1472): 380x76 white card, 12px radius, 1px
 * border, brand-teal 36px check badge, 16px title / 12px caption. The Figma
 * copy names the next token ("Next patient is now GC-014") — deliberately not
 * reproduced: naming a specific next patient is a prediction this component
 * has no data to back, and Skip must never imply a nurse has called the next
 * patient.
 */
export function QueueUpdatedToast({ message = 'The queue has been updated.' }: { message?: string }) {
  return (
    <div
      role="status"
      className="flex w-full max-w-[380px] items-center gap-4 rounded-md border border-border bg-surface px-5 py-3.5 shadow-[0_6px_20px_rgba(5,48,46,0.09)]"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-500 text-white">
        <Check size={18} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-base leading-6 text-ink">Queue updated</span>
        <span className="text-xs leading-[18px] text-muted">{message}</span>
      </span>
    </div>
  )
}

/**
 * Where the toast sits. Figma stacks it on top of the header photo — and on
 * top of the receptionist chip too (that frame moved the chip down and the
 * toast covers it), which hid who is signed in. Here it never covers the chip
 * or any control:
 *  - xl (1280px) and up: pinned under the chip band. The chip occupies
 *    y=44..106 at the top of the page (28px page padding + 16px inset + 62px
 *    chip), so the toast starts at 114px, over the lower half of the header
 *    photo like Figma. Measured clear of the chip, title and filters at 1280
 *    and 1440. Below xl the header is too cramped for a 380px card to clear
 *    the chip and subtitle.
 *  - below xl: bottom of the screen (centred on the content area, right of the
 *    264px sidebar from md up), clear of the sticky top navigation.
 * Purely informational, so pointer-events are off: it can never block a click
 * on whatever it happens to float over for its few seconds on screen.
 */
export function QueueToastViewport({ message }: { message: string }) {
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-40 flex justify-center md:left-[280px] xl:inset-x-auto xl:bottom-auto xl:right-8 xl:top-[114px] xl:w-[380px] xl:justify-end">
      <QueueUpdatedToast message={message} />
    </div>
  )
}
