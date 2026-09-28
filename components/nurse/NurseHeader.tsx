'use client'

import { type ReactNode, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { DutyControl } from './DutyControl'

interface Service {
  id: string
  name: string
}

interface NurseHeaderProps {
  services: Service[]
  isOnDuty: boolean
  currentServiceId: string | null
  currentServiceName: string | null
  /** EndSessionControl, passed in rather than rendered here — it's mounted unconditionally at the page level (see its own docs for why: the "Session ended" report must survive is_on_duty flipping to false) and this only places it visually. */
  endSession: ReactNode
}

/**
 * "Switch service" is a toggle over the same DutyControl form used to
 * start a session in the first place — one form/action for both (see
 * DutyControl's own docs) — collapsed into a header disclosure while on
 * duty instead of a permanently visible panel, since a nurse touches it
 * once at the start of the day and otherwise needs the vertical space
 * for the current patient and waiting list.
 */
export function NurseHeader({
  services,
  isOnDuty,
  currentServiceId,
  currentServiceName,
  endSession,
}: NurseHeaderProps) {
  const [switching, setSwitching] = useState(false)
  // Off duty, there's no toggle to click — starting a session is the
  // only thing to do here, so the form shows without being asked.
  const showDutyControl = switching || !isOnDuty

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${isOnDuty ? 'bg-success' : 'bg-muted'}`}
            aria-hidden
          />
          <p className="text-sm font-semibold text-ink">
            {isOnDuty && currentServiceName ? `On duty · ${currentServiceName}` : 'Off duty'}
          </p>
        </div>

        {isOnDuty && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="tertiary" onClick={() => setSwitching((s) => !s)}>
              Switch service
            </Button>
            {endSession}
          </div>
        )}
      </div>

      {showDutyControl && (
        <DutyControl services={services} isOnDuty={isOnDuty} currentServiceId={currentServiceId} />
      )}
    </div>
  )
}
