import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { validatePassword } from '../lib/passwordValidation'
import {
  dobMatchesSaId,
  isValidSouthAfricanId,
  parseOptionalPhone,
  requireDateOfBirth,
  requireIdNumber,
  saIdBirthDateCandidates,
} from '../lib/profileValidation'
import { validateRegistration, type RegistrationInput } from '../lib/registrationValidation'

// OFFLINE spec. Part 1 is pure logic. Part 2 loads the real /register, /login and /reset-password pages from the offline dev
// server (its Supabase URL is a closed local port) and never completes a submission: every non-GET request is aborted and
// recorded, so a form that wrongly submitted would fail the test instead of reaching a server.

const TODAY = '2026-11-01'

// Well-formed SA ID numbers (Luhn-valid). 000229… is a leap day (2000); 900229… has a valid check digit but 29 Feb 1990 / 2090
// do not exist; 800101500928… has a valid check digit but citizenship digit 2. Each negative vector is Luhn-valid on purpose, so
// it fails for the rule it is named after and not for the check digit (asserted below).
const SA_ID = '8001015009087'
const SA_ID_LEAP_DAY = '0002290001086'
const SA_ID_BAD_DATE = '9002295001082'
const SA_ID_BAD_CITIZENSHIP = '8001015009285'

test.describe('requireDateOfBirth', () => {
  test('missing is an error; a real past date is kept as entered', () => {
    expect(requireDateOfBirth('', TODAY).error).toMatch(/enter your date of birth/i)
    expect(requireDateOfBirth('   ', TODAY).error).toMatch(/enter your date of birth/i)
    expect(requireDateOfBirth('1992-07-15', TODAY)).toEqual({ value: '1992-07-15' })
  })
  test('malformed, impossible, future and pre-1900 dates are rejected with a message and no value', () => {
    for (const raw of ['15/07/1992', '1992-7-5', '1992-02-30', '2027-01-01', '1899-12-31', 'not a date']) {
      const r = requireDateOfBirth(raw, TODAY)
      expect(r.error, raw).toBeTruthy()
      expect(r.value, raw).toBeNull()
    }
  })
  test('today is accepted (a newborn), tomorrow is not', () => {
    expect(requireDateOfBirth(TODAY, TODAY).error).toBeUndefined()
    expect(requireDateOfBirth('2026-11-02', TODAY).error).toMatch(/future/i)
  })
})

test.describe('isValidSouthAfricanId / requireIdNumber', () => {
  test('accepts well-formed SA ID numbers, including a leap day', () => {
    expect(isValidSouthAfricanId(SA_ID)).toBe(true)
    expect(isValidSouthAfricanId(SA_ID_LEAP_DAY)).toBe(true)
    expect(requireIdNumber(SA_ID)).toEqual({ value: SA_ID })
    expect(requireIdNumber('800101 5009 087')).toEqual({ value: SA_ID }) // spaces are stripped, as handle_new_user() does
  })
  test('the negative vectors are Luhn-valid, so each is rejected by the rule it is named after', () => {
    const luhn = (d: string) =>
      [...d].reverse().reduce((sum, ch, i) => sum + (i % 2 ? (Number(ch) * 2 > 9 ? Number(ch) * 2 - 9 : Number(ch) * 2) : Number(ch)), 0) % 10 === 0
    expect(luhn(SA_ID_BAD_DATE)).toBe(true)
    expect(luhn(SA_ID_BAD_CITIZENSHIP)).toBe(true)
    expect(luhn('8001015009088')).toBe(false)
  })
  test('rejects a wrong check digit, an impossible date and a bad citizenship digit', () => {
    expect(isValidSouthAfricanId('8001015009088')).toBe(false)
    expect(isValidSouthAfricanId(SA_ID_BAD_DATE)).toBe(false)
    expect(isValidSouthAfricanId(SA_ID_BAD_CITIZENSHIP)).toBe(false)
    for (const bad of ['8001015009088', SA_ID_BAD_DATE, SA_ID_BAD_CITIZENSHIP]) {
      const r = requireIdNumber(bad)
      expect(r.value, bad).toBeNull()
      expect(r.error, bad).toMatch(/south african id number isn.t valid/i)
    }
  })
  test('a digit-only number of the wrong length is refused as a mistyped ID, not accepted as a passport', () => {
    for (const bad of ['800101500908', '80010150090877', '1234567890']) {
      expect(requireIdNumber(bad).error, bad).toMatch(/13 digits/i)
    }
  })
  test('passport numbers: letters+digits or short numeric, upper-cased, 6–20 characters', () => {
    expect(requireIdNumber('a1234567')).toEqual({ value: 'A1234567' })
    expect(requireIdNumber('ab 12 34 56')).toEqual({ value: 'AB123456' })
    expect(requireIdNumber('123456789')).toEqual({ value: '123456789' }) // 9-digit numeric passport
    expect(requireIdNumber('A'.repeat(20)).error).toBeUndefined()
  })
  test('missing, too short, too long and punctuation are rejected', () => {
    expect(requireIdNumber('').error).toMatch(/enter your south african id or passport/i)
    expect(requireIdNumber('   ').error).toMatch(/enter your south african id or passport/i)
    for (const bad of ['A1234', 'A'.repeat(21), 'AB-123456', 'AB.123456', 'ÅB123456']) {
      const r = requireIdNumber(bad)
      expect(r.error, bad).toMatch(/6–20 letters or digits/i)
      expect(r.value, bad).toBeNull()
    }
  })
})

const VALID: RegistrationInput = {
  full_name: 'Thabo Mokoena',
  email: 'thabo@example.com',
  phone: '',
  date_of_birth: '1980-01-01',
  id_number: SA_ID,
  password: 'longenough',
}

test.describe('validateRegistration', () => {
  test('a complete form yields normalised values and no errors', () => {
    const r = validateRegistration({ ...VALID, full_name: '  Thabo   Mokoena ', id_number: '800101 5009 087' }, TODAY)
    expect(r.errors).toEqual({})
    expect(r.values).toEqual({
      fullName: 'Thabo Mokoena',
      email: 'thabo@example.com',
      phone: null,
      dateOfBirth: '1980-01-01',
      idNumber: SA_ID,
      password: 'longenough',
    })
  })
  test('an empty form reports every required field, including date of birth and ID/passport number', () => {
    const r = validateRegistration({ full_name: '', email: '', phone: '', date_of_birth: '', id_number: '', password: '' }, TODAY)
    expect(r.values).toBeNull()
    expect(Object.keys(r.errors).sort()).toEqual(['date_of_birth', 'email', 'full_name', 'id_number', 'password'])
  })
  test('date of birth and ID number are each individually required', () => {
    expect(validateRegistration({ ...VALID, date_of_birth: '' }, TODAY).errors).toEqual({ date_of_birth: 'Enter your date of birth.' })
    expect(Object.keys(validateRegistration({ ...VALID, id_number: '' }, TODAY).errors)).toEqual(['id_number'])
  })
  test('malformed email and short password are rejected', () => {
    expect(validateRegistration({ ...VALID, email: 'thabo@' }, TODAY).errors.email).toMatch(/valid email/i)
    expect(validateRegistration({ ...VALID, password: '1234567' }, TODAY).errors.password).toMatch(/at least 8 characters/i)
  })
})

const SA_ID_AMBIGUOUS = '0506155012087' // 15 June, year 05: 1905 or 2005
const SA_ID_LEAP_AMBIGUOUS = '0402295001083' // 29 Feb, year 04: 1904 and 2004 were both leap years
const SA_ID_BORN_TODAY = '2611015001086' // 2026-11-01 (TODAY) or 1926-11-01
const SA_ID_BORN_TOMORROW = '2611025001084' // 2026-11-02 is in the future, so only 1926-11-02
const SA_ID_1927 = '2703155001081' // 2027-03-15 is in the future, so only 1927-03-15

test.describe('saIdBirthDateCandidates: the century is never assumed', () => {
  test('an unambiguous ID yields one full date', () => {
    expect(saIdBirthDateCandidates(SA_ID, TODAY)).toEqual(['1980-01-01'])
    expect(saIdBirthDateCandidates(SA_ID_1927, TODAY)).toEqual(['1927-03-15'])
  })
  test('an ID whose year fits both centuries yields both, oldest first, for the person to choose', () => {
    expect(saIdBirthDateCandidates(SA_ID_AMBIGUOUS, TODAY)).toEqual(['1905-06-15', '2005-06-15'])
    expect(saIdBirthDateCandidates(SA_ID_BORN_TODAY, TODAY)).toEqual(['1926-11-01', '2026-11-01'])
  })
  test('a date in the future is not offered: tomorrow in 2026 is excluded, tomorrow in 1926 remains', () => {
    expect(saIdBirthDateCandidates(SA_ID_BORN_TOMORROW, TODAY)).toEqual(['1926-11-02'])
  })
  test('leap years: 29 February 00 can only be 2000 (1900 was not a leap year); 29 February 04 is 1904 or 2004', () => {
    expect(saIdBirthDateCandidates(SA_ID_LEAP_DAY, TODAY)).toEqual(['2000-02-29'])
    expect(saIdBirthDateCandidates(SA_ID_LEAP_AMBIGUOUS, TODAY)).toEqual(['1904-02-29', '2004-02-29'])
  })
  test('nothing is derived from a passport number, an invalid ID, or an ID with an impossible date', () => {
    expect(saIdBirthDateCandidates('A1234567', TODAY)).toEqual([])
    expect(saIdBirthDateCandidates('123456789', TODAY)).toEqual([])
    expect(saIdBirthDateCandidates('8001015009088', TODAY)).toEqual([]) // wrong check digit
    expect(saIdBirthDateCandidates(SA_ID_BAD_DATE, TODAY)).toEqual([]) // 29 Feb 1990 / 2090 do not exist
    expect(saIdBirthDateCandidates('', TODAY)).toEqual([])
  })
  test('dobMatchesSaId accepts only the dates the ID can mean', () => {
    expect(dobMatchesSaId('1980-01-01', SA_ID, TODAY)).toBe(true)
    expect(dobMatchesSaId('2080-01-01', SA_ID, TODAY)).toBe(false) // future
    expect(dobMatchesSaId('1980-01-02', SA_ID, TODAY)).toBe(false)
    expect(dobMatchesSaId('1981-01-01', SA_ID, TODAY)).toBe(false)
    expect(dobMatchesSaId('1905-06-15', SA_ID_AMBIGUOUS, TODAY)).toBe(true)
    expect(dobMatchesSaId('2005-06-15', SA_ID_AMBIGUOUS, TODAY)).toBe(true)
    expect(dobMatchesSaId('1955-06-15', SA_ID_AMBIGUOUS, TODAY)).toBe(false)
  })
})

test.describe('validateRegistration: date of birth against the ID number', () => {
  test('a date of birth that contradicts a valid SA ID is refused, on the date field', () => {
    for (const dob of ['1999-12-31', '1980-01-02', '1980-02-01', '1981-01-01']) {
      const r = validateRegistration({ ...VALID, date_of_birth: dob }, TODAY)
      expect(r.values, dob).toBeNull()
      expect(r.errors.date_of_birth, dob).toMatch(/doesn.t match your south african id/i)
      expect(r.errors.id_number, dob).toBeUndefined()
    }
  })
  test('either year is accepted for an ambiguous ID; a third is not', () => {
    for (const dob of ['1905-06-15', '2005-06-15']) {
      expect(validateRegistration({ ...VALID, id_number: SA_ID_AMBIGUOUS, date_of_birth: dob }, TODAY).errors).toEqual({})
    }
    expect(validateRegistration({ ...VALID, id_number: SA_ID_AMBIGUOUS, date_of_birth: '1955-06-15' }, TODAY).errors.date_of_birth).toMatch(/doesn.t match/i)
  })
  test('the same rule holds on a leap day', () => {
    expect(validateRegistration({ ...VALID, id_number: SA_ID_LEAP_DAY, date_of_birth: '2000-02-29' }, TODAY).errors).toEqual({})
    expect(validateRegistration({ ...VALID, id_number: SA_ID_LEAP_DAY, date_of_birth: '1900-02-28' }, TODAY).errors.date_of_birth).toMatch(/doesn.t match/i)
  })
  test('a passport number encodes nothing: any real past date entered by hand is accepted, a missing one is not', () => {
    expect(validateRegistration({ ...VALID, id_number: 'A1234567', date_of_birth: '1999-12-31' }, TODAY).errors).toEqual({})
    expect(validateRegistration({ ...VALID, id_number: 'A1234567', date_of_birth: '' }, TODAY).errors.date_of_birth).toMatch(/enter your date of birth/i)
  })
  test('a bad ID is reported on the ID, with no extra complaint about the date', () => {
    const r = validateRegistration({ ...VALID, id_number: '8001015009088', date_of_birth: '1999-12-31' }, TODAY)
    expect(r.errors.id_number).toMatch(/isn.t valid/i)
    expect(r.errors.date_of_birth).toBeUndefined()
  })
})

test.describe('validatePassword', () => {
  test('empty and whitespace-only passwords are refused with their own messages', () => {
    expect(validatePassword('')).toEqual({ ok: false, error: 'Enter a password.' })
    for (const pw of [' ', '        ', '          ', '\t\t\t\t\t\t\t\t', ' \n \n \n \n']) {
      expect(validatePassword(pw), JSON.stringify(pw)).toEqual({ ok: false, error: 'Password can’t be only spaces.' })
    }
  })
  test('a short value padded with spaces does not pass as a longer password', () => {
    for (const pw of ['abc       ', '       abc', '   abc    xyz   ', 'ab cd ef', 'a b c d e f g', '1234567 ', ' 1234567']) {
      const r = validatePassword(pw)
      expect(r.ok, JSON.stringify(pw)).toBe(false)
      expect(r.ok ? '' : r.error, JSON.stringify(pw)).toMatch(/at least 8 characters that aren.t spaces/i)
    }
  })
  test('too short is refused; exactly eight real characters is accepted', () => {
    expect(validatePassword('1234567').ok).toBe(false)
    expect(validatePassword('12345678').ok).toBe(true)
  })
  test('strong passwords and multiword passphrases are accepted', () => {
    for (const pw of ['correct horse battery staple', 'my dog Rex 2020', 'Tr0ub4dor&3', 'pässwörd-ünïcode', 'a'.repeat(64), 'one two three four']) {
      expect(validatePassword(pw).ok, pw).toBe(true)
    }
  })
  test('leading and trailing spaces are not an error, and the value is judged exactly as typed', () => {
    expect(validatePassword('  spaced passphrase  ').ok).toBe(true)
    const r = validateRegistration({ ...VALID, password: '  spaced passphrase  ' }, TODAY)
    expect(r.values?.password).toBe('  spaced passphrase  ') // never trimmed or altered
  })
  test('the label shows in the message, for the change-password forms', () => {
    expect(validatePassword('short', { label: 'New password' })).toEqual({
      ok: false,
      error: 'New password must have at least 8 characters that aren’t spaces.',
    })
  })
  test('registration surfaces it on the password field', () => {
    expect(validateRegistration({ ...VALID, password: '        ' }, TODAY).errors.password).toMatch(/only spaces/i)
    expect(validateRegistration({ ...VALID, password: 'abc       ' }, TODAY).errors.password).toMatch(/aren.t spaces/i)
  })
})

test.describe('optional phone at registration', () => {
  test('empty is allowed and stored as no phone', () => {
    expect(parseOptionalPhone('')).toEqual({ value: null })
    expect(validateRegistration({ ...VALID, phone: '   ' }, TODAY).values?.phone).toBeNull()
  })
  test('South African and foreign numbers are kept exactly as typed', () => {
    for (const raw of ['082 123 4567', '+27 82 123 4567', '+44 20 7946 0958', '(035) 123-4567', '0821234567']) {
      expect(parseOptionalPhone(raw), raw).toEqual({ value: raw })
    }
  })
  test('letters, symbols, too few or too many digits and over-long text are refused', () => {
    for (const raw of ['abc', '082 123 4567 ext 2', '12345', '1234567890123456', '<script>', '0'.repeat(31), '++27821234567']) {
      expect(parseOptionalPhone(raw).error, raw).toBeTruthy()
    }
    expect(validateRegistration({ ...VALID, phone: 'abc' }, TODAY).errors.phone).toBeTruthy()
  })
})

// What handle_new_user() does with the signup metadata — written out from migration 20261006151206 so that anything this form
// accepts can be shown to survive it. (The trigger drops a malformed value silently; nothing is ever reported back.)
function triggerKeeps(dob: string, id: string, today: string): { dob: boolean; id: boolean } {
  const normalisedId = id.replace(/\s/g, '').toUpperCase()
  const d = new Date(`${dob}T12:00:00Z`)
  const dobOk =
    /^\d{4}-\d{2}-\d{2}$/.test(dob) &&
    !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === dob &&
    dob <= today &&
    dob >= '1900-01-01'
  return { dob: dobOk, id: /^[A-Z0-9]{6,20}$/.test(normalisedId) }
}

test.describe('what the form sends is what handle_new_user() stores', () => {
  test('every date of birth and ID/passport number the form accepts passes the trigger’s own checks', () => {
    // [date of birth, ID/passport]: an SA ID must be paired with a date it can mean; a passport takes any real past date.
    const pairs: [string, string][] = [
      ['1980-01-01', SA_ID],
      ['2000-02-29', SA_ID_LEAP_DAY],
      ['1905-06-15', SA_ID_AMBIGUOUS],
      ['2005-06-15', SA_ID_AMBIGUOUS],
      ['1900-01-01', 'A1234567'],
      ['1980-01-01', 'ab 12 34 56'],
      ['2000-02-29', '123456789'],
      [TODAY, 'Z'.repeat(20)],
      ['1992-07-15', 'P12345'],
    ]
    for (const [dob, id] of pairs) {
      const r = validateRegistration({ ...VALID, date_of_birth: dob, id_number: id }, TODAY)
      expect(r.errors, `${dob} / ${id}`).toEqual({})
      const kept = triggerKeeps(r.values!.dateOfBirth, r.values!.idNumber, TODAY)
      expect(kept, `${dob} / ${id}`).toEqual({ dob: true, id: true })
      expect(r.values!.dateOfBirth).toBe(dob) // sent unchanged
    }
  })

  test('the mirror above still matches the migration that defines handle_new_user()', () => {
    const dir = join(__dirname, '..', 'supabase', 'migrations')
    const defining = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => /create (or replace )?function public\.handle_new_user\b/i.test(readFileSync(join(dir, f), 'utf8')))
      .sort()
    // A newer definition would silently invalidate the mirror: fail until it is reviewed.
    expect(defining.at(-1)).toBe('20261006151206_patient_profile_fields.sql')
    const sql = readFileSync(join(dir, defining.at(-1) as string), 'utf8')
    expect(sql).toContain("'^\\d{4}-\\d{2}-\\d{2}$'")
    expect(sql).toContain("'^[A-Z0-9]{6,20}$'")
    expect(sql).toContain("date '1900-01-01'")
    expect(sql).toContain("dob > current_date")
    expect(sql).toMatch(/upper\(regexp_replace\(coalesce\(new\.raw_user_meta_data ->> 'id_number', ''\), '\\s', '', 'g'\)\)/)
    expect(sql).toContain("'patient'")
  })

  test('a value the trigger would drop is rejected by the form first', () => {
    for (const [dob, id] of [['1992-02-30', 'A1234567'], ['2027-01-01', 'A1234567'], ['1980-01-01', 'AB-123456'], ['1980-01-01', 'A12']]) {
      const r = validateRegistration({ ...VALID, date_of_birth: dob, id_number: id }, TODAY)
      expect(r.values, `${dob} / ${id}`).toBeNull()
    }
  })
})

test.describe('profile persistence and password-path contracts (source level)', () => {
  const root = join(__dirname, '..')
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
  const slice = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from) + from.length))

  test('register() sends exactly the four keys handle_new_user() reads, and the trigger reads those four', () => {
    const auth = read('app/actions/auth.ts')
    const data = slice(auth, 'data: {', 'emailRedirectTo') // the signUp metadata block
    for (const key of ['full_name', 'phone', 'date_of_birth', 'id_number']) expect(data, key).toContain(`${key}`)
    expect(data).not.toMatch(/\brole\b|clinic_id|is_active/) // nothing privileged can ride along
    const sql = read('supabase/migrations/20261006151206_patient_profile_fields.sql')
    for (const key of ['full_name', 'phone', 'date_of_birth', 'id_number']) expect(sql, key).toContain(`->> '${key}'`)
  })

  test('the patient Profile page reads the stored columns it renders (full_name, phone, date_of_birth, id_number)', () => {
    const page = read('app/(patient)/profile/page.tsx')
    expect(page).toContain(".select('full_name, phone, date_of_birth, id_number')")
    expect(page).toContain(".eq('auth_user_id', user.id)")
    expect(page).toContain('profile.date_of_birth')
    expect(page).toContain('profile.id_number')
  })

  test('every action that sets a password applies the shared rule; none applies a private length check', () => {
    const files = ['app/actions/auth.ts', 'app/actions/profile.ts', 'app/actions/receptionProfile.ts', 'app/actions/admin.ts', 'app/actions/reception.ts']
    for (const f of files) {
      const src = read(f)
      expect(src, `${f} has its own password length check`).not.toMatch(/(password|next)\.length\s*<\s*\d/)
      if (/updateUser\(\s*\{\s*password/.test(src)) expect(src, `${f} writes a password without validatePassword`).toContain('validatePassword(')
    }
    expect(read('app/actions/auth.ts')).toContain('validateRegistration(')
    // Reception's change goes through the patient action, so it gets the same rule.
    expect(read('app/actions/receptionProfile.ts')).toContain('await changePassword(')
  })

  test('sign-in does not apply the new rule: existing users keep logging in with the password they have', () => {
    const login = slice(read('app/actions/auth.ts'), 'export async function login', 'export async function logout')
    expect(login).not.toContain('validatePassword')
    expect(login).toContain('signInWithPassword({ email, password })') // the password goes through exactly as typed
    expect(login).toMatch(/if \(!email \|\| !password\)/)
  })
})

// ------------------------------------------------------------------------------------------------ real pages (offline server)

async function sealed(context: BrowserContext) {
  const posts: string[] = []
  await context.route('**/*', (route) => {
    const req = route.request()
    if (req.method() !== 'GET' && req.method() !== 'HEAD') {
      posts.push(`${req.method()} ${req.url()}`)
      return route.abort()
    }
    return route.continue()
  })
  return posts
}

const visit = async (page: Page, path: string) => {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  // Interact only once React has attached to the form, so a click runs the client handler rather than a pre-hydration submit.
  await page.waitForFunction(
    () => {
      const form = document.querySelector('form')
      return !!form && Object.keys(form).some((k) => k.startsWith('__reactProps'))
    },
    undefined,
    { timeout: 90_000 },
  )
}

test.describe('registration form (real page, nothing submitted)', () => {
  test.setTimeout(180_000)

  test('date of birth and ID/passport number are required fields; phone is the optional one', async ({ page, context }) => {
    await sealed(context)
    await visit(page, '/register')
    await expect(page.getByLabel('Date of birth')).toHaveAttribute('required', '')
    await expect(page.getByLabel('ID or passport number')).toHaveAttribute('required', '')
    await expect(page.getByLabel('Full name')).toHaveAttribute('required', '')
    await expect(page.getByText(/\(optional\)/i)).toHaveCount(1)
    await expect(page.getByLabel('Mobile number (optional)')).not.toHaveAttribute('required', '')
  })

  test('an empty submit shows an error under every required field, focuses the first, and sends nothing', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/register')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page.getByText('Enter your full name.')).toBeVisible()
    await expect(page.getByText('Enter your email address.')).toBeVisible()
    await expect(page.getByText('Enter your date of birth.')).toBeVisible()
    await expect(page.getByText('Enter your South African ID or passport number.')).toBeVisible()
    await expect(page.getByText('Enter a password.')).toBeVisible()
    await expect(page.getByLabel('Full name')).toBeFocused()
    await expect(page.getByLabel('ID or passport number')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('ID or passport number')).toHaveAttribute('aria-describedby', /-error$/)
    expect(posts).toEqual([])
  })

  test('only the bad field is reported: a well-formed form except an ID with a wrong check digit, and again with no date of birth', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/register')
    await page.getByLabel('Full name').fill('Thabo Mokoena')
    await page.getByLabel('Email').fill('thabo@example.com')
    await page.getByLabel('Date of birth').fill('1980-01-01')
    await page.getByLabel('ID or passport number').fill('8001015009088')
    await page.getByLabel('Password', { exact: true }).fill('longenough')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page.getByText(/south african id number isn.t valid/i)).toBeVisible()
    await expect(page.getByText('Enter your date of birth.')).toHaveCount(0)
    await expect(page.getByLabel('ID or passport number')).toBeFocused()

    await page.getByLabel('Date of birth').fill('')
    await page.getByLabel('ID or passport number').fill('A1234567') // a passport suggests no date, so it stays empty
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText('Enter your date of birth.')).toBeVisible()
    await expect(page.getByLabel('Date of birth')).toBeFocused()
    expect(posts).toEqual([])
  })
})

test.describe('show/hide password (real pages, nothing submitted)', () => {
  test.setTimeout(180_000)

  test('registration: hidden by default, toggles, keeps the value, keeps autocomplete, never submits', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/register')
    const field = page.getByLabel('Password', { exact: true })
    const toggle = page.getByRole('button', { name: 'Show password' }).first() // the Confirm field has one too

    await expect(field).toHaveAttribute('type', 'password')
    await expect(field).toHaveAttribute('autocomplete', 'new-password')
    await expect(toggle).toHaveAttribute('type', 'button')
    await expect(toggle).toHaveAttribute('aria-controls', (await field.getAttribute('id')) as string)

    await field.fill('s3cret-pass')
    await toggle.click()
    await expect(field).toHaveAttribute('type', 'text')
    await expect(field).toHaveValue('s3cret-pass')
    await expect(field).toHaveAttribute('autocomplete', 'new-password')
    await page.getByRole('button', { name: 'Hide password' }).first().click()
    await expect(field).toHaveAttribute('type', 'password')
    await expect(field).toHaveValue('s3cret-pass')

    // pressing the toggle submits nothing and raises no validation messages
    await expect(page.getByText('Enter your full name.')).toHaveCount(0)
    expect(posts).toEqual([])
  })

  test('registration: reachable by keyboard and operated with Enter and Space without submitting the form', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/register')
    const field = page.getByLabel('Password', { exact: true })
    await field.focus()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Show password' }).first()).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(field).toHaveAttribute('type', 'text')
    await page.keyboard.press('Space')
    await expect(field).toHaveAttribute('type', 'password')
    await page.keyboard.press('Enter')
    await expect(field).toHaveAttribute('type', 'text')
    await expect(page.getByText('Enter your full name.')).toHaveCount(0) // the form was not submitted
    expect(posts).toEqual([])
  })

  test('login: toggles and keeps autocomplete="current-password"', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/login')
    const field = page.getByLabel('Password', { exact: true })
    await expect(field).toHaveAttribute('type', 'password')
    await expect(field).toHaveAttribute('autocomplete', 'current-password')
    await field.fill('typed-here')
    await page.getByRole('button', { name: 'Show password' }).click()
    await expect(field).toHaveAttribute('type', 'text')
    await expect(field).toHaveValue('typed-here')
    await expect(field).toHaveAttribute('autocomplete', 'current-password')
    expect(posts).toEqual([])
  })

  test('reset password: both fields have their own independent toggle', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/reset-password')
    const next = page.getByLabel('New password')
    const confirm = page.getByLabel('Confirm password')
    await expect(page.getByRole('button', { name: 'Show password' })).toHaveCount(2)
    await page.getByRole('button', { name: 'Show password' }).first().click()
    await expect(next).toHaveAttribute('type', 'text')
    await expect(confirm).toHaveAttribute('type', 'password')
    await expect(next).toHaveAttribute('autocomplete', 'new-password')
    await expect(confirm).toHaveAttribute('autocomplete', 'new-password')
    await page.getByRole('button', { name: 'Show password' }).click() // the second one, still labelled "Show"
    await expect(confirm).toHaveAttribute('type', 'text')
    expect(posts).toEqual([])
  })
})

test.describe('date of birth from the ID number (real page, nothing submitted)', () => {
  test.setTimeout(180_000)

  const idField = (page: Page) => page.getByLabel('ID or passport number')
  const dobField = (page: Page) => page.getByLabel('Date of birth')

  test('an unambiguous SA ID fills the date and says so; clearing the ID removes a date it supplied', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/register')
    await idField(page).fill(SA_ID)
    await expect(dobField(page)).toHaveValue('1980-01-01')
    await expect(page.getByRole('status')).toContainText('filled in from your ID number')
    await expect(page.getByRole('status')).toContainText('1 January 1980')
    await expect(page.getByRole('group')).toHaveCount(0) // no year question when there is only one possibility

    await idField(page).fill('')
    await expect(dobField(page)).toHaveValue('')
    expect(posts).toEqual([])
  })

  test('a date the person typed is never overwritten by the ID number', async ({ page, context }) => {
    await sealed(context)
    await visit(page, '/register')
    await dobField(page).fill('1999-12-31')
    await idField(page).fill(SA_ID)
    await expect(dobField(page)).toHaveValue('1999-12-31')
    await expect(page.getByRole('status')).toHaveCount(0) // nothing claims the date came from the ID
  })

  test('an ID that fits two birth years asks which, never guesses, and the choice fills the date (keyboard)', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/register')
    await idField(page).fill(SA_ID_AMBIGUOUS)

    const group = page.getByRole('group', { name: /fits two birth years/i })
    await expect(group).toBeVisible()
    await expect(dobField(page)).toHaveValue('') // not guessed
    const older = group.getByRole('radio', { name: '15 June 1905' })
    const newer = group.getByRole('radio', { name: '15 June 2005' })
    await expect(older).not.toBeChecked()
    await expect(newer).not.toBeChecked()

    await older.focus()
    await page.keyboard.press('Space')
    await expect(dobField(page)).toHaveValue('1905-06-15')
    await expect(older).toBeChecked()
    await page.keyboard.press('ArrowDown')
    await expect(newer).toBeChecked()
    await expect(dobField(page)).toHaveValue('2005-06-15')

    // typing the date by hand keeps the radios in step
    await dobField(page).fill('1905-06-15')
    await expect(older).toBeChecked()
    expect(posts).toEqual([])
  })

  test('a passport number never produces a suggestion; the date is entered by hand and accepted', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/register')
    await idField(page).fill('A1234567')
    await expect(dobField(page)).toHaveValue('')
    await expect(page.getByRole('status')).toHaveCount(0)
    await expect(page.getByRole('group')).toHaveCount(0)

    await page.getByLabel('Full name').fill('Thabo Mokoena')
    await page.getByLabel('Email').fill('thabo@example.com')
    await dobField(page).fill('1999-12-31')
    await page.getByLabel('Password', { exact: true }).fill('   ') // stops short of a valid submit: see below
    await page.getByRole('button', { name: 'Create account' }).click()
    // the date and the passport are fine; only the password is reported
    await expect(page.getByText('Password can’t be only spaces.')).toBeVisible()
    await expect(page.getByText(/date of birth/i).filter({ hasText: /doesn.t match|enter your/i })).toHaveCount(0)
    expect(posts).toEqual([])
  })

  test('a date that contradicts the SA ID is refused on the date field, and nothing is sent', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/register')
    await page.getByLabel('Full name').fill('Thabo Mokoena')
    await page.getByLabel('Email').fill('thabo@example.com')
    await idField(page).fill(SA_ID)
    await dobField(page).fill('1999-12-31')
    await page.getByLabel('Password', { exact: true }).fill('longenough')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page.getByText(/date of birth doesn.t match your south african id/i)).toBeVisible()
    await expect(dobField(page)).toBeFocused()
    await expect(dobField(page)).toHaveAttribute('aria-invalid', 'true')
    expect(posts).toEqual([])
  })

  test('phone-width layout: the year question and both fields fit with no sideways scrolling', async ({ page, context }) => {
    await sealed(context)
    await page.setViewportSize({ width: 360, height: 740 })
    await visit(page, '/register')
    await idField(page).fill(SA_ID_AMBIGUOUS)
    await expect(page.getByRole('group', { name: /fits two birth years/i })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    const box = await page.getByRole('radio', { name: '15 June 2005' }).boundingBox()
    expect(box && box.width).toBeGreaterThanOrEqual(20)
  })
})

test.describe('password rules on the registration form (real page, nothing submitted)', () => {
  test.setTimeout(180_000)

  async function fillValidExceptPassword(page: Page) {
    await page.getByLabel('Full name').fill('Thabo Mokoena')
    await page.getByLabel('Email address').fill('thabo@example.com')
    await page.getByLabel('ID or passport number').fill(SA_ID)
    await page.getByLabel('Date of birth').fill('1980-01-01')
  }

  for (const [label, pw, message] of [
    ['only spaces', '          ', /can.t be only spaces/i],
    ['a short word padded with spaces', 'abc       ', /at least 8 characters that aren.t spaces/i],
    ['too short', '1234567', /at least 8 characters that aren.t spaces/i],
  ] as const) {
    test(`${label} is refused with a clear message and nothing is sent`, async ({ page, context }) => {
      const posts = await sealed(context)
      await visit(page, '/register')
      await fillValidExceptPassword(page)
      await page.getByLabel('Password', { exact: true }).fill(pw)
      await page.getByRole('button', { name: 'Create account' }).click()
      await expect(page.getByText(message)).toBeVisible()
      await expect(page.getByLabel('Password', { exact: true })).toBeFocused()
      await expect(page.getByLabel('Password', { exact: true })).toHaveValue(pw) // never trimmed or cleared
      expect(posts).toEqual([])
    })
  }

  test('a multiword passphrase is not refused (the request is aborted by the test, so nothing is created)', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/register')
    await fillValidExceptPassword(page)
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple')
    await page.getByLabel('Confirm password').fill('correct horse battery staple')
    await page.getByRole('button', { name: 'Create account' }).click()
    // Validation passed, so the form action was attempted — and the sealed context aborted that POST.
    await expect.poll(() => posts.length, { timeout: 30_000 }).toBeGreaterThan(0)
    await expect(page.getByText(/only spaces|aren.t spaces/i)).toHaveCount(0)
  })
})

test.describe('email verification code entry (real page, nothing submitted)', () => {
  test.setTimeout(180_000)

  const boxes = (page: Page) => page.getByRole('group', { name: 'Verification code' }).getByRole('textbox')

  test('six boxes, digits only, focus advances, and Verify is enabled only at six; resend is offered', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/verify?email=someone%40example.com')
    const verify = page.getByRole('button', { name: 'Verify account' })
    await expect(boxes(page)).toHaveCount(6)
    await expect(verify).toBeDisabled()

    await boxes(page).nth(0).pressSequentially('1')
    await expect(boxes(page).nth(0)).toHaveValue('1')
    await expect(boxes(page).nth(1)).toBeFocused() // focus moves on to the next box

    await boxes(page).nth(1).pressSequentially('a') // a non-digit is simply not accepted
    await expect(boxes(page).nth(1)).toHaveValue('')
    await expect(verify).toBeDisabled()

    for (const [i, d] of [...'23456'].entries()) await boxes(page).nth(i + 1).pressSequentially(d)
    for (const [i, d] of [...'123456'].entries()) await expect(boxes(page).nth(i)).toHaveValue(d)
    await expect(verify).toBeEnabled()
    await expect(page.getByRole('button', { name: /resend code/i })).toBeVisible()
    expect(posts).toEqual([])
  })

  test('a whole code arriving in one box (autofill or paste) spreads across the six, and extra digits are dropped', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/verify?email=someone%40example.com')
    await boxes(page).nth(0).fill('1234567890')
    for (const [i, d] of [...'123456'].entries()) await expect(boxes(page).nth(i)).toHaveValue(d)
    await expect(page.getByRole('button', { name: 'Verify account' })).toBeEnabled()
    expect(posts).toEqual([])
  })

  test('backspace on an empty box steps back and clears the previous digit', async ({ page, context }) => {
    await sealed(context)
    await visit(page, '/verify?email=someone%40example.com')
    await boxes(page).nth(0).pressSequentially('12')
    await expect(boxes(page).nth(2)).toBeFocused()
    await page.keyboard.press('Backspace')
    await expect(boxes(page).nth(1)).toHaveValue('')
    await expect(boxes(page).nth(1)).toBeFocused()
  })

  test('it never claims an email was sent: only a resend Supabase accepted may say that', async ({ page, context }) => {
    await sealed(context)
    await visit(page, '/verify?email=someone%40example.com')
    const body = await page.locator('main').innerText()
    expect(body).not.toMatch(/we.{0,3}ve sent|we sent|has been sent|check your (inbox|email)/i)
    expect(body).toContain('Enter the 6-digit verification code for')
    expect(body).toContain('someone@example.com')
    // The only "on its way" wording lives behind a successful resend call, which this offline page never makes.
    expect(body).not.toContain('on its way')
    expect(readFileSync('components/auth/VerifyForm.tsx', 'utf8')).toMatch(
      /setResendState\('sent'\)[\s\S]{0,120}A new code is on its way/
    )
  })
})
