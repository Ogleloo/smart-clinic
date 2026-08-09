'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  nextPatient,
  undoAction,
  getNurseCurrentState,
  type NurseCurrentEntry,
  type CalledResult,
  type QueueEmptyResult,
  type LongDecision,
} from '@/app/actions/nurse'
import { Button } from '@/components/ui/Button'
import { QueueToken } from '@/components/ui/QueueToken'

interface CurrentPatientPanelProps {
  initialEntry: NurseCurrentEntry | null
  /** clinic_settings.undo_window_seconds — needed because a queue_empty result doesn't carry its own copy (only 'called' does). */
  undoWindowSeconds: number
}

/**
 * The five-state nurse workflow model:
 *   IDLE                 baseEntry is null, transient is NONE
 *   IN_PROGRESS           baseEntry is set, transient is NONE
 *   SUBMITTING             transient.kind === 'SUBMITTING'
 *   NEEDS_LONG_DECISION    transient.kind === 'NEEDS_LONG_DECISION'
 *   COMPLETED_WITH_UNDO    transient.kind === 'COMPLETED_WITH_UNDO'
 *
 * Represented as two independent pieces rather than one five-way union
 * so SUBMITTING/NEEDS_LONG_DECISION never have to duplicate whatever
 * entry data is already sitting in baseEntry — they just overlay it.
 */
type Transient =
  | { kind: 'NONE' }
  | { kind: 'SUBMITTING'; actionId: string; longDecision?: LongDecision }
  | { kind: 'NEEDS_LONG_DECISION'; actionId: string; durationMinutes: number; thresholdMinutes: number }
  | {
      kind: 'COMPLETED_WITH_UNDO'
      actionId: string
      result: CalledResult | QueueEmptyResult
      deadline: number
      disabledReason?: string
      undoSubmitting?: boolean
    }

const UNDO_DISABLED_LINGER_MS = 3000

export function CurrentPatientPanel({ initialEntry, undoWindowSeconds }: CurrentPatientPanelProps) {
  const router = useRouter()
  const [baseEntry, setBaseEntry] = useState<NurseCurrentEntry | null>(initialEntry)
  const [transient, setTransient] = useState<Transient>({ kind: 'NONE' })
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // action_id is generated ONCE per logical "advance the queue" gesture
  // and reused across every retry of that gesture (network timeout, or
  // a long_consultation confirmation) until a terminal result lands —
  // see ADR (nurse workflow idempotency). Held in a ref, not state: it
  // must survive across renders without itself triggering one.
  const pendingActionId = useRef<string | null>(null)
  const transientRef = useRef(transient)
  useEffect(() => {
    transientRef.current = transient
  })

  // True for the entire span of a submit()/handleUndo() call, including
  // its own follow-up re-fetch. Without this, the focus/visibility
  // reconciliation effect below can interleave with that follow-up
  // fetch — e.g. a focus event firing mid-mutation reads the
  // not-yet-committed old state and, if it resolves after the
  // mutation's own correct re-fetch, silently overwrites it with stale
  // data. Whichever fetch is "ours" for this action must be the one
  // that wins.
  const busyRef = useRef(false)

  // Ticks once a second so the elapsed-time display and the undo
  // countdown stay live without polling the server.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const submit = useCallback(async (longDecision?: LongDecision) => {
    busyRef.current = true
    const actionId = pendingActionId.current ?? crypto.randomUUID()
    pendingActionId.current = actionId
    setError(null)
    setTransient({ kind: 'SUBMITTING', actionId, longDecision })

    const { data, error: submitError } = await nextPatient(actionId, longDecision)

    if (submitError) {
      // Deliberately do NOT clear pendingActionId: a retry (clicking the
      // same button again) must reuse this exact id, not mint a new one.
      setError(submitError)
      setTransient({ kind: 'NONE' })
      busyRef.current = false
      return
    }

    if (data!.status === 'long_consultation') {
      // No ledger write happened for this branch, so the same actionId
      // stays valid to resubmit with a decision — nothing to clear.
      setTransient({
        kind: 'NEEDS_LONG_DECISION',
        actionId,
        durationMinutes: data!.duration_minutes,
        thresholdMinutes: data!.threshold_minutes,
      })
      busyRef.current = false
      return
    }

    // Terminal outcome — the ledger now holds this actionId, so it's
    // done being "pending" regardless of whether this was a fresh
    // dispatch or a replay.
    pendingActionId.current = null

    if (data!.status === 'called') {
      setBaseEntry({
        queueEntryId: data!.queue_entry_id,
        consultationId: data!.consultation_id,
        token: data!.token,
        patientName: data!.patient_name,
        priority: data!.priority,
        // next_patient doesn't return the consultation's started_at —
        // it was just created, so "now" is accurate to well under a
        // second, which is all the elapsed-time display needs.
        startedAt: new Date().toISOString(),
      })
    } else {
      setBaseEntry(null)
    }

    setTransient({
      kind: 'COMPLETED_WITH_UNDO',
      actionId,
      result: data as CalledResult | QueueEmptyResult,
      deadline: Date.now() + undoWindowSeconds * 1000,
    })
    busyRef.current = false
    // revalidatePath ran server-side, but this action was invoked as a
    // plain function call, not dispatched through a form/useActionState
    // — that's what normally carries the auto-refresh. router.refresh()
    // re-runs the Server Component so WaitingList's initialQueue (and
    // anything else server-derived on this page) picks up the change.
    router.refresh()
  }, [undoWindowSeconds, router])

  const handleUndo = useCallback(async (actionId: string) => {
    busyRef.current = true
    setTransient((t) => (t.kind === 'COMPLETED_WITH_UNDO' ? { ...t, undoSubmitting: true } : t))
    const { error: undoError } = await undoAction(actionId)

    if (undoError) {
      setTransient((t) =>
        t.kind === 'COMPLETED_WITH_UNDO' ? { ...t, undoSubmitting: false, disabledReason: undoError } : t
      )
      busyRef.current = false
      return
    }

    // undo_next_patient only returns the restored token, not full
    // patient details — re-read current state rather than guess them.
    setTransient({ kind: 'NONE' })
    const { entry } = await getNurseCurrentState()
    setBaseEntry(entry)
    busyRef.current = false
    router.refresh()
  }, [router])

  // Collapse COMPLETED_WITH_UNDO once its window closes: show it
  // disabled with a reason briefly, then fall back to plain
  // IN_PROGRESS/IDLE.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (transient.kind !== 'COMPLETED_WITH_UNDO' || transient.disabledReason) return
    const msLeft = transient.deadline - now
    if (msLeft > 0) return

    const actionId = transient.actionId
    setTransient((t) =>
      t.kind === 'COMPLETED_WITH_UNDO' && t.actionId === actionId
        ? { ...t, disabledReason: 'Undo window has closed' }
        : t
    )
  }, [transient, now])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (transient.kind !== 'COMPLETED_WITH_UNDO' || !transient.disabledReason) return
    const timer = setTimeout(() => setTransient({ kind: 'NONE' }), UNDO_DISABLED_LINGER_MS)
    return () => clearTimeout(timer)
  }, [transient])

  // Two tabs is a known limitation, not something this can prevent
  // (two different action_ids are two real, independent transitions
  // server-side) — but when this tab regains focus, reconcile its
  // display to whatever the server now says is current, rather than
  // silently keep showing a patient another tab already advanced past.
  useEffect(() => {
    function reconcile() {
      if (document.visibilityState !== 'visible') return
      if (transientRef.current.kind !== 'NONE') return
      if (busyRef.current) return
      getNurseCurrentState().then(({ entry }) => setBaseEntry(entry))
    }
    document.addEventListener('visibilitychange', reconcile)
    window.addEventListener('focus', reconcile)
    return () => {
      document.removeEventListener('visibilitychange', reconcile)
      window.removeEventListener('focus', reconcile)
    }
  }, [])

  const isSubmitting = transient.kind === 'SUBMITTING'

  // NEEDS_LONG_DECISION — a required confirmation, shown regardless of
  // what the underlying entry looks like.
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
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="primary" loading={isSubmitting} onClick={() => submit('record')}>
            Record {minutes} min
          </Button>
          <Button variant="tertiary" loading={isSubmitting} onClick={() => submit('break')}>
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
        <section className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-6 text-center">
          <p className="text-xs font-semibold tracking-wide text-muted">CURRENT PATIENT</p>
          <p className="text-lg font-semibold text-ink">Consultation completed. No patients waiting.</p>
          <EndedFooter result={result} />
          <UndoRow t={transient} now={now} onUndo={handleUndo} />
        </section>
      )
    }

    // status === 'called': the newly called patient is already baseEntry.
    return (
      <section className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-6 text-center">
        <p className="text-xs font-semibold tracking-wide text-muted">CURRENT PATIENT</p>
        <p className="text-lg font-semibold text-ink">{result.patient_name}</p>
        <QueueToken token={result.token} size="lg" />
        <ElapsedTimer startedAt={baseEntry?.startedAt ?? null} now={now} />
        <EndedFooter result={result} />
        <UndoRow t={transient} now={now} onUndo={handleUndo} />
        <Button variant="primary" loading={isSubmitting} onClick={() => submit()}>
          Next patient
        </Button>
      </section>
    )
  }

  // IDLE / IN_PROGRESS (transient is NONE or SUBMITTING)
  return (
    <section className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-6 text-center">
      <p className="text-xs font-semibold tracking-wide text-muted">CURRENT PATIENT</p>

      {baseEntry && (
        <>
          <p className="text-lg font-semibold text-ink">{baseEntry.patientName}</p>
          <QueueToken token={baseEntry.token} size="lg" />
          <ElapsedTimer startedAt={baseEntry.startedAt} now={now} />
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <Button variant="primary" loading={isSubmitting} onClick={() => submit()}>
        {baseEntry ? 'Next patient' : 'Call next patient'}
      </Button>
    </section>
  )
}

function EndedFooter({ result }: { result: CalledResult | QueueEmptyResult }) {
  if (!result.ended_token) return null
  return (
    <p className="text-sm text-muted">
      Ended {result.ended_token}
      {result.status === 'called' && result.ended_minutes !== null ? ` · ${Math.round(result.ended_minutes)} min` : ''}
      {result.ended_excluded ? ' — not counted towards the average' : ''}
    </p>
  )
}

function UndoRow({
  t,
  now,
  onUndo,
}: {
  t: Extract<Transient, { kind: 'COMPLETED_WITH_UNDO' }>
  now: number
  onUndo: (actionId: string) => void
}) {
  // A 'called' result is always undoable — it reverses the new call
  // itself, regardless of whether a previous consultation was also
  // ended. A 'queue_empty' result is only undoable when it actually
  // ended something (ended_token set); an empty-queue check with
  // nothing open before it has nothing to restore.
  if (t.result.status !== 'called' && !t.result.ended_token) return null
  if (t.disabledReason) {
    return <p className="text-xs text-muted">{t.disabledReason}</p>
  }
  const secondsLeft = Math.max(0, Math.floor((t.deadline - now) / 1000))
  return (
    <Button variant="tertiary" loading={t.undoSubmitting} onClick={() => onUndo(t.actionId)}>
      Undo ({secondsLeft}s)
    </Button>
  )
}

function ElapsedTimer({ startedAt, now }: { startedAt: string | null; now: number }) {
  if (!startedAt) return null
  const elapsedSeconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const mm = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')
  const ss = String(elapsedSeconds % 60).padStart(2, '0')
  return (
    <p className="font-mono text-2xl font-semibold tabular-nums text-ink">
      {mm}:{ss}
    </p>
  )
}
