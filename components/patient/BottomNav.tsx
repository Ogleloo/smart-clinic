'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BOTTOM_NAV_ITEMS, formatBadge, isActivePath } from './navItems'

/** Mobile (below md) navigation. The desktop sidebar replaces it from md up. */
export function BottomNav({ unreadCount }: { unreadCount: number }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface md:hidden">
      <div className="mx-auto flex max-w-md items-center justify-around px-2 py-2">
        {BOTTOM_NAV_ITEMS.map((tab) => {
          const isActive = isActivePath(pathname, tab.href)
          const Icon = tab.icon
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex flex-col items-center gap-0.5 rounded-md px-4 py-1.5 text-xs font-semibold ${
                isActive ? 'text-primary-700' : 'text-muted'
              }`}
            >
              {/* Icon above the label, not replacing it — icons aid recognition for users with limited literacy, labels keep it unambiguous. */}
              <Icon size={20} aria-hidden />
              {tab.label}
              {tab.showsUnread && unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                  {formatBadge(unreadCount)}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
