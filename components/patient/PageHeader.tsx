import type { ReactNode } from 'react'

/** Content column for patient screens: full width on mobile, capped beside the sidebar on desktop. */
// 1176 = three 352px action cards + two 24px gaps + 36px padding each side (Figma desktop frame).
export const PAGE_CLASS = 'mx-auto flex w-full max-w-[1176px] flex-col gap-6 px-4 py-6 md:px-9 md:py-9'

/** Figma type scale — the only text styles patient screens use. */
export const TYPE = {
  pageTitle: 'font-display text-[40px] font-bold leading-tight text-ink',
  section: 'font-display text-[22px] font-semibold text-ink',
  body: 'text-base text-ink',
  small: 'text-xs text-muted',
} as const

/** Shared heading block for every patient screen — title, optional subtitle, optional right-hand action. */
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
