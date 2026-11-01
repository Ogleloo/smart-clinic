import { BarChart3, BrainCircuit, ClipboardList, LayoutDashboard, Settings, UserRound, Users, type LucideIcon } from 'lucide-react'

export type AdminNavItem = { href: string; label: string; icon: LucideIcon }

export const ADMIN_DASHBOARD_HREF = '/admin'

/**
 * Every existing admin area stays reachable. Labels follow the Figma sidebar (frame 168:3: Dashboard, Patients,
 * Staff Management, Reports, System Settings); Services has no Figma item but is a working screen, so it is kept
 * rather than hidden. Figma's "Queue Overview" and "Appointments" have no admin screen behind them (the queue
 * overview is a panel on the dashboard), so they are not linked — no dead ends.
 */
export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: ADMIN_DASHBOARD_HREF, label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/allocation-advisor', label: 'Allocation Lab', icon: BrainCircuit },
  { href: '/admin/services', label: 'Services', icon: ClipboardList },
  { href: '/admin/patients', label: 'Patients', icon: UserRound },
  { href: '/admin/staff', label: 'Staff Management', icon: Users },
  { href: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { href: '/admin/settings', label: 'System Settings', icon: Settings },
]

/** /admin matches only itself — every other admin path starts with it. */
export function isAdminActivePath(pathname: string, href: string): boolean {
  return pathname === href || (href !== ADMIN_DASHBOARD_HREF && pathname.startsWith(`${href}/`))
}

/** The page's name for the visually hidden <h1> on screens that don't draw their own (V2 pages keep their h2). */
export function adminPageLabel(pathname: string): string {
  return ADMIN_NAV_ITEMS.find((i) => isAdminActivePath(pathname, i.href))?.label ?? 'Admin'
}
