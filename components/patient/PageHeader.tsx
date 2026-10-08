import type { ReactNode } from 'react'

/** Content column for patient screens: full width on mobile, capped beside the sidebar on desktop. */
export const PAGE_CLASS = 'mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 md:px-8 md:py-8'

/** Shared heading block for every patient screen — title, optional subtitle, optional right-hand action. */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-[22px] font-bold text-ink md:text-[26px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
