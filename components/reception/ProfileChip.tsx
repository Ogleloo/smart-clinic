import Link from 'next/link'
import { initials } from '@/lib/initials'

export const PROFILE_SETTINGS_HREF = '/reception/profile/settings'

interface ProfileChipProps {
  fullName: string
  clinicName: string | null
  /** True on the settings page itself: same chip, but not a link to where you already are. */
  current?: boolean
}

/**
 * Figma frame 222:1755 "Profile-Chip" (336x60, 24px radius, 46px avatar).
 * Figma draws a chevron on it, which promises a dropdown that doesn't exist,
 * so the chip is a plain link to Profile Settings instead and has no chevron.
 */
export function ProfileChip({ fullName, clinicName, current = false }: ProfileChipProps) {
  const className =
    'flex h-[60px] w-full max-w-[336px] items-center gap-3 rounded-[24px] bg-surface pl-2.5 pr-5 text-left shadow-[0_5px_12px_rgba(5,48,46,0.08)]'
  const body = (
    <>
      <span className="flex size-[46px] shrink-0 items-center justify-center rounded-full bg-primary-500 text-base text-white" aria-hidden>
        {initials(fullName)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-base leading-6 text-ink">{fullName}</span>
        <span className="truncate text-xs leading-[18px] text-muted">Receptionist{clinicName ? ` • ${clinicName}` : ''}</span>
      </span>
    </>
  )

  if (current) {
    return (
      <div className={className} role="group" aria-label="Signed in as">
        {body}
      </div>
    )
  }
  return (
    <Link href={PROFILE_SETTINGS_HREF} className={`${className} transition-shadow hover:shadow-[0_8px_18px_rgba(5,48,46,0.14)]`}>
      {body}
      <span className="sr-only"> — open Profile Settings</span>
    </Link>
  )
}
