import Image from 'next/image'
import { MapPin } from 'lucide-react'
import { CARD } from './authStyles'

/**
 * The background every Patient V3 auth screen shares (Figma 28:40, 33:49, 45:68): a clinic photograph washed out
 * behind a 70% mint veil and an 8px backdrop blur, with soft rotated teal shapes bleeding off the corners.
 *
 * The photograph is the clinic's own approved image (public/images/clinic), not the Figma one: the Figma
 * photographs carry another clinic's signage, which the Nurse V3 hero already set the precedent of not shipping.
 * At this opacity the subject is barely legible, so the substitution costs nothing visually.
 *
 * Where backdrop-filter is unsupported the veil alone still carries the contrast, so the card stays readable.
 */

type Blob = {
  /** Wrapper offsets, exactly as Figma positions the rotated bounding box. */
  pos: string
  /** Size of the shape itself (not the rotated box). */
  w: number
  h: number
  radius: number
  rotate: number
  color: string
  opacity: number
}

const LOGIN_BLOBS: Blob[] = [
  { pos: 'right-[-165px] top-[-178px] h-[465px] w-[465px]', w: 380, h: 380, radius: 140, rotate: -15, color: '#08B9A8', opacity: 0.22 },
  { pos: 'bottom-[-172px] left-[-204px] h-[452px] w-[452px]', w: 340, h: 340, radius: 120, rotate: 25, color: '#039486', opacity: 0.18 },
  { pos: 'bottom-[-156px] right-[202px] h-[396px] w-[396px]', w: 280, h: 280, radius: 90, rotate: 45, color: '#08B9A8', opacity: 0.15 },
]

const FORM_BLOBS: Blob[] = [
  { pos: 'left-[-50px] top-[-125px] h-[388px] w-[419px]', w: 360, h: 320, radius: 120, rotate: -12, color: '#08B9A8', opacity: 0.22 },
  { pos: 'left-[-41px] top-[-30px] h-[336px] w-[355px]', w: 280, h: 240, radius: 100, rotate: 25, color: '#039486', opacity: 0.18 },
  { pos: 'bottom-[-256px] right-[-31px] h-[496px] w-[506px]', w: 380, h: 340, radius: 140, rotate: 35, color: '#08B9A8', opacity: 0.24 },
  { pos: 'bottom-[-12px] right-[-28px] h-[280px] w-[308px]', w: 260, h: 220, radius: 80, rotate: -15, color: '#039486', opacity: 0.16 },
]

export function AuthBackdrop({ blobs = 'form' }: { blobs?: 'login' | 'form' }) {
  const set = blobs === 'login' ? LOGIN_BLOBS : FORM_BLOBS
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <Image
        src="/images/clinic/riverside-reception.webp"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      <div className="absolute inset-0 bg-[rgba(232,252,250,0.78)] supports-[backdrop-filter]:bg-[rgba(232,252,250,0.7)] supports-[backdrop-filter]:backdrop-blur-[8px]" />
      {set.map((b, i) => (
        <div key={i} className={`absolute hidden items-center justify-center md:flex ${b.pos}`}>
          <div
            className="shrink-0"
            style={{
              width: b.w,
              height: b.h,
              borderRadius: b.radius,
              background: b.color,
              opacity: b.opacity,
              transform: `rotate(${b.rotate}deg)`,
            }}
          />
        </div>
      ))}
    </div>
  )
}

/** Figma's SmartClinic/Brand lockup (10:3): four rounded squares, the wordmark, and the clinic line beneath. */
export function AuthBrand() {
  const sq = 'absolute rounded-[8px]'
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-start gap-4 py-1">
        <span aria-hidden className="relative block size-[46px] shrink-0 overflow-hidden">
          <span className={`${sq} bg-[#08B9A8]`} style={{ left: 13, top: 0, width: 20, height: 20 }} />
          <span className={`${sq} bg-[#039486]`} style={{ left: 26, top: 13, width: 20, height: 20 }} />
          <span className={`${sq} bg-[#08B9A8]`} style={{ left: 13, top: 26, width: 20, height: 20 }} />
          <span className={`${sq} bg-[#08B9A8]`} style={{ left: 0, top: 13, width: 20, height: 20 }} />
        </span>
        <span className="flex flex-col justify-center gap-1">
          <span className="font-display text-[22px] font-semibold leading-7 text-ink">Smart Clinic</span>
          <span className="text-xs leading-[18px] text-muted">Riverside Clinic</span>
        </span>
      </div>
      {/* Figma repeats the clinic name here as a location line; kept because it is the only teal accent in the
          header block, but it is the same clinic, not a second one. */}
      <p className="flex items-center gap-2 text-base leading-6 text-[#037F74]">
        <MapPin aria-hidden size={14} />
        Riverside Clinic
      </p>
    </div>
  )
}

/**
 * Page wrapper: the washed backdrop with the card centred on it. `.theme-public` supplies the V3 palette tokens
 * (the same token-only class the public landing page uses) without touching any signed-in screen.
 */
export function AuthShell({
  children,
  blobs = 'form',
}: {
  children: React.ReactNode
  blobs?: 'login' | 'form'
}) {
  return (
    <div className="theme-public relative min-h-dvh bg-paper text-ink">
      <AuthBackdrop blobs={blobs} />
      <main className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-10 sm:px-6">
        <div className={CARD}>{children}</div>
      </main>
    </div>
  )
}
