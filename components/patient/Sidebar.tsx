'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LifeBuoy, Phone } from 'lucide-react'
import { SIDEBAR_ITEMS, formatBadge, isActivePath } from './navItems'

interface SidebarProps {
  unreadCount: number
  clinicName: string | null
  /** clinics.phone — null when the clinic hasn't set one, in which case no number is shown at all. */
  clinicPhone: string | null
}

/** Desktop (md and up) persistent navigation. Below md the bottom nav takes over. */
export function Sidebar({ unreadCount, clinicName, clinicPhone }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="h-8 w-8 rounded-full bg-primary-700" aria-hidden />
        <span className="font-display text-lg font-semibold text-ink">{clinicName ?? 'Clinic'}</span>
      </div>

      <nav aria-label="Main" className="flex flex-1 flex-col gap-1 px-3">
        {SIDEBAR_ITEMS.map((item) => {
          const isActive = isActivePath(pathname, item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold transition-colors ${
                isActive ? 'bg-primary-50 text-primary-700' : 'text-muted hover:bg-subtle hover:text-ink'
              }`}
            >
              <Icon size={18} aria-hidden />
              <span className="flex-1">{item.label}</span>
              {item.showsUnread && unreadCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-bold text-white">
                  {formatBadge(unreadCount)}
                  <span className="sr-only"> unread</span>
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <div className="m-3 rounded-lg bg-subtle p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <LifeBuoy size={16} aria-hidden />
          Need help?
        </p>
        {clinicPhone ? (
          <a
            href={`tel:${clinicPhone.replace(/\s/g, '')}`}
            className="mt-2 flex items-center gap-2 text-sm font-semibold text-primary-700"
          >
            <Phone size={14} aria-hidden />
            {clinicPhone}
          </a>
        ) : (
          <p className="mt-1 text-xs text-muted">Ask at reception during opening hours.</p>
        )}
      </div>
    </aside>
  )
}
