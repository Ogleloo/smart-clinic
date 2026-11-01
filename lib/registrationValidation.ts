import { parseStaffName, requireDateOfBirth, requireIdNumber } from './profileValidation'

export type RegistrationField = 'full_name' | 'email' | 'date_of_birth' | 'id_number' | 'password'
export type RegistrationErrors = Partial<Record<RegistrationField, string>>

export type RegistrationInput = {
  full_name: string
  email: string
  date_of_birth: string
  id_number: string
  password: string
}

export type RegistrationValues = {
  fullName: string
  email: string
  dateOfBirth: string
  idNumber: string
  password: string
}

export const REGISTRATION_FIELD_ORDER: RegistrationField[] = ['full_name', 'email', 'date_of_birth', 'id_number', 'password']

/** Read the registration fields off a submitted form (client) or FormData (server). */
export function registrationInputFrom(form: FormData): RegistrationInput {
  const get = (name: string) => String(form.get(name) ?? '')
  return {
    full_name: get('full_name'),
    email: get('email'),
    date_of_birth: get('date_of_birth'),
    id_number: get('id_number'),
    password: get('password'),
  }
}

/**
 * The single rule set for patient registration, run in the browser (so the person
 * sees every problem before anything is sent) and again in the Server Action (which
 * is the one that counts). Phone stays optional and is not checked here.
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

  const dob = requireDateOfBirth(input.date_of_birth, today)
  if (dob.error) errors.date_of_birth = dob.error

  const idNumber = requireIdNumber(input.id_number)
  if (idNumber.error) errors.id_number = idNumber.error

  if (input.password.length < 8) errors.password = 'Password must be at least 8 characters.'

  if (Object.keys(errors).length > 0) return { errors, values: null }
  return {
    errors,
    values: {
      fullName: name.value as string,
      email,
      dateOfBirth: dob.value as string,
      idNumber: idNumber.value as string,
      password: input.password,
    },
  }
}
