'use client'

import { useActionState, useEffect, useState } from 'react'
import {
  callNextPatient,
  startConsultation,
  endConsultation,
  skipPatient,
  type CallNextState,
  type StartState,
  type EndState,
  type SkipState,
  type CurrentEntry,
} from '@/app/actions/nurse'
import { Button } from '@/components/ui/Button'
import { QueueToken } from '@/components/ui/QueueToken'

interface CurrentPatientPanelProps {
  initialEntry: CurrentEntry | null
  /** Present only when a consultation has actually been started (not just called). */
  initialStartedAt: string | null
}

/**
 * Three states, driven by two independent signals rather than a single
 * enum: `entry` (do we have a called patient at all) and `startedAt`
 * (has start_consultation actually run for them). "called" is not a
 * queue_entries.status value — call_next_patient sets status
 * 'in_progress' immediately, before any consultation exists — so the
 * distinction between "called" and "consultation actually running" is
 * derived from whether a consultations row exists, both on first load
 * (in the server page) and here after each action.
 */
export function CurrentPatientPanel({ initialEntry, initialStartedAt }: CurrentPatientPanelProps) {
  const [entry, setEntry] = useState<CurrentEntry | null>(initialEntry)
  const [startedAt, setStartedAt] = useState<string | null>(initialStartedAt)
  const [endResult, setEndResult] = useState<EndState['result'] | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const [callState, callAction, calling] = useActionState<CallNextState, FormData>(callNextPatient, {})
  const [startState, startFormAction, starting] = useActionState<StartState, FormData>(
    startConsultation,
    {}
  )
  const [endState, endFormAction, ending] = useActionState<EndState, FormData>(endConsultation, {})
  const [skipState, skipFormAction, skipping] = useActionState<SkipState, FormData>(skipPatient, {})

  // Each of these reacts to a server action's result, not a user event.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (callState.entry) {
      setEntry(callState.entry)
      setStartedAt(null)
      setEndResult(null)
    }
  }, [callState.entry])
  useEffect(() => {
    if (startState.startedAt) setStartedAt(startState.startedAt)
  }, [startState.startedAt])
  useEffect(() => {
    if (endState.result) {
      setEndResult(endState.result)
      setEntry(null)
      setStartedAt(null)
    }
  }, [endState.result])
  useEffect(() => {
    if (skipState.skipped) {
      setEntry(null)
      setStartedAt(null)
    }
  }, [skipState.skipped])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Elapsed timer — ticks only while a consultation is actually running.
  useEffect(() => {
    if (!startedAt) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [startedAt])

  if (endResult) {
    return (
      <section className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-6 text-center">
        <p className="text-xs font-semibold tracking-wide text-muted">CONSULTATION ENDED</p>
        <p className="text-lg font-semibold text-ink">
          {Math.round(endResult.durationMinutes)} min recorded
        </p>
        <p className="text-sm text-muted">
          Service average now {Math.round(endResult.newServiceAverage)} min ({endResult.newConfidence}{' '}
          confidence)
        </p>
        <form action={callAction}>
          <Button type="submit" variant="primary" loading={calling}>
            Call next patient
          </Button>
        </form>
      </section>
    )
  }

  if (!entry) {
    return (
      <section className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-6 text-center">
        <p className="text-xs font-semibold tracking-wide text-muted">CURRENT PATIENT</p>
        {callState.none && <p className="text-sm text-muted">No one waiting.</p>}
        {callState.error && (
          <p role="alert" className="text-sm text-danger">
            {callState.error}
          </p>
        )}
        <form action={callAction}>
          <Button type="submit" variant="primary" loading={calling}>
            Call next patient
          </Button>
        </form>
      </section>
    )
  }

  const isRunning = !!startedAt
  const elapsedSeconds = isRunning
    ? Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
    : 0
  const mm = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')
  const ss = String(elapsedSeconds % 60).padStart(2, '0')

  return (
    <section className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-6 text-center">
      <p className="text-xs font-semibold tracking-wide text-muted">CURRENT PATIENT</p>
      <p className="text-lg font-semibold text-ink">{entry.patientName}</p>
      <QueueToken token={entry.token} size="lg" />

      {isRunning ? (
        <>
          <p className="font-mono text-2xl font-semibold tabular-nums text-ink">
            {mm}:{ss}
          </p>
          <form action={endFormAction}>
            <input type="hidden" name="queue_entry_id" value={entry.id} />
            <Button type="submit" variant="primary" loading={ending}>
              End consultation
            </Button>
          </form>
          {endState.error && (
            <p role="alert" className="text-sm text-danger">
              {endState.error}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <form action={startFormAction}>
              <input type="hidden" name="queue_entry_id" value={entry.id} />
              <Button type="submit" variant="primary" loading={starting}>
                Start consultation
              </Button>
            </form>
            <form action={skipFormAction}>
              <input type="hidden" name="queue_entry_id" value={entry.id} />
              <Button type="submit" variant="tertiary" loading={skipping}>
                Skip
              </Button>
            </form>
          </div>
          {startState.error && (
            <p role="alert" className="text-sm text-danger">
              {startState.error}
            </p>
          )}
          {skipState.error && (
            <p role="alert" className="text-sm text-danger">
              {skipState.error}
            </p>
          )}
        </>
      )}
    </section>
  )
}
