import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { isValidSouthAfricanId, requireDateOfBirth, requireIdNumber } from '../lib/profileValidation'
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
      dateOfBirth: '1980-01-01',
      idNumber: SA_ID,
      password: 'longenough',
    })
  })
  test('an empty form reports every required field, including date of birth and ID/passport number', () => {
    const r = validateRegistration({ full_name: '', email: '', date_of_birth: '', id_number: '', password: '' }, TODAY)
    expect(r.values).toBeNull()
    expect(Object.keys(r.errors).sort()).toEqual(['date_of_birth', 'email', 'full_name', 'id_number', 'password'])
  })
  test('date of birth and ID number are each individually required', () => {
    expect(validateRegistration({ ...VALID, date_of_birth: '' }, TODAY).errors).toEqual({ date_of_birth: 'Enter your date of birth.' })
    expect(Object.keys(validateRegistration({ ...VALID, id_number: '' }, TODAY).errors)).toEqual(['id_number'])
  })
  test('malformed email and short password are rejected', () => {
    expect(validateRegistration({ ...VALID, email: 'thabo@' }, TODAY).errors.email).toMatch(/valid email/i)
    expect(validateRegistration({ ...VALID, password: '1234567' }, TODAY).errors.password).toMatch(/at least 8/i)
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
    const dobs = ['1900-01-01', '1980-01-01', '2000-02-29', TODAY]
    const ids = [SA_ID, SA_ID_LEAP_DAY, 'A1234567', 'ab 12 34 56', '123456789', 'Z'.repeat(20), 'P12345']
    for (const dob of dobs) {
      for (const id of ids) {
        const r = validateRegistration({ ...VALID, date_of_birth: dob, id_number: id }, TODAY)
        expect(r.errors, `${dob} / ${id}`).toEqual({})
        const kept = triggerKeeps(r.values!.dateOfBirth, r.values!.idNumber, TODAY)
        expect(kept, `${dob} / ${id}`).toEqual({ dob: true, id: true })
        expect(r.values!.dateOfBirth).toBe(dob) // sent unchanged
      }
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
    await expect(page.getByLabel('Phone (optional)')).not.toHaveAttribute('required', '')
  })

  test('an empty submit shows an error under every required field, focuses the first, and sends nothing', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/register')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page.getByText('Enter your full name.')).toBeVisible()
    await expect(page.getByText('Enter your email address.')).toBeVisible()
    await expect(page.getByText('Enter your date of birth.')).toBeVisible()
    await expect(page.getByText('Enter your South African ID or passport number.')).toBeVisible()
    await expect(page.getByText('Password must be at least 8 characters.')).toBeVisible()
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
    await page.getByLabel('ID or passport number').fill(SA_ID)
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
    const toggle = page.getByRole('button', { name: 'Show password' })

    await expect(field).toHaveAttribute('type', 'password')
    await expect(field).toHaveAttribute('autocomplete', 'new-password')
    await expect(toggle).toHaveAttribute('type', 'button')
    await expect(toggle).toHaveAttribute('aria-controls', (await field.getAttribute('id')) as string)

    await field.fill('s3cret-pass')
    await toggle.click()
    await expect(field).toHaveAttribute('type', 'text')
    await expect(field).toHaveValue('s3cret-pass')
    await expect(field).toHaveAttribute('autocomplete', 'new-password')
    await page.getByRole('button', { name: 'Hide password' }).click()
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
    await expect(page.getByRole('button', { name: 'Show password' })).toBeFocused()
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
