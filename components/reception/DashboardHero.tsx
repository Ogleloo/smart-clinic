import Image from 'next/image'
import { initials } from '@/lib/initials'
import { greetingForNow } from '@/lib/clinicTime'
import { TYPE } from './PageHeader'

interface DashboardHeroProps {
  fullName: string
  clinicName: string | null
}

/**
 * Figma frame 111:2 "Hero-Section". The two background ellipses are
 * decorative only (no asset).
 *
 * The photo itself is NOT the Figma source image — that file is a real
 * photograph of "CityMD Clinic" (a different, identifiable clinic's
 * branding on the reception wall), which can't be shipped in this app.
 * public/images/clinic/riverside-reception.webp is the approved
 * replacement: an illustrative clinic reception image, not a verified
 * photograph of the actual Riverside Clinic — hence the empty alt text,
 * same as the purely decorative role the Figma photo itself plays here
 * (the receptionist's real identity is in the chip text, not the image).
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

        <div className="relative min-h-[180px] overflow-hidden rounded-lg bg-subtle md:min-h-[286px]">
          <Image
            src="/images/clinic/riverside-reception.webp"
            alt=""
            fill
            sizes="(min-width: 768px) 700px, 100vw"
            className="object-cover"
            priority
          />
          <div className="absolute right-4 top-4 flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-full bg-surface px-3 py-2 shadow-[0_12px_32px_rgba(5,48,46,0.08)] sm:max-w-[330px]">
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
