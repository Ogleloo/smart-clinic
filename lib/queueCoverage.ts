import type { PublicQueueDisplay } from '@/lib/types/database.types'

export type CoverageVariant = 'active' | 'warning' | 'closed'

/**
 * Three states, not two — a service with no nurse and nobody waiting is
 * just quiet, not broken. Only "people waiting, nobody serving them"
 * earns the warning colour; painting every uncovered service amber made
 * an ordinary clinic look like something was wrong everywhere at once.
 * Shared by the public landing page and the reception dashboard so the
 * two never disagree about what counts as which state.
 */
export function coverageVariant(row: Pick<PublicQueueDisplay, 'is_being_served' | 'waiting_count'>): CoverageVariant {
  if (row.is_being_served) return 'active'
  return row.waiting_count > 0 ? 'warning' : 'closed'
}

export const COVERAGE_CARD_STYLES: Record<CoverageVariant, string> = {
  active: 'bg-surface border border-border',
  warning: 'bg-warning-bg',
  closed: 'bg-subtle',
}
