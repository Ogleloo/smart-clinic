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
 * Required variants for patient registration. They return exactly what the
 * optional parsers return — so a value that passes here also passes
 * handle_new_user() (same date shape and range; same ^[A-Z0-9]{6,20}$ after
 * the same upper-casing and whitespace stripping) and is therefore stored
 * rather than silently dropped.
 */
export function requireDateOfBirth(raw: string, today: string): FieldResult {
  if (!raw.trim()) return { value: null, error: 'Enter your date of birth.' }
  return parseDateOfBirth(raw, today)
}

/** Luhn check over all 13 digits (the last digit is the check digit). */
function luhnValid(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

/**
 * Structural check of a 13-digit South African ID number: YYMMDD must be a real
 * calendar date (the century is not encoded, so either 19YY or 20YY may make it
 * real — which also settles 29 February), the citizenship digit is 0 or 1, and the
 * Luhn check digit must match. It proves the number is well formed, not that it
 * belongs to this person.
 */
export function isValidSouthAfricanId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false
  const yy = Number(id.slice(0, 2))
  const mm = Number(id.slice(2, 4))
  const dd = Number(id.slice(4, 6))
  const realDate = [1900, 2000].some((century) => {
    const d = new Date(Date.UTC(century + yy, mm - 1, dd))
    return d.getUTCFullYear() === century + yy && d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd
  })
  if (!realDate) return false
  if (id[10] !== '0' && id[10] !== '1') return false
  return luhnValid(id)
}

/**
 * Required "South African ID or passport number". profiles has a single id_number
 * column — no document type and no issuing country — so the kind is inferred:
 *   13 digits           -> must be a well-formed South African ID
 *   other digit-only 10+ -> refused: almost certainly a mistyped ID (passports are
 *                          rarely numeric and longer than 9 digits)
 *   anything else 6–20  -> accepted as a passport number
 * A foreign passport that is purely 13 digits therefore cannot be registered here;
 * capturing the country of issue needs a schema change that has not been approved.
 */
export function requireIdNumber(raw: string): FieldResult {
  const value = raw.replace(/\s/g, '').toUpperCase()
  if (!value) return { value: null, error: 'Enter your South African ID or passport number.' }
  if (!/^[A-Z0-9]{6,20}$/.test(value)) {
    return { value: null, error: 'ID or passport number must be 6–20 letters or digits, with no dashes or symbols.' }
  }
  if (/^\d+$/.test(value)) {
    if (value.length === 13) {
      return isValidSouthAfricanId(value)
        ? { value }
        : { value: null, error: 'That South African ID number isn’t valid. Check each digit.' }
    }
    if (value.length >= 10) {
      return { value: null, error: 'A South African ID number has 13 digits. Check the number, or enter your passport number.' }
    }
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
