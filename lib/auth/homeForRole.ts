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
      return '/nurse'
    case 'receptionist':
      return '/reception'
    default:
      return '/dashboard'
  }
}
