import Link from 'next/link'
import type { AdminDashboardData, ServicePerformanceRow } from '@/lib/adminDashboard'
import type { ConfidenceLevel } from '@/lib/confidence'

const CONFIDENCE_PILL: Record<ConfidenceLevel, { label: string; className: string }> = {
  high: { label: 'High confidence', className: 'bg-subtle text-ink' },
  medium: { label: 'Medium confidence', className: 'bg-subtle text-ink' },
  low: { label: 'Low confidence', className: 'bg-warning-bg text-warning' },
}

/** What the "Est. wait" column says for one service. Never a number the system cannot justify: an uncovered service has no estimate. */
export function estimateText(row: ServicePerformanceRow): { text: string; detail: string | null; tone: 'ok' | 'none' } {
  // isBeingServed null = the live coverage read failed: whether anyone is on duty is unknown, so say nothing about it.
  if (row.isBeingServed === null) return { text: 'Unavailable', detail: null, tone: 'none' }
  if (!row.isBeingServed) return { text: 'No estimate', detail: 'No nurse on duty', tone: 'none' }
  return {
    text: row.estimatedWaitMinutes === null ? 'No wait' : `~${row.estimatedWaitMinutes} min`,
    // sampleCount null = the stats call failed for this service: no sample count is better than a made-up 0.
    detail: row.sampleCount === null ? 'Sample size unavailable' : `${row.sampleCount} sample${row.sampleCount === 1 ? '' : 's'}`,
    tone: 'ok',
  }
}

const nurseText = (n: number | null) => (n === null ? 'Nurse count unavailable' : `${n} ${n === 1 ? 'nurse' : 'nurses'} on duty`)
const cell = (n: number | null) => (n === null ? '—' : String(n))

function Confidence({ row }: { row: ServicePerformanceRow }) {
  // No confidence label without the estimate it describes.
  if (row.isBeingServed !== true) return null
  const pill = CONFIDENCE_PILL[row.confidence]
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${pill.className}`}>{pill.label}</span>
}

/**
 * Figma "Queue Overview" panel: a row per active service with Waiting / Serving / Est. wait, a totals footer and
 * a View reports button. Differences from Figma, all because the figure would otherwise be invented:
 *  - no "Dr. Smith • Room 3" line (no room or assignment data); the second line is the real nurse count;
 *  - "Est. wait" is the prediction engine's estimate for the next patient, not a historical average, and says
 *    "No estimate" when nobody is on duty;
 *  - the footer's average is "Avg. wait today" (check-in to being called), not "overall".
 * Below md each service is a card instead of a table row.
 */
export function AdminQueueOverview({ data }: { data: AdminDashboardData }) {
  const { services, clinicState, today, errors } = data

  return (
    <section aria-labelledby="admin-queue-overview" className="flex h-full flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-[0_12px_32px_rgba(5,48,46,0.08)]">
      <div className="flex flex-col gap-1">
        <h2 id="admin-queue-overview" className="font-display text-[22px] font-semibold text-ink">
          Queue Overview
        </h2>
        <p className="text-base text-muted">Current queue and estimated waiting time.</p>
      </div>

      {errors.services && (
        <p role="alert" className="rounded-md bg-danger-bg p-3 text-sm font-semibold text-[#B42318]">
          We couldn’t load the list of services, so the queue overview and service coverage are unavailable. Reload to try again.
        </p>
      )}
      {errors.coverage && !errors.services && (
        <p role="alert" className="rounded-md bg-danger-bg p-3 text-sm font-semibold text-[#B42318]">
          We couldn’t load live queue coverage. Per-service waiting counts and wait estimates are unavailable, and so is the
          needs-attention check; reload to try again.
        </p>
      )}
      {errors.perService && !errors.services && (
        <p role="status" className="rounded-md bg-warning-bg p-3 text-sm font-semibold text-warning">
          Nurse counts or sample sizes could not be loaded for some services; those show as unavailable.
        </p>
      )}

      {errors.services ? null : services.length === 0 ? (
        <p className="rounded-md bg-primary-50 p-4 text-sm text-ink">
          There are no active services yet.{' '}
          <Link href="/admin/services" className="font-semibold text-[#037F74] underline underline-offset-2">
            Add a service
          </Link>{' '}
          to see its queue here.
        </p>
      ) : (
        <>
          <table className="hidden w-full text-left text-sm md:table">
            <caption className="sr-only">Waiting, in consultation, nurses on duty and estimated wait for each active service</caption>
            <thead>
              <tr className="bg-primary-50 text-xs text-muted">
                <th scope="col" className="rounded-l-md px-4 py-3 font-normal">Service</th>
                <th scope="col" className="px-3 py-3 text-right font-normal">Waiting</th>
                <th scope="col" className="px-3 py-3 text-right font-normal">Serving</th>
                <th scope="col" className="rounded-r-md px-4 py-3 font-normal">Est. wait</th>
              </tr>
            </thead>
            <tbody>
              {services.map((row) => {
                const est = estimateText(row)
                return (
                  <tr key={row.serviceId} className="border-b border-border last:border-b-0">
                    <th scope="row" className="px-4 py-4 text-left font-normal">
                      <span className="block text-base text-ink">{row.serviceName}</span>
                      <span className="block text-xs text-muted">{nurseText(row.nursesOnDuty)}</span>
                    </th>
                    <td className="px-3 py-4 text-right text-base tabular-nums text-ink">{cell(row.waitingCount)}</td>
                    <td className="px-3 py-4 text-right text-base tabular-nums text-ink">{cell(row.servingCount)}</td>
                    <td className="px-4 py-4">
                      <span className={`block text-base ${est.tone === 'ok' ? 'text-ink' : 'font-semibold text-warning'}`}>{est.text}</span>
                      {est.detail && <span className="block text-xs text-muted">{est.detail}</span>}
                      <Confidence row={row} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <ul className="flex flex-col md:hidden" aria-label="Services">
            {services.map((row) => {
              const est = estimateText(row)
              return (
                <li key={row.serviceId} className="flex flex-col gap-3 border-b border-border py-4 first:pt-0 last:border-b-0">
                  <div>
                    <p className="text-base text-ink">{row.serviceName}</p>
                    <p className="text-xs text-muted">{nurseText(row.nursesOnDuty)}</p>
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-muted">Waiting</dt>
                      <dd className="tabular-nums text-ink">{cell(row.waitingCount)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Serving</dt>
                      <dd className="tabular-nums text-ink">{cell(row.servingCount)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Est. wait</dt>
                      <dd className={est.tone === 'ok' ? 'text-ink' : 'font-semibold text-warning'}>{est.text}</dd>
                    </div>
                  </dl>
                  {(est.detail || row.isBeingServed === true) && (
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      {est.detail}
                      <Confidence row={row} />
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}

      <div className="mt-auto flex flex-col gap-4 border-t border-border pt-4 sm:flex-row sm:items-end sm:justify-between">
        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          <div>
            <dt className="text-xs text-muted">Total waiting</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums text-ink">{cell(clinicState.waitingNow)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Total serving</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums text-ink">{cell(today.inConsultation)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Avg. wait today</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums text-[#037F74]">
              {clinicState.avgWaitTodayMinutes === null ? '—' : `${clinicState.avgWaitTodayMinutes} min`}
            </dd>
          </div>
        </dl>
        <Link
          href="/admin/reports"
          className="inline-flex min-h-11 items-center justify-center rounded-sm border-[1.2px] border-[#037F74] bg-surface px-5 text-sm font-semibold text-[#037F74] transition-colors hover:bg-primary-50"
        >
          View reports
        </Link>
      </div>
      <p className="text-xs text-muted">
        {clinicState.nursesOnDuty === null || clinicState.nursesTotal === null
          ? 'Nurse counts unavailable'
          : `${clinicState.nursesOnDuty} of ${clinicState.nursesTotal} nurses on duty`}
        {' · '}
        {clinicState.servicesCovered === null || clinicState.servicesTotal === null
          ? 'Service coverage unavailable'
          : `${clinicState.servicesCovered} of ${clinicState.servicesTotal} services covered`}
        {errors.queue ? ' · Today’s queue figures couldn’t be loaded' : ''}
      </p>
    </section>
  )
}
