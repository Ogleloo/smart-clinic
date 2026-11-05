'use client'

import { usePathname } from 'next/navigation'
import { ADMIN_DASHBOARD_HREF, adminPageLabel } from './navItems'

/**
 * The one <main> of every admin screen.
 *
 *  - Dashboard (/admin): the V3 palette, full-width, mint page background; the page draws its own <h1>.
 *  - Every other admin page (still the V2 screens): the V2 palette and the 820px column they were built for,
 *    plus a visually hidden <h1> naming the page — the old layout's visible "Admin" heading went with the old
 *    header, and these pages only draw an <h2>.
 *
 * Staff Management keeps the V2 column deliberately. Its Figma frame (168:412) is a full-width table of
 * per-person Service, Workload and duty columns that this system has no data for; what it actually shows is
 * an invitation form and two lists, which read better in the same measured column as the other V2 admin
 * screens than stretched across 1176px. Converting the whole admin area to the V3 palette is its own piece of
 * work and is not bundled into a staff-onboarding change.
 */
export function AdminContentFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? ''

  if (pathname === ADMIN_DASHBOARD_HREF) {
    return <main className="theme-admin min-h-dvh bg-paper text-ink">{children}</main>
  }
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[820px] flex-col gap-5 px-4 py-6 sm:px-6">
      <h1 className="sr-only">{adminPageLabel(pathname)}</h1>
      {children}
    </main>
  )
}
