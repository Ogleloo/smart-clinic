import Image from 'next/image'
import Link from 'next/link'
import { initials } from '@/lib/initials'
import { TYPE } from '@/components/reception/PageHeader'
import { NURSE_QUEUE_HREF } from './navItems'

interface NurseDashboardHeroProps {
  fullName: string
  clinicName: string | null
  isOnDuty: boolean
  serviceName: string | null
}

/**
 * Figma frame 161:3 "Main" hero: title block on the left (x=32), a 580×196 image on the right with the
 * profile chip floating over its top-right corner.
 *
 * The image is the same approved illustrative reception image the Reception hero uses, not the Figma
 * photograph (which shows another clinic's branding). Its alt is empty: it is decoration, and the
 * nurse's identity is in the chip text.
 *
 * The chip is not a link: Figma draws a chevron on it, but there is no nurse Profile Settings screen
 * (or menu) yet, and a control that goes nowhere is worse than none. Its avatar uses #037F74 instead of
 * Figma's #08B9A8 because white initials on #08B9A8 are only 2.47:1.
 *
 * The duty line under the subtitle is not in Figma. The dashboard has to say plainly whether the queue
 * below is live, and when the nurse is off duty, where to go to start.
 */
export function NurseDashboardHero({ fullName, clinicName, isOnDuty, serviceName }: NurseDashboardHeroProps) {
  return (
    <section aria-label="Welcome" className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_580px] xl:items-start xl:pr-4">
      <div className="flex flex-col pt-1 xl:pl-2 xl:pt-3">
        <h1 className={`${TYPE.pageTitle} flex flex-col`}>
          <span>Welcome back,</span>
          <span className="-mt-0.5 break-words text-[#039486]">{fullName}</span>
        </h1>
        <p className="mt-1.5 max-w-[460px] text-base text-muted">
          Manage consultation queues, patient records and quality care.
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" aria-label="Duty status">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 font-semibold ${
              isOnDuty ? 'bg-primary-50 text-[#037F74]' : 'bg-subtle text-muted'
            }`}
          >
            <span aria-hidden className={`size-2 rounded-full ${isOnDuty ? 'bg-primary-500' : 'bg-muted'}`} />
            {isOnDuty ? `On duty${serviceName ? ` · ${serviceName}` : ''}` : 'Off duty'}
          </span>
          {!isOnDuty && (
            <Link href={NURSE_QUEUE_HREF} className="font-semibold text-[#037F74] underline underline-offset-2">
              Go on duty in My Queue
            </Link>
          )}
        </p>
      </div>

      <div className="relative h-[196px] overflow-hidden rounded-lg bg-subtle">
        <Image
          src="/images/clinic/riverside-reception.webp"
          alt=""
          fill
          sizes="(min-width: 1280px) 580px, 100vw"
          className="object-cover"
          priority
        />
        <div aria-hidden className="absolute inset-0 bg-[rgba(242,251,249,0.1)]" />
        <div
          role="group"
          aria-label="Signed in as"
          className="absolute right-4 top-4 flex h-[60px] w-[320px] max-w-[calc(100%-2rem)] items-center gap-2 rounded-[24px] bg-surface pl-2 pr-4 shadow-[0_4px_12px_rgba(5,48,46,0.08)] xl:right-[46px] xl:top-[14px]"
        >
          <span
            aria-hidden
            className="flex size-[46px] shrink-0 items-center justify-center rounded-full bg-[#037F74] text-base text-white"
          >
            {initials(fullName) || '–'}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-base leading-6 text-ink">{fullName}</span>
            <span className="truncate text-xs leading-[18px] text-muted">Nurse{clinicName ? ` • ${clinicName}` : ''}</span>
          </span>
        </div>
      </div>
    </section>
  )
}
