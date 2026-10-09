import { LayoutDashboard, UserPlus, Users, CalendarDays, type LucideIcon } from 'lucide-react'

export type NavItem = { href: string; label: string; icon: LucideIcon }

/**
 * Matches 4 of the 6 states on the `SmartClinic/ReceptionSidebar` Figma
 * component (Dashboard, Check-in Patient, Queue Management, Appointments).
 * Patients and Reports have no V3 page design yet, so they're left off
 * until their own frames exist — see docs/SESSION_HANDOFF.md.
 */
export const SIDEBAR_ITEMS: NavItem[] = [
  { href: '/reception', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/reception/check-in', label: 'Check-in Patient', icon: UserPlus },
  { href: '/reception/queue', label: 'Queue Management', icon: Users },
  { href: '/reception/appointments', label: 'Appointments', icon: CalendarDays },
]

/** / reception itself must match exactly — every other item matches its own subtree too. */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === '/reception') return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}
