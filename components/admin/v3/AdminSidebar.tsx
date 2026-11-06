'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Headphones, LogOut, Phone } from 'lucide-react'
import { SignOutConfirm } from '@/components/ui/SignOutConfirm'
import { BrandMark } from '@/components/reception/ReceptionSidebar'
import { ADMIN_NAV_ITEMS, isAdminActivePath } from './navItems'

interface AdminSidebarProps {
  clinicName: string | null
  clinicPhone: string | null
}

/**
 * Desktop (md and up) persistent navigation, 264px — Figma frame 168:3 sidebar, same geometry and brand lockup
 * as the Reception and Nurse sidebars. The clinic name is the signed-in admin's own clinic; when it can't be
 * read the sidebar says "Clinic", never an example clinic. Sign Out is a row of its own (Figma draws none).
 * Carries .theme-admin itself so the V2 pages beside it keep their own palette.
 */
export function AdminSidebar({ clinicName, clinicPhone }: AdminSidebarProps) {
  const pathname = usePathname() ?? ''

  return (
    <aside className="theme-admin sticky top-0 hidden h-dvh w-66 shrink-0 flex-col justify-between overflow-y-auto border-r border-border bg-surface px-4 pb-7 pt-9 text-ink md:flex">
      <div className="flex flex-col gap-8">
        <div className="flex items-start gap-4 py-1">
          <BrandMark />
          <div className="flex min-w-0 flex-col">
            <span className="font-display text-[22px] font-semibold text-ink">Smart Clinic</span>
            <span className="truncate text-base text-muted">{clinicName ?? 'Clinic'}</span>
          </div>
        </div>

        <nav aria-label="Main" className="flex flex-col gap-1">
          {ADMIN_NAV_ITEMS.map((item) => {
            const isActive = isAdminActivePath(pathname, item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex h-[52px] items-center gap-3 overflow-hidden rounded-md pl-5 pr-4 text-base transition-colors ${
                  isActive ? 'bg-primary-50 text-[#037F74]' : 'text-muted hover:bg-paper hover:text-ink'
                }`}
              >
                {isActive && <span aria-hidden className="absolute left-0 h-[52px] w-1 bg-primary-500" />}
                <Icon size={22} aria-hidden />
                <span className="flex-1">{item.label}</span>
              </Link>
            )
          })}

          <SignOutConfirm buttonClassName="flex h-[52px] w-full items-center gap-3 rounded-md pl-5 pr-4 text-base text-muted transition-colors hover:bg-paper hover:text-ink">
            <LogOut size={22} aria-hidden />
            Sign Out
          </SignOutConfirm>
        </nav>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-primary-50 p-5">
        <p className="flex items-center gap-3 text-base text-ink">
          <span className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-surface">
            <Headphones size={18} className="text-[#037F74]" aria-hidden />
          </span>
          Need help?
        </p>
        <p className="text-xs text-muted">Contact our support team for assistance.</p>
        {clinicPhone && (
          <a
            href={`tel:${clinicPhone.replace(/\s/g, '')}`}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-sm border-[1.2px] border-[#037F74] bg-surface px-4 text-sm font-semibold text-[#037F74] hover:bg-primary-50"
          >
            <Phone size={16} aria-hidden />
            Call {clinicPhone}
          </a>
        )}
      </div>
    </aside>
  )
}
