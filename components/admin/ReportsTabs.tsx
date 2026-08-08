'use client'

import { useState } from 'react'

export interface ThroughputDay {
  date: string
  label: string
  count: number
}

export interface ServiceVolume {
  serviceId: string
  name: string
  count: number
  avgDurationMinutes: number | null
}

export interface WaitAccuracyStats {
  sampleCount: number
  avgActualWaitMinutes: number | null
  minActualWaitMinutes: number | null
  maxActualWaitMinutes: number | null
}

interface ReportsTabsProps {
  throughput: ThroughputDay[]
  byService: ServiceVolume[]
  waitAccuracy: WaitAccuracyStats
}

const TABS = ['Throughput', 'By service', 'Wait accuracy'] as const
type Tab = (typeof TABS)[number]

const THIN_DATA_THRESHOLD = 5

export function ReportsTabs({ throughput, byService, waitAccuracy }: ReportsTabsProps) {
  const [tab, setTab] = useState<Tab>('Throughput')
  const maxThroughput = Math.max(1, ...throughput.map((d) => d.count))
  const maxServiceCount = Math.max(1, ...byService.map((s) => s.count))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-t-md px-3 py-2 text-sm font-semibold ${
              tab === t ? 'border-b-2 border-primary-700 text-primary-700' : 'text-muted'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Throughput' && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">Consultations completed per day, last 14 days.</p>
          {throughput.every((d) => d.count === 0) ? (
            <p className="text-sm text-muted">No completed consultations in this period yet.</p>
          ) : (
            <div className="flex items-end gap-1.5" style={{ height: 160 }}>
              {throughput.map((d) => (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t bg-primary-700"
                    style={{ height: `${Math.max(2, (d.count / maxThroughput) * 120)}px` }}
                    title={`${d.label}: ${d.count}`}
                  />
                  <span className="font-mono text-[10px] tabular-nums text-muted">{d.count}</span>
                  <span className="text-[9px] text-muted">{d.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'By service' && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">Volume and average consultation duration, last 14 days.</p>
          {byService.length === 0 ? (
            <p className="text-sm text-muted">No completed consultations in this period yet.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold tracking-wide text-muted">
                  <th className="py-2 font-semibold">Service</th>
                  <th className="py-2 font-semibold">Volume</th>
                  <th className="py-2 font-semibold">Avg duration</th>
                </tr>
              </thead>
              <tbody>
                {byService.map((s) => (
                  <tr key={s.serviceId} className="border-b border-border">
                    <td className="py-2 text-ink">{s.name}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2 rounded bg-primary-700"
                          style={{ width: `${Math.max(4, (s.count / maxServiceCount) * 100)}px` }}
                        />
                        <span className="font-mono tabular-nums text-ink">{s.count}</span>
                      </div>
                    </td>
                    <td className="py-2 font-mono tabular-nums text-ink">
                      {s.avgDurationMinutes === null ? '—' : `${s.avgDurationMinutes} min`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'Wait accuracy' && (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-warning-bg bg-warning-bg p-3">
            <p className="text-sm text-warning">
              This shows <strong>actual</strong> wait times only, not predicted-vs-actual. Wait estimates
              are computed live when a patient checks their status and are never stored (ADR-009) — there
              is no historical &ldquo;predicted&rdquo; value on record to compare against. Recomputing an
              estimate now for a past visit would use today&rsquo;s averages, not what was true at the
              time, which would be a fabricated number, not a real one.
            </p>
          </div>

          {waitAccuracy.sampleCount === 0 ? (
            <p className="text-sm text-muted">No completed consultations with a linked queue entry yet.</p>
          ) : waitAccuracy.sampleCount < THIN_DATA_THRESHOLD ? (
            <p className="text-sm text-muted">
              Only {waitAccuracy.sampleCount} sample{waitAccuracy.sampleCount === 1 ? '' : 's'} in the last
              14 days — too thin to draw a meaningful chart or average from. Check back once more
              consultations have been recorded.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              <StatTile label="Average actual wait" value={`${waitAccuracy.avgActualWaitMinutes} min`} />
              <StatTile label="Shortest" value={`${waitAccuracy.minActualWaitMinutes} min`} />
              <StatTile label="Longest" value={`${waitAccuracy.maxActualWaitMinutes} min`} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-semibold tracking-wide text-muted">{label.toUpperCase()}</p>
      <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  )
}
