import { Building2 } from 'lucide-react'
import { initials } from '@/lib/initials'
import { greetingForNow } from '@/lib/clinicTime'
import { TYPE } from './PageHeader'

interface DashboardHeroProps {
  fullName: string
  clinicName: string | null
}

/**
 * Figma frame 111:2 "Hero-Section". The two background ellipses are
 * decorative only (no asset); there's no clinic photo in storage yet, so
 * the photo panel is a placeholder, same convention as the patient
 * dashboard's "Clinic photo placeholder" block.
 */
export function DashboardHero({ fullName, clinicName }: DashboardHeroProps) {
  const firstInitials = initials(fullName)

  return (
    <section className="relative overflow-hidden rounded-xl bg-surface">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-32 h-96 w-96 rounded-full bg-primary-50 opacity-70 blur-2xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-24 top-10 h-56 w-56 rounded-full bg-primary-50 opacity-70 blur-xl"
      />
      <div className="relative grid grid-cols-1 gap-6 p-6 md:grid-cols-2 md:p-9">
        <div className="flex flex-col justify-center gap-3">
          <h1 className={TYPE.pageTitle}>
            {greetingForNow()},
            <br />
            {fullName}
          </h1>
          <p className="text-base text-muted">
            Manage patient check-ins, queue entries and daily clinic activities — all in one place.
          </p>
        </div>

        <div className="relative flex min-h-[180px] items-center justify-center rounded-lg bg-subtle md:min-h-[286px]">
          <Building2 size={40} className="text-muted" aria-hidden />
          <div className="absolute right-4 top-4 flex max-w-[330px] items-center gap-3 rounded-full bg-surface px-3 py-2 shadow-[0_12px_32px_rgba(5,48,46,0.08)]">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-500 text-sm font-semibold text-white">
              {firstInitials}
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-ink">{fullName}</span>
              <span className="text-xs text-muted">Receptionist{clinicName ? ` • ${clinicName}` : ''}</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
