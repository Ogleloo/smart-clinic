'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { logout } from '@/app/actions/auth'
import { SIDEBAR_ITEMS, isActivePath } from './navItems'

/**
 * No mobile frame exists in the Reception V3 Figma page (desktop-first,
 * 1440 reference) — this isn't a design, just a functional stand-in so
 * the nav the V2 ReceptionNav provided at every width isn't lost below
 * md, where ReceptionSidebar hides itself.
 *
 * Sign Out is included here too: ReceptionSidebar's own Sign Out form is
 * inside the sidebar's <aside>, which this component doesn't render, so
 * without this a mobile user would have no way to sign out until Profile
 * Settings (Phase 5) exists. Same `logout` Server Action as the sidebar —
 * no new auth logic.
 */
export function ReceptionMobileNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Main"
      className="sticky top-0 z-10 flex items-center gap-1 overflow-x-auto border-b border-border bg-surface px-3 py-2 md:hidden"
    >
      {SIDEBAR_ITEMS.map((item) => {
        const isActive = isActivePath(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={`shrink-0 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              isActive ? 'bg-primary-50 text-primary-700' : 'text-muted hover:bg-paper'
            }`}
          >
            {item.label}
          </Link>
        )
      })}

      <form action={logout} className="ml-auto shrink-0">
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
