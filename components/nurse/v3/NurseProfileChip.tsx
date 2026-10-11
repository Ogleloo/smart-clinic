import { initials } from '@/lib/initials'

/**
 * Figma "Profile-Chip" (node 211:221 on frame 161:170): white pill, 24px radius, 44px avatar, name over
 * "Nurse • clinic". Same decisions as the dashboard chip: not a link and no chevron (there is no nurse profile
 * menu yet), and the avatar is #037F74 because white initials on Figma's #08B9A8 are only 2.47:1.
 */
export function NurseProfileChip({ fullName, clinicName }: { fullName: string; clinicName: string | null }) {
  return (
    <div
      role="group"
      aria-label="Signed in as"
      className="flex max-w-full items-center gap-3 rounded-[24px] bg-surface py-3 pl-3 pr-5 shadow-[0_4px_6px_rgba(5,48,46,0.08)]"
    >
      <span
        aria-hidden
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#037F74] text-base text-white"
      >
        {initials(fullName) || '–'}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-base leading-6 text-ink">{fullName}</span>
        <span className="truncate text-xs leading-[18px] text-muted">Nurse{clinicName ? ` • ${clinicName}` : ''}</span>
      </span>
    </div>
  )
}
