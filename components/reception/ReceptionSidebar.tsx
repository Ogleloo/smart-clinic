'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LifeBuoy, LogOut, Phone } from 'lucide-react'
import { logout } from '@/app/actions/auth'
import { SIDEBAR_ITEMS, isActivePath } from './navItems'

interface ReceptionSidebarProps {
  clinicName: string | null
  clinicPhone: string | null
}

/** Desktop (md and up) persistent navigation, 264px — matches the `SmartClinic/ReceptionSidebar` Figma component width. */
export function ReceptionSidebar({ clinicName, clinicPhone }: ReceptionSidebarProps) {
  const pathname = usePathname()

  return (
    <aside className="sticky top-0 hidden h-dvh w-66 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex flex-col gap-1 px-6 py-6">
        <span className="font-display text-[22px] font-semibold text-ink">Smart Clinic</span>
        {clinicName && <span className="text-xs text-muted">{clinicName}</span>}
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
                  ? 'border-primary-700 bg-primary-50 text-primary-700'
                  : 'border-transparent text-muted hover:bg-paper hover:text-ink'
              }`}
            >
              <Icon size={20} aria-hidden />
              <span className="flex-1">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Same Server Action as every other sign-out in the app: logout() then redirect to /login. */}
      <form action={logout} className="px-4">
        <button
          type="submit"
          className="flex min-h-12 w-full items-center gap-3 rounded-sm border-l-4 border-transparent px-3 text-base text-muted transition-colors hover:bg-paper hover:text-ink"
        >
          <LogOut size={20} aria-hidden />
          Sign Out
        </button>
      </form>

      <div className="m-4 flex flex-col gap-3 rounded-lg bg-primary-50 p-4">
        <p className="flex items-center gap-2 text-base font-semibold text-ink">
          <LifeBuoy size={20} className="text-primary-700" aria-hidden />
          Need help?
        </p>
        {clinicPhone ? (
          <>
            <p className="text-xs text-muted">Contact your support team for assistance.</p>
            <a
              href={`tel:${clinicPhone.replace(/\s/g, '')}`}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border-[1.5px] border-primary-700 bg-transparent px-4 text-sm font-semibold text-primary-700 hover:bg-surface"
            >
              <Phone size={16} aria-hidden />
              Call {clinicPhone}
            </a>
          </>
        ) : (
          <p className="text-xs text-muted">Contact your support team for assistance.</p>
        )}
      </div>
    </aside>
  )
}
