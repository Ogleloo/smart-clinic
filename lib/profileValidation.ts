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
