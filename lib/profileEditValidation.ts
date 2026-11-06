import type { DocumentType } from './registrationValidation'
import {
  dobMatchesSaId,
  isValidSouthAfricanId,
  parseDateOfBirth,
  parseOptionalPassportNumber,
  parseOptionalPhone,
  parseOptionalSouthAfricanId,
  parseStaffName,
  saIdDobMismatchMessage,
  type FieldResult,
} from './profileValidation'

export type ProfileEditField = 'full_name' | 'phone' | 'date_of_birth' | 'id_number'
export type ProfileEditErrors = Partial<Record<ProfileEditField, string>>

export const PROFILE_EDIT_FIELD_ORDER: ProfileEditField[] = ['full_name', 'phone', 'date_of_birth', 'id_number']

export type ProfileEditInput = {
  full_name: string
  phone: string
  date_of_birth: string
  /** Raw, like registration's — anything other than exactly 'passport' is treated as 'sa_id'. */
  document_type: string
  id_number: string
}

/** The two fields a legacy value can exist for, read exactly as the database currently holds them. */
export type ProfileEditCurrent = {
  id_number: string | null
  date_of_birth: string | null
}

export type ProfileEditValues = {
  fullName: string
  phone: string | null
  dateOfBirth: string | null
  idNumber: string | null
}

/** Read the profile edit fields off a submitted form (client) or FormData (server). */
export function profileEditInputFrom(form: FormData): ProfileEditInput {
  const get = (name: string) => String(form.get(name) ?? '')
  return {
    full_name: get('full_name'),
    phone: get('phone'),
    date_of_birth: get('date_of_birth'),
    document_type: get('document_type'),
    id_number: get('id_number'),
  }
}

/**
 * The rule set for a patient editing their own profile, run in the browser and again in the Server Action.
 *
 * `current` is what the database holds right now for the two fields that carry a strict new rule
 * (date_of_birth, id_number) that did not exist when some existing profiles were first saved. A field whose
 * submitted value is byte-identical to `current` is passed straight through, exactly as stored, and is never
 * re-validated — that is what keeps an existing legacy value (saved before this rule existed, or before a
 * document type was ever asked for) from being rejected, or silently dropped, just because the person changed
 * their phone number on the same form. Only a field the person is actually changing is held to the full rule,
 * the same one registration enforces for a brand new account.
 *
 * Full name and phone have no "legacy" concern — their rules have not changed — so they are always validated
 * fresh, the same as registration.
 */
export function validateProfileEdit(
  input: ProfileEditInput,
  current: ProfileEditCurrent,
  today: string,
): { errors: ProfileEditErrors; values: ProfileEditValues | null } {
  const errors: ProfileEditErrors = {}

  const name = parseStaffName(input.full_name)
  if (name.error) errors.full_name = name.error

  const phone = parseOptionalPhone(input.phone)
  if (phone.error) errors.phone = phone.error

  const idUnchanged = input.id_number === (current.id_number ?? '')
  let idNumber: FieldResult
  if (idUnchanged) {
    idNumber = { value: current.id_number }
  } else if (current.id_number && !input.id_number.trim()) {
    // Clearing the field is a deletion, not an edit — a blank submission must never be read as "remove this".
    idNumber = { value: null, error: 'ID or passport number can’t be cleared once saved. Enter a new one instead.' }
  } else {
    const documentType: DocumentType = input.document_type === 'passport' ? 'passport' : 'sa_id'
    idNumber = documentType === 'passport' ? parseOptionalPassportNumber(input.id_number) : parseOptionalSouthAfricanId(input.id_number)
  }
  if (idNumber.error) errors.id_number = idNumber.error

  const dobUnchanged = input.date_of_birth === (current.date_of_birth ?? '')
  let dob: FieldResult
  if (dobUnchanged) {
    dob = { value: current.date_of_birth }
  } else if (current.date_of_birth && !input.date_of_birth.trim()) {
    dob = { value: null, error: 'Date of birth can’t be cleared once saved. Enter a new date instead.' }
  } else {
    dob = parseDateOfBirth(input.date_of_birth, today)
  }
  if (dob.error) errors.date_of_birth = dob.error

  // Only when both sides are concrete, real values, AND at least one of them is actually being changed right
  // now — never forces a relationship onto a pair of legacy fields that were never checked against each other
  // when they were first saved. An inconsistent pair that predates this rule is preserved exactly as it is
  // until the person changes one side of it themselves; changing either side re-checks it against the other.
  if (
    dob.value &&
    idNumber.value &&
    isValidSouthAfricanId(idNumber.value) &&
    !(idUnchanged && dobUnchanged) &&
    !dobMatchesSaId(dob.value, idNumber.value, today)
  ) {
    errors.date_of_birth = saIdDobMismatchMessage(idNumber.value, today)
  }

  /**
   * One of the pair filled in while the other is left empty is refused, but only when the person is changing one
   * of them right now — the same gate the cross-check above uses, and for the same reason: a legacy profile that
   * holds one without the other must stay editable without being made to supply the missing one.
   *
   * Both columns are nullable, so without this an ID number could be saved with the date-of-birth field left
   * blank, and the check that the two agree would simply never run: a South African ID that encodes a birth date
   * nobody has to match is only half-entered, and the half that would have contradicted it is the half omitted.
   * Requiring the other side is what closes that, in both directions — the app already asks for both together
   * (lib/profileCompleteness.ts treats either one missing as an incomplete profile), so this refuses nothing the
   * rest of the screen was not already asking for.
   */
  const changingEither = !(idUnchanged && dobUnchanged)
  if (changingEither && !errors.id_number && !errors.date_of_birth) {
    if (idNumber.value && !dob.value) {
      errors.date_of_birth = 'Enter your date of birth too — an ID or passport number is only saved together with one.'
    } else if (dob.value && !idNumber.value) {
      errors.id_number = 'Enter your ID or passport number too — a date of birth is only saved together with one.'
    }
  }

  if (Object.keys(errors).length > 0) return { errors, values: null }
  return {
    errors,
    values: {
      fullName: name.value as string,
      phone: phone.value,
      dateOfBirth: dob.value,
      idNumber: idNumber.value,
    },
  }
}
