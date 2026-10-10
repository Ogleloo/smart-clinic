import Image from 'next/image'
import { initials } from '@/lib/initials'
import { TYPE } from './PageHeader'

interface QueueHeaderProps {
  fullName: string
  clinicName: string | null
}

/**
 * Figma frame 114:736 "Header-Container". Same hero pattern as the
 * Dashboard (DashboardHero) but shorter (174px vs 348px) and with no stat
 * row beneath it.
 *
 * The Figma subtitle references "Call next patient" — that's nurse-only
 * (call_next_patient() is hard-gated to role='nurse'), so the copy here
 * describes only what a receptionist can do on this screen: view the live
 * queue and skip a waiting patient.
 */
export function QueueHeader({ fullName, clinicName }: QueueHeaderProps) {
  const firstInitials = initials(fullName)

  return (
    <div className="flex flex-col gap-6 rounded-xl lg:flex-row lg:items-start lg:justify-between">
      <div className="flex flex-col gap-2 lg:w-[480px] lg:shrink-0 lg:pt-1">
        <h1 className={TYPE.pageTitle}>Queue management</h1>
        <p className="max-w-[455px] text-base text-muted">
          View the live queue, skip a waiting patient who has left, and track service flow.
        </p>
      </div>

      <div className="relative min-h-[140px] flex-1 overflow-hidden rounded-xl bg-subtle md:min-h-[174px] lg:max-w-[590px]">
        <Image
          src="/images/clinic/riverside-reception.webp"
          alt=""
          fill
          sizes="(min-width: 1024px) 590px, 100vw"
          className="object-cover"
        />
        <div className="absolute right-4 top-4 flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-full bg-surface px-3 py-2 shadow-[0_5px_12px_rgba(5,48,46,0.09)] sm:max-w-[320px]">
          <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-primary-500 text-sm font-semibold text-white">
            {firstInitials}
          </span>
          <span className="flex flex-col">
            <span className="text-sm font-semibold text-ink">{fullName}</span>
            <span className="text-xs text-muted">Receptionist{clinicName ? ` • ${clinicName}` : ''}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
