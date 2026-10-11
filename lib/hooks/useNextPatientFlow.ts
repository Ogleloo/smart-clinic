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
export type Transient =
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
      /** The undo request never reached the server (network). Unlike disabledReason, Undo stays available to retry. */
      undoError?: string
    }

export type CommittedEvent = { kind: 'advanced'; result: CalledResult | QueueEmptyResult } | { kind: 'undone' }

export type CompletedTransient = Extract<Transient, { kind: 'COMPLETED_WITH_UNDO' }>

const UNDO_DISABLED_LINGER_MS = 3000

/**
 * A Server Action call can also *throw* — the request never got an answer (connection dropped, server
 * restarting). That must not leave the button stuck on "Please wait…", and the retry must still be the same
 * logical attempt (same action_id), because the first request may in fact have reached the database.
 */
export const UNREACHABLE_MESSAGE = 'Couldn’t reach the server. Check your connection and try again.'

/** Shown whenever the nurse's current consultation could not be read: the state is unknown, not "no patient". */
export const STATE_UNKNOWN_MESSAGE =
  'We couldn’t confirm your current consultation. Next patient is paused until it is checked again.'

/**
 * Two different outcomes, never conflated: a successful read (which may legitimately find no open
 * consultation — entry null) and a failed read (the state is unknown). Only the first may drive the screen as
 * "no current patient".
 */
type StateRead = { ok: true; entry: NurseCurrentEntry | null } | { ok: false; error: string }

async function readCurrentState(): Promise<StateRead> {
  try {
    const { entry, error } = await getNurseCurrentState()
    return error ? { ok: false, error } : { ok: true, entry }
  } catch {
    return { ok: false, error: UNREACHABLE_MESSAGE }
  }
}

interface UseNextPatientFlowOptions {
  initialEntry: NurseCurrentEntry | null
  /** clinic_settings.undo_window_seconds — needed because a queue_empty result doesn't carry its own copy (only 'called' does). */
  undoWindowSeconds: number
  /** Called after a call or an undo has landed (whether or not the follow-up read succeeded) — e.g. to re-read a queue list. Never called for a failed or long-consultation attempt. */
  onCommitted?: (event: CommittedEvent) => void
  /**
   * Set when the page's own server-side read of the current consultation failed. The state then starts as
   * unknown: Next patient is refused until retryStateRead() (or a focus reconciliation) succeeds.
   */
  initialStateError?: string | null
}

/**
 * The Next patient / Undo state machine, shared by the working screen's
 * CurrentPatientPanel and the Nurse V3 My Queue screen so the two cannot
 * drift apart. Moved here unchanged from CurrentPatientPanel, plus an
 * in-flight guard on submit/undo (see busyRef).
 */
export function useNextPatientFlow({ initialEntry, undoWindowSeconds, onCommitted, initialStateError }: UseNextPatientFlowOptions) {
  const router = useRouter()
  const [baseEntry, setBaseEntry] = useState<NurseCurrentEntry | null>(initialStateError ? null : initialEntry)
  // Non-null while the nurse's current consultation is UNKNOWN (the last authoritative read failed). Fail
  // closed: next_patient() is never sent from an unknown state, because it would end whatever consultation is
  // really open. A confirmed call result and its Undo window are kept; only advancing is blocked.
  const [stateError, setStateError] = useState<string | null>(initialStateError ? STATE_UNKNOWN_MESSAGE : null)
  const stateErrorRef = useRef(stateError)
  useEffect(() => {
    stateErrorRef.current = stateError
  })
  const [retrying, setRetrying] = useState(false)
  const [transient, setTransient] = useState<Transient>({ kind: 'NONE' })
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const onCommittedRef = useRef(onCommitted)
  useEffect(() => {
    onCommittedRef.current = onCommitted
  })

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
  //
  // It also refuses a second submit/undo while one is in flight: two
  // clicks can land in the same tick, before React re-renders the
  // button as disabled. (A second submit would have reused the same
  // action_id and been replayed server-side, so this was never a
  // double call — but it was a second request.)
  const busyRef = useRef(false)

  // Ticks once a second so the elapsed-time display and the undo
  // countdown stay live without polling the server.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  /** Apply an authoritative read: a success establishes the state (even "no patient"); a failure marks it unknown. */
  const applyRead = useCallback((read: StateRead) => {
    if (read.ok) {
      setBaseEntry(read.entry)
      setStateError(null)
    } else {
      // Never keep showing a patient the read could not confirm (it may be the consultation that just ended).
      setBaseEntry(null)
      setStateError(STATE_UNKNOWN_MESSAGE)
    }
  }, [])

  const submit = useCallback(async (longDecision?: LongDecision) => {
    if (busyRef.current) return
    if (stateErrorRef.current) return
    busyRef.current = true
    const actionId = pendingActionId.current ?? crypto.randomUUID()
    pendingActionId.current = actionId
    setError(null)
    setTransient({ kind: 'SUBMITTING', actionId, longDecision })

    let response: Awaited<ReturnType<typeof nextPatient>>
    try {
      response = await nextPatient(actionId, longDecision)
    } catch {
      response = { error: UNREACHABLE_MESSAGE }
    }
    const { data, error: submitError } = response

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
      // next_patient's own result doesn't carry checked_in_at,
      // appointment_id or service_id — re-read the authoritative row
      // rather than guess at them (same principle handleUndo already
      // follows below: don't reconstruct what a fresh read can give
      // exactly). If that read fails, the call still happened: the result
      // below and its Undo window are kept, and the state is marked unknown.
      applyRead(await readCurrentState())
    } else {
      setBaseEntry(null)
      setStateError(null)
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
    // re-runs the Server Component so anything server-derived on this
    // page picks up the change.
    router.refresh()
    onCommittedRef.current?.({ kind: 'advanced', result: data as CalledResult | QueueEmptyResult })
  }, [undoWindowSeconds, router, applyRead])

  const handleUndo = useCallback(async (actionId: string) => {
    if (busyRef.current) return
    busyRef.current = true
    setTransient((t) => (t.kind === 'COMPLETED_WITH_UNDO' ? { ...t, undoSubmitting: true, undoError: undefined } : t))
    let undoResponse: Awaited<ReturnType<typeof undoAction>>
    try {
      undoResponse = await undoAction(actionId)
    } catch {
      setTransient((t) =>
        t.kind === 'COMPLETED_WITH_UNDO' ? { ...t, undoSubmitting: false, undoError: UNREACHABLE_MESSAGE } : t
      )
      busyRef.current = false
      return
    }
    const { error: undoError } = undoResponse

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
    applyRead(await readCurrentState())
    busyRef.current = false
    router.refresh()
    onCommittedRef.current?.({ kind: 'undone' })
  }, [router, applyRead])

  /** Read-only: re-reads the current consultation. Never calls next_patient() or undo. */
  const retryStateRead = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setRetrying(true)
    applyRead(await readCurrentState())
    setRetrying(false)
    busyRef.current = false
  }, [applyRead])

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
      readCurrentState().then((read) => {
        // A failed read is not "no patient": keep what is on screen (and an
        // unknown state stays unknown).
        if (!read.ok) return
        // A call or undo that started while this read was in flight owns
        // the result; this older read must not overwrite it.
        if (busyRef.current || transientRef.current.kind !== 'NONE') return
        setBaseEntry(read.entry)
        setStateError(null)
      })
    }
    document.addEventListener('visibilitychange', reconcile)
    window.addEventListener('focus', reconcile)
    return () => {
      document.removeEventListener('visibilitychange', reconcile)
      window.removeEventListener('focus', reconcile)
    }
  }, [])

  return {
    baseEntry,
    transient,
    error,
    now,
    isSubmitting: transient.kind === 'SUBMITTING',
    /** Non-null while the current consultation is unknown; Next patient is refused until a read succeeds. */
    stateError,
    canAdvance: stateError === null,
    retrying,
    retryStateRead,
    submit,
    handleUndo,
  }
}
