import type { FieldResult } from './profileValidation'

/**
 * The service fields an administrator types, checked against what the database already enforces so a mistake
 * comes back as a sentence instead of a constraint violation.
 *
 * Two of these three rules exist in `public.services` as CHECK constraints and are quoted beside each. The
 * database stays authoritative — it is the thing that cannot be bypassed — but `createService` and
 * `updateService` return `error.message` verbatim, so without these the administrator saw
 * `new row for relation "services" violates check constraint "services_prefix_format"`. Mirroring the
 * constraint is what turns that into something actionable; it does not replace it.
 *
 * `name` is the odd one out: nothing in the database constrains it at all, no length and no character set. It
 * is shown on the public queue display, on the booking wizard and on every staff screen, so it is the one that
 * most needs a bound here, because there is no second line of defence behind it.
 */

/** `services_prefix_format`: CHECK (token_prefix ~ '^[A-Z]{2,4}$'). Upper-cased first, as the forms always did. */
export function parseTokenPrefix(raw: string): FieldResult {
  const value = raw.trim().toUpperCase()
  if (!value) return { value: null, error: 'Enter a token prefix.' }
  if (!/^[A-Z]{2,4}$/.test(value)) {
    return { value: null, error: 'A token prefix is 2 to 4 letters, like GC or PHAR.' }
  }
  return { value }
}

/**
 * Service name: 2–60 characters, at least one letter, and an allow-list of the characters real service names
 * use — letters (any script), digits, spaces, ampersands, apostrophes, hyphens, full stops, commas, slashes and
 * brackets. "Maternal & Child Health" and "TB / HIV Clinic" are both normal, which is why this list is wider
 * than the one for a person's name.
 *
 * Angle brackets, quotes, braces and backslashes are not on it, so a service name cannot carry markup into the
 * public display, which is the one screen in this app an unauthenticated visitor sees.
 *
 * 60 characters is a layout bound rather than a database one: the name sits in a fixed card on the queue
 * display and in a table cell on the admin screen, and nothing truncates it.
 */
export function parseServiceName(raw: string): FieldResult {
  const value = raw.replace(/\s+/g, ' ').trim()
  if (!value) return { value: null, error: 'Enter a service name.' }
  if (value.length < 2) return { value: null, error: 'A service name must be at least 2 characters.' }
  if (value.length > 60) return { value: null, error: 'That service name is too long (60 characters at most).' }
  if (!/\p{L}/u.test(value)) return { value: null, error: 'A service name must contain at least one letter.' }
  if (!/^[\p{L}\p{M}\p{N} &'().,/-]+$/u.test(value)) {
    return {
      value: null,
      error: 'A service name can only contain letters, numbers, spaces and the punctuation & \' ( ) . , / -',
    }
  }
  return { value }
}

/**
 * `services_default_consultation_minutes_check`: CHECK (default_consultation_minutes BETWEEN 1 AND 240).
 *
 * Read off FormData, so a missing field, an empty string and "abc" all have to land on the same answer rather
 * than on NaN or on 0. The upper bound matters beyond the constraint: this figure feeds the wait estimate, and a
 * value in the thousands would produce predictions the clinic cannot act on.
 */
export function parseConsultationMinutes(raw: unknown): { value: number | null; error?: string } {
  const text = String(raw ?? '').trim()
  if (!text) return { value: null, error: 'Enter a default duration in minutes.' }
  if (!/^\d+$/.test(text)) return { value: null, error: 'Enter the default duration as a whole number of minutes.' }
  const value = Number(text)
  if (value < 1 || value > 240) {
    return { value: null, error: 'A default duration must be between 1 and 240 minutes.' }
  }
  return { value }
}
