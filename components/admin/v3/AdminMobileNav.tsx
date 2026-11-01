'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { logout } from '@/app/actions/auth'
import { ADMIN_NAV_ITEMS, isAdminActivePath } from './navItems'

/**
 * Below md the sidebar hides itself. Figma has no mobile frame, so this is a functional stand-in: every admin
 * area as a scrolling row of links, and Sign Out pinned on the right so it is always visible. p-1 on the
 * scroller: it clips anything outside its box, and the focus ring is a 4px box-shadow.
 */
export function AdminMobileNav() {
  const pathname = usePathname() ?? ''

  return (
    <nav
      aria-label="Main"
      className="theme-admin sticky top-0 z-10 flex items-center gap-1 border-b border-border bg-surface px-3 py-2 md:hidden"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1">
        {ADMIN_NAV_ITEMS.map((item) => {
          const isActive = isAdminActivePath(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                isActive ? 'bg-primary-50 text-[#037F74]' : 'text-muted hover:bg-paper'
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </div>

      <form action={logout} className="shrink-0">
        <button
          type="submit"
          aria-label="Sign Out"
          className="flex min-h-9 items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold text-muted transition-colors hover:bg-paper hover:text-ink"
        >
          <LogOut size={16} aria-hidden />
          <span className="sr-only sm:not-sr-only">Sign Out</span>
        </button>
      </form>
    </nav>
  )
}
