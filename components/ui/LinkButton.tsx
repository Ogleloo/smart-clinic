import Link from 'next/link'
import type { ComponentProps } from 'react'
import { buttonClasses, type ButtonVariant } from './button-styles'

interface LinkButtonProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant
  fullWidth?: boolean
}

/** Design System: Button, styled identically to `Button` but rendering an <a> — for navigation, never nested inside another interactive element. */
export function LinkButton({
  variant = 'primary',
  fullWidth = false,
  className = '',
  ...props
}: LinkButtonProps) {
  return <Link {...props} className={buttonClasses(variant, fullWidth, className)} />
}
