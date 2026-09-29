'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, BarChart3 } from 'lucide-react'
import type { PredictionQualityStats } from '@/lib/adminDashboard'

/**
 * "Can I trust the estimates" — the third question, and the one that
 * distinguishes this from a CRUD queue app. The exclusion sentence is
 * the headline (plain language, not raw statistics); avg/stddev are
 * legitimate reportable figures on their own, shown as stat tiles
 * rather than buried in prose.
 */
export function PredictionQualityPanel({ stats }: { stats: PredictionQualityStats }) {
  const [open, setOpen] = useState(false)
  const includedCount = stats.recordedCount - stats.excludedCount
  // A staff break is a deliberate judgement call, not an implausible
  // reading — the headline sentence is specifically about plausibility,
  // so it counts only the two length-based reasons. Breaks get their
  // own, differently-worded line right below.
  const implausibleCount = stats.exclusionBreakdown.tooShort + stats.exclusionBreakdown.tooLong

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <BarChart3 size={18} className="text-primary-700" aria-hidden />
        <p className="text-xs font-semibold tracking-wide text-muted">PREDICTION QUALITY</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Recorded" value={stats.recordedCount} />
        <Stat label="Excluded" value={stats.excludedCount} />
        <Stat label="Avg duration" value={stats.avgMinutes === null ? '—' : `${stats.avgMinutes} min`} />
        <Stat label="Typical variation" value={stats.stddevMinutes === null ? '—' : `± ${stats.stddevMinutes} min`} />
      </div>

      {stats.excludedCount > 0 ? (
        <div className="flex flex-col gap-2">
          {implausibleCount > 0 && (
            <p className="text-sm text-ink">
              {implausibleCount} consultation{implausibleCount === 1 ? '' : 's'}{' '}
              {implausibleCount === 1 ? 'was' : 'were'} left out of the averages because{' '}
              {implausibleCount === 1 ? 'its' : 'their'} recorded length was not plausible.
            </p>
          )}
          {stats.exclusionBreakdown.staffBreak > 0 && (
            <p className="text-sm text-ink">
              {stats.exclusionBreakdown.staffBreak} more{' '}
              {stats.exclusionBreakdown.staffBreak === 1 ? 'was' : 'were'} deliberately marked as a staff break,
              not a data problem.
            </p>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-primary-700"
          >
            {open ? 'Hide reasons' : 'Show reasons'}
            {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
          </button>
          {open && (
            <ul className="flex flex-col gap-1 text-sm text-muted">
              {stats.exclusionBreakdown.staffBreak > 0 && (
                <li>{stats.exclusionBreakdown.staffBreak} marked as a staff break</li>
              )}
              {stats.exclusionBreakdown.tooShort > 0 && (
                <li>
                  {stats.exclusionBreakdown.tooShort} shorter than {stats.minPlausibleMinutes} min (likely a
                  mis-click)
                </li>
              )}
              {stats.exclusionBreakdown.tooLong > 0 && (
                <li>
                  {stats.exclusionBreakdown.tooLong} longer than {stats.maxPlausibleMinutes} min (likely
                  forgotten open)
                </li>
              )}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">
          {includedCount > 0
            ? 'Every recorded consultation counts towards the averages.'
            : 'No consultations recorded yet.'}
        </p>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-muted">{label.toUpperCase()}</p>
      <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  )
}
