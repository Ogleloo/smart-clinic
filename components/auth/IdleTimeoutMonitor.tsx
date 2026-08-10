'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { idleLogout } from '@/app/actions/auth'
import { Button } from '@/components/ui/Button'

const WARNING_LEAD_MINUTES = 2
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const

interface IdleTimeoutMonitorProps {
  /** clinic_settings.staff_idle_timeout_minutes, resolved once server-side by requireRole(). */
  timeoutMinutes: number
}

/**
 * Staff-only idle timeout. Mounted only in staff area layouts/pages
 * (reception, nurse, admin) — never in the (patient) tree, since
 * patients are deliberately never subject to this: someone waiting in
 * a queue has every reason to leave the page open for an hour, and
 * signing them out would defeat the purpose of the app. Staff use
 * shared clinic devices; that asymmetry is the whole point.
 *
 * Never signs out silently: the warning always fires
 * WARNING_LEAD_MINUTES before the actual timeout, and any activity —
 * ambient (mouse/keyboard/touch/scroll) or the explicit "Stay signed
 * in" click — resets both timers back to the full window.
 *
 * idleLogout() only ever calls supabase.auth.signOut(). Re-authenticating
 * afterwards must not change clinical state — a nurse's open
 * consultation is read fresh from the database (getNurseCurrentState),
 * never re-derived from whatever this timer last knew.
 */
export function IdleTimeoutMonitor({ timeoutMinutes }: IdleTimeoutMonitorProps) {
  const [showWarning, setShowWarning] = useState(false)
  const warningTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetTimers = useCallback(() => {
    setShowWarning(false)
    if (warningTimer.current) clearTimeout(warningTimer.current)
    if (expiryTimer.current) clearTimeout(expiryTimer.current)

    const warningMs = Math.max(0, (timeoutMinutes - WARNING_LEAD_MINUTES) * 60_000)
    const timeoutMs = timeoutMinutes * 60_000

    warningTimer.current = setTimeout(() => setShowWarning(true), warningMs)
    expiryTimer.current = setTimeout(() => {
      void idleLogout()
    }, timeoutMs)
  }, [timeoutMinutes])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    resetTimers()
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, resetTimers, { passive: true }))
    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, resetTimers))
      if (warningTimer.current) clearTimeout(warningTimer.current)
      if (expiryTimer.current) clearTimeout(expiryTimer.current)
    }
  }, [resetTimers])
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!showWarning) return null

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-warning bg-warning-bg p-4 text-center shadow-lg sm:inset-x-auto sm:right-4"
    >
      <p className="text-sm font-semibold text-ink">
        You&rsquo;ll be signed out in {WARNING_LEAD_MINUTES} minutes due to inactivity.
      </p>
      <Button variant="primary" onClick={resetTimers}>
        Stay signed in
      </Button>
    </div>
  )
}
