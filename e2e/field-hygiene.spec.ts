import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEmail, parseOptionalPhone, parsePhone, parseStaffName } from '../lib/profileValidation'
import { parseConsultationMinutes, parseServiceName, parseTokenPrefix } from '../lib/serviceValidation'

/**
 * The shared field rules every form in the app runs: email, name and phone. Pure logic — no browser, no network,
 * no database.
 *
 * These are SYNTAX rules. None of them establishes that a person is who they say they are, that a mailbox exists
 * or can receive mail, or that a phone number is in service. They establish that what was typed is the shape of
 * the thing it claims to be, which is all a form can know, and they are the same rules on the client (so the
 * problem is visible before a round trip) and in the Server Action (which is the one that counts).
 */

test.describe('parseEmail — syntax only, and lower-cased', () => {
  test('a plain address is accepted, trimmed and lower-cased', () => {
    expect(parseEmail('thabo@example.com')).toEqual({ value: 'thabo@example.com' })
    expect(parseEmail('  Thabo@Example.COM  ')).toEqual({ value: 'thabo@example.com' })
  })

  /**
   * Lower-casing is what stops one person becoming two accounts. The domain is case-insensitive by the standard;
   * the local part technically is not, but no provider in practice treats it otherwise, and the alternative is
   * that "Thabo@..." and "thabo@..." register separately and neither can see the other's appointments.
   */
  test('case differences collapse to one stored address', () => {
    const forms = ['thabo@example.com', 'Thabo@example.com', 'THABO@EXAMPLE.COM', 'ThAbO@ExAmPlE.cOm']
    const stored = new Set(forms.map((f) => parseEmail(f).value))
    expect(stored.size).toBe(1)
    expect([...stored][0]).toBe('thabo@example.com')
  })

  test('the shapes that are still real addresses are accepted', () => {
    for (const raw of [
      'thabo.mokoena@example.com',
      'thabo+clinic@example.com',
      'thabo_m@example.co.za',
      't@stu.unizulu.ac.za',
      "o'brien@example.com",
      'thabo-m@sub.domain.example.com',
    ]) {
      expect(parseEmail(raw), raw).toEqual({ value: raw.toLowerCase() })
    }
  })

  test('empty is refused, with the message the field asks for', () => {
    expect(parseEmail('').error).toMatch(/enter your email address/i)
    expect(parseEmail('    ').error).toMatch(/enter your email address/i)
  })

  test('whitespace inside an address is refused rather than silently stripped', () => {
    // Stripping would turn a typo into a different, possibly real, address belonging to somebody else.
    for (const raw of ['tha bo@example.com', 'thabo@exa mple.com', 'thabo @example.com']) {
      expect(parseEmail(raw).error, raw).toMatch(/can.t contain spaces/i)
    }
  })

  test('consecutive dots are refused', () => {
    for (const raw of ['thabo..m@example.com', 'thabo@example..com', 'a..b@c..d.com']) {
      expect(parseEmail(raw).error, raw).toMatch(/two dots in a row/i)
    }
  })

  test('a dot at the edge of either part is refused', () => {
    for (const raw of ['.thabo@example.com', 'thabo.@example.com', 'thabo@.example.com', 'thabo@example.com.']) {
      expect(parseEmail(raw).error, raw).toMatch(/start or end a part with a dot/i)
    }
  })

  test('anything not shaped like an address at all is refused', () => {
    for (const raw of ['not-an-email', 'thabo@', '@example.com', 'thabo@example', 'thabo@@example.com', 'a@b@c.com', '@']) {
      expect(parseEmail(raw).error, raw).toBeTruthy()
      expect(parseEmail(raw).value, raw).toBeNull()
    }
  })

  test('a hyphen at the edge of the domain is refused', () => {
    expect(parseEmail('thabo@-example.com').error).toBeTruthy()
    expect(parseEmail('thabo@example-.com').error).toBeTruthy()
  })

  test('an address longer than can be delivered is refused on length', () => {
    // RFC 5321 caps a path at 254 characters; anything longer cannot be delivered by any route.
    const atLimit = 'a'.repeat(254 - '@example.com'.length) + '@example.com'
    expect(atLimit).toHaveLength(254)
    expect(parseEmail(atLimit).value).toBe(atLimit)
    expect(parseEmail('a' + atLimit).error).toMatch(/too long/i)
  })

  test('markup and control characters cannot survive as an address', () => {
    for (const raw of ['<script>@example.com', 'thabo@<b>.com', 'thabo\n@example.com', 'thabo@example.com\u0000']) {
      expect(parseEmail(raw).error, raw).toBeTruthy()
    }
  })
})

test.describe('parseStaffName — an allow-list, not a block-list', () => {
  test('the names this clinic actually holds are accepted', () => {
    // Including the titled spellings staff carry, which is why full stops are allowed at all.
    for (const raw of ['Nurse Mabaso', 'Sr. Botha', 'Tshepo Cleopatra Baartman', 'Thabo Mokoena']) {
      expect(parseStaffName(raw), raw).toEqual({ value: raw })
    }
  })

  test('accented, apostrophed and hyphenated names are accepted — South African names routinely are', () => {
    for (const raw of ['Thándeka Ngwenya', "O'Brien", 'N’wamitwa Chauke', 'Smith-Jones', 'Zoë van der Merwe', 'José Müller']) {
      expect(parseStaffName(raw), raw).toEqual({ value: raw })
    }
  })

  test('whitespace is collapsed and trimmed, not rejected', () => {
    expect(parseStaffName('  Thabo   Mokoena  ')).toEqual({ value: 'Thabo Mokoena' })
  })

  test('empty or whitespace-only is refused', () => {
    expect(parseStaffName('').error).toMatch(/enter your full name/i)
    expect(parseStaffName('    ').error).toMatch(/enter your full name/i)
    expect(parseStaffName('\t\n ').error).toBeTruthy()
  })

  test('a name that is purely digits or purely punctuation is refused', () => {
    for (const raw of ['1234', '12', '---', '...', "'''", '- -', '42 42']) {
      expect(parseStaffName(raw).error, raw).toBeTruthy()
      expect(parseStaffName(raw).value, raw).toBeNull()
    }
  })

  test('digits anywhere in a name are refused', () => {
    // This is the rule that the 27 existing walk-in records ("<name> <number>") would not satisfy. They are
    // never re-validated: no code path lets anyone re-save them — they have no login, and reception's only
    // profile action edits the receptionist's own row — so the rule applies to new input only, exactly as the
    // legacy handling for date_of_birth and id_number does in lib/profileEditValidation.ts.
    for (const raw of ['Thabo 2', 'Patient 12', 'Thabo1 Mokoena', '2Pac Shakur']) {
      expect(parseStaffName(raw).error, raw).toMatch(/letters, spaces, hyphens, apostrophes and full stops/i)
    }
  })

  /**
   * React escapes on output, and that is one layer. This is the other: a name is also read back by the public
   * queue display and by SQL reports, neither of which is React, so a value that is never dangerous is worth
   * more than relying on output escaping alone.
   */
  test('anything shaped like markup or a script is refused outright', () => {
    for (const raw of [
      '<script>alert(1)</script>',
      'Thabo <b>Mokoena</b>',
      '<img src=x onerror=alert(1)>',
      'Thabo" onmouseover="x',
      '{{constructor}}',
      'Thabo & Sons',
      'Robert\'); DROP TABLE profiles;--',
    ]) {
      expect(parseStaffName(raw).error, raw).toBeTruthy()
      expect(parseStaffName(raw).value, raw).toBeNull()
    }
  })

  test('control characters are refused — a newline breaks every list the name appears in', () => {
    for (const raw of ['Thabo\nMokoena'.replace('\n', '\u0001'), 'Thabo\u007fMokoena', 'Thabo\u0000']) {
      expect(parseStaffName(raw).error, raw).toBeTruthy()
    }
  })

  test('length bounds hold at the edges', () => {
    expect(parseStaffName('A').error).toMatch(/at least 2/i)
    expect(parseStaffName('Ab')).toEqual({ value: 'Ab' })
    const max = 'A'.repeat(120)
    expect(parseStaffName(max)).toEqual({ value: max })
    expect(parseStaffName('A'.repeat(121)).error).toMatch(/too long/i)
  })

  test('a name must start with a letter', () => {
    for (const raw of ['.Thabo', '-Thabo', "'Thabo", ' .Thabo']) {
      expect(parseStaffName(raw).error, raw).toBeTruthy()
    }
  })
})

test.describe('phone — one South African rule, one stored format', () => {
  test('parseOptionalPhone and parsePhone are now the same rule', () => {
    // They were two different rules: registration kept whatever was typed and accepted foreign numbers, while
    // the staff profile form required a South African number and normalised it. The same person's number was
    // therefore accepted on one form and refused on the next.
    for (const raw of ['', '082 123 4567', '+27821234567', '+44 20 7946 0958', 'abc']) {
      expect(parseOptionalPhone(raw), raw).toEqual(parsePhone(raw))
    }
  })

  test('every accepted spelling normalises to exactly one stored value', () => {
    const spellings = ['082 123 4567', '0821234567', '082-123-4567', '+27 82 123 4567', '+27821234567', '27821234567']
    const stored = new Set(spellings.map((s) => parsePhone(s).value))
    expect(stored.size).toBe(1)
    expect([...stored][0]).toBe('+27 82 123 4567')
  })

  test('empty is allowed — phone is optional everywhere it is collected', () => {
    expect(parsePhone('')).toEqual({ value: null })
    expect(parsePhone('   ')).toEqual({ value: null })
  })

  test('markup, letters and wrong lengths are refused', () => {
    for (const raw of ['<script>', 'abc', '082 123', '082 123 45678', '0012345678', '+27 0821234567']) {
      expect(parsePhone(raw).error, raw).toBeTruthy()
    }
  })
})

/**
 * Service fields, which an administrator types. Two of the three rules exist as CHECK constraints in
 * public.services; these tests pin the app's copy of them to the same boundaries, because the point of the copy
 * is a readable message and a copy that disagreed with the constraint would produce the raw violation it exists
 * to prevent.
 */
test.describe('service fields mirror what the database enforces', () => {
  test('token prefix: 2–4 letters, upper-cased — services_prefix_format', () => {
    // CHECK (token_prefix ~ '^[A-Z]{2,4}$')
    expect(parseTokenPrefix('gc')).toEqual({ value: 'GC' })
    expect(parseTokenPrefix('  phar ')).toEqual({ value: 'PHAR' })
    expect(parseTokenPrefix('ABCD')).toEqual({ value: 'ABCD' })
    for (const raw of ['A', 'ABCDE', 'G1', '12', 'G-C', 'G C', '<b>']) {
      expect(parseTokenPrefix(raw).error, raw).toMatch(/2 to 4 letters/i)
    }
    expect(parseTokenPrefix('').error).toMatch(/enter a token prefix/i)
  })

  test('default duration: a whole number of 1–240 minutes — services_default_consultation_minutes_check', () => {
    // CHECK (default_consultation_minutes >= 1 AND default_consultation_minutes <= 240)
    expect(parseConsultationMinutes('15')).toEqual({ value: 15 })
    expect(parseConsultationMinutes('1')).toEqual({ value: 1 })
    expect(parseConsultationMinutes('240')).toEqual({ value: 240 })
    // These three used to reach the database and come back as a constraint violation.
    for (const raw of ['241', '1000', '0']) {
      expect(parseConsultationMinutes(raw).error, String(raw)).toMatch(/between 1 and 240/i)
    }
    for (const raw of ['15.5', 'abc', '-5', '1e3', ' ']) {
      expect(parseConsultationMinutes(raw).error, String(raw)).toBeTruthy()
    }
    expect(parseConsultationMinutes(null).error).toMatch(/enter a default duration/i)
    expect(parseConsultationMinutes(undefined).error).toMatch(/enter a default duration/i)
  })

  test('service name: the names a clinic really uses are accepted', () => {
    for (const raw of [
      'General Consultation',
      'Pharmacy',
      'Maternal & Child Health',
      'TB / HIV Clinic',
      "Children's Ward",
      'Ante-natal (First Visit)',
      'Immunisation, Under 5s',
    ]) {
      expect(parseServiceName(raw), raw).toEqual({ value: raw })
    }
    expect(parseServiceName('  General   Consultation  ')).toEqual({ value: 'General Consultation' })
  })

  test('service name: nothing in the database bounds this column, so these are the only checks there are', () => {
    expect(parseServiceName('').error).toMatch(/enter a service name/i)
    expect(parseServiceName('A').error).toMatch(/at least 2/i)
    expect(parseServiceName('A'.repeat(61)).error).toMatch(/too long/i)
    expect(parseServiceName('A'.repeat(60)).value).toHaveLength(60)
    expect(parseServiceName('123').error).toMatch(/at least one letter/i)
    // The public queue display is the one screen an unauthenticated visitor sees, and it shows this name.
    for (const raw of ['<script>alert(1)</script>', 'Clinic <b>A</b>', 'Clinic"s', 'Clinic{x}', 'Clinic\\x', 'Clinic|x']) {
      expect(parseServiceName(raw).error, raw).toBeTruthy()
    }
  })
})

/**
 * Source contract. Walk-in patients are created by reception, and the row that action writes is an ordinary
 * patient profile — indistinguishable afterwards from a self-registered one. It was previously the only path
 * into that table that checked nothing but "not empty", which made it the loose door: a rule enforced on
 * /register but not here applies only to patients who type their own details.
 */
test.describe('every path that writes a name or phone uses the shared rules', () => {
  const ROOT = path.resolve(__dirname, '..')
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

  test('createWalkinPatient validates the name and phone it is given', () => {
    const src = read('app/actions/reception.ts')
    expect(src).toContain("from '@/lib/profileValidation'")
    expect(src).toContain('parseStaffName(String(formData.get(\'full_name\') ?? \'\'))')
    expect(src).toContain('parsePhone(String(formData.get(\'phone\') ?? \'\'))')
    // The validated values are what reach the database, not the raw form input.
    expect(src).toContain('p_full_name: name.value as string')
    expect(src).toContain('p_phone: phone.value ?? undefined')
  })

  test('no action still passes a raw, only-trimmed name or phone straight to the database', () => {
    for (const rel of ['app/actions/reception.ts', 'app/actions/receptionProfile.ts', 'app/actions/auth.ts']) {
      const src = read(rel)
      expect(src, rel).not.toMatch(/p_full_name:\s*String\(/)
      expect(src, rel).not.toMatch(/p_phone:\s*String\(/)
    }
  })

  test('both email entry points normalise the address they compare or store', () => {
    const auth = read('app/actions/auth.ts')
    // Sign-in lower-cases but deliberately does not shape-check: on a sign-in form the only safe answer to a
    // malformed address is the same one every wrong credential gets.
    expect(auth).toContain(".trim().toLowerCase()")
    // Password reset does shape-check, because it has no password to be wrong and would otherwise fail silently.
    expect(auth).toContain('parseEmail(String(formData.get(\'email\') ?? \'\'))')
    expect(read('lib/registrationValidation.ts')).toContain('parseEmail(input.email)')
    expect(read('lib/staffInvitationValidation.ts')).toContain('parseEmail(input.email)')
  })
})
