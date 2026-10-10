/**
 * Optional patient identity fields — the same rules handle_new_user()
 * applies to signup metadata (migration 20261006151206). The trigger
 * silently drops a malformed value so signup can never be blocked by an
 * optional field; validating here first is what turns that into a
 * visible error instead of a value that quietly never got saved.
 *
 * Profile settings writes go straight to profiles (no trigger in the
 * path), so for that form these checks are the only ones there are.
 */

export type FieldResult = { value: string | null; error?: string }

export function parseDateOfBirth(raw: string, today: string): FieldResult {
  const value = raw.trim()
  if (!value) return { value: null }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { value: null, error: 'Enter your date of birth as a full date.' }
  const parsed = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return { value: null, error: 'That date of birth isn’t a real date.' }
  }
  if (value > today) return { value: null, error: 'Date of birth can’t be in the future.' }
  if (value < '1900-01-01') return { value: null, error: 'Enter a date of birth after 1900.' }
  return { value }
}

export function parseIdNumber(raw: string): FieldResult {
  const value = raw.replace(/\s/g, '').toUpperCase()
  if (!value) return { value: null }
  if (!/^[A-Z0-9]{6,20}$/.test(value)) {
    return { value: null, error: 'ID or passport number must be 6–20 letters or digits.' }
  }
  return { value }
}

/**
 * Staff display name. Trimmed and whitespace-collapsed; 2–120 characters;
 * no control characters (a newline in a name breaks every list it appears in).
 */
export function parseStaffName(raw: string): FieldResult {
  const value = raw.replace(/\s+/g, ' ').trim()
  if (!value) return { value: null, error: 'Enter your full name.' }
  if (value.length < 2) return { value: null, error: 'Full name must be at least 2 characters.' }
  if (value.length > 120) return { value: null, error: 'Full name is too long (120 characters at most).' }
  if (/[\u0000-\u001f\u007f]/.test(value)) return { value: null, error: 'Full name contains characters that aren’t allowed.' }
  return { value }
}

/**
 * Optional South African phone number. Accepts the formats the clinic already
 * stores — 082 123 4567, 0821234567, (035) 123 4567, +27 82 123 4567, 27821234567 —
 * with spaces, dashes and brackets as separators, and returns the number in
 * readable international form (+27 82 123 4567). Empty is allowed (phone is nullable).
 */
export function parsePhone(raw: string): FieldResult {
  const trimmed = raw.trim()
  if (!trimmed) return { value: null }
  if (!/^\+?[0-9 ()\-]+$/.test(trimmed)) {
    return { value: null, error: 'Phone number can only contain digits, spaces, dashes, brackets and a leading +.' }
  }
  const digits = trimmed.replace(/\D/g, '')
  let national: string | null = null
  if (trimmed.startsWith('+')) {
    if (digits.startsWith('27')) national = digits.slice(2)
  } else if (digits.startsWith('27') && digits.length === 11) {
    national = digits.slice(2)
  } else if (digits.startsWith('0')) {
    national = digits.slice(1)
  }
  if (national === null || !/^[1-9][0-9]{8}$/.test(national)) {
    return { value: null, error: 'Enter a South African number, like 082 123 4567 or +27 82 123 4567.' }
  }
  return { value: `+27 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}` }
}
