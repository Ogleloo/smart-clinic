import { test, expect } from '@playwright/test'
import { parsePhone, parseStaffName } from '../lib/profileValidation'
import { AVATAR_MAX_BYTES, checkAvatarFile } from '../lib/avatarFile'

// Pure logic — no browser, no network, no database.

test.describe('parseStaffName', () => {
  test('trims and collapses whitespace', () => {
    expect(parseStaffName('  Noluthando   Dlamini ')).toEqual({ value: 'Noluthando Dlamini' })
  })
  test('rejects empty, one-character, over-long and control-character names', () => {
    expect(parseStaffName('   ').error).toMatch(/enter your full name/i)
    expect(parseStaffName('A').error).toMatch(/at least 2/i)
    expect(parseStaffName('x'.repeat(121)).error).toMatch(/too long/i)
    expect(parseStaffName('Ann\u0007e').error).toMatch(/aren.t allowed/i)
    expect(parseStaffName('x'.repeat(120)).error).toBeUndefined()
  })
  test('a newline collapses to a space rather than surviving into the stored name', () => {
    expect(parseStaffName('Ann\nMarie')).toEqual({ value: 'Ann Marie' })
  })
})

test.describe('parsePhone', () => {
  test('empty is allowed (phone is optional)', () => {
    expect(parsePhone('')).toEqual({ value: null })
    expect(parsePhone('   ')).toEqual({ value: null })
  })
  test('accepts the South African formats the clinic already stores, normalised to +27 xx xxx xxxx', () => {
    for (const raw of ['082 123 4567', '0821234567', '(082) 123-4567', '+27 82 123 4567', '+27821234567', '27821234567', '035 123 4567']) {
      expect(parsePhone(raw).error, raw).toBeUndefined()
      expect(parsePhone(raw).value, raw).toMatch(/^\+27 [1-9]\d \d{3} \d{4}$/)
    }
    expect(parsePhone('082 123 4567').value).toBe('+27 82 123 4567')
    expect(parsePhone('+27 35 123 4567').value).toBe('+27 35 123 4567')
    expect(parsePhone('0821234567').value).toBe(parsePhone('+27 82 123 4567').value)
  })
  test('rejects letters, wrong lengths, other countries and malformed prefixes', () => {
    for (const raw of ['abc', '12345', '082 123 456', '082 123 45678', '+44 20 7946 0958', '+27 02 123 4567', '++27821234567', '082-123-4567x', '0']) {
      expect(parsePhone(raw).error, raw).toBeTruthy()
      expect(parsePhone(raw).value, raw).toBeNull()
    }
  })
})

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]
const file = (bytes: number[], name: string, type: string, pad = 0) =>
  new File([new Uint8Array([...bytes, ...new Array(pad).fill(0)])], name, { type })

test.describe('checkAvatarFile', () => {
  test('accepts a real PNG and a real JPEG', async () => {
    expect(await checkAvatarFile(file(PNG_HEAD, 'me.png', 'image/png'))).toEqual({ ok: true, type: 'image/png' })
    expect(await checkAvatarFile(file(JPEG_HEAD, 'me.JPG', 'image/jpeg'))).toEqual({ ok: true, type: 'image/jpeg' })
  })
  test('rejects a file over 5 MB, and accepts exactly 5 MB', async () => {
    const over = await checkAvatarFile(file(PNG_HEAD, 'big.png', 'image/png', AVATAR_MAX_BYTES))
    expect(over).toEqual({ ok: false, error: 'That photo is larger than 5 MB.' })
    const exact = await checkAvatarFile(file(PNG_HEAD, 'edge.png', 'image/png', AVATAR_MAX_BYTES - PNG_HEAD.length))
    expect(exact.ok).toBe(true)
  })
  test('rejects wrong extensions and MIME types', async () => {
    expect((await checkAvatarFile(file(PNG_HEAD, 'me.gif', 'image/png'))).ok).toBe(false)
    expect((await checkAvatarFile(file(PNG_HEAD, 'me.png', 'image/gif'))).ok).toBe(false)
    expect((await checkAvatarFile(file(PNG_HEAD, 'me.svg', 'image/svg+xml'))).ok).toBe(false)
  })
  test('rejects a file whose bytes are not an image, whatever its name and MIME type claim', async () => {
    const exe = [0x4d, 0x5a, 0x90, 0, 0x03, 0, 0, 0] // "MZ" Windows executable
    expect(await checkAvatarFile(file(exe, 'me.png', 'image/png'))).toEqual({ ok: false, error: 'That file isn’t a real JPG or PNG image.' })
    const html = Array.from('<script>alert(1)</script>').map((c) => c.charCodeAt(0))
    expect((await checkAvatarFile(file(html, 'me.jpg', 'image/jpeg'))).ok).toBe(false)
  })
  test('rejects a JPEG presented as a PNG (type must match contents), and an empty file', async () => {
    expect(await checkAvatarFile(file(JPEG_HEAD, 'me.png', 'image/png'))).toEqual({ ok: false, error: 'That file’s type doesn’t match its contents.' })
    expect(await checkAvatarFile(new File([], 'me.png', { type: 'image/png' }))).toEqual({ ok: false, error: 'That file is empty.' })
  })
})
