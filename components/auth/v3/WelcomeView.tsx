import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, Bell, Clock, MapPin, Users } from 'lucide-react'
import { BTN_PRIMARY, BTN_SECONDARY } from './authStyles'

/**
 * Patient V3 Welcome Entry (Figma 22:39): a 720px content column beside a full-height clinic photograph, with
 * soft teal shapes drifting across the seam. Below lg the photograph becomes a band under the content.
 *
 * This is the entry to the *authentication* flow, not a second home page: it offers exactly two actions and
 * links back to the public landing page. The photograph is the clinic's own approved image rather than Figma's
 * (same reason as AuthShell).
 */

const FEATURES = [
  { icon: Users, title: 'Live queue position', body: 'See your real-time position in the queue.' },
  // Figma says "Get accurate wait times". The engine gives an estimate and withholds one when no nurse is on
  // duty, so this promises an estimate rather than accuracy.
  { icon: Clock, title: 'Honest wait estimates', body: 'See your approximate wait, based on the queue right now.' },
  { icon: Bell, title: 'In-app updates', body: 'Receive important updates about your queue and appointment.' },
] as const

const DECO = [
  { pos: 'left-[560px] top-[-185px] h-[485px] w-[447px]', w: 340, h: 400, radius: 120, rotate: -18, color: '#08B9A8', opacity: 0.22 },
  { pos: 'left-[625px] top-[60px] h-[415px] w-[368px]', w: 300, h: 360, radius: 120, rotate: 12, color: '#039486', opacity: 0.18 },
  { pos: 'left-[340px] top-[120px] h-[390px] w-[375px]', w: 260, h: 300, radius: 100, rotate: 30, color: '#08B9A8', opacity: 0.14 },
  { pos: 'left-[740px] top-[-49px] h-[278px] w-[242px]', w: 220, h: 260, radius: 80, rotate: -5, color: '#039486', opacity: 0.2 },
]

export function WelcomeView() {
  return (
    <div className="theme-public relative min-h-dvh overflow-hidden bg-paper text-ink">
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden xl:block">
        {DECO.map((d, i) => (
          <div key={i} className={`absolute flex items-center justify-center ${d.pos}`}>
            <div
              className="shrink-0"
              style={{
                width: d.w,
                height: d.h,
                borderRadius: d.radius,
                background: d.color,
                opacity: d.opacity,
                transform: `rotate(${d.rotate}deg)`,
              }}
            />
          </div>
        ))}
      </div>

      <div className="relative flex min-h-dvh flex-col xl:grid xl:grid-cols-[720px_minmax(0,1fr)]">
        <main className="flex flex-col gap-10 px-5 py-10 sm:px-10 sm:py-14 xl:gap-[52px] xl:px-20 xl:py-[72px]">
          <Link
            href="/"
            className="inline-flex min-h-11 w-fit items-center gap-2 text-sm font-semibold text-muted hover:text-ink"
          >
            <ArrowLeft aria-hidden size={16} />
            Back to home
          </Link>

          <div className="flex items-center gap-4">
            <span aria-hidden className="relative block size-14 shrink-0 overflow-hidden">
              <span className="absolute rounded-[8px] bg-[#08B9A8]" style={{ left: 16, top: 0, width: 24, height: 24 }} />
              <span className="absolute rounded-[8px] bg-[#039486]" style={{ left: 32, top: 16, width: 24, height: 24 }} />
              <span className="absolute rounded-[8px] bg-[#08B9A8]" style={{ left: 16, top: 32, width: 24, height: 24 }} />
              <span className="absolute rounded-[8px] bg-[#08B9A8]" style={{ left: 0, top: 16, width: 24, height: 24 }} />
            </span>
            <span className="flex flex-col gap-1">
              <span className="font-display text-[32px] font-bold leading-tight text-ink sm:text-[40px] sm:leading-[44px]">
                Smart Clinic
              </span>
              <span className="flex items-center gap-1 text-base leading-6 text-muted">
                <MapPin aria-hidden size={12} />
                Riverside Clinic
              </span>
            </span>
          </div>

          <div className="flex flex-col gap-5">
            <h1 className="font-display text-[32px] font-bold leading-tight text-ink sm:text-[40px] sm:leading-[44px]">
              {/* 40px text, so Figma's lighter accent clears the 3:1 large-text bar. */}
              Know where <span className="text-[#039486]">you stand</span>
            </h1>
            {/* Figma says "skip the queue"; booking does not bypass check-in, so this says "follow". */}
            <p className="font-display text-lg font-semibold leading-7 text-muted sm:text-[22px]">
              Book appointments, follow the queue, and see your estimated wait — all in one place.
            </p>
          </div>

          <div className="flex w-full flex-col gap-4 sm:max-w-[380px]">
            <Link href="/register" className={BTN_PRIMARY}>
              Get started →
            </Link>
            <Link href="/login" className={BTN_SECONDARY}>
              Log in
            </Link>
          </div>

          <ul className="flex flex-col gap-7">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex items-center gap-5">
                <span className="flex size-[60px] shrink-0 items-center justify-center rounded-[24px] bg-primary-50 text-[#037F74]">
                  <Icon aria-hidden size={26} />
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-base leading-6 text-ink">{title}</span>
                  <span className="text-base leading-6 text-muted">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </main>

        <div className="relative h-[260px] overflow-hidden sm:h-[340px] xl:h-auto">
          <Image
            src="/images/clinic/riverside-reception.webp"
            alt=""
            fill
            priority
            sizes="(min-width: 1280px) 720px, 100vw"
            className="object-cover"
          />
          <div aria-hidden className="absolute inset-y-0 left-0 hidden w-[360px] bg-gradient-to-r from-[#F5FFFD] to-[rgba(245,255,253,0)] xl:block" />
          <div aria-hidden className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-[#F5FFFD] to-[rgba(245,255,253,0)] xl:hidden" />
        </div>
      </div>
    </div>
  )
}
