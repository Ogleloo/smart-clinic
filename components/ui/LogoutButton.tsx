import { logout } from '@/app/actions/auth'
import { Button } from './Button'

/** Design System: Button (tertiary) wrapped in the sign-out Server Action — shared by every staff layout header. */
export function LogoutButton() {
  return (
    <form action={logout}>
      <Button type="submit" variant="tertiary">
        Log out
      </Button>
    </form>
  )
}
