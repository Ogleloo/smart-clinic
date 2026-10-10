'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { logout } from '@/app/actions/auth'
import { NURSE_NAV_ITEMS, isNurseActivePath } from './navItems'

/**
 * Below md the sidebar hides itself. The Figma page is desktop-first and has no mobile frame, so this is a
 * functional stand-in, not a design: the same routes as the sidebar, with Sign Out pinned on the right so it
 * is always visible on a phone (the sidebar's own Sign Out lives inside the hidden <aside>).
 */
export function NurseMobileNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Main"
      className="sticky top-0 z-10 flex items-center gap-1 border-b border-border bg-surface px-3 py-2 md:hidden"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {NURSE_NAV_ITEMS.map((item) => {
          const isActive = isNurseActivePath(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={`shrink-0 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
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
