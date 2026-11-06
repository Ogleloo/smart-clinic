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
 * The birth dates a structurally valid South African ID number can mean. The ID encodes
 * only YYMMDD, never the century, so a date is returned for each century in which it is a
 * real calendar day, is not in the future and is not before 1900 (29 February, for
 * instance, exists in 2000 but not 1900; 04 means 1904 or 2004). Zero, one or two dates:
 * with two, the person has to say which year is theirs — it is never guessed. Anything
 * that is not a valid 13-digit SA ID returns [] — a passport number encodes nothing.
 *
 * A well-formed ID is not proof that the person entering it holds it.
 */
export function saIdBirthDateCandidates(id: string, today: string): string[] {
  if (!isValidSouthAfricanId(id)) return []
  const yy = id.slice(0, 2)
  const mm = id.slice(2, 4)
  const dd = id.slice(4, 6)
  return [1900, 2000]
    .map((century) => `${century + Number(yy)}-${mm}-${dd}`)
    .filter((iso) => {
      const d = new Date(`${iso}T12:00:00Z`)
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso && iso <= today && iso >= '1900-01-01'
    })
    .sort()
}

/** True when `dob` (YYYY-MM-DD) is one of the dates the SA ID can mean. */
export function dobMatchesSaId(dob: string, id: string, today: string): boolean {
  return saIdBirthDateCandidates(id, today).includes(dob)
}

/**
 * The message for a date of birth that contradicts the ID number beside it. It names the date the ID actually
 * encodes, so the person can see which of the two fields is the wrong one — "these don't match" leaves them
 * guessing which to change, and the ID is the field they are more likely to have mistyped.
 *
 * Both centuries are named when the ID is ambiguous (the number carries YYMMDD and never the century), because
 * claiming one of them would be stating a fact the ID does not contain. Nothing here guesses: a person born in
 * 1904 and a person born in 2004 have the same six digits, and only they know which is theirs.
 *
 * Callers reach this only once `dobMatchesSaId` has already said no.
 */
export function saIdDobMismatchMessage(id: string, today: string): string {
  const candidates = saIdBirthDateCandidates(id, today)
  if (candidates.length === 1) {
    return `That ID number encodes a birth date of ${candidates[0]}, which doesn’t match the date of birth you entered.`
  }
  if (candidates.length > 1) {
    return `That ID number encodes a birth date of ${candidates.join(' or ')} — neither matches the date of birth you entered.`
  }
  // No candidate survives (the encoded date is not real, or is in the future): the ID is the broken field, and
  // its own checksum/date rule will have said so on id_number. Nothing specific can honestly be named here.
  return 'That date of birth doesn’t match your South African ID number.'
}

/**
 * Email address SYNTAX. This is the only thing it checks, and the only thing it can check: that the text is
 * shaped like an address. It is not evidence that the mailbox exists, that anyone reads it, or that mail sent to
 * it would arrive, and it must never be presented as any of those. Nothing in this system verifies an address.
 *
 * Lower-cased on the way through, because the stored value is compared — "Thabo@Example.com" and
 * "thabo@example.com" are one mailbox, and storing both would make two accounts out of one person. The domain
 * is genuinely case-insensitive; the local part technically is not, but no mail provider in practice treats it
 * otherwise, and the alternative is duplicate accounts.
 *
 * 254 characters is the maximum length of an address that can be delivered (RFC 5321's limit on a path).
 * Consecutive dots, and a dot at either edge of the local part or the domain, are refused: all are invalid in an
 * address, and all are the shape of a typo rather than of a mailbox.
 */
const INVALID_EMAIL = 'Enter a valid email address.'

export function parseEmail(raw: string): FieldResult {
  const value = raw.trim().toLowerCase()
  if (!value) return { value: null, error: 'Enter your email address.' }
  if (/\s/.test(value)) return { value: null, error: 'An email address can’t contain spaces.' }
  if (value.length > 254) return { value: null, error: 'That email address is too long (254 characters at most).' }

  // Exactly one @, with something on each side.
  if (!/^[^@]+@[^@]+$/.test(value)) return { value: null, error: INVALID_EMAIL }
  const at = value.indexOf('@')
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)

  // These two are checked before the character sets below so the message can name the actual problem — "two
  // dots in a row" is something a person can act on, where "not a valid address" leaves them re-reading it.
  if (value.includes('..')) return { value: null, error: 'An email address can’t contain two dots in a row.' }
  for (const part of [local, domain]) {
    if (part.startsWith('.') || part.endsWith('.')) {
      return { value: null, error: 'An email address can’t start or end a part with a dot.' }
    }
  }

  // Local part: an allow-list, so angle brackets, quotes, ampersands, braces, backslashes and control
  // characters cannot appear in a stored address. RFC 5322 does permit some of them inside a quoted local part;
  // no mail provider issues such an address, and accepting markup into a value this app displays and logs is a
  // worse trade than refusing an address nobody has.
  if (!/^[a-z0-9._%+'-]+$/.test(local)) return { value: null, error: INVALID_EMAIL }

  // Domain: dot-separated labels of letters, digits and hyphens, no label starting or ending with a hyphen, and
  // an alphabetic top-level label of at least two characters.
  const labels = domain.split('.')
  if (labels.length < 2) return { value: null, error: INVALID_EMAIL }
  for (const label of labels) {
    if (!/^[a-z0-9-]+$/.test(label) || label.startsWith('-') || label.endsWith('-')) {
      return { value: null, error: INVALID_EMAIL }
    }
  }
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1]!)) return { value: null, error: INVALID_EMAIL }

  return { value }
}

/**
 * Optional South African phone number for self-registration — the same rule, and the same single stored format,
 * as every other phone field in the app (see parsePhone below, which this delegates to).
 *
 * It used to be deliberately permissive, on the reasoning that a patient registering with a passport might have
 * a foreign number. That is a real case and this rule does reject it: a +44 or +263 number cannot be registered
 * any more. The trade was made on purpose — two different phone rules in one application meant the same person's
 * number was accepted in one form and refused in the next, and was stored in whatever shape they happened to
 * type, so no two records were comparable and none could be dialled from the record alone. A clinic phone number
 * that cannot be called is not worth the flexibility. If international numbers are needed, the right fix is a
 * country field, not a second rule.
 */
export function parseOptionalPhone(raw: string): FieldResult {
  return parsePhone(raw)
}

/**
 * Required South African ID number: the value itself must already be exactly 13 ASCII digits — nothing is
 * stripped or cleaned here. Cleaning (removing spaces, dashes, anything the browser's own digit filter would
 * never produce) is the registration field's job, done once as the person types or pastes
 * (app/(auth)/register/page.tsx's handleSaIdChange); this is the check that runs on whatever actually arrives,
 * including a request built by hand that skipped the browser entirely, and it must not quietly repeat that
 * cleaning — a value that needed cleaning did not come from the field that already does it.
 *
 * Once the shape is confirmed, well-formedness is the structural check above — the Luhn digit, a real encoded
 * calendar date, and a 0/1 citizenship digit.
 */
export function requireSouthAfricanId(raw: string): FieldResult {
  if (!raw.trim()) return { value: null, error: 'Enter your South African ID number.' }
  if (!/^\d{13}$/.test(raw)) return { value: null, error: 'A South African ID number has 13 digits.' }
  if (!isValidSouthAfricanId(raw)) return { value: null, error: 'That South African ID number isn’t valid. Check each digit.' }
  return { value: raw }
}

/**
 * Required passport number: 6–20 letters or digits, the same shape handle_new_user() accepts — profiles has a
 * single id_number column, no document-type column, so this is the only check the stored value gets.
 *
 * A 13-digit numeric value is the shape of a South African ID, not a passport number. Refusing it here (unless
 * it happens to pass the ID's own checksum) is what stops choosing "Passport" from being a way to submit an ID
 * number that fails its own checksum — the document-type selection is enforced again here, not only by which
 * field the browser showed.
 */
export function requirePassportNumber(raw: string): FieldResult {
  const value = raw.replace(/\s/g, '').toUpperCase()
  if (!value) return { value: null, error: 'Enter your passport number.' }
  if (!/^[A-Z0-9]{6,20}$/.test(value)) {
    return { value: null, error: 'Passport number must be 6–20 letters or digits, with no dashes or symbols.' }
  }
  if (/^\d{13}$/.test(value) && !isValidSouthAfricanId(value)) {
    return { value: null, error: 'That looks like a South African ID number, but it isn’t valid. Check each digit, or switch document type to South African ID.' }
  }
  return { value }
}

/**
 * Optional South African ID number for profile editing: empty is allowed (the field can be left blank), but
 * anything entered is held to the exact same rule registration enforces — profile editing must never be a
 * looser path to the same column. Only applied to a value the person is actively changing; an existing stored
 * value that predates this rule is never re-run through it just because something else on the form changed
 * (see validateProfileEdit in lib/profileEditValidation.ts).
 */
export function parseOptionalSouthAfricanId(raw: string): FieldResult {
  if (!raw.trim()) return { value: null }
  return requireSouthAfricanId(raw)
}

/** Optional passport number for profile editing — the same relationship to requirePassportNumber() as above. */
export function parseOptionalPassportNumber(raw: string): FieldResult {
  if (!raw.trim()) return { value: null }
  return requirePassportNumber(raw)
}

/**
 * A person's name. Trimmed and whitespace-collapsed; 2–120 characters; no control characters (a newline in a
 * name breaks every list it appears in); and an allow-listed character set: it must begin with a letter, after
 * which only letters, combining marks, spaces, apostrophes, hyphens and full stops are accepted.
 *
 * An allow-list, not a block-list of whatever has caused trouble before. It refuses a "name" that is entirely
 * digits or punctuation ("1234", "---"), and it refuses the angle brackets, ampersands, quotes and braces that
 * markup and script are made of, so nothing tag-shaped can be stored in the first place. React escapes on
 * output, and that is one layer; this is the other. A name is also read back by the public queue display and by
 * SQL reports, neither of which is React, so input that is never dangerous is worth more than output escaping
 * alone.
 *
 * Full stops are allowed because the clinic's own staff names carry titles — "Nurse Mabaso", and the "Sr. Botha"
 * spelling still in the database. Combining marks are allowed because South African names are routinely
 * accented, and `\p{L}` already covers the letters of every language the clinic serves rather than just A–Z.
 * Both straight and typographic apostrophes are accepted, because phone keyboards produce the curly one.
 */
const NAME_SHAPE = /^[\p{L}\p{M}][\p{L}\p{M} '’.-]*$/u

export function parseStaffName(raw: string): FieldResult {
  const value = raw.replace(/\s+/g, ' ').trim()
  if (!value) return { value: null, error: 'Enter your full name.' }
  if (value.length < 2) return { value: null, error: 'Full name must be at least 2 characters.' }
  if (value.length > 120) return { value: null, error: 'Full name is too long (120 characters at most).' }
  if (/[\u0000-\u001f\u007f]/.test(value)) return { value: null, error: 'Full name contains characters that aren’t allowed.' }
  if (!NAME_SHAPE.test(value)) {
    return {
      value: null,
      error: 'A name can only contain letters, spaces, hyphens, apostrophes and full stops, and must start with a letter.',
    }
  }
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
