'use client'

import { useCallback, useState } from 'react'
import { Clock3, UserPlus } from 'lucide-react'
import { type NurseCurrentEntry, type CalledResult, type QueueEmptyResult } from '@/app/actions/nurse'
import { createClient } from '@/lib/supabase/client'
import { useQueueBroadcast } from '@/lib/hooks/useQueueBroadcast'
import { useNextPatientFlow, type CompletedTransient } from '@/lib/hooks/useNextPatientFlow'
import { CLINIC_TIMEZONE } from '@/lib/clinicTime'
import { Button } from '@/components/ui/Button'
import { QueueToken } from '@/components/ui/QueueToken'

interface CurrentPatientPanelProps {
  initialEntry: NurseCurrentEntry | null
  serviceId: string
  /** clinic_settings.undo_window_seconds — needed because a queue_empty result doesn't carry its own copy (only 'called' does). */
  undoWindowSeconds: number
  /** service_consultation_stats(serviceId), fetched server-side — the same average the patient screen shows, not re-derived here (ADR-009). Refreshed whenever the page re-renders (every next_patient/undo/duty change already triggers that). */
  serviceAverageMinutes: number | null
  /** The token "Next patient" will call, so the consequence line can name it. Purely informational — next_patient's own atomic pick is what actually happens, so a token that goes stale between broadcasts is a display nicety, never a correctness risk. */
  initialNextToken: string | null
  /** The page's server-side read of the current consultation failed: start with the state unknown (Next patient paused). */
  initialStateError?: string | null
}

function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: CLINIC_TIMEZONE,
  })
}

/**
 * The Next patient / Undo state machine lives in useNextPatientFlow
 * (shared with the Nurse V3 My Queue screen); this component is its
 * working-screen presentation.
 */
export function CurrentPatientPanel({
  initialEntry,
  serviceId,
  undoWindowSeconds,
  serviceAverageMinutes,
  initialNextToken,
  initialStateError,
}: CurrentPatientPanelProps) {
  const [supabase] = useState(() => createClient())
  const [nextToken, setNextToken] = useState<string | null>(initialNextToken)
  const flow = useNextPatientFlow({ initialEntry, undoWindowSeconds, initialStateError })
  const { baseEntry, transient, error, now, isSubmitting, submit, handleUndo, canAdvance } = flow

  const refreshNextToken = useCallback(async () => {
    const { data } = await supabase.rpc('get_service_queue', { p_service_id: serviceId })
    setNextToken(data?.find((r) => r.status === 'waiting')?.token ?? null)
  }, [supabase, serviceId])

  useQueueBroadcast(serviceId, refreshNextToken)

  const nextActionHint =
    nextToken === null ? 'No one is waiting.' : `ends this consultation and calls ${nextToken}`

  // NEEDS_LONG_DECISION — a required confirmation. Warning-styled, not
  // the dark teal current-patient card: this is an interrupt, the same
  // one EndSessionControl shows for the same underlying reason, and it
  // should read like one.
  if (transient.kind === 'NEEDS_LONG_DECISION') {
    const minutes = Math.round(transient.durationMinutes)
    return (
      <section className="flex flex-col items-center gap-3 rounded-lg border border-warning bg-warning-bg p-6 text-center">
        <p className="text-xs font-semibold tracking-wide text-muted">CURRENT PATIENT</p>
        {baseEntry && (
          <>
            <p className="text-lg font-semibold text-ink">{baseEntry.patientName}</p>
            <QueueToken token={baseEntry.token} size="lg" />
          </>
        )}
        <p className="text-sm font-semibold text-ink">
          This consultation has been open for {minutes} minutes. Was this continuous patient care?
        </p>
        <StateUnknownNotice flow={flow} />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="primary" loading={isSubmitting} disabled={!canAdvance} onClick={() => submit('record')}>
            Record {minutes} min
          </Button>
          <Button variant="tertiary" loading={isSubmitting} disabled={!canAdvance} onClick={() => submit('break')}>
            Break occurred
          </Button>
        </div>
      </section>
    )
  }

  // COMPLETED_WITH_UNDO
  if (transient.kind === 'COMPLETED_WITH_UNDO') {
    const { result } = transient
    if (result.status === 'queue_empty') {
      return (
        <section className="flex flex-col gap-4 rounded-lg bg-primary-900 p-6 text-white">
          <p className="text-xs font-semibold tracking-wide text-primary-100">CURRENT PATIENT</p>
          <p className="text-lg font-semibold">Consultation completed. No patients waiting.</p>
          <UndoStrip t={transient} now={now} onUndo={handleUndo} />
          <StateUnknownNotice flow={flow} />
        </section>
      )
    }

    // status === 'called': the newly called patient is already baseEntry.
    return (
      <section className="flex flex-col gap-4 rounded-lg bg-primary-900 p-6 text-white">
        <CurrentPatientHeader />
        <div className="flex items-center gap-3">
          <p className="text-lg font-semibold">{result.patient_name}</p>
          <QueueToken token={result.token} size="lg" tone="white" />
        </div>
        {baseEntry && <CheckInLine entry={baseEntry} />}
        <StatsRow elapsedStartedAt={baseEntry?.startedAt ?? null} now={now} serviceAverageMinutes={serviceAverageMinutes} />
        <div>
          <Button variant="primary" loading={isSubmitting} disabled={!canAdvance} onClick={() => submit()}>
            Next patient
          </Button>
          <p className="mt-1.5 text-xs text-primary-100">{nextActionHint}</p>
        </div>
        <UndoStrip t={transient} now={now} onUndo={handleUndo} />
        <StateUnknownNotice flow={flow} />
      </section>
    )
  }

  // IDLE / IN_PROGRESS (transient is NONE or SUBMITTING)
  return (
    <section className="flex flex-col gap-4 rounded-lg bg-primary-900 p-6 text-white">
      <CurrentPatientHeader hasPatient={!!baseEntry} />

      {baseEntry ? (
        <>
          <div className="flex items-center gap-3">
            <p className="text-lg font-semibold">{baseEntry.patientName}</p>
            <QueueToken token={baseEntry.token} size="lg" tone="white" />
          </div>
          <CheckInLine entry={baseEntry} />
          <StatsRow elapsedStartedAt={baseEntry.startedAt} now={now} serviceAverageMinutes={serviceAverageMinutes} />
        </>
      ) : (
        <p className="text-sm text-primary-100">
          {flow.stateError ? 'Current consultation not confirmed.' : 'No patient in consultation.'}
        </p>
      )}

      <StateUnknownNotice flow={flow} />

      {error && (
        <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      <div>
        <Button variant="primary" loading={isSubmitting} disabled={!canAdvance} onClick={() => submit()}>
          {baseEntry ? 'Next patient' : 'Call next patient'}
        </Button>
        <p className="mt-1.5 text-xs text-primary-100">
          {baseEntry ? nextActionHint : nextToken ? `calls ${nextToken}` : 'No one is waiting.'}
        </p>
      </div>
    </section>
  )
}

/** Fail closed when the current consultation is unknown: Next patient is disabled; "Check again" only re-reads. */
function StateUnknownNotice({ flow }: { flow: ReturnType<typeof useNextPatientFlow> }) {
  if (!flow.stateError) return null
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-warning-bg px-3 py-2 text-sm font-semibold text-ink">
      <p>{flow.stateError}</p>
      <Button variant="secondary" loading={flow.retrying} onClick={() => flow.retryStateRead()}>
        Check again
      </Button>
    </div>
  )
}

function CurrentPatientHeader({ hasPatient = true }: { hasPatient?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <p className="text-xs font-semibold tracking-wide text-primary-100">CURRENT PATIENT</p>
      {hasPatient && (
        <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-900">
          In consultation
        </span>
      )}
    </div>
  )
}

function CheckInLine({ entry }: { entry: NurseCurrentEntry }) {
  return (
    <div className="flex items-center gap-3 text-sm text-primary-100">
      <span className="flex items-center gap-1.5">
        <Clock3 size={14} aria-hidden />
        Checked in {formatClockTime(entry.checkedInAt)}
      </span>
      {entry.isWalkIn && (
        <span className="flex items-center gap-1.5">
          <UserPlus size={14} aria-hidden />
          Walk-in
        </span>
      )}
    </div>
  )
}

/**
 * Consultation time and service average side by side so the nurse can
 * self-calibrate ("am I running long?") without doing arithmetic — and
 * it's the same average figure the patient screen shows, not a
 * second, differently-derived one.
 */
function StatsRow({
  elapsedStartedAt,
  now,
  serviceAverageMinutes,
}: {
  elapsedStartedAt: string | null
  now: number
  serviceAverageMinutes: number | null
}) {
  return (
    <div className="flex gap-6">
      <div>
        <p className="text-xs font-semibold tracking-wide text-primary-100">CONSULTATION TIME</p>
        <ElapsedTimer startedAt={elapsedStartedAt} now={now} />
      </div>
      <div>
        <p className="text-xs font-semibold tracking-wide text-primary-100">SERVICE AVERAGE</p>
        <p className="font-mono text-2xl font-semibold tabular-nums">
          {serviceAverageMinutes !== null ? `${Math.round(serviceAverageMinutes)} min` : '—'}
        </p>
      </div>
    </div>
  )
}

function endedNote(result: CalledResult | QueueEmptyResult): string {
  if (result.ended_counted !== false) return ''
  return result.ended_exclusion_reason === 'staff_break' ? ' (break)' : ' — not counted towards the average'
}

function UndoStrip({
  t,
  now,
  onUndo,
}: {
  t: CompletedTransient
  now: number
  onUndo: (actionId: string) => void
}) {
  // A 'called' result is always undoable — it reverses the new call
  // itself, regardless of whether a previous consultation was also
  // ended. A 'queue_empty' result is only undoable when it actually
  // ended something (ended_token set); an empty-queue check with
  // nothing open before it has nothing to restore.
  if (t.result.status !== 'called' && !t.result.ended_token) return null

  const { result } = t
  const endedLine = result.ended_token
    ? `${result.status === 'called' ? `Called ${result.token} · ` : ''}ended ${result.ended_token}${
        result.ended_minutes !== null ? ` at ${Math.round(result.ended_minutes)} min` : ''
      }${endedNote(result)}`
    : `Called ${result.status === 'called' ? result.token : ''}`

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-primary-700 px-3 py-2">
      <p className="text-sm text-primary-100">{endedLine}</p>
      <UndoButton t={t} now={now} onUndo={onUndo} />
    </div>
  )
}

function UndoButton({
  t,
  now,
  onUndo,
}: {
  t: CompletedTransient
  now: number
  onUndo: (actionId: string) => void
}) {
  if (t.disabledReason) {
    return <p className="text-xs text-primary-100">{t.disabledReason}</p>
  }
  const secondsLeft = Math.max(0, Math.floor((t.deadline - now) / 1000))
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" loading={t.undoSubmitting} onClick={() => onUndo(t.actionId)}>
        Undo ({secondsLeft}s)
      </Button>
      {t.undoError && (
        <p role="alert" className="text-xs text-primary-100">
          {t.undoError}
        </p>
      )}
    </div>
  )
}

function ElapsedTimer({ startedAt, now }: { startedAt: string | null; now: number }) {
  if (!startedAt) return null
  const elapsedSeconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const mm = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')
  const ss = String(elapsedSeconds % 60).padStart(2, '0')
  return (
    <p className="font-mono text-2xl font-semibold tabular-nums text-white">
      {mm}:{ss}
    </p>
  )
}
