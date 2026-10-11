import { Users } from 'lucide-react'
import { LinkButton } from '@/components/ui/LinkButton'
import type { DashboardQueueRow, NurseDashboardData } from '@/lib/nurseDashboard'
import { NURSE_QUEUE_HREF } from './navItems'

/** Pill colours checked for WCAG AA text contrast: Figma's amber (#F59E0B on #FFF5DB) is far below 4.5:1, so the same hue is darkened. */
const CHIP = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold leading-[18px]'
const WAITING_CHIP = `${CHIP} bg-[#FFF5DB] text-[#8A5600]`
const SEEING_CHIP = `${CHIP} bg-primary-50 text-[#037F74]`
const EMERGENCY_CHIP = `${CHIP} bg-danger-bg text-[#B42318]`

function StatusCell({ row }: { row: DashboardQueueRow }) {
  return (
    <span className="flex flex-col items-start gap-1">
      {row.status === 'in_progress' ? (
        <span className={SEEING_CHIP}>In consultation</span>
      ) : (
        <span className={WAITING_CHIP}>Waiting</span>
      )}
      {row.isEmergency && <span className={EMERGENCY_CHIP}>Emergency</span>}
    </span>
  )
}

/**
 * Two different numbers, never blended: how long the patient has already waited (a fact, from check-in) and
 * how long the prediction engine says is left (get_wait_estimate, which declines to answer when nobody is on
 * duty, so a missing estimate is simply not shown).
 */
function WaitCell({ row }: { row: DashboardQueueRow }) {
  if (row.status === 'in_progress') return <span className="text-muted">—</span>
  return (
    <span className="flex flex-col leading-4">
      {/* An unknown wait is shown as unknown — never as 0 minutes. */}
      {row.elapsedMinutes === null ? (
        <span className="text-muted">Wait time unavailable</span>
      ) : (
        <span className="text-ink">{row.elapsedMinutes} min elapsed</span>
      )}
      {row.estimatedMinutes !== null && <span className="text-muted">~{row.estimatedMinutes} min to go</span>}
    </span>
  )
}

function Body({ data }: { data: NurseDashboardData }) {
  const { queue, queueTotal, queueScoped, errors, nurse } = data

  if (errors.queue) {
    return (
      <p role="alert" className="mt-6 rounded-md border border-border bg-danger-bg p-4 text-sm font-semibold text-[#B42318]">
        We couldn’t load your queue. Reload the page to try again, or open My Queue.
      </p>
    )
  }
  if (!queueScoped) {
    return (
      <div className="mt-6 flex flex-col items-start gap-3 rounded-md border border-border bg-subtle p-5">
        <p className="text-sm font-semibold text-ink">
          {nurse.isOnDuty ? 'You have no assigned service.' : 'You’re off duty.'}
        </p>
        <p className="text-sm text-muted">
          {nurse.isOnDuty
            ? 'Choose a service in My Queue to see its queue here.'
            : 'Go on duty in My Queue to choose a service and see its queue here.'}
        </p>
        <LinkButton href={NURSE_QUEUE_HREF} variant="secondary" className="!border-[#037F74] !text-[#037F74]">
          Open My Queue
        </LinkButton>
      </div>
    )
  }
  if (queue.length === 0) {
    return (
      <div className="mt-6 rounded-md border border-border bg-subtle p-5 text-center">
        <p className="text-sm font-semibold text-ink">No one is waiting</p>
        <p className="mt-1 text-sm text-muted">New check-ins for {nurse.serviceName ?? 'your service'} will appear here.</p>
      </div>
    )
  }

  return (
    <>
      {/* lg and up: the Figma table. Columns are fixed so nothing overflows; Service is dropped between 1280 and 1400px where the panel is narrower than Figma's 730px, since every row shares the nurse's one service. */}
      <table className="mt-4 hidden w-full table-fixed border-collapse text-left text-xs lg:table">
        <caption className="sr-only">Today’s queue for {nurse.serviceName ?? 'your service'}, in the order patients will be seen</caption>
        <colgroup>
          <col className="w-9" />
          <col className="w-[84px]" />
          <col />
          <col className="hidden w-[170px] min-[1400px]:table-column" />
          <col className="w-[140px]" />
          <col className="w-[112px]" />
        </colgroup>
        <thead>
          <tr className="h-[38px] bg-[#F0FDFA] text-xs font-semibold text-muted">
            <th scope="col" className="rounded-l-md pl-3 font-semibold">#</th>
            <th scope="col" className="font-semibold">Token</th>
            <th scope="col" className="font-semibold">Patient Name</th>
            <th scope="col" className="hidden font-semibold min-[1400px]:table-cell">Service</th>
            <th scope="col" className="font-semibold">Wait Time</th>
            <th scope="col" className="rounded-r-md font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {queue.map((row) => (
            <tr key={row.queueEntryId} className={`min-h-12 border-b border-[#F0F4F8] align-middle ${row.isEmergency ? 'bg-danger-bg/60' : ''}`}>
              <td className="py-2 pl-3 tabular-nums text-muted">{row.position ?? '—'}</td>
              <td className="py-2 font-mono font-semibold tabular-nums text-ink">{row.token}</td>
              <td className="truncate py-2 pr-2 text-ink" title={row.patientName}>{row.patientName}</td>
              <td className="hidden truncate py-2 pr-2 text-muted min-[1400px]:table-cell">{nurse.serviceName ?? '—'}</td>
              <td className="py-2 pr-2"><WaitCell row={row} /></td>
              <td className="py-2"><StatusCell row={row} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Below lg a six-column table doesn't fit beside the sidebar without clipping, so the same facts are stacked. */}
      <ul className="mt-4 flex flex-col gap-3 lg:hidden">
        {queue.map((row) => (
          <li key={row.queueEntryId} className={`rounded-lg border border-border p-3 ${row.isEmergency ? 'bg-danger-bg/60' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 text-sm text-ink">
                <span className="font-mono font-semibold tabular-nums">{row.token}</span>
                <span className="text-muted"> · </span>
                <span className="break-words">{row.patientName}</span>
              </p>
              <StatusCell row={row} />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted">
              <div>
                <dt>Position</dt>
                <dd className="text-sm tabular-nums text-ink">{row.position ?? '—'}</dd>
              </div>
              <div>
                <dt>Wait time</dt>
                <dd className="text-xs"><WaitCell row={row} /></dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      {queueTotal > queue.length && (
        <p className="mt-3 text-xs text-muted">
          Showing {queue.length} of {queueTotal}. <span className="sr-only">Use View all to see the rest.</span>
        </p>
      )}
    </>
  )
}

/** Figma frame 161:101 "Todays-Queue" (730×440). Backed by get_service_queue for the nurse's own current service, in the order the database returns it (emergency priority first). */
export function TodaysQueuePanel({ data }: { data: NurseDashboardData }) {
  return (
    <section
      aria-labelledby="todays-queue"
      className="flex flex-col xl:min-h-[440px] rounded-lg border border-border bg-surface p-[17px] shadow-[0_6px_14px_rgba(5,48,46,0.05)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-[14px]">
          <span className="flex size-[46px] shrink-0 items-center justify-center rounded-full bg-primary-50 text-[#037F74]">
            <Users size={22} aria-hidden />
          </span>
          <div>
            <h2 id="todays-queue" className="text-base leading-6 text-ink">Today’s Queue</h2>
            <p className="text-xs leading-[18px] text-muted">
              {data.queueScoped ? (data.nurse.serviceName ?? 'Your service') : data.nurse.isOnDuty ? 'No service assigned' : 'Off duty'}
            </p>
          </div>
        </div>
        <LinkButton
          href={NURSE_QUEUE_HREF}
          variant="secondary"
          className="!h-10 !min-h-10 !w-[130px] !rounded-sm !border-[#037F74] !px-4 !text-sm !text-[#037F74]"
        >
          View all
        </LinkButton>
      </div>
      <Body data={data} />
    </section>
  )
}
