import { Clock } from 'lucide-react'
import { CLINIC_TIMEZONE } from '@/lib/clinicTime'
import type { ActivityKind, DashboardActivityEvent } from '@/lib/nurseDashboard'

const TIME = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: CLINIC_TIMEZONE })

/** "10:42 AM", in the clinic's timezone, never the browser's or the server's (ADR-020). */
export function formatActivityTime(iso: string): string {
  return TIME.format(new Date(iso))
}

const LABEL: Record<ActivityKind, string> = {
  completed: 'completed',
  in_consultation: 'in consultation',
  skipped: 'skipped',
  no_show: 'marked no-show',
  ended: 'ended — not counted',
}

/** The marker colour follows the event type; the words carry the meaning, so colour is never the only cue. */
const DOT: Record<ActivityKind, string> = {
  completed: 'bg-[#12B76A]',
  in_consultation: 'bg-[#2F80ED]',
  skipped: 'bg-muted',
  no_show: 'bg-muted',
  ended: 'bg-muted',
}

/**
 * Figma frame 161:147 "Todays-Activity" (380×440). Every entry is one of this nurse's own consultations
 * today, read under the nurse's own row-level security — there is no other source, and nothing is
 * invented. `events === null` means the read failed, which is shown as an error, not as "no activity".
 */
export function RecentActivityPanel({ events, error }: { events: DashboardActivityEvent[] | null; error?: string }) {
  return (
    <section
      aria-labelledby="recent-activity"
      className="flex flex-col xl:min-h-[440px] rounded-lg border border-border bg-surface p-[17px] shadow-[0_6px_14px_rgba(5,48,46,0.05)]"
    >
      <div className="flex items-center gap-[14px]">
        <span className="flex size-[46px] shrink-0 items-center justify-center rounded-full bg-primary-50 text-[#037F74]">
          <Clock size={22} aria-hidden />
        </span>
        <div>
          <h2 id="recent-activity" className="text-base leading-6 text-ink">Recent Activity</h2>
          <p className="text-xs leading-[18px] text-muted">Latest updates from your consultations.</p>
        </div>
      </div>

      {error || events === null ? (
        <p role="alert" className="mt-6 rounded-md border border-border bg-danger-bg p-4 text-sm font-semibold text-[#B42318]">
          We couldn’t load your recent activity.
        </p>
      ) : events.length === 0 ? (
        <div className="mt-6 rounded-md border border-border bg-subtle p-5 text-center">
          <p className="text-sm font-semibold text-ink">No activity yet today</p>
          <p className="mt-1 text-sm text-muted">Consultations you take today will appear here.</p>
        </div>
      ) : (
        <ol className="relative mt-6 flex flex-col gap-[26px] pl-1">
          <span aria-hidden className="absolute bottom-3 left-[11px] top-2 w-0.5 bg-primary-50" />
          {events.map((e) => (
            <li key={e.id} className="relative flex items-start gap-[14px]">
              <span aria-hidden className={`relative z-[1] mt-1 size-[18px] shrink-0 rounded-full ${DOT[e.kind]}`} />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-base leading-6 text-ink">
                    <span className="font-mono font-semibold tabular-nums">{e.token}</span> {LABEL[e.kind]}
                  </p>
                  <time dateTime={e.at} className="shrink-0 pt-[3px] text-xs leading-[18px] text-muted">
                    {formatActivityTime(e.at)}
                  </time>
                </div>
                <p className="text-xs leading-[18px] text-muted">{e.patientLabel}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
