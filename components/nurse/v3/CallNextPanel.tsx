'use client'

import { AlertTriangle, Check, Clock3, UserPlus } from 'lucide-react'
import type { CalledResult, NurseCurrentEntry, QueueEmptyResult } from '@/app/actions/nurse'
import type { CompletedTransient, useNextPatientFlow } from '@/lib/hooks/useNextPatientFlow'
import { formatActivityTime } from './RecentActivityPanel'
import { EmergencyPill, StatusPill } from './queuePills'

type Flow = ReturnType<typeof useNextPatientFlow>

interface CallNextPanelProps {
  flow: Flow
  /** First waiting token in the latest queue read. Informational only: next_patient() makes its own atomic pick. */
  nextToken: string | null
  serviceName: string | null
  serviceAverageMinutes: number | null
}

/** White on #037F74 is 5.0:1; Figma's #08B9A8 fill is 2.47:1, so primary actions use the darker teal (as Reception Profile Settings does). */
const PRIMARY_BTN =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-sm bg-[#037F74] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#026B62] disabled:cursor-not-allowed disabled:opacity-60'
const OUTLINE_BTN =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-sm border-[1.2px] border-[#037F74] bg-surface px-5 text-sm font-semibold text-[#037F74] transition-colors hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60'
const CARD = 'rounded-lg border border-border bg-surface shadow-[0_8px_16px_rgba(5,48,46,0.05)]'

function endedNote(result: CalledResult | QueueEmptyResult): string {
  if (result.ended_counted !== false) return ''
  return result.ended_exclusion_reason === 'staff_break' ? ' (break)' : ' — not counted towards the average'
}

function endedLine(result: CalledResult | QueueEmptyResult): string | null {
  if (!result.ended_token) return null
  const minutes = result.ended_minutes !== null ? ` after ${Math.round(result.ended_minutes)} min` : ''
  return `${result.ended_token}’s consultation ended${minutes}${endedNote(result)}.`
}

function ElapsedTimer({ startedAt, now }: { startedAt: string; now: number }) {
  const elapsedSeconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const mm = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')
  const ss = String(elapsedSeconds % 60).padStart(2, '0')
  return (
    <span className="font-mono text-xl font-semibold tabular-nums text-ink">
      {mm}:{ss}
    </span>
  )
}

function UndoButton({ t, now, onUndo }: { t: CompletedTransient; now: number; onUndo: (actionId: string) => void }) {
  if (t.disabledReason) {
    return (
      <p role="status" className="text-sm text-muted">
        {t.disabledReason}
      </p>
    )
  }
  const secondsLeft = Math.max(0, Math.floor((t.deadline - now) / 1000))
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        className={`${OUTLINE_BTN} sm:w-[220px]`}
        disabled={t.undoSubmitting}
        onClick={() => onUndo(t.actionId)}
        aria-label={`Undo call, ${secondsLeft} seconds left`}
      >
        {t.undoSubmitting ? 'Please wait…' : `Undo call (${secondsLeft}s)`}
      </button>
      {t.undoError && (
        <p role="alert" className="text-sm font-semibold text-[#B42318] sm:max-w-[220px]">
          {t.undoError}
        </p>
      )}
    </div>
  )
}

/** A 'called' result is always undoable; a 'queue_empty' one only when it actually ended a consultation (same rule as the working screen). */
function isUndoable(t: CompletedTransient): boolean {
  return t.result.status === 'called' || !!t.result.ended_token
}

function NextButton({ flow, hasPatient, nextToken }: { flow: Flow; hasPatient: boolean; nextToken: string | null }) {
  const hint = hasPatient
    ? nextToken
      ? `Ends this consultation and calls the next patient (${nextToken} is next in line).`
      : 'Ends this consultation. No one is waiting.'
    : nextToken
      ? `${nextToken} is next in line.`
      : 'No one is waiting.'
  return (
    <div className="flex flex-col gap-1.5 sm:items-end">
      <button
        type="button"
        className={`${PRIMARY_BTN} sm:min-w-[220px]`}
        disabled={flow.isSubmitting || !flow.canAdvance}
        aria-describedby={flow.canAdvance ? undefined : 'state-unknown-hint'}
        onClick={() => flow.submit()}
      >
        {flow.isSubmitting ? 'Please wait…' : hasPatient ? 'Next patient' : 'Call next patient'}
      </button>
      <p id={flow.canAdvance ? undefined : 'state-unknown-hint'} className="text-xs text-muted sm:max-w-[300px] sm:text-right">
        {flow.canAdvance ? hint : 'Paused until your current consultation is confirmed.'}
      </p>
    </div>
  )
}

/**
 * The current consultation could not be read, so Next patient is paused (fail closed). "Check again" only
 * re-reads; it never calls next_patient() or undo.
 */
function StateUnknownAlert({ flow }: { flow: Flow }) {
  if (!flow.stateError) return null
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-md bg-warning-bg px-4 py-3 text-sm text-ink sm:flex-row sm:items-center sm:justify-between">
      <p className="font-semibold">{flow.stateError}</p>
      <button type="button" className={`${OUTLINE_BTN} min-h-11 shrink-0`} disabled={flow.retrying} onClick={() => flow.retryStateRead()}>
        {flow.retrying ? 'Checking…' : 'Check again'}
      </button>
    </div>
  )
}

function ErrorAlert({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-md bg-danger-bg px-4 py-3 text-sm font-semibold text-[#B42318]">
      {message} Try again — a retry repeats the same request, it can’t call two patients.
    </p>
  )
}

function CurrentPatientSummary({ entry, now, serviceName, serviceAverageMinutes }: {
  entry: NurseCurrentEntry
  now: number
  serviceName: string | null
  serviceAverageMinutes: number | null
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[22px] font-semibold leading-7 text-[#037F74]">{entry.token}</span>
        <StatusPill status="in_consultation" />
        {entry.priority > 0 && <EmergencyPill />}
      </div>
      <p className="break-words text-base text-ink">{entry.patientName}</p>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {serviceName && <span>{serviceName}</span>}
        <span className="inline-flex items-center gap-1.5">
          <Clock3 size={14} aria-hidden />
          Checked in {formatActivityTime(entry.checkedInAt)}
        </span>
        {entry.isWalkIn && (
          <span className="inline-flex items-center gap-1.5">
            <UserPlus size={14} aria-hidden />
            Walk-in
          </span>
        )}
      </p>
      <dl className="mt-1 flex flex-wrap gap-6">
        <div>
          <dt className="text-xs text-muted">Consultation time</dt>
          <dd><ElapsedTimer startedAt={entry.startedAt} now={now} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Service average</dt>
          <dd className="font-mono text-xl font-semibold tabular-nums text-ink">
            {serviceAverageMinutes !== null ? `${Math.round(serviceAverageMinutes)} min` : '—'}
          </dd>
        </div>
      </dl>
    </div>
  )
}

/**
 * Current patient + Call next for Nurse V3 My Queue, driven entirely by useNextPatientFlow (the same state
 * machine as the working screen). There is deliberately no per-patient "Start consultation": next_patient()
 * picks the next eligible patient and opens the consultation in one atomic step, so the nurse never chooses a
 * row to start.
 */
export function CallNextPanel({ flow, nextToken, serviceName, serviceAverageMinutes }: CallNextPanelProps) {
  const { transient, baseEntry, now, error } = flow

  if (transient.kind === 'NEEDS_LONG_DECISION') {
    const minutes = Math.round(transient.durationMinutes)
    return (
      <section id="current-patient" aria-labelledby="current-patient-title" className="flex flex-col gap-4 rounded-lg border border-warning bg-warning-bg p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle size={22} className="mt-0.5 shrink-0 text-[#8A5600]" aria-hidden />
          <div className="flex flex-col gap-1">
            <h2 id="current-patient-title" className="text-base font-semibold text-ink">
              {baseEntry ? `${baseEntry.token} · ${baseEntry.patientName}` : 'Current consultation'}
            </h2>
            <p className="text-sm text-ink">
              This consultation has been open for {minutes} minutes. Was this continuous patient care?
            </p>
          </div>
        </div>
        <StateUnknownAlert flow={flow} />
        <ErrorAlert message={error} />
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" className={PRIMARY_BTN} disabled={flow.isSubmitting || !flow.canAdvance} onClick={() => flow.submit('record')}>
            {flow.isSubmitting ? 'Please wait…' : `Record ${minutes} min`}
          </button>
          <button type="button" className={OUTLINE_BTN} disabled={flow.isSubmitting || !flow.canAdvance} onClick={() => flow.submit('break')}>
            Break occurred
          </button>
        </div>
      </section>
    )
  }

  if (transient.kind === 'COMPLETED_WITH_UNDO') {
    const { result } = transient
    const ended = endedLine(result)
    const called = result.status === 'called' ? result : null
    // Figma 164:192 "Patient Called Successfully": success badge, the called patient's card, Undo Call. Its
    // "Start Consultation" button is not reproduced — the consultation is already open (next_patient opened it),
    // so the primary action here is the real next step: Next patient.
    return (
      <section id="current-patient" aria-labelledby="current-patient-title" className={`${CARD} flex flex-col items-center gap-5 p-6`}>
        <span className="flex size-24 items-center justify-center rounded-[24px] bg-[#E5FBF7]" aria-hidden>
          <Check size={36} className="text-[#037F74]" />
        </span>
        <div role="status" className="flex flex-col items-center gap-1 text-center">
          <h2 id="current-patient-title" className="font-display text-[22px] font-semibold leading-7 text-ink">
            {called ? 'Patient called successfully' : 'Consultation completed'}
          </h2>
          <p className="text-base text-muted">
            {called
              ? `${called.token} — ${called.patient_name} is now in consultation.`
              : 'No patients are waiting.'}
          </p>
        </div>

        {called && (
          <div className={`${CARD} flex w-full max-w-[580px] flex-col gap-4 p-6 sm:flex-row sm:justify-between`}>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-display text-[22px] font-semibold leading-7 text-[#037F74]">{called.token}</span>
              <span className="break-words text-base text-ink">{called.patient_name}</span>
              {serviceName && <span className="text-xs text-muted">{serviceName}</span>}
            </div>
            <dl className="grid shrink-0 grid-cols-2 gap-4 text-xs text-muted sm:flex sm:w-[150px] sm:flex-col sm:gap-3">
              <div>
                <dt>Called at</dt>
                <dd className="text-sm text-ink">{baseEntry?.startedAt ? formatActivityTime(baseEntry.startedAt) : '—'}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd className="text-sm text-ink">
                  {baseEntry?.consultationId === called.consultation_id ? 'In consultation' : 'Consultation status unavailable'}
                </dd>
              </div>
            </dl>
          </div>
        )}

        {ended && <p className="text-sm text-muted">{ended}</p>}
        <StateUnknownAlert flow={flow} />
        <ErrorAlert message={error} />

        <div className="flex w-full max-w-[580px] flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {isUndoable(transient) ? <UndoButton t={transient} now={now} onUndo={flow.handleUndo} /> : <span />}
          {called && <NextButton flow={flow} hasPatient nextToken={nextToken} />}
        </div>
      </section>
    )
  }

  return (
    <section id="current-patient" aria-labelledby="current-patient-title" className={`${CARD} flex flex-col gap-4 p-6`}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-3">
          <h2 id="current-patient-title" className="text-xs font-semibold uppercase tracking-wide text-muted">
            Current patient
          </h2>
          {baseEntry ? (
            <CurrentPatientSummary entry={baseEntry} now={now} serviceName={serviceName} serviceAverageMinutes={serviceAverageMinutes} />
          ) : flow.stateError ? (
            <p className="text-base text-ink">Current consultation not confirmed.</p>
          ) : (
            <p className="text-base text-ink">No patient in consultation.</p>
          )}
        </div>
        <NextButton flow={flow} hasPatient={!!baseEntry} nextToken={nextToken} />
      </div>
      <StateUnknownAlert flow={flow} />
      <ErrorAlert message={error} />
    </section>
  )
}
