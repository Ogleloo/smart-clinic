import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { TYPE } from '@/components/patient/PageHeader'
import { initials } from '@/lib/initials'

export interface PatientHeaderBannerProps {
  title: string
  subtitle: string
  fullName: string
}

/**
 * Decorative page-header band (Figma 48:130 / 52:400 / 57:… / 68:…) shared by every V3 booking screen: a
 * rounded mint band with the page title/subtitle, the patient's account chip, and — on large screens — a
 * decorative clinic photo. Same structure and the same fixes as the dashboard's own header
 * (components/patient/DashboardView.tsx): the chip shows name and role only, never the ID/passport number
 * (Figma's sample patient chip does — that's mockup data, not a reason to put a national ID on screen), and
 * truncates a long name instead of overflowing or clipping it. Kept as its own component rather than reused
 * from DashboardView because DashboardView's header also carries a time-of-day greeting that these screens
 * don't have — copying its JSX pattern for a plain title/subtitle instead of sharing the component avoids
 * touching the already-shipped, already-tested dashboard for an unrelated task.
 */
export function PatientHeaderBanner({ title, subtitle, fullName }: PatientHeaderBannerProps) {
  return (
    <div className="relative flex min-h-[160px] flex-col gap-4 overflow-hidden rounded-[24px] bg-card-mint p-6 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6 sm:p-8">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className={`${TYPE.pageTitle} break-words`}>{title}</h1>
        <p className="text-base text-muted">{subtitle}</p>
      </div>

      <Link
        href="/profile"
        className="relative z-10 flex w-full min-w-0 items-center gap-3 rounded-[24px] bg-surface py-2 pl-3 pr-4 shadow-[0_12px_16px_rgba(5,48,46,0.08)] hover:opacity-90 sm:w-fit sm:max-w-[280px] sm:shrink-0"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-700 text-sm font-semibold text-white" aria-hidden>
          {initials(fullName) || '–'}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base leading-6 text-ink">{fullName}</span>
          <span className="text-xs leading-[18px] text-muted">Patient</span>
        </span>
        <ChevronDown size={14} className="shrink-0 text-muted" aria-hidden />
      </Link>

      <div aria-hidden className="absolute inset-y-0 right-0 hidden w-[42%] lg:block">
        {/* eslint-disable-next-line @next/next/no-img-element -- decorative atmosphere image, not optimised content */}
        <img src="/images/clinic/riverside-reception.webp" alt="" className="h-full w-full object-cover opacity-90" />
        <div className="absolute inset-0 bg-gradient-to-r from-card-mint via-card-mint/40 to-transparent" />
      </div>
    </div>
  )
}
