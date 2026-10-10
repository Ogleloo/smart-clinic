'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { Search, SlidersHorizontal } from 'lucide-react'
import type { NurseCurrentEntry } from '@/app/actions/nurse'
import { createClient } from '@/lib/supabase/client'
import { useQueueBroadcast } from '@/lib/hooks/useQueueBroadcast'
import { useNextPatientFlow, type CommittedEvent } from '@/lib/hooks/useNextPatientFlow'
import {
  MY_QUEUE_TABS,
  buildMyQueueRows,
  countMyQueueTabs,
  filterMyQueueRows,
  loadQueueSnapshot,
  type MyQueueRow,
  type MyQueueTab,
  type QueueSnapshot,
} from '@/lib/nurseQueue'
import { TYPE } from '@/components/reception/PageHeader'
import { QueueUpdatedToast } from '@/components/reception/QueueUpdatedToast'
import { OfflineBanner } from '@/components/ui/OfflineBanner'
import { NurseHeader } from '@/components/nurse/NurseHeader'
import { EndSessionControl } from '@/components/nurse/EndSessionControl'
import { CoverageWarning } from '@/components/nurse/CoverageWarning'
import { NurseProfileChip } from './NurseProfileChip'
import { CallNextPanel } from './CallNextPanel'
import { MyQueueTable, SKIP_UNAVAILABLE_NOTE_ID } from './MyQueueTable'
import { formatActivityTime } from './RecentActivityPanel'
import { NURSE_WORKSPACE_HREF } from './navItems'

export interface MyQueueViewProps {
  nurse: {
    profileId: string
    fullName: string
    clinicName: string | null
    isOnDuty: boolean
    serviceId: string | null
    serviceName: string | null
  }
  /** Active services of the nurse's clinic, for going on duty / switching service. */
  services: { id: string; name: string }[]
  /** Every service of the clinic by id (including inactive), to name completed consultations. */
  serviceNames: Record<string, string>
  initialSnapshot: QueueSnapshot
  initialEntry: NurseCurrentEntry | null
  currentError?: string
  undoWindowSeconds: number
  serviceAverageMinutes: number | null
}

const TOAST_MS = 4000

/**
 * Subscribes only while there is a service to listen to (useQueueBroadcast needs a real channel name). A ping
 * triggers a re-read, never a mutation.
 */
function QueueBroadcastSync({ serviceId, onChange, onOnline }: { serviceId: string; onChange: () => void; onOnline: (online: boolean) => void }) {
  const { online } = useQueueBroadcast(serviceId, onChange)
  useEffect(() => {
    onOnline(online)
  }, [online, onOnline])
  return null
}

/**
 * Nurse V3 My Queue (Figma frame 161:170, with 162:534 / 164:192 as its interaction states). The Skip Patient
 * modal (164:268) is not wired: Skip is disabled fail-closed until an atomic backend check is approved.
 *
 * The service's waiting queue is shared by every nurse on that service, so it is labelled as the service queue,
 * not as patients assigned to this nurse. "In Consultation" is this nurse's own open consultation (from
 * useNextPatientFlow, the same state machine as the working screen); "Completed" is this nurse's own
 * consultations ended today.
 *
 * Every refresh — realtime ping, window focus, a completed call or undo — re-reads the whole snapshot. Each
 * read is numbered and an older read that resolves late is dropped, so it can never overwrite newer state.
 * Search, tab and filter are local state and survive refreshes.
 *
 * Split in two on purpose. The outer part (heading, chip, duty bar with End session) is never remounted, so
 * EndSessionControl's "Session ended" report survives going off duty. The body below it is keyed on duty and
 * service, so a duty or service change starts it from the new server props.
 */
export function MyQueueView(props: MyQueueViewProps) {
  const { nurse, services } = props
  const scoped = nurse.isOnDuty && !!nurse.serviceId
  const serviceLabel = nurse.serviceName ?? 'your service'
  return (
    <main className="mx-auto flex w-full max-w-[1176px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <div className="flex flex-col-reverse gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className={TYPE.pageTitle}>My Queue</h1>
          <p className="text-base text-muted">
            {scoped
              ? `The shared waiting queue for ${serviceLabel}, your current patient and the consultations you completed today.`
              : 'Go on duty to see your service’s queue. Consultations you completed today are listed below.'}
          </p>
        </div>
        <div className="self-start xl:-mt-4 xl:w-[250px] xl:shrink-0">
          <NurseProfileChip fullName={nurse.fullName} clinicName={nurse.clinicName} />
        </div>
      </div>

      <NurseHeader
        services={services}
        isOnDuty={nurse.isOnDuty}
        currentServiceId={nurse.serviceId}
        currentServiceName={nurse.serviceName}
        endSession={<EndSessionControl isOnDuty={nurse.isOnDuty} currentServiceId={nurse.serviceId} />}
      />

      <MyQueueBody key={`${nurse.isOnDuty ? 'on' : 'off'}:${nurse.serviceId ?? 'none'}`} {...props} />
    </main>
  )
}

function MyQueueBody({
  nurse,
  serviceNames,
  initialSnapshot,
  initialEntry,
  currentError,
  undoWindowSeconds,
  serviceAverageMinutes,
}: MyQueueViewProps) {
  const [supabase] = useState(() => createClient())
  const scoped = nurse.isOnDuty && !!nurse.serviceId

  const [snapshot, setSnapshot] = useState<QueueSnapshot>(initialSnapshot)
  const [refreshFailedAt, setRefreshFailedAt] = useState<string | null>(null)
  const [online, setOnline] = useState(true)
  const [tab, setTab] = useState<MyQueueTab>('all')
  const [search, setSearch] = useState('')
  const [emergencyOnly, setEmergencyOnly] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const requestSeq = useRef(0)
  const appliedSeq = useRef(0)

  const refresh = useCallback(async () => {
    const id = ++requestSeq.current
    let next: QueueSnapshot
    try {
      next = await loadQueueSnapshot(supabase, { nurseProfileId: nurse.profileId, serviceId: scoped ? nurse.serviceId : null })
    } catch {
      if (id > appliedSeq.current) setRefreshFailedAt(new Date().toISOString())
      return
    }
    // A slower, older read must not overwrite a newer one that already landed — including the read issued
    // after an action completed, which is always numbered after any read already in flight.
    if (id < appliedSeq.current) return
    appliedSeq.current = id
    if (next.errors.queue || next.errors.completed) {
      // Keep what is on screen and say it may be stale, rather than blanking the list.
      setRefreshFailedAt(new Date().toISOString())
      setSnapshot((prev) => ({
        queue: next.errors.queue ? prev.queue : next.queue,
        estimates: next.errors.queue ? prev.estimates : next.estimates,
        completed: next.errors.completed ? prev.completed : next.completed,
        errors: {
          queue: next.errors.queue && prev.errors.queue ? next.errors.queue : undefined,
          completed: next.errors.completed && prev.errors.completed ? next.errors.completed : undefined,
        },
      }))
      return
    }
    setRefreshFailedAt(null)
    setSnapshot(next)
  }, [supabase, nurse.profileId, nurse.serviceId, scoped])

  const showToast = useCallback((message: string) => setToast(message), [])

  const onCommitted = useCallback(
    (event: CommittedEvent) => {
      // Figma 162:534 "Queue updated": a consultation just moved to Completed.
      if (event.kind === 'advanced' && event.result.ended_token) {
        showToast(`Consultation completed — ${event.result.ended_token} moved to Completed.`)
      }
      void refresh()
    },
    [refresh, showToast]
  )

  const flow = useNextPatientFlow({ initialEntry, undoWindowSeconds, onCommitted })

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  // A tab that comes back into view re-reads too (another nurse or another tab may have moved the queue).
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [refresh])

  const { rows, othersInConsultation, nextToken } = useMemo(
    () =>
      buildMyQueueRows({
        queue: snapshot.queue,
        estimates: snapshot.estimates,
        currentEntry: flow.baseEntry,
        completed: snapshot.completed,
        serviceNames,
        currentServiceId: nurse.serviceId,
      }),
    [snapshot, flow.baseEntry, serviceNames, nurse.serviceId]
  )
  const counts = countMyQueueTabs(rows)
  const visible = filterMyQueueRows(rows, { tab, search, emergencyOnly })

  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const nextIndex = (index + (e.key === 'ArrowRight' ? 1 : MY_QUEUE_TABS.length - 1)) % MY_QUEUE_TABS.length
    setTab(MY_QUEUE_TABS[nextIndex]!.id)
    document.getElementById(`my-queue-tab-${MY_QUEUE_TABS[nextIndex]!.id}`)?.focus()
  }

  const serviceLabel = nurse.serviceName ?? 'your service'

  return (
    <>
      {nurse.isOnDuty && !nurse.serviceId && (
        <p role="status" className="rounded-md border border-border bg-subtle p-4 text-sm text-ink">
          You’re on duty without an assigned service. Choose a service above to see its queue and call patients.
        </p>
      )}

      {scoped && (
        <>
          <CoverageWarning serviceId={nurse.serviceId!} />
          <QueueBroadcastSync serviceId={nurse.serviceId!} onChange={refresh} onOnline={setOnline} />
          <CallNextPanel flow={flow} nextToken={nextToken} serviceName={nurse.serviceName} serviceAverageMinutes={serviceAverageMinutes} />
        </>
      )}

      {currentError && (
        <p role="alert" className="rounded-md bg-danger-bg px-4 py-3 text-sm font-semibold text-[#B42318]">
          We couldn’t check whether you have a consultation open. Reload the page before calling the next patient.
        </p>
      )}

      <section aria-label="Queue" className="flex flex-col gap-4">
        <div role="tablist" aria-label="Filter by status" className="flex flex-wrap gap-2">
          {MY_QUEUE_TABS.map((t, i) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                id={`my-queue-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="my-queue-panel"
                tabIndex={active ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => onTabKeyDown(e, i)}
                className={`min-h-10 rounded-sm px-5 py-2 text-base leading-6 transition-colors ${
                  active ? 'bg-[#037F74] text-white' : 'border border-border bg-surface text-muted hover:bg-paper hover:text-ink'
                }`}
              >
                {t.label} ({counts[t.id]})
              </button>
            )
          })}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex h-[46px] min-w-0 flex-1 items-center gap-3 rounded-sm border border-border bg-surface px-4 focus-within:border-[#037F74]">
            <Search size={18} className="shrink-0 text-muted" aria-hidden />
            <span className="sr-only">Search by patient name or token</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or token..."
              className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted"
            />
          </label>
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="my-queue-filters"
            onClick={() => setFiltersOpen((o) => !o)}
            className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-sm border-[1.5px] border-[#037F74] bg-surface px-5 text-sm font-semibold text-[#037F74] hover:bg-primary-50"
          >
            <SlidersHorizontal size={16} aria-hidden />
            Filters{emergencyOnly ? ' (1)' : ''}
          </button>
        </div>

        {filtersOpen && (
          <fieldset id="my-queue-filters" className="flex flex-wrap items-center gap-4 rounded-sm border border-border bg-surface px-4 py-3">
            <legend className="sr-only">Filters</legend>
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={emergencyOnly}
                onChange={(e) => setEmergencyOnly(e.target.checked)}
                className="size-4 accent-[#037F74]"
              />
              Emergency priority only
            </label>
          </fieldset>
        )}

        <div
          id="my-queue-panel"
          role="tabpanel"
          aria-labelledby={`my-queue-tab-${tab}`}
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-[0_6px_16px_rgba(5,48,46,0.05)] xl:p-0 xl:pb-2"
        >
          {!online && <OfflineBanner fullWidth />}
          {refreshFailedAt && (
            <p role="status" className="mx-0 rounded-md bg-warning-bg px-4 py-2 text-sm text-ink xl:mx-4 xl:mt-4">
              Couldn’t refresh the queue at {formatActivityTime(refreshFailedAt)}. Showing the last list that loaded; it
              updates again automatically.
            </p>
          )}
          <PanelBody
            rows={visible}
            tab={tab}
            search={search}
            emergencyOnly={emergencyOnly}
            scoped={scoped}
            isOnDuty={nurse.isOnDuty}
            errors={snapshot.errors}
            serviceLabel={serviceLabel}
            onClearSearch={() => setSearch('')}
          />
          {scoped && othersInConsultation > 0 && (
            <p className="px-0 text-xs text-muted xl:px-5">
              {othersInConsultation} other patient{othersInConsultation === 1 ? ' is' : 's are'} in consultation with
              another nurse on {serviceLabel}.
            </p>
          )}
        </div>
      </section>

      <p className="text-sm text-muted">
        Prefer the previous layout?{' '}
        <Link href={NURSE_WORKSPACE_HREF} className="font-semibold text-[#037F74] underline underline-offset-2">
          Open the classic nurse screen
        </Link>
        .
      </p>

      {/* Figma 162:534. Bottom of the screen, not under the chip as on Reception: here the duty bar sits there, and the toast must never sit over its controls. */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-4 bottom-4 z-40 flex justify-center md:left-[280px] xl:left-auto xl:right-8 xl:w-[380px]">
          <QueueUpdatedToast message={toast} />
        </div>
      )}
    </>
  )
}

function PanelBody({
  rows,
  tab,
  search,
  emergencyOnly,
  scoped,
  isOnDuty,
  errors,
  serviceLabel,
  onClearSearch,
}: {
  rows: MyQueueRow[]
  tab: MyQueueTab
  search: string
  emergencyOnly: boolean
  scoped: boolean
  isOnDuty: boolean
  errors: QueueSnapshot['errors']
  serviceLabel: string
  onClearSearch: () => void
}) {
  const wantsQueue = tab === 'all' || tab === 'waiting'
  const wantsCompleted = tab === 'all' || tab === 'completed'
  const alerts: string[] = []
  if (wantsQueue && errors.queue) alerts.push('We couldn’t load the waiting queue. It will retry on the next update, or reload the page.')
  if (wantsCompleted && errors.completed) alerts.push('We couldn’t load your completed consultations. Reload the page to try again.')

  const alertNodes = alerts.map((a) => (
    <p key={a} role="alert" className="rounded-md bg-danger-bg px-4 py-3 text-sm font-semibold text-[#B42318] xl:mx-4 xl:mt-4">
      {a}
    </p>
  ))

  if (rows.length > 0) {
    const caption =
      tab === 'completed'
        ? 'Consultations you completed today, most recent first'
        : `My Queue for ${serviceLabel}: your current patient, then waiting patients in the order they will be called, then today’s completed consultations`
    return (
      <>
        {alertNodes}
        {scoped && rows.some((r) => r.status === 'waiting') && (
          <p id={SKIP_UNAVAILABLE_NOTE_ID} className="rounded-md bg-subtle px-4 py-3 text-sm text-ink xl:mx-4 xl:mt-4">
            <span className="font-semibold">Skip is temporarily unavailable on My Queue</span> while a safety fix is
            reviewed. If a waiting patient needs to be skipped, ask reception to skip them.
          </p>
        )}
        <MyQueueTable rows={rows} caption={caption} canAct={scoped} />
      </>
    )
  }

  let title: string
  let detail: string | null = null
  if (search.trim() || emergencyOnly) {
    title = search.trim() ? `No patients match “${search.trim()}”.` : 'No emergency-priority patients.'
    detail = 'Try another name or token, or clear the search and filters.'
  } else if (!scoped && (tab === 'waiting' || tab === 'in_consultation')) {
    title = isOnDuty ? 'You have no assigned service.' : 'You’re off duty.'
    detail = isOnDuty ? 'Choose a service above to see its queue.' : 'Start a session above to see your service’s queue and call patients.'
  } else if (tab === 'waiting') {
    title = 'No one is waiting'
    detail = `New check-ins for ${serviceLabel} will appear here automatically.`
  } else if (tab === 'in_consultation') {
    title = 'No patient in consultation'
    detail = 'Use Call next patient to start the next consultation.'
  } else if (tab === 'completed') {
    title = 'No completed consultations yet today'
  } else {
    title = scoped ? 'The queue is empty' : 'Nothing to show yet'
    detail = scoped
      ? `No one is waiting for ${serviceLabel}, and you haven’t completed a consultation today.`
      : 'Start a session above to see your service’s queue.'
  }

  return (
    <>
      {alertNodes}
      {!(alerts.length > 0 && !search.trim() && !emergencyOnly) && (
        <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
          <p className="text-base font-semibold text-ink">{title}</p>
          {detail && <p className="text-sm text-muted">{detail}</p>}
          {search.trim() && (
            <button type="button" onClick={onClearSearch} className="mt-2 text-sm font-semibold text-[#037F74] underline underline-offset-2">
              Clear search
            </button>
          )}
        </div>
      )}
    </>
  )
}
