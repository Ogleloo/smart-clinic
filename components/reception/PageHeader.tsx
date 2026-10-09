import type { ReactNode } from 'react'

/** Content column for reception screens: 1176px beside the 264px sidebar (Figma desktop frame, 1440 total). */
export const PAGE_CLASS = 'mx-auto flex w-full max-w-[1176px] flex-col gap-6 px-4 py-6 md:px-9 md:py-9'

/** Figma type scale (frame 111:2 variable defs) — the only text styles reception V3 screens use. */
export const TYPE = {
  pageTitle: 'font-display text-[40px] font-bold leading-tight text-ink',
  section: 'font-display text-[22px] font-semibold text-ink',
  body: 'text-base text-ink',
  small: 'text-xs text-muted',
} as const

/** Shared heading block for every reception V3 screen — title, optional subtitle, optional right-hand action. */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className={TYPE.pageTitle}>{title}</h1>
        {subtitle && <p className="text-base text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
