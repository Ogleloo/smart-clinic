'use client'

import { useState } from 'react'
import type { AdminDashboardErrors, ServicePerformanceRow } from '@/lib/adminDashboard'
import {
  PRESETS, evaluateScenario, type AdvisorReport, type PolicyResult,
  type ServiceKey, type SyntheticScenario, type SyntheticService,
} from '@/lib/research/nurseAllocationAdvisor'

interface Props {
  /** Live, aggregated information already available to the Admin dashboard; NEVER a model input. */
  liveServices: Pick<ServicePerformanceRow, 'serviceId' | 'serviceName' | 'waitingCount' | 'nursesOnDuty' | 'estimatedWaitMinutes' | 'isBeingServed'>[]
  errors: Pick<AdminDashboardErrors, 'services' | 'coverage' | 'perService'>
}

const oneDecimal = (n: number | null) => n === null || !Number.isFinite(n) ? '—' : `${n.toFixed(1)} min`
const whole = (n: number | null) => n === null ? '—' : String(n)
const bounded = (value: string, min: number, max: number, previous: number) => {
  const num = Number(value)
  return value.trim() !== '' && Number.isInteger(num) ? Math.min(max, Math.max(min, num)) : previous
}
/**
 * A wide table in a keyboard-focusable, labelled scroll region. The hint is shown by a CSS container query, exactly
 * when the region is narrower than the table's minimum width (so only when there really is something to scroll to,
 * with no JavaScript and no flash); it is the region's accessible description either way. The region is focusable
 * (tabIndex 0) so arrow keys / Home / End scroll it without a mouse or touch, and the global :focus-visible ring
 * shows. Classes are written out in full so Tailwind can see them.
 */
const SCROLL_HINT = {
  live: { table: 'min-w-[520px]', hint: '@max-[520px]:block' },
  comparison: { table: 'min-w-[680px]', hint: '@max-[680px]:block' },
} as const

function ScrollableTable({ id, label, kind, children }: { id: string; label: string; kind: keyof typeof SCROLL_HINT; children: React.ReactNode }) {
  return (
    <div className="@container mt-4">
      <p id={`${id}-hint`} className={`mb-2 hidden text-sm font-semibold text-ink ${SCROLL_HINT[kind].hint}`}>
        Swipe or scroll horizontally to view more columns
      </p>
      <div
        role="region"
        tabIndex={0}
        aria-label={label}
        aria-describedby={`${id}-hint`}
        className="overflow-x-auto rounded-md border border-border"
      >
        {children}
      </div>
    </div>
  )
}

const baselineMean = (p: PolicyResult) => oneDecimal(p.forecast.overallMeanStartWaitMinutes)
const moveDescription = (p: PolicyResult) => p.forecast.move
  ? `${p.forecast.move.from === 'general' ? 'General' : 'Chronic'} → ${p.forecast.move.to === 'general' ? 'General' : 'Chronic'}`
  : 'No move'

type LiveRow = Props['liveServices'][number]
/** The engine-estimate wording, shared by the table and the cards. An unknown value is never shown as a number. */
const liveEstimate = (row: LiveRow, coverageFailed: boolean) =>
  coverageFailed || row.isBeingServed === null ? 'Unavailable'
    : row.isBeingServed === false ? 'No estimate — uncovered'
    : row.estimatedWaitMinutes === null ? 'No estimate'
    : `~${row.estimatedWaitMinutes} min`

function LivePanel({ liveServices, errors }: Props) {
  return (
    <section aria-labelledby="allocation-live" className="rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 id="allocation-live" className="font-display text-xl font-semibold text-ink">Observed service snapshot</h2>
      <p className="mt-1 text-sm text-muted">
        Read-only figures from the existing Admin dashboard loader. They are <strong>not</strong> inserted into the hypothetical allocation model.
        No personnel identity or qualification is retrieved.
      </p>
      {errors.services ? (
        <p role="alert" className="mt-4 rounded-md bg-danger-bg p-3 text-sm text-danger">Services could not be loaded.</p>
      ) : liveServices.length === 0 ? (
        <p className="mt-4 rounded-md bg-primary-50 p-3 text-sm">There are no active services to display.</p>
      ) : (
        <>
        <ul aria-label="Observed services" className="mt-4 grid gap-3 sm:grid-cols-2 xl:hidden">
          {liveServices.map((row) => (
            <li key={row.serviceId} className="rounded-md border border-border p-4">
              <h3 className="font-display text-base font-semibold text-ink">{row.serviceName}</h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-muted">Waiting</dt>
                  <dd className="tabular-nums text-ink">{errors.coverage ? '—' : whole(row.waitingCount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Nurses on duty</dt>
                  <dd className="tabular-nums text-ink">{whole(row.nursesOnDuty)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-muted">Engine estimate</dt>
                  <dd className="text-ink">{liveEstimate(row, errors.coverage)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        <div className="hidden xl:block">
        <ScrollableTable id="allocation-live-table" label="Observed service snapshot table" kind="live">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm">
            <caption className="sr-only">Current per-service queue and staffing aggregates; no patient names</caption>
            <thead className="bg-primary-50 text-muted">
              <tr><th scope="col" className="p-3">Service</th><th scope="col" className="p-3 text-right">Waiting</th><th scope="col" className="p-3 text-right">Nurses on duty</th><th scope="col" className="p-3 text-right">Engine estimate</th></tr>
            </thead>
            <tbody>
              {liveServices.map((row) => (
                <tr key={row.serviceId} className="border-t border-border text-ink">
                  <th scope="row" className="p-3 font-medium">{row.serviceName}</th>
                  <td className="p-3 text-right tabular-nums">{errors.coverage ? '—' : whole(row.waitingCount)}</td>
                  <td className="p-3 text-right tabular-nums">{whole(row.nursesOnDuty)}</td>
                  <td className="p-3 text-right">{liveEstimate(row, errors.coverage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
        </div>
        </>
      )}
      {(errors.coverage || errors.perService) && (
        <p role="status" className="mt-3 text-sm text-warning">
          Some coverage or staffing figures are unavailable; an unknown value is never treated as zero.
        </p>
      )}
    </section>
  )
}

function ComparisonTable({ report }: { report: AdvisorReport }) {
  const models = [report.baseline, ...report.comparisons]
  const generalMean = (p: PolicyResult) => oneDecimal(p.forecast.services.find((s) => s.id === 'general')!.meanStartWaitMinutes)
  const chronicMean = (p: PolicyResult) => oneDecimal(p.forecast.services.find((s) => s.id === 'chronic')!.meanStartWaitMinutes)
  return (
    <section aria-labelledby="allocation-comparison" className="rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 id="allocation-comparison" className="font-display text-xl font-semibold text-ink">Policy comparison — synthetic only</h2>
      <p className="mt-1 text-sm text-muted">Deterministic next-free start times for patients already waiting. Lower does not establish a clinically preferable allocation.</p>
      <ul aria-label="Policy comparison" className="mt-4 grid gap-3 sm:grid-cols-2 xl:hidden">
        {models.map((p) => (
          <li key={p.key} className="rounded-md border border-border p-4">
            <h3 className="font-display text-base font-semibold text-ink">{p.title}</h3>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div className="col-span-2">
                <dt className="text-xs text-muted">One hypothetical move</dt>
                <dd className="text-ink">{moveDescription(p)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted">Overall mean start wait</dt>
                <dd className="tabular-nums text-ink">{baselineMean(p)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">General</dt>
                <dd className="tabular-nums text-ink">{generalMean(p)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Chronic</dt>
                <dd className="tabular-nums text-ink">{chronicMean(p)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Unserved</dt>
                <dd className="tabular-nums text-ink">{p.forecast.patientsUnserved}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden xl:block">
      <ScrollableTable id="allocation-comparison-table" label="Policy comparison table" kind="comparison">
        <table className="w-full min-w-[680px] border-collapse text-left text-sm">
          <caption className="sr-only">Hypothetical staffing-policy comparisons for the synthetic scenario</caption>
          <thead className="bg-primary-50 text-muted">
            <tr><th scope="col" className="p-3">Policy</th><th scope="col" className="p-3">One hypothetical move</th><th scope="col" className="p-3 text-right">Overall mean start wait</th><th scope="col" className="p-3 text-right">General</th><th scope="col" className="p-3 text-right">Chronic</th><th scope="col" className="p-3 text-right">Unserved</th></tr>
          </thead>
          <tbody>
            {models.map((p) => (
              <tr key={p.key} className="border-t border-border text-ink">
                <th scope="row" className="p-3 font-medium">{p.title}</th>
                <td className="p-3">{moveDescription(p)}</td>
                <td className="p-3 text-right tabular-nums">{baselineMean(p)}</td>
                <td className="p-3 text-right tabular-nums">{generalMean(p)}</td>
                <td className="p-3 text-right tabular-nums">{chronicMean(p)}</td>
                <td className="p-3 text-right tabular-nums">{p.forecast.patientsUnserved}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
      </div>
      <p className="mt-3 text-sm text-muted">
        A dash means the model cannot calculate a finite wait because some queued patients have no assigned nurse. The count-only and workload policies are research comparators, not automatically safe choices.
      </p>
      <div className="mt-4 space-y-2">
        {models.slice(1).map((p) => (
          <p key={p.key} className="text-sm text-muted"><strong className="text-ink">{p.title}:</strong> {p.explanation}</p>
        ))}
      </div>
    </section>
  )
}

function NumericControl({ id, name, value, min, max, onChange }: {
  id: string; name: string; value: number; min: number; max: number; onChange: (n: number) => void
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm text-ink">
      <span className="text-muted">{name}</span>
      <input id={id} type="number" min={min} max={max} step="1" value={value}
        onChange={(e) => onChange(bounded(e.target.value, min, max, value))}
        className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-base text-ink" />
    </label>
  )
}

export function AllocationAdvisorView({ liveServices, errors }: Props) {
  const [scenario, setScenario] = useState<SyntheticScenario>(() => structuredClone(PRESETS[0]))
  const [report, setReport] = useState<AdvisorReport>(() => evaluateScenario(PRESETS[0]))
  const [changed, setChanged] = useState(false)

  function choosePreset(id: string) {
    const preset = PRESETS.find((p) => p.id === id) ?? PRESETS[0]
    const next = structuredClone(preset)
    setScenario(next)
    setReport(evaluateScenario(next))
    setChanged(false)
  }
  function editService(id: ServiceKey, key: keyof SyntheticService, value: number) {
    setScenario((old) => {
      const next = structuredClone(old)
      const current = next.services.find((s) => s.id === id)!
      if (key === 'nurses') {
        current.nurses = value
        current.busyNurses = Math.min(current.busyNurses, value)
      } else if (key === 'waiting') {
        current.waiting = value
        current.priorityWaiting = Math.min(current.priorityWaiting, value)
      } else if (key === 'busyNurses' || key === 'priorityWaiting' || key === 'meanConsultationMinutes') {
        current[key] = value
      }
      return next
    })
    setChanged(true)
  }
  function evaluate() { setReport(evaluateScenario(scenario)); setChanged(false) }

  return (
    <div className="mx-auto flex w-full max-w-[1176px] flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#037F74]">Admin V3 · Research prototype</p>
        <h1 className="font-display text-3xl font-bold text-ink">Smart Nurse Allocation Advisor</h1>
        <p className="max-w-[840px] text-base text-muted">
          Monitor real service demand and explore controlled staffing scenarios. The simulation <strong>does not use real patient or nurse data</strong>, does not know nurse qualifications and cannot reassign staff.
        </p>
      </header>

      <LivePanel liveServices={liveServices} errors={errors} />

      <section aria-labelledby="allocation-synthetic" className="rounded-lg border border-border bg-surface p-4 sm:p-6">
        <h2 id="allocation-synthetic" className="font-display text-xl font-semibold text-ink">Synthetic research scenario</h2>
        <p className="mt-1 text-sm text-muted">Choose a preset or adjust illustrative values. No live appointments, queue entries or staff records are changed.</p>
        <label htmlFor="allocation-preset" className="mt-4 flex flex-col gap-2 text-sm font-medium text-ink">
          Scenario
          <select id="allocation-preset" value={scenario.id} onChange={(e) => choosePreset(e.target.value)}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-base">
            {PRESETS.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </label>
        <p className="mt-2 text-sm text-muted">{scenario.description}</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {scenario.services.map((svc) => (
            <fieldset key={svc.id} className="min-w-0 rounded-lg border border-border bg-paper p-4">
              <legend className="px-1 font-display text-base font-semibold text-ink">{svc.name} (illustrative)</legend>
              <div className="grid grid-cols-2 gap-3">
                <NumericControl id={`${svc.id}-waiting`} name="Waiting" min={0} max={100} value={svc.waiting} onChange={(n) => editService(svc.id, 'waiting', n)} />
                <NumericControl id={`${svc.id}-duration`} name="Mean duration (min)" min={1} max={120} value={svc.meanConsultationMinutes} onChange={(n) => editService(svc.id, 'meanConsultationMinutes', n)} />
                <NumericControl id={`${svc.id}-nurses`} name="Nurses assigned" min={0} max={12 - scenario.services.find((v) => v.id !== svc.id)!.nurses} value={svc.nurses} onChange={(n) => editService(svc.id, 'nurses', n)} />
                <NumericControl id={`${svc.id}-busy`} name="Nurses currently busy" min={0} max={svc.nurses} value={svc.busyNurses} onChange={(n) => editService(svc.id, 'busyNurses', n)} />
                <NumericControl id={`${svc.id}-priority`} name="Priority patients" min={0} max={svc.waiting} value={svc.priorityWaiting} onChange={(n) => editService(svc.id, 'priorityWaiting', n)} />
              </div>
            </fieldset>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label htmlFor="allocation-transfer" className="flex w-full flex-col gap-1 text-sm text-muted sm:max-w-[170px]">
            Transfer delay (min)
            <input id="allocation-transfer" type="number" min="0" max="60" value={scenario.transferMinutes}
              onChange={(e) => { setScenario((s) => ({ ...s, transferMinutes: bounded(e.target.value, 0, 60, s.transferMinutes) })); setChanged(true) }}
              className="min-h-11 rounded-md border border-border bg-surface px-3 text-base text-ink" />
          </label>
          <label className="flex min-h-11 flex-1 items-center gap-2 rounded-md border border-border px-3 text-sm text-ink">
            <input type="checkbox" checked={scenario.crossQualifiedIdleHelper}
              onChange={(e) => { setScenario((s) => ({ ...s, crossQualifiedIdleHelper: e.target.checked })); setChanged(true) }} />
            Assume an idle, cross-qualified helper exists (synthetic only)
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={evaluate}
            className="min-h-11 rounded-md bg-[#037F74] px-5 py-3 text-sm font-semibold text-white hover:bg-[#026B62]">
            Evaluate Allocation
          </button>
          <span role="status" className="text-sm text-muted">{changed ? 'Inputs changed — evaluate to refresh the results.' : 'Results match the current synthetic inputs.'}</span>
        </div>
        {scenario.services[0].nurses + scenario.services[1].nurses > 12 && (
          <p role="alert" className="mt-3 text-sm text-danger">Maximum combined nurse count for this demonstration is 12. Reduce the number before evaluating.</p>
        )}
      </section>

      {changed ? (
        <p role="status" className="rounded-md border border-border bg-primary-50 p-4 text-sm text-ink">The result below reflects the previous scenario. Select <strong>Evaluate Allocation</strong> to update it.</p>
      ) : null}
      <section aria-labelledby="allocation-finding" className="rounded-lg border border-border bg-surface p-4 sm:p-6">
        <h2 id="allocation-finding" className="font-display text-xl font-semibold text-ink">Research finding — not a staffing instruction</h2>
        <p className="mt-2 text-base text-ink">{report.modelFindingText}</p>
        <p className="mt-2 text-sm text-muted">
          Current scenario: {report.baseline.forecast.patientsWaiting} patients waiting. Baseline mean modeled start wait: {oneDecimal(report.baseline.forecast.overallMeanStartWaitMinutes)}.
          {report.baseline.forecast.patientsUnserved > 0 ? ` ${report.baseline.forecast.patientsUnserved} patients are unserved in this snapshot.` : ''}
        </p>
        {report.comparisons[2].forecast.move && report.comparisons[2].meanWaitChangeMinutes !== null && (
          <p className="mt-2 text-sm text-ink">Illustrative change in mean wait (next-free minus current): <strong>{report.comparisons[2].meanWaitChangeMinutes.toFixed(1)} min</strong>. Review each service&rsquo;s effect before interpreting this number.</p>
        )}
      </section>
      <ComparisonTable report={report} />
      <section aria-labelledby="allocation-limits" className="rounded-lg border border-border bg-surface p-4 sm:p-6">
        <h2 id="allocation-limits" className="font-display text-xl font-semibold text-ink">Assumptions and limitations</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted">
          {report.assumptions.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p className="mt-4 text-sm text-muted">
          This demonstration is informed by the eight-round synthetic WANR research program, but is a smaller independent snapshot model.
          The earlier experiments did not establish a universally superior policy, safe activation timing, or clinical eligibility.
          Real nurse reassignment and supervisor approval remain out of scope.
        </p>
      </section>
    </div>
  )
}
