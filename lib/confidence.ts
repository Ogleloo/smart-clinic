export type ConfidenceLevel = 'high' | 'medium' | 'low'

/**
 * Pure string mapping, no React — a Server Component (QueueSummaryCard,
 * rendered from the dashboard's Server Component page) needs to call
 * this as a plain function, which only works from a plain module. A
 * 'use client' file turns every export into a client-only reference;
 * calling one directly from server code (rather than rendering it as
 * JSX) throws at runtime. Same fix already applied once in this
 * codebase for Button/LinkButton (see button-styles.ts).
 *
 * get_wait_estimate() returns confidence as a plain string;
 * unrecognised values fall back to low rather than erroring.
 */
export function toConfidenceLevel(value: string | null | undefined): ConfidenceLevel {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low'
}
