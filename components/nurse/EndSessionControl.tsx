'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  endShift,
  checkEndSessionImpact,
  type EndShiftResult,
  type LongDecision,
} from '@/app/actions/nurse'
import { Button } from '@/components/ui/Button'

interface EndSessionControlProps {
  isOnDuty: boolean
  currentServiceId: string | null
}

type Flow =
  | { kind: 'IDLE' }
  | { kind: 'CHECKING' }
  | { kind: 'CONFIRMING'; serviceName: string; waitingCount: number }
  | { kind: 'SUBMITTING' }
  | { kind: 'NEEDS_LONG_DECISION'; durationMinutes: number; thresholdMinutes: number }

function reportFor(data: Extract<EndShiftResult, { status: 'shift_ended' }>): string {
  if (!data.closed_consultation) return 'Session ended.'
  const minutes = Math.round(data.closed_minutes ?? 0)
  const base = `Session ended. ${data.closed_token} closed at ${minutes} min`
  return data.excluded ? `${base} — not counted towards the average (break).` : `${base}.`
}

/**
 * "End session" — deliberately its own component, mounted unconditionally
 * (not inside the onDuty-gated block in page.tsx) so the "Session ended"
 * report survives the transition to off-duty: once is_on_duty flips,
 * page.tsx stops rendering CurrentPatientPanel/WaitingList entirely, and
 * anything gated the same way would unmount before the nurse could read
 * what just happened.
 *
 * "Session" not "shift": a nurse uses this for a lunch break as much as
 * the end of the day, and needs to be visible the whole time they're on
 * duty, not just in the duty panel touched once at the start of it.
 */
export function EndSessionControl({ isOnDuty, currentServiceId }: EndSessionControlProps) {
  const router = useRouter()
  const [flow, setFlow] = useState<Flow>({ kind: 'IDLE' })
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<string | null>(null)

  // A stale "session ended" report shouldn't linger once a new session
  // starts.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isOnDuty) setReport(null)
  }, [isOnDuty])
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleEndSessionClick() {
    if (!currentServiceId) return
    setError(null)
    setFlow({ kind: 'CHECKING' })

    const { impact } = await checkEndSessionImpact(currentServiceId)
    if (impact) {
      setFlow({ kind: 'CONFIRMING', serviceName: impact.serviceName, waitingCount: impact.waitingCount })
    } else {
      await submit()
    }
  }

  async function submit(longDecision?: LongDecision) {
    setFlow({ kind: 'SUBMITTING' })
    const { data, error: endError } = await endShift(longDecision)

    if (endError) {
      setError(endError)
      setFlow({ kind: 'IDLE' })
      return
    }

    if (data!.status === 'long_consultation') {
      setFlow({
        kind: 'NEEDS_LONG_DECISION',
        durationMinutes: data!.duration_minutes,
        thresholdMinutes: data!.threshold_minutes,
      })
      return
    }

    setFlow({ kind: 'IDLE' })
    setReport(reportFor(data as Extract<EndShiftResult, { status: 'shift_ended' }>))
    // revalidatePath ran server-side, but that only invalidates the
    // cache — it doesn't push a fresh render to an already-mounted page
    // for an action invoked as a plain function call (the auto-refresh
    // that comes with useActionState/form dispatch doesn't apply here).
    router.refresh()
  }

  if (!isOnDuty) {
    return report ? (
      <p role="status" className="text-sm font-semibold text-ink">
        {report}
      </p>
    ) : null
  }

  if (flow.kind === 'NEEDS_LONG_DECISION') {
    const minutes = Math.round(flow.durationMinutes)
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-warning bg-warning-bg p-3">
        <p className="text-sm font-semibold text-ink">
          This consultation has been open for {minutes} minutes. Was this continuous patient care?
        </p>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => submit('record')}>
            Record {minutes} min
          </Button>
          <Button variant="tertiary" onClick={() => submit('break')}>
            Break occurred
          </Button>
        </div>
      </section>
    )
  }

  if (flow.kind === 'CONFIRMING') {
    const { serviceName, waitingCount } = flow
    const plural = waitingCount === 1 ? 'patient is' : 'patients are'
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-warning bg-warning-bg p-3">
        <p className="text-sm font-semibold text-ink">
          You are the only nurse serving {serviceName}. {waitingCount} {plural} waiting. If you end this
          session, their wait estimate will be unavailable until another nurse goes on duty. Continue?
        </p>
        <div className="flex gap-2">
          <Button variant="tertiary" onClick={() => setFlow({ kind: 'IDLE' })}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => submit()}>
            Continue
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-1.5">
      <Button
        variant="tertiary"
        loading={flow.kind === 'CHECKING' || flow.kind === 'SUBMITTING'}
        onClick={handleEndSessionClick}
      >
        End session
      </Button>
      <p className="text-xs text-muted">Stop serving this queue and go off duty.</p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  )
}
