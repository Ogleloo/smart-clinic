export type ConfidenceLevel = 'high' | 'medium' | 'low'

interface ConfidenceChipProps {
  level: ConfidenceLevel
}

/**
 * Design System: Confidence pill.
 * Low confidence means uncertainty, not an error — it's neutral grey,
 * never red, so patients don't read a thin data sample as something
 * having gone wrong.
 */
const STYLES: Record<ConfidenceLevel, string> = {
  high: 'bg-success-bg text-success',
  medium: 'bg-warning-bg text-warning',
  low: 'bg-subtle text-muted',
}

const LABELS: Record<ConfidenceLevel, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
}

const EXPLANATIONS: Record<ConfidenceLevel, string> = {
  high: 'Based on many consistent recent visits for this service.',
  medium: 'Based on a smaller or less consistent set of recent visits.',
  low: 'Not enough recent data yet — treat this estimate loosely.',
}

/** get_wait_estimate() returns confidence as a plain string; unrecognised values fall back to low rather than erroring. */
export function toConfidenceLevel(value: string | null | undefined): ConfidenceLevel {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low'
}

export function ConfidenceChip({ level }: ConfidenceChipProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${STYLES[level]}`}
      title={EXPLANATIONS[level]}
    >
      {LABELS[level]}
    </span>
  )
}
