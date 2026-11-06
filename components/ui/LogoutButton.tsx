import { buttonClasses } from './button-styles'
import { SignOutConfirm } from './SignOutConfirm'

/**
 * Design System: Button (tertiary) wrapped in the sign-out Server Action — shared by every staff layout header.
 * Behind the same confirmation step as every other sign-out; it renders the tertiary button's own classes rather
 * than <Button>, because the trigger element itself lives inside SignOutConfirm.
 */
export function LogoutButton() {
  return <SignOutConfirm buttonClassName={buttonClasses('tertiary', false)}>Log out</SignOutConfirm>
}
