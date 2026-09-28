'use client'

import { useState } from 'react'
import { StatusChip } from '@/components/ui/StatusChip'
import { LinkButton } from '@/components/ui/LinkButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { CheckInAppointmentButton } from '@/components/reception/CheckInAppointmentButton'
import type { TodayBucket, TodayRow } from '@/lib/receptionDashboard'

const TABS: { key: TodayBucket; label: string }[] = [
  { key: 'in_queue', label: 'In queue' },
  { key: 'booked', label: 'Booked today' },
  { key: 'completed', label: 'Completed' },
]

/**
 * One unified list across two tables (appointments not yet checked in,
 * and today's queue_entries at every stage) rather than reception
 * having to piece the day together from separate screens. A missed
 * appointment reads "No-show", styled warning not danger — the patient
 * didn't cancel, and they may still walk in and need checking in,
 * which is exactly why it still gets the same primary Check-in action
 * as a plain booked one.
 */
export function TodayInClinicList({ rows }: { rows: TodayRow[] }) {
  const [tab, setTab] = useState<TodayBucket>('in_queue')
  const visible = rows.filter((row) => row.bucket === tab)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {TABS.map((t) => {
          const count = rows.filter((row) => row.bucket === t.key).length
          const isActive = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                isActive ? 'bg-primary-700 text-white' : 'bg-subtle text-muted'
              }`}
            >
              {t.label} ({count})
            </button>
          )
        })}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          headline={
            tab === 'in_queue'
              ? 'Nobody in the queue right now'
              : tab === 'booked'
                ? 'No one still to check in'
                : 'Nothing completed yet today'
          }
          fullWidth
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold tracking-wide text-muted">
                <th className="py-2 font-semibold">Token</th>
                <th className="py-2 font-semibold">Patient</th>
                <th className="py-2 font-semibold">Service</th>
                <th className="py-2 font-semibold">{tab === 'booked' ? 'Time' : 'Waiting'}</th>
                <th className="py-2 font-semibold">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className="border-b border-border">
                  <td className="py-3 font-mono font-semibold tabular-nums text-ink">{row.token ?? '—'}</td>
                  <td className="py-3 text-ink">{row.patientName}</td>
                  <td className="py-3 text-ink">{row.serviceName}</td>
                  <td className="py-3 font-mono tabular-nums text-ink">{row.timeLabel}</td>
                  <td className="py-3">
                    <StatusChip status={row.statusVariant} label={row.statusLabel} />
                  </td>
                  <td className="py-3 text-right">
                    {row.bucket === 'booked' && row.appointmentId ? (
                      <CheckInAppointmentButton appointmentId={row.appointmentId} />
                    ) : row.bucket === 'in_queue' ? (
                      <LinkButton href="/reception/queue" variant="secondary">
                        View
                      </LinkButton>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
