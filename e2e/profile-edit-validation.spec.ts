import { test, expect } from '@playwright/test'
import {
  profileEditInputFrom,
  validateProfileEdit,
  type ProfileEditCurrent,
  type ProfileEditInput,
} from '../lib/profileEditValidation'
import { parseOptionalPassportNumber, parseOptionalSouthAfricanId } from '../lib/profileValidation'

// Pure logic — no browser, no network, no database. Patient Profile Settings aligns with PR #45's stricter
// South African ID / Passport rules without ever punishing an existing legacy profile for it.

const TODAY = '2026-11-02'
const SA_ID = '8001015009087' // Luhn-valid, 1 Jan 1980
const SA_ID_BAD_CHECKSUM = '8001015009088'

const BASE: ProfileEditInput = {
  full_name: 'Thabo Mokoena',
  phone: '',
  date_of_birth: '',
  document_type: 'sa_id',
  id_number: '',
}
const EMPTY_CURRENT: ProfileEditCurrent = { id_number: null, date_of_birth: null }

test.describe('parseOptionalSouthAfricanId / parseOptionalPassportNumber', () => {
  test('empty is allowed — these are optional, unlike registration’s required versions', () => {
    expect(parseOptionalSouthAfricanId('')).toEqual({ value: null })
    expect(parseOptionalSouthAfricanId('   ')).toEqual({ value: null })
    expect(parseOptionalPassportNumber('')).toEqual({ value: null })
  })
  test('present, it is held to the exact same rule as registration — no looser path to the same column', () => {
    expect(parseOptionalSouthAfricanId(SA_ID)).toEqual({ value: SA_ID })
    expect(parseOptionalSouthAfricanId(SA_ID_BAD_CHECKSUM).error).toMatch(/isn.t valid/i)
    expect(parseOptionalSouthAfricanId('800101 5009 087').error).toMatch(/13 digits/i) // not cleaned, same as registration
    expect(parseOptionalPassportNumber('a1234567')).toEqual({ value: 'A1234567' })
    expect(parseOptionalPassportNumber('AB-123456').error).toMatch(/6–20 letters or digits/i)
    expect(parseOptionalPassportNumber(SA_ID_BAD_CHECKSUM).error).toMatch(/looks like a south african id/i)
  })
})

test.describe('validateProfileEdit: a fresh value is held to the full rule', () => {
  test('a complete, valid edit with no prior data succeeds', () => {
    const r = validateProfileEdit(
      { ...BASE, phone: '082 123 4567', date_of_birth: '1980-01-01', id_number: SA_ID },
      EMPTY_CURRENT,
      TODAY,
    )
    expect(r.errors).toEqual({})
    expect(r.values).toEqual({ fullName: 'Thabo Mokoena', phone: '+27 82 123 4567', dateOfBirth: '1980-01-01', idNumber: SA_ID })
  })
  test('full name is always required, phone always validated fresh, regardless of document type', () => {
    expect(validateProfileEdit({ ...BASE, full_name: '' }, EMPTY_CURRENT, TODAY).errors.full_name).toMatch(/enter your full name/i)
    expect(validateProfileEdit({ ...BASE, phone: 'abc' }, EMPTY_CURRENT, TODAY).errors.phone).toBeTruthy()
  })
  test('a brand new South African ID must be exactly 13 digits and pass its checksum', () => {
    expect(validateProfileEdit({ ...BASE, id_number: '12345' }, EMPTY_CURRENT, TODAY).errors.id_number).toMatch(/13 digits/i)
    expect(validateProfileEdit({ ...BASE, id_number: SA_ID_BAD_CHECKSUM }, EMPTY_CURRENT, TODAY).errors.id_number).toMatch(/isn.t valid/i)
    expect(validateProfileEdit({ ...BASE, id_number: SA_ID }, EMPTY_CURRENT, TODAY).errors.id_number).toBeUndefined()
  })
  test('a brand new passport follows the passport rule, and still can’t be a malformed South African ID in disguise', () => {
    const passport = { ...BASE, document_type: 'passport' } as const
    expect(validateProfileEdit({ ...passport, id_number: 'A1234567' }, EMPTY_CURRENT, TODAY).errors.id_number).toBeUndefined()
    expect(validateProfileEdit({ ...passport, id_number: SA_ID_BAD_CHECKSUM }, EMPTY_CURRENT, TODAY).errors.id_number).toMatch(/looks like a south african id/i)
  })
  test('a forged document_type can only tighten validation, never relax it', () => {
    for (const forged of ['', 'PASSPORT', 'anything']) {
      const r = validateProfileEdit({ ...BASE, document_type: forged, id_number: 'A1234567' }, EMPTY_CURRENT, TODAY)
      expect(r.errors.id_number, forged).toMatch(/south african id/i)
    }
  })
})

test.describe('validateProfileEdit: an untouched legacy value is never re-validated', () => {
  test('a legacy ID that would fail today’s rule (wrong length, no checksum ever run) is written back unchanged if the person never touches it', () => {
    const legacy: ProfileEditCurrent = { id_number: 'AB-12', date_of_birth: null } // too short for the passport rule, has a dash
    const r = validateProfileEdit({ ...BASE, id_number: 'AB-12', phone: '082 123 4567' }, legacy, TODAY)
    expect(r.errors.id_number).toBeUndefined()
    expect(r.values?.idNumber).toBe('AB-12') // passed straight through, not reformatted or rejected
  })
  test('a legacy 13-digit value that never had its checksum checked is written back unchanged', () => {
    const legacy: ProfileEditCurrent = { id_number: SA_ID_BAD_CHECKSUM, date_of_birth: null }
    const r = validateProfileEdit({ ...BASE, id_number: SA_ID_BAD_CHECKSUM, full_name: 'Thabo M' }, legacy, TODAY)
    expect(r.errors.id_number).toBeUndefined()
    expect(r.values?.idNumber).toBe(SA_ID_BAD_CHECKSUM)
  })
  test('a legacy date of birth outside today’s range is written back unchanged', () => {
    const legacy: ProfileEditCurrent = { id_number: null, date_of_birth: '1850-01-01' } // before the 1900 floor
    const r = validateProfileEdit({ ...BASE, date_of_birth: '1850-01-01' }, legacy, TODAY)
    expect(r.errors.date_of_birth).toBeUndefined()
    expect(r.values?.dateOfBirth).toBe('1850-01-01')
  })
  test('changing one field does not re-trigger validation on the other, untouched one', () => {
    const legacy: ProfileEditCurrent = { id_number: 'AB-12', date_of_birth: null }
    // phone changes; id_number is resubmitted exactly as it already was
    const r = validateProfileEdit({ ...BASE, id_number: 'AB-12', phone: '0821234567' }, legacy, TODAY)
    expect(r.errors).toEqual({})
  })
  test('once the person actually changes a legacy value, the full rule applies to the NEW value', () => {
    const legacy: ProfileEditCurrent = { id_number: 'AB-12', date_of_birth: null }
    // a different value, still under the default South African ID rule (document_type is 'sa_id' unless the
    // person explicitly chose Passport) — not 13 digits, so it is refused on length, not written through.
    const r = validateProfileEdit({ ...BASE, id_number: 'AB-999999' }, legacy, TODAY)
    expect(r.errors.id_number).toMatch(/13 digits/i)
    expect(r.values).toBeNull()

    // the same new value, this time under Passport, still fails — but on the passport rule (the dash), since
    // this is a genuinely new value being validated fresh, not the untouched legacy one.
    const asPassport = validateProfileEdit({ ...BASE, id_number: 'AB-999999', document_type: 'passport' }, legacy, TODAY)
    expect(asPassport.errors.id_number).toMatch(/6–20 letters or digits/i)
  })
})

test.describe('validateProfileEdit: clearing an existing value is refused, not treated as a deletion', () => {
  test('clearing an existing ID/passport number is rejected; the stored value is kept, not nulled', () => {
    const current: ProfileEditCurrent = { id_number: SA_ID, date_of_birth: null }
    const r = validateProfileEdit({ ...BASE, id_number: '' }, current, TODAY)
    expect(r.errors.id_number).toMatch(/can.t be cleared/i)
    expect(r.values).toBeNull()
  })
  test('clearing an existing date of birth is rejected the same way', () => {
    const current: ProfileEditCurrent = { id_number: null, date_of_birth: '1980-01-01' }
    const r = validateProfileEdit({ ...BASE, date_of_birth: '' }, current, TODAY)
    expect(r.errors.date_of_birth).toMatch(/can.t be cleared/i)
  })
  test('leaving an already-empty field empty is fine — there is nothing to delete', () => {
    const r = validateProfileEdit({ ...BASE, id_number: '', date_of_birth: '' }, EMPTY_CURRENT, TODAY)
    expect(r.errors.id_number).toBeUndefined()
    expect(r.errors.date_of_birth).toBeUndefined()
    expect(r.values).toEqual({ fullName: 'Thabo Mokoena', phone: null, dateOfBirth: null, idNumber: null })
  })
  test('replacing an existing value with a new valid one is a normal edit, not a deletion', () => {
    const current: ProfileEditCurrent = { id_number: SA_ID, date_of_birth: '1980-01-01' }
    const r = validateProfileEdit(
      { ...BASE, id_number: 'A1234567', document_type: 'passport', date_of_birth: '1980-01-01' },
      current,
      TODAY,
    )
    expect(r.errors.id_number).toBeUndefined()
    expect(r.values?.idNumber).toBe('A1234567')
  })
})

test.describe('validateProfileEdit: date of birth against the South African ID on file', () => {
  test('a newly entered date of birth that contradicts a newly entered, valid South African ID is refused', () => {
    const r = validateProfileEdit({ ...BASE, id_number: SA_ID, date_of_birth: '1999-12-31' }, EMPTY_CURRENT, TODAY)
    expect(r.errors.date_of_birth).toMatch(/encodes a birth date of/i)
    expect(r.errors.id_number).toBeUndefined()
  })
  test('a consistent pair succeeds', () => {
    const r = validateProfileEdit({ ...BASE, id_number: SA_ID, date_of_birth: '1980-01-01' }, EMPTY_CURRENT, TODAY)
    expect(r.errors).toEqual({})
  })
  test('the cross-check never fires against a legacy ID that was never checksum-validated', () => {
    const legacy: ProfileEditCurrent = { id_number: SA_ID_BAD_CHECKSUM, date_of_birth: null } // Luhn-invalid, so not a "valid" SA ID structurally
    const r = validateProfileEdit({ ...BASE, id_number: SA_ID_BAD_CHECKSUM, date_of_birth: '1999-12-31' }, legacy, TODAY)
    expect(r.errors.date_of_birth).toBeUndefined()
  })
  /**
   * Both columns are nullable, so half the pair could previously be saved on its own — and an ID saved with the
   * date-of-birth field left blank is an ID whose encoded birth date nothing ever has to agree with. The field
   * that would have contradicted it is exactly the field omitted, which is why this is required in both
   * directions rather than only "a date of birth needs an ID".
   */
  test('half the pair is refused: entering one of the two now requires the other', () => {
    const idOnly = validateProfileEdit({ ...BASE, id_number: SA_ID, date_of_birth: '' }, EMPTY_CURRENT, TODAY)
    expect(idOnly.errors.date_of_birth).toMatch(/date of birth too/i)
    expect(idOnly.values).toBeNull()

    const dobOnly = validateProfileEdit({ ...BASE, id_number: '', date_of_birth: '1980-01-01' }, EMPTY_CURRENT, TODAY)
    expect(dobOnly.errors.id_number).toMatch(/ID or passport number too/i)
    expect(dobOnly.values).toBeNull()

    // A passport counts as the other half just as an ID does — it encodes no date, but it is still a document.
    const passportPair = validateProfileEdit(
      { ...BASE, id_number: 'A1234567', document_type: 'passport', date_of_birth: '1980-01-01' },
      EMPTY_CURRENT,
      TODAY,
    )
    expect(passportPair.errors).toEqual({})
  })

  test('a legacy profile holding only one of the pair is not made to supply the other to edit something else', () => {
    // The requirement is gated on actually changing one of the two. A profile saved before the pairing rule
    // existed can still change its phone number or its name without being asked for the missing field.
    const idWithoutDob: ProfileEditCurrent = { id_number: SA_ID, date_of_birth: null }
    const r = validateProfileEdit({ ...BASE, id_number: SA_ID, date_of_birth: '', phone: '082 123 4567' }, idWithoutDob, TODAY)
    expect(r.errors).toEqual({})
    expect(r.values).toEqual({ fullName: 'Thabo Mokoena', phone: '+27 82 123 4567', dateOfBirth: null, idNumber: SA_ID })

    const dobWithoutId: ProfileEditCurrent = { id_number: null, date_of_birth: '1980-01-01' }
    const r2 = validateProfileEdit(
      { ...BASE, id_number: '', date_of_birth: '1980-01-01', full_name: 'Thabo Jacob Mokoena' },
      dobWithoutId,
      TODAY,
    )
    expect(r2.errors).toEqual({})
    expect(r2.values?.fullName).toBe('Thabo Jacob Mokoena')
  })
  test('changing only the date of birth still checks it against an unchanged, valid stored South African ID', () => {
    const current: ProfileEditCurrent = { id_number: SA_ID, date_of_birth: '1980-01-01' }
    const r = validateProfileEdit({ ...BASE, id_number: SA_ID, date_of_birth: '1981-01-01' }, current, TODAY)
    expect(r.errors.date_of_birth).toMatch(/encodes a birth date of/i)
  })
  test('changing only the South African ID still checks the new one against an unchanged date of birth', () => {
    // SA_ID means 1 Jan 1980; a DOB of 1981 contradicts it.
    const current: ProfileEditCurrent = { id_number: 'A1234567', date_of_birth: '1981-01-01' }
    const r = validateProfileEdit({ ...BASE, id_number: SA_ID, date_of_birth: '1981-01-01' }, current, TODAY)
    expect(r.errors.date_of_birth).toMatch(/encodes a birth date of/i)
  })
  test('a legacy profile with a valid South African ID and a mismatched stored date of birth is preserved exactly when the person changes only their phone number', () => {
    // The pair predates this cross-check (or was never consistent to begin with) — SA_ID means 1 Jan 1980,
    // but the stored date of birth is a different, equally real date. Neither field is being touched.
    const current: ProfileEditCurrent = { id_number: SA_ID, date_of_birth: '1999-12-31' }
    const r = validateProfileEdit({ ...BASE, id_number: SA_ID, date_of_birth: '1999-12-31', phone: '082 123 4567' }, current, TODAY)
    expect(r.errors).toEqual({})
    expect(r.values).toEqual({ fullName: 'Thabo Mokoena', phone: '+27 82 123 4567', dateOfBirth: '1999-12-31', idNumber: SA_ID })
  })
  test('the same inconsistent legacy pair is rejected the moment either side is actually changed', () => {
    const current: ProfileEditCurrent = { id_number: SA_ID, date_of_birth: '1999-12-31' }
    // date of birth changed (to a different, still-contradicting date); ID left exactly as it was
    const dobChanged = validateProfileEdit({ ...BASE, id_number: SA_ID, date_of_birth: '2000-01-01' }, current, TODAY)
    expect(dobChanged.errors.date_of_birth).toMatch(/encodes a birth date of/i)
    // ID changed to a different, still-valid-shaped but inconsistent SA ID; date of birth left exactly as it was
    const idChanged = validateProfileEdit({ ...BASE, id_number: '0506155012087', date_of_birth: '1999-12-31' }, current, TODAY)
    expect(idChanged.errors.date_of_birth).toMatch(/encodes a birth date of/i)
  })
})

test.describe('profileEditInputFrom', () => {
  test('reads all five fields off FormData, defaulting anything absent to an empty string', () => {
    const data = new FormData()
    data.set('full_name', 'Thabo Mokoena')
    data.set('phone', '082 123 4567')
    data.set('date_of_birth', '1980-01-01')
    data.set('document_type', 'passport')
    data.set('id_number', 'A1234567')
    expect(profileEditInputFrom(data)).toEqual({
      full_name: 'Thabo Mokoena',
      phone: '082 123 4567',
      date_of_birth: '1980-01-01',
      document_type: 'passport',
      id_number: 'A1234567',
    })
    expect(profileEditInputFrom(new FormData())).toEqual({
      full_name: '',
      phone: '',
      date_of_birth: '',
      document_type: '',
      id_number: '',
    })
  })
})
