import { LayoutDashboard, Users, type LucideIcon } from 'lucide-react'

export type NurseNavItem = { href: string; label: string; icon: LucideIcon }

/**
 * The existing, fully working nurse screen (call next, undo, current patient, waiting list, duty, end session).
 * Kept available while the V3 migration is incomplete; My Queue links to it as the "classic screen".
 */
export const NURSE_WORKSPACE_HREF = '/nurse'
export const NURSE_DASHBOARD_HREF = '/nurse/dashboard'
/** Nurse V3 My Queue (Phase 2): the queue, duty, Call next, Undo and Skip in the V3 design. */
export const NURSE_QUEUE_HREF = '/nurse/queue'

/**
 * The Figma sidebar (component 222:3600) also lists Current Patient, Patient History and Reports. None of
 * those has a working V3 screen yet, so they are not linked — no dead ends. The current patient is shown on
 * My Queue.
 */
export const NURSE_NAV_ITEMS: NurseNavItem[] = [
  { href: NURSE_DASHBOARD_HREF, label: 'Dashboard', icon: LayoutDashboard },
  { href: NURSE_QUEUE_HREF, label: 'My Queue', icon: Users },
]

/** /nurse itself must match exactly: /nurse/dashboard is a different item. */
export function isNurseActivePath(pathname: string, href: string): boolean {
  return pathname === href || (href !== NURSE_WORKSPACE_HREF && pathname.startsWith(`${href}/`))
}
