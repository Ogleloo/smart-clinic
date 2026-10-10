'use client'

import type { MyQueueRow } from '@/lib/nurseQueue'
import { EmergencyToggle } from '@/components/nurse/EmergencyToggle'
import { formatActivityTime } from './RecentActivityPanel'
import { EmergencyPill, StatusPill } from './queuePills'

interface MyQueueTableProps {
  rows: MyQueueRow[]
  caption: string
  /** Waiting-row actions need an on-duty nurse with a service; off duty the rows are read-only. */
  canAct: boolean
  onSkip: (row: MyQueueRow) => void
}

const SKIP_BTN =
  'inline-flex min-h-11 items-center justify-center rounded-sm border-[1.5px] border-[#037F74] bg-surface px-4 text-sm font-semibold text-[#037F74] hover:bg-primary-50'

function WaitCell({ row }: { row: MyQueueRow }) {
  if (row.status !== 'waiting') return <span className="text-muted">—</span>
  return (
    <span className="flex flex-col leading-[18px]">
      {/* An unknown wait is shown as unknown — never as 0 minutes. */}
      {row.elapsedMinutes === null ? (
        <span className="text-muted">Unavailable</span>
      ) : (
        <span className="text-ink">{row.elapsedMinutes} min waited</span>
      )}
      {row.estimatedMinutes !== null && <span className="text-muted">~{row.estimatedMinutes} min to go</span>}
    </span>
  )
}

function StatusCell({ row }: { row: MyQueueRow }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <StatusPill status={row.status} />
      {row.isEmergency && <EmergencyPill />}
      {row.notCounted && <span className="text-xs text-muted">Break · not in average</span>}
    </span>
  )
}

function Actions({ row, canAct, onSkip }: { row: MyQueueRow; canAct: boolean; onSkip: (row: MyQueueRow) => void }) {
  if (row.status === 'in_consultation') {
    return (
      <a href="#current-patient" className="text-sm font-semibold text-[#037F74] underline underline-offset-2">
        Go to current patient
      </a>
    )
  }
  if (row.status !== 'waiting' || !canAct) return <span className="text-muted">—</span>
  return (
    <div className="flex flex-wrap items-start gap-2">
      <button type="button" className={SKIP_BTN} onClick={() => onSkip(row)} aria-label={`Skip ${row.token}, ${row.patientName}`}>
        Skip
      </button>
      {/* The working screen's EmergencyToggle, unchanged; only sized down to the table's 14px button scale here. */}
      <div className="[&_button]:min-h-11 [&_button]:rounded-sm [&_button]:px-3 [&_button]:text-sm">
        <EmergencyToggle queueEntryId={row.queueEntryId} isEmergency={row.isEmergency} />
      </div>
    </div>
  )
}

function PositionCell({ row }: { row: MyQueueRow }) {
  if (row.position === null) return <span className="text-muted">—</span>
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span>{row.position}</span>
      {row.position === 1 && <span className="text-xs font-semibold leading-4 text-[#037F74]">Next</span>}
    </span>
  )
}

/**
 * Figma frame 161:170 "Queue-Table" (1096px at 1440): header band #F0FDFA, 13px table text, rows ruled #D9ECE9.
 * Columns follow the Figma order. Figma's per-row "Start Consult" / "View Details" are not reproduced: the
 * backend chooses the next patient (Call next patient, above), and there is no consultation-details screen yet.
 * Waiting rows offer Skip and the existing emergency-priority control instead.
 *
 * From xl (1280px) it is a table; the Service column appears from 1400px, where there is room. Below xl the
 * same facts are stacked as cards so nothing scrolls sideways.
 */
export function MyQueueTable({ rows, caption, canAct, onSkip }: MyQueueTableProps) {
  return (
    <>
      <table className="hidden w-full table-fixed border-collapse text-left text-[13px] leading-[18px] xl:table">
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          <col className="w-[68px]" />
          <col className="w-[92px]" />
          <col />
          <col className="hidden w-[180px] min-[1400px]:table-column" />
          <col className="w-[96px]" />
          <col className="w-[124px]" />
          <col className="w-[136px]" />
          <col className="w-[236px]" />
        </colgroup>
        <thead>
          <tr className="h-[52px] bg-[#F0FDFA] text-muted">
            <th scope="col" className="pl-5 font-normal">#</th>
            <th scope="col" className="font-normal">Token</th>
            <th scope="col" className="font-normal">Patient Name</th>
            <th scope="col" className="hidden font-normal min-[1400px]:table-cell">Service</th>
            <th scope="col" className="font-normal">Arrival Time</th>
            <th scope="col" className="font-normal">Wait Time</th>
            <th scope="col" className="font-normal">Status</th>
            <th scope="col" className="pr-5 font-normal">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={`border-b border-border align-middle ${row.isEmergency ? 'bg-danger-bg/50' : ''}`}>
              <td className="py-3 pl-5 tabular-nums text-muted"><PositionCell row={row} /></td>
              <td className="py-3 tabular-nums text-ink">{row.token}</td>
              <td className="py-3 pr-3 text-ink"><span className="block truncate" title={row.patientName}>{row.patientName}</span></td>
              <td className="hidden truncate py-3 pr-3 text-muted min-[1400px]:table-cell">{row.serviceName ?? '—'}</td>
              <td className="py-3 tabular-nums text-muted">{row.arrivedAt ? formatActivityTime(row.arrivedAt) : '—'}</td>
              <td className="py-3 pr-2"><WaitCell row={row} /></td>
              <td className="py-3 pr-2"><StatusCell row={row} /></td>
              <td className="py-3 pr-5"><Actions row={row} canAct={canAct} onSkip={onSkip} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="flex flex-col gap-3 xl:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={row.key} className={`rounded-lg border border-border p-4 ${row.isEmergency ? 'bg-danger-bg/50' : 'bg-surface'}`}>
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 text-sm text-ink">
                <span className="font-mono font-semibold tabular-nums">{row.token}</span>
                <span className="text-muted"> · </span>
                <span className="break-words">{row.patientName}</span>
              </p>
              <StatusCell row={row} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-muted sm:grid-cols-4">
              <div>
                <dt>Position</dt>
                <dd className="text-sm tabular-nums text-ink"><PositionCell row={row} /></dd>
              </div>
              <div>
                <dt>Arrival time</dt>
                <dd className="text-sm tabular-nums text-ink">{row.arrivedAt ? formatActivityTime(row.arrivedAt) : '—'}</dd>
              </div>
              <div>
                <dt>Wait time</dt>
                <dd className="text-xs"><WaitCell row={row} /></dd>
              </div>
              <div>
                <dt>Service</dt>
                <dd className="break-words text-sm text-ink">{row.serviceName ?? '—'}</dd>
              </div>
            </dl>
            {(row.status === 'in_consultation' || (row.status === 'waiting' && canAct)) && (
              <div className="mt-3 border-t border-border pt-3">
                <Actions row={row} canAct={canAct} onSkip={onSkip} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
