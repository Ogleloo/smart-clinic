'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LifeBuoy, Phone } from 'lucide-react'
import { SIDEBAR_ITEMS, formatBadge, isActivePath } from './navItems'

interface SidebarProps {
  unreadCount: number
  clinicName: string | null
  /** clinics.phone — null when the clinic hasn't set one, in which case no number (and no call button) is shown. */
  clinicPhone: string | null
}

/** Desktop (md and up) persistent navigation, 264px. Below md the bottom nav takes over. */
export function Sidebar({ unreadCount, clinicName, clinicPhone }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside className="sticky top-0 hidden h-dvh w-66 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex flex-col gap-1 px-6 py-6">
        <span className="font-display text-[22px] font-semibold text-ink">Smart Clinic</span>
        {clinicName && <span className="text-xs text-ink">{clinicName}</span>}
      </div>

      <nav aria-label="Main" className="flex flex-1 flex-col gap-1 px-4">
        {SIDEBAR_ITEMS.map((item) => {
          const isActive = isActivePath(pathname, item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex min-h-12 items-center gap-3 rounded-sm border-l-4 px-3 text-base transition-colors ${
                isActive
                  ? 'border-primary-700 bg-card-mint text-primary-700'
                  : 'border-transparent text-muted hover:bg-paper hover:text-ink'
              }`}
            >
              <Icon size={20} aria-hidden />
              <span className="flex-1">{item.label}</span>
              {item.showsUnread && unreadCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-2 text-xs font-semibold text-white">
                  {formatBadge(unreadCount)}
                  <span className="sr-only"> unread</span>
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <div className="m-4 flex flex-col gap-3 rounded-lg bg-card-mint p-4">
        <p className="flex items-center gap-2 text-base font-semibold text-ink">
          <LifeBuoy size={20} className="text-primary-700" aria-hidden />
          Need help?
        </p>
        {clinicPhone ? (
          <>
            <p className="text-xs text-muted">Call {clinicName ?? 'the clinic'} on {clinicPhone}.</p>
            <a
              href={`tel:${clinicPhone.replace(/\s/g, '')}`}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary-700 px-4 text-sm font-semibold text-white hover:opacity-90"
            >
              <Phone size={16} aria-hidden />
              Get help
            </a>
          </>
        ) : (
          <p className="text-xs text-muted">Ask at reception during opening hours.</p>
        )}
      </div>
    </aside>
  )
}
