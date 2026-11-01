import type { UserRole } from '@/lib/types/database.types'

/**
 * Where each role lands (RBAC — FR-1.4). A plain module, not part of a
 * 'use server' or 'use client' file: it's imported both by the login
 * action and by each area's server-side layout guard, and either of
 * those directives would turn every export of the file into a
 * client-only or action-only reference (see button-styles.ts for the
 * same issue with Button/LinkButton).
 */
export function homeForRole(role: UserRole): string {
  switch (role) {
    case 'admin':
      return '/admin'
    case 'nurse':
      // Nurse V3 dashboard. The classic working screen stays reachable at /nurse (linked from every V3
      // screen, and back again from it). Both are guarded by requireRole('nurse'), so a wrong-role user
      // is sent to THEIR home, never back here: no redirect loop.
      return '/nurse/dashboard'
    case 'receptionist':
      return '/reception'
    default:
      return '/dashboard'
  }
}
