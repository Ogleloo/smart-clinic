/**
 * Which of the two identity details a patient's profile is still missing.
 *
 * Registration now requires both, but patients created before that — and any account whose
 * sign-up details never reached the profile — can have neither. Only the *names* of the missing
 * fields are returned, never the values, so nothing built from this can echo an ID or passport
 * number. A value that is empty or only spaces counts as missing.
 */

export type MissingProfileField = 'date_of_birth' | 'id_number'

export function missingProfileFields(profile: {
  date_of_birth: string | null
  id_number: string | null
}): MissingProfileField[] {
  const missing: MissingProfileField[] = []
  if (!profile.date_of_birth?.trim()) missing.push('date_of_birth')
  if (!profile.id_number?.trim()) missing.push('id_number')
  return missing
}

const LABEL: Record<MissingProfileField, string> = {
  date_of_birth: 'date of birth',
  id_number: 'ID or passport number',
}

/** "date of birth", "ID or passport number", or "date of birth and ID or passport number". */
export function describeMissingFields(missing: MissingProfileField[]): string {
  return missing.map((f) => LABEL[f]).join(' and ')
}
