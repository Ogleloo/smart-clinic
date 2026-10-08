'use client'

import { useState } from 'react'
import type { ConfidenceLevel } from '@/lib/confidence'

interface ConfidenceChipProps {
  level: ConfidenceLevel
  /**
   * When provided, the chip becomes an expandable disclosure explaining
   * its own basis (sample_count, from the same get_wait_estimate call
   * that produced everything else on screen — never recomputed). Omit
   * it to keep the plain, non-interactive chip used elsewhere.
   */
  sampleCount?: number
}

/**
 * Design System: Confidence pill.
 * Medium and High are both normal, unremarkable states — a smaller or
 * less consistent sample is not a problem, so neither gets an alerting
 * colour. Amber is reserved for Low alone: this codebase's own warning
 * tokens already carry "worth noting, not a fault" rather than "error"
 * (the same pairing marks a missed appointment, not a red danger
 * colour) — consistent with Low's own copy never reading as a fault,
 * just an honest, visible flag that the sample is thin.
 */
const STYLES: Record<ConfidenceLevel, string> = {
  high: 'bg-primary-50 text-primary-700',
  medium: 'bg-subtle text-muted',
  low: 'bg-warning-bg text-warning',
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

function consultationsPhrase(sampleCount: number): string {
  return `${sampleCount} completed consultation${sampleCount === 1 ? '' : 's'}`
}

/**
 * Low must not read as a fault — it's the system being honest about a
 * thin sample, not an error state. That's why its expanded text omits
 * the "Low confidence —" lead-in that medium/high use: the word "Low"
 * doesn't need repeating right next to its own explanation.
 */
function expandedText(level: ConfidenceLevel, sampleCount: number): string {
  if (level === 'low') {
    return `Based on ${consultationsPhrase(sampleCount)} — not yet enough history for a reliable estimate.`
  }
  return `${LABELS[level]} — based on ${consultationsPhrase(sampleCount)}. Times vary moderately.`
}

export function ConfidenceChip({ level, sampleCount }: ConfidenceChipProps) {
  const [open, setOpen] = useState(false)

  if (sampleCount === undefined) {
    return (
      <span
        className={`inline-flex items-center rounded-full px-3 py-1 text-[length:var(--chip-text,0.75rem)] font-semibold ${STYLES[level]}`}
        title={EXPLANATIONS[level]}
      >
        {LABELS[level]}
      </span>
    )
  }

  return (
    <div className="inline-flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[length:var(--chip-text,0.75rem)] font-semibold ${STYLES[level]}`}
      >
        {LABELS[level]}
        <span aria-hidden>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <p className="max-w-[220px] text-left text-xs text-muted">{expandedText(level, sampleCount)}</p>
      )}
    </div>
  )
}
