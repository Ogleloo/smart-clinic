/**
 * Shared class strings for the Patient V3 authentication screens (Figma 22:39, 28:40, 33:49, 45:68).
 *
 * Colour note, the same decision the public landing page records: Figma fills buttons and small accent text with
 * #08B9A8 (2.47:1 against white) and #039486 (3.6:1). Neither clears 4.5:1, so anything at or below 22px uses
 * #037F74 (4.89:1) and only the 40px headings keep #039486, which clears the 3:1 large-text bar.
 */

export const ACCENT = '#037F74'
export const ACCENT_HOVER = '#026B62'
/** 40px headings only. */
export const ACCENT_LARGE = '#039486'

/** Figma's Button component (10:16) at 56px, full width. */
export const BTN_PRIMARY =
  'inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-[8px] bg-[#037F74] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#026B62] disabled:cursor-not-allowed disabled:opacity-60'

export const BTN_SECONDARY =
  'inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-[8px] border-[1.5px] border-[#037F74] bg-surface px-6 text-sm font-semibold text-[#037F74] transition-colors hover:bg-primary-50'

/** Inline accent link inside a sentence; underlined so colour is not the only signal. */
export const LINK = 'font-semibold text-[#037F74] underline underline-offset-4 hover:text-[#026B62]'

/** A link that is its own row — 44px tall so it is a real touch target. */
export const LINK_ROW = `inline-flex min-h-11 items-center justify-center ${LINK}`

/**
 * The card every auth screen sits in: Figma 680 wide, 16px radius, 1.5px border, a near-white vertical gradient
 * and the V3 card shadow. Below sm it fills the width and loses the big padding.
 */
export const CARD =
  'relative w-full max-w-[680px] rounded-[16px] border-[1.5px] border-border bg-gradient-to-b from-[rgba(255,255,255,0.97)] to-[rgba(243,255,253,0.97)] px-5 py-8 shadow-[0_12px_32px_rgba(5,48,46,0.08)] sm:px-10 sm:py-10 lg:px-14 lg:py-11'

/** Field label + control spacing used between the stacked field groups (Figma 33:71 gap-16). */
export const FIELD_STACK = 'flex w-full flex-col gap-4'

export const HEADING = 'font-display text-[28px] font-bold leading-tight text-ink sm:text-[40px] sm:leading-[44px]'
export const SUBHEADING = 'text-base leading-6 text-muted'
