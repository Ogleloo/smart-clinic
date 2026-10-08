export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger' | 'danger-outline'

/**
 * Design System: Button.
 * One component with a `variant` prop — not four components (§13).
 * Minimum height 44px for touch targets (§12).
 *
 * Plain module (no 'use client') so both the client `Button` and the
 * server-renderable `LinkButton` can share these classes — a file with
 * 'use client' turns every export into a client-only reference, which
 * broke LinkButton when it's rendered from a Server Component page.
 */
export const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary-700 text-white hover:bg-primary-600',
  secondary: 'bg-surface text-primary-700 border-[1.5px] border-primary-700 hover:bg-primary-50',
  tertiary: 'bg-transparent text-primary-700 hover:bg-primary-50',
  danger: 'bg-danger text-white hover:opacity-90',
  'danger-outline': 'bg-surface text-danger border-[1.5px] border-danger hover:bg-danger-bg',
}

export function buttonClasses(variant: ButtonVariant, fullWidth: boolean, className = '') {
  // rounded-md and --button-text resolve to 10px / 16px on staff screens
  // and 12px / 14px inside .theme-patient (globals.css).
  return `inline-flex min-h-11 items-center justify-center rounded-md px-5 text-[length:var(--button-text,1rem)]
    font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50
    ${buttonVariantClasses[variant]} ${fullWidth ? 'w-full' : ''} ${className}`
}
