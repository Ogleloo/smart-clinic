/**
 * One password rule for every place a password is CREATED or CHANGED: registration,
 * the reset-password page, and the patient and Reception change-password forms
 * (Reception's wraps the patient's). Sign-in deliberately does not use it — people who
 * already have a password must be able to log in with it, whatever it is.
 *
 * The password is judged exactly as typed and is never trimmed or altered: leading or
 * trailing spaces are part of it (a passphrase may legitimately contain them) and are
 * stored as given. What is refused is padding standing in for substance:
 *
 *   - empty, or only whitespace
 *   - fewer than 8 characters that are not whitespace — so "abc       " (10 characters,
 *     3 real ones) and "ab cd ef" fail, while a passphrase such as "correct horse battery"
 *     or "my dog Rex 2020" passes.
 *
 * Runs in the browser-facing Server Actions (the server is the one that counts); it is
 * plain TypeScript so tests and any future client-side hint share it.
 */

export const PASSWORD_MIN_CHARACTERS = 8

export type PasswordCheck = { ok: true } | { ok: false; error: string }

export function validatePassword(password: string, { label = 'Password' }: { label?: string } = {}): PasswordCheck {
  if (password.length === 0) return { ok: false, error: `Enter a ${label.toLowerCase()}.` }
  if (password.trim().length === 0) return { ok: false, error: `${label} can’t be only spaces.` }
  const real = password.replace(/\s/g, '').length
  if (real < PASSWORD_MIN_CHARACTERS) {
    return {
      ok: false,
      error: `${label} must have at least ${PASSWORD_MIN_CHARACTERS} characters that aren’t spaces.`,
    }
  }
  return { ok: true }
}
