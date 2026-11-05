import type { PublicQueueDisplay } from '@/lib/types/database.types'
import { coverageVariant } from '@/lib/queueCoverage'

/**
 * Copy and small helpers for the public landing page (Figma frame 16:6). Wherever the Figma text would state
 * something the system cannot back up, the wording here differs on purpose — see the notes on each item and
 * docs of the PR. Nothing here is fetched; the live parts (services, queue figures, opening hours) arrive as props.
 */

/** Section anchors. Every nav and footer link points at one of these or at a real route — there are no placeholder links. */
export const ANCHORS = { top: 'top', about: 'about', services: 'services', how: 'how-it-works' } as const

export const NAV_LINKS = [
  { href: `#${ANCHORS.top}`, label: 'Home' },
  { href: `#${ANCHORS.services}`, label: 'Services' },
  { href: `#${ANCHORS.how}`, label: 'How it works' },
  { href: `#${ANCHORS.about}`, label: 'About' },
] as const

/** Figma's hero line says "skip the queue"; booking does not bypass check-in, so it says "follow the queue". */
export const HERO_SUBTITLE = 'Book appointments, follow the queue, and see your estimated wait — all in one place.'

export const MICRO_FEATURES = [
  { icon: '/images/landing/icons/users-18.svg', title: 'Live queue position', caption: 'See your position live' },
  { icon: '/images/landing/icons/clock-18.svg', title: 'Honest wait estimates', caption: 'Plan around clinic flow' },
  { icon: '/images/landing/icons/bell-18.svg', title: 'In-app updates', caption: 'Reminders & notifications' },
] as const

/** "Reschedule" is not offered by the app, so the booking card says what is: book and cancel. */
export const FEATURES = [
  { icon: '/images/landing/icons/users-24.svg', title: 'Live queue tracking', body: 'See your real-time position before your turn.' },
  { icon: '/images/landing/icons/clock-24.svg', title: 'Honest wait estimates', body: 'See your approximate wait based on the current clinic queue.' },
  { icon: '/images/landing/icons/calendar-24.svg', title: 'Appointment booking', body: 'Book or cancel appointments online.' },
  { icon: '/images/landing/icons/bell-24.svg', title: 'Notifications & reminders', body: 'Stay informed about appointments and queue updates.' },
] as const

/** Step 2 says check-in still happens; Figma's "high quality care" claim is not something the system can show. */
export const STEPS = [
  { icon: '/images/landing/icons/step-user.svg', title: 'Create your profile', body: 'Sign up and add a few details to get started.' },
  { icon: '/images/landing/icons/step-calendar.svg', title: 'Book or check in', body: 'Book an appointment or walk in — either way, check in at reception when you arrive.' },
  { icon: '/images/landing/icons/step-compass.svg', title: 'Track your turn', body: 'See your queue position and estimated wait time, updated as the queue moves.' },
  { icon: '/images/landing/icons/step-heart-pulse.svg', title: 'Get seen', body: 'When it is your turn, the clinic calls you in.' },
] as const

export const CTA_SUBTITLE = 'Book ahead, check in, and follow your place in the queue.'
export const FOOTER_BLURB = 'Riverside Clinic’s appointment and queue system: book ahead, check in, and follow your place in line.'

// ------------------------------------------------------------------------------------------------ live data

/** What the page knows about the services. "unavailable" (the read failed) is never the same as "empty" (it succeeded with none). */
export type ServicesState =
  | { status: 'ok'; rows: PublicQueueDisplay[] }
  | { status: 'empty' }
  | { status: 'unavailable' }

export type HoursState = { status: 'ok'; lines: string[] } | { status: 'empty' } | { status: 'unavailable' }

export const displayHref = (serviceId: string) => `/display/${serviceId}`

/** One public service icon per service, picked from its NAME only; unknown names get the general-consultation icon. */
export function serviceIconFor(name: string): { src: string; size: number; inset: boolean } {
  const n = name.toLowerCase()
  if (/immuni[sz]|vaccin/.test(n)) return { src: '/images/landing/icons/syringe.svg', size: 20.0016, inset: true }
  if (/chronic/.test(n)) return { src: '/images/landing/icons/heart-pulse.svg', size: 24, inset: false }
  if (/family|plan/.test(n)) return { src: '/images/landing/icons/users-24.svg', size: 24, inset: false }
  return { src: '/images/landing/icons/stethoscope.svg', size: 24, inset: false }
}

/**
 * The status line of one service, from the public RPC's own fields only. An estimate is shown as an estimate, only
 * when someone is on duty and someone is waiting; with nobody on duty there is no figure at all.
 */
export function serviceStatusText(row: Pick<PublicQueueDisplay, 'is_being_served' | 'waiting_count' | 'estimated_wait_minutes'>): string {
  const variant = coverageVariant(row)
  if (variant === 'active') {
    return row.waiting_count > 0
      ? `${row.waiting_count} waiting · estimated wait about ${row.estimated_wait_minutes} min`
      : 'No one is waiting'
  }
  if (variant === 'warning') return `${row.waiting_count} waiting · no nurse on duty, so no estimate`
  return 'No nurse on duty'
}

/**
 * The three states of the services block, in plain words.
 *  - empty: the read worked and there are no ACTIVE services. The booking page cannot book without one, so this must
 *    not say or imply that booking is possible. (Signing up is still possible, and says only that.)
 *  - unavailable: the read FAILED. This is a data problem, not a statement about the clinic.
 */
export const EMPTY_SERVICES_TEXT =
  'No services are available at the moment, so appointments can’t be booked right now. Please check back soon — you can still create an account or log in in the meantime.'
export const UNAVAILABLE_SERVICES_TEXT =
  'We couldn’t load the current service information. This is a temporary problem with the request, not a sign that the clinic is closed — please refresh the page to try again. You can still create an account or log in, and walk-in patients are registered at reception.'

/**
 * This page is a server-rendered snapshot taken when it loads: there is no realtime subscription and no polling.
 * Live updating belongs to the signed-in queue screens and the waiting-room display, not to this page.
 */
export const SNAPSHOT_NOTE =
  'These figures are a snapshot from when this page loaded — refresh the page for the latest. Estimated waits are approximate and not guaranteed; they change as the queue moves. Where no nurse is on duty we show no estimate rather than a guess.'
export const CHECK_IN_NOTE = 'Booking a slot does not skip check-in: please check in at reception when you arrive.'

export const HOURS_UNAVAILABLE = 'Opening hours are unavailable right now.'
export const HOURS_EMPTY = 'Opening hours have not been published yet.'

// ------------------------------------------------------------------------------------------------ class strings
// The landing palette is Figma's: white-on-#08B9A8 buttons are 2.47:1, so buttons and small teal text use #037F74
// (4.89:1) and the CTA panel is #037F74 with full-opacity white text. Large (40px) accent words use #039486 (3.6:1 ≥ 3:1).

export const BTN_PRIMARY =
  'inline-flex min-h-12 items-center justify-center rounded-[8px] bg-[#037F74] px-8 text-sm font-semibold text-white transition-colors hover:bg-[#026B62]'
/** Focus ring that stays visible on the teal panel (the global ring is teal and would vanish into it). */
export const RING_ON_TEAL = 'focus-visible:shadow-[0_0_0_2px_#037F74,0_0_0_4px_#FFFFFF]'
export const BTN_WHITE = `inline-flex min-h-[52px] items-center justify-center rounded-[8px] bg-white px-7 text-sm font-semibold text-[#037F74] transition-colors hover:bg-primary-50 ${RING_ON_TEAL}`
export const BTN_WHITE_OUTLINE = `inline-flex min-h-[52px] items-center justify-center rounded-[8px] border-[1.5px] border-white px-7 text-sm font-semibold text-white transition-colors hover:bg-white/10 ${RING_ON_TEAL}`
export const CARD = 'rounded-[16px] border border-border bg-surface shadow-[0_12px_16px_rgba(5,48,46,0.08)]'
export const ICON_BADGE = 'flex size-14 shrink-0 items-center justify-center rounded-[24px] bg-primary-50'
