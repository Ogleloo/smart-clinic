import { Bell, CalendarDays, CalendarPlus, House, ListOrdered, User, Users, type LucideIcon } from 'lucide-react'

export type NavItem = { href: string; label: string; icon: LucideIcon; showsUnread?: boolean }

export const SIDEBAR_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: House },
  { href: '/book', label: 'Book Appointment', icon: CalendarPlus },
  { href: '/appointments', label: 'My Appointments', icon: CalendarDays },
  { href: '/queue', label: 'My Queue', icon: ListOrdered },
  { href: '/notifications', label: 'Notifications', icon: Bell, showsUnread: true },
  { href: '/profile', label: 'Profile', icon: User },
]

export const BOTTOM_NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: House },
  { href: '/queue', label: 'Queue', icon: Users },
  { href: '/notifications', label: 'Alerts', icon: Bell, showsUnread: true },
  { href: '/profile', label: 'Profile', icon: User },
]

/** /appointments/[id] keeps "My Appointments" lit, /profile/settings keeps "Profile" lit. */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function formatBadge(count: number): string {
  return count > 99 ? '99+' : String(count)
}
