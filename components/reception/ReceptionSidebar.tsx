'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Headphones, LogOut, Phone, UserRound } from 'lucide-react'
import { logout } from '@/app/actions/auth'
import { SIDEBAR_ITEMS, isActivePath } from './navItems'
import { PROFILE_SETTINGS_HREF } from './ProfileChip'

interface ReceptionSidebarProps {
  clinicName: string | null
  clinicPhone: string | null
}

/** `SmartClinic/Brand` lockup (Figma node 10:3) — four offset rounded squares in a pinwheel, two accent tones. */
export function BrandMark() {
  return (
    <div aria-hidden className="relative size-8 shrink-0">
      <span className="absolute left-[28%] top-0 size-[43%] rounded-[3px] bg-primary-500" />
      <span className="absolute left-[56%] top-[28%] size-[43%] rounded-[3px] bg-primary-600" />
      <span className="absolute left-[28%] top-[56%] size-[43%] rounded-[3px] bg-primary-500" />
      <span className="absolute left-0 top-[28%] size-[43%] rounded-[3px] bg-primary-500" />
    </div>
  )
}

/** Desktop (md and up) persistent navigation, 264px — matches the `SmartClinic/ReceptionSidebar` Figma component (node 201:711). */
export function ReceptionSidebar({ clinicName, clinicPhone }: ReceptionSidebarProps) {
  const pathname = usePathname()

  return (
    <aside className="sticky top-0 hidden h-dvh w-66 shrink-0 flex-col justify-between border-r border-border bg-surface px-4 pb-7 pt-9 md:flex">
      <div className="flex flex-col gap-8">
        <div className="flex items-start gap-4 py-1">
          <BrandMark />
          <div className="flex flex-col">
            <span className="font-display text-[22px] font-semibold text-ink">Smart Clinic</span>
            <span className="text-base text-muted">{clinicName ?? 'Riverside Clinic'}</span>
          </div>
        </div>

        <nav aria-label="Main" className="flex flex-col gap-1">
          {SIDEBAR_ITEMS.map((item) => {
            const isActive = isActivePath(pathname, item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex h-[58px] items-center gap-4 overflow-hidden rounded-md pl-5 pr-4 text-base transition-colors ${
                  isActive ? 'bg-primary-50 text-primary-600' : 'text-muted hover:bg-paper hover:text-ink'
                }`}
              >
                {isActive && <span aria-hidden className="absolute left-0 h-8 w-1 rounded-r-sm bg-primary-500" />}
                <Icon size={24} aria-hidden />
                <span className="flex-1">{item.label}</span>
              </Link>
            )
          })}

          {/* Not in the Figma sidebar either, but the profile chip only exists on some screens; this keeps Profile
              Settings one click away from every reception page. */}
          <Link
            href={PROFILE_SETTINGS_HREF}
            aria-current={isActivePath(pathname, PROFILE_SETTINGS_HREF) ? 'page' : undefined}
            className={`relative flex h-[58px] items-center gap-4 overflow-hidden rounded-md pl-5 pr-4 text-base transition-colors ${
              isActivePath(pathname, PROFILE_SETTINGS_HREF) ? 'bg-primary-50 text-primary-600' : 'text-muted hover:bg-paper hover:text-ink'
            }`}
          >
            {isActivePath(pathname, PROFILE_SETTINGS_HREF) && (
              <span aria-hidden className="absolute left-0 h-8 w-1 rounded-r-sm bg-primary-500" />
            )}
            <UserRound size={24} aria-hidden />
            <span className="flex-1">Profile Settings</span>
          </Link>

          {/* No nav-row equivalent in Figma (frame 111:2) — the profile chip's chevron implies a dropdown with
              sign-out, but no such menu exists yet. Kept here, same row styling, so every receptionist still has
              a visible way to sign out from the dashboard shell. Same Server Action as the rest of the app. */}
          <form action={logout}>
            <button
              type="submit"
              className="flex h-[58px] w-full items-center gap-4 rounded-md pl-5 pr-4 text-base text-muted transition-colors hover:bg-paper hover:text-ink"
            >
              <LogOut size={24} aria-hidden />
              Sign Out
            </button>
          </form>
        </nav>
      </div>

      <div className="flex flex-col gap-3 rounded-lg bg-primary-50 px-4 py-5">
        <p className="flex items-center gap-3 text-base text-ink">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface">
            <Headphones size={18} className="text-primary-700" aria-hidden />
          </span>
          Need help?
        </p>
        <p className="text-xs text-muted">Contact our support team for assistance.</p>
        {clinicPhone && (
          <a
            href={`tel:${clinicPhone.replace(/\s/g, '')}`}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border-[1.3px] border-primary-500 bg-surface px-4 text-sm font-semibold text-primary-600 hover:bg-primary-50"
          >
            <Phone size={16} aria-hidden />
            Call {clinicPhone}
          </a>
        )}
      </div>
    </aside>
  )
}
