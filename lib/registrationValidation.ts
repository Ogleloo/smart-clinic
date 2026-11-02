import { validatePassword } from './passwordValidation'
import {
  dobMatchesSaId,
  isValidSouthAfricanId,
  parseOptionalPhone,
  parseStaffName,
  requireDateOfBirth,
  requirePassportNumber,
  requireSouthAfricanId,
} from './profileValidation'

export type DocumentType = 'sa_id' | 'passport'
export type RegistrationField = 'full_name' | 'email' | 'phone' | 'date_of_birth' | 'id_number' | 'password' | 'confirm'
export type RegistrationErrors = Partial<Record<RegistrationField, string>>

export type RegistrationInput = {
  full_name: string
  email: string
  phone: string
  date_of_birth: string
  /**
   * Raw, like every other field here — read straight off the form/FormData and normalised below, never trusted
   * as already being 'sa_id' | 'passport'. Anything other than exactly 'passport' is treated as 'sa_id', the
   * stricter of the two rules: a forged or missing value can never relax validation, only tighten it.
   */
  document_type: string
  id_number: string
  password: string
}

export type RegistrationValues = {
  fullName: string
  email: string
  /** null when the optional phone was left empty. */
  phone: string | null
  dateOfBirth: string
  idNumber: string
  password: string
}

export const REGISTRATION_FIELD_ORDER: RegistrationField[] = [
  'full_name',
  'email',
  'phone',
  'date_of_birth',
  'id_number',
  'password',
  // Checked by the form and the Server Action rather than validateRegistration: the confirmation is a property of
  // the form, not of the account being created, and only the password itself is ever stored.
  'confirm',
]

/** Read the registration fields off a submitted form (client) or FormData (server). */
export function registrationInputFrom(form: FormData): RegistrationInput {
  const get = (name: string) => String(form.get(name) ?? '')
  return {
    full_name: get('full_name'),
    email: get('email'),
    phone: get('phone'),
    date_of_birth: get('date_of_birth'),
    document_type: get('document_type'),
    id_number: get('id_number'),
    password: get('password'),
  }
}

/**
 * The single rule set for patient registration, run in the browser (so the person
 * sees every problem before anything is sent) and again in the Server Action (which
 * is the one that counts).
 *
 * Date of birth and ID/passport number are required. The document type (South African ID or passport) is an
 * explicit choice, not inferred from what was typed, and is enforced here — the one place both the browser and
 * the Server Action run — so selecting "Passport" can never be used to dodge the ID's own checksum. When the
 * number is a South African ID, the date of birth must be one of the dates that ID can mean — a contradiction is
 * refused, never silently corrected. A passport number encodes nothing, so the date of birth is whatever the
 * person entered. The password is checked exactly as typed.
 */
export function validateRegistration(
  input: RegistrationInput,
  today: string,
): { errors: RegistrationErrors; values: RegistrationValues | null } {
  const errors: RegistrationErrors = {}

  const name = parseStaffName(input.full_name)
  if (name.error) errors.full_name = name.error

  const email = input.email.trim()
  if (!email) errors.email = 'Enter your email address.'
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = 'Enter a valid email address.'

  const phone = parseOptionalPhone(input.phone)
  if (phone.error) errors.phone = phone.error

  const dob = requireDateOfBirth(input.date_of_birth, today)
  if (dob.error) errors.date_of_birth = dob.error

  const documentType: DocumentType = input.document_type === 'passport' ? 'passport' : 'sa_id'
  const idNumber = documentType === 'passport' ? requirePassportNumber(input.id_number) : requireSouthAfricanId(input.id_number)
  if (idNumber.error) errors.id_number = idNumber.error

  if (dob.value && idNumber.value && isValidSouthAfricanId(idNumber.value) && !dobMatchesSaId(dob.value, idNumber.value, today)) {
    errors.date_of_birth = 'That date of birth doesn’t match your South African ID number.'
  }

  const password = validatePassword(input.password)
  if (!password.ok) errors.password = password.error

  if (Object.keys(errors).length > 0) return { errors, values: null }
  return {
    errors,
    values: {
      fullName: name.value as string,
      email,
      phone: phone.value,
      dateOfBirth: dob.value as string,
      idNumber: idNumber.value as string,
      password: input.password,
    },
  }
}
