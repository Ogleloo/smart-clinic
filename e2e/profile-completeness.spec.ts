import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describeMissingFields, missingProfileFields } from '../lib/profileCompleteness'

/**
 * Patient Profile — "Complete your profile" notice. Offline: no browser session, no network, no database.
 *
 *  - pure logic for which fields count as missing;
 *  - the REAL component rendered to HTML (through tsx) for complete / incomplete profiles;
 *  - that HTML styled with the app's REAL compiled Tailwind CSS and laid out in a browser at phone and desktop
 *    widths (the profile page itself needs a signed-in patient, so it can't be opened offline);
 *  - source-level contracts: the page passes only field names, and auth.ts no longer carries the stale comments.
 *
 * NOT covered here: the live page with a real signed-in patient (needs the shared database), and the settings
 * form actually saving the details (the form already existed and is unchanged).
 */

const SECRET_ID = '8001015009087'

test.describe('missingProfileFields', () => {
  test('complete profile: nothing missing', () => {
    expect(missingProfileFields({ date_of_birth: '1980-01-01', id_number: SECRET_ID })).toEqual([])
    expect(missingProfileFields({ date_of_birth: '2005-06-15', id_number: 'A1234567' })).toEqual([])
  })
  test('either one missing, or both', () => {
    expect(missingProfileFields({ date_of_birth: null, id_number: SECRET_ID })).toEqual(['date_of_birth'])
    expect(missingProfileFields({ date_of_birth: '1980-01-01', id_number: null })).toEqual(['id_number'])
    expect(missingProfileFields({ date_of_birth: null, id_number: null })).toEqual(['date_of_birth', 'id_number'])
  })
  test('empty or whitespace-only values count as missing', () => {
    expect(missingProfileFields({ date_of_birth: '', id_number: '   ' })).toEqual(['date_of_birth', 'id_number'])
    expect(missingProfileFields({ date_of_birth: ' ', id_number: SECRET_ID })).toEqual(['date_of_birth'])
  })
  test('the result contains field names only, never a value', () => {
    expect(JSON.stringify(missingProfileFields({ date_of_birth: null, id_number: null }))).not.toMatch(/\d/)
    expect(describeMissingFields(['date_of_birth'])).toBe('date of birth')
    expect(describeMissingFields(['id_number'])).toBe('ID or passport number')
    expect(describeMissingFields(['date_of_birth', 'id_number'])).toBe('date of birth and ID or passport number')
  })
})

type Rendered = { states: Record<'complete' | 'missingBoth' | 'missingDob' | 'missingId', string>; css: string }
let rendered: Rendered

test.beforeAll(() => {
  const out = execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'e2e/support/render-profile-completion.tsx'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  rendered = JSON.parse(out)
})

test.describe('ProfileCompletionNotice markup (real component)', () => {
  test('a complete profile renders nothing', () => {
    expect(rendered.states.complete).toBe('')
  })

  for (const [name, text] of [
    ['missingBoth', 'Your date of birth and ID or passport number are missing.'],
    ['missingDob', 'Your date of birth is missing.'],
    ['missingId', 'Your ID or passport number is missing.'],
  ] as const) {
    test(`${name}: names exactly what is missing, links to settings, says no new account is needed`, () => {
      const html = rendered.states[name]
      expect(html).toContain('Complete your profile')
      expect(html).toContain(text)
      expect(html).toMatch(/<a [^>]*href="\/profile\/settings"[^>]*>Complete profile<\/a>/)
      expect(html).toMatch(/already have an\s+account/i)
      expect(html).toMatch(/no need to register again/i)
    })
  }

  test('the ID or passport number is never in the notice, even when the profile holds one', () => {
    for (const html of Object.values(rendered.states)) {
      expect(html).not.toContain(SECRET_ID)
      expect(html).not.toMatch(/\d{6,}/)
    }
  })

  test('the region is labelled by its heading', () => {
    const html = rendered.states.missingBoth
    const labelledby = html.match(/<section[^>]*aria-labelledby="([^"]+)"/)?.[1]
    expect(labelledby).toBeTruthy()
    expect(html).toMatch(new RegExp(`<h2 id="${labelledby}"[^>]*>Complete your profile</h2>`))
    expect(html).toContain('aria-hidden="true"') // the icon is decorative
  })
})

test.describe('ProfileCompletionNotice layout (real component + real compiled CSS)', () => {
  const page$ = (html: string) =>
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${rendered.css}</style></head>` +
    `<body><div class="theme-patient min-h-dvh"><main class="mx-auto flex w-full max-w-[1176px] flex-col gap-6 px-4 py-6 md:px-9 md:py-9">` +
    `<h1>Profile</h1>${html}</main></div></body></html>`

  for (const width of [320, 360, 390, 768, 1280]) {
    test(`${width}px: no sideways scrolling; the link is a full-width, 44px+ touch target inside the card`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.setContent(page$(rendered.states.missingBoth))

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)

      const region = page.getByRole('region', { name: 'Complete your profile' })
      await expect(region).toBeVisible()
      const link = region.getByRole('link', { name: 'Complete profile' })
      await expect(link).toHaveAttribute('href', '/profile/settings')

      const r = (await region.boundingBox())!
      const l = (await link.boundingBox())!
      expect(l.height).toBeGreaterThanOrEqual(44)
      expect(l.x).toBeGreaterThanOrEqual(r.x)
      expect(l.x + l.width).toBeLessThanOrEqual(r.x + r.width)
      expect(r.width).toBeLessThanOrEqual(576 + 1) // max-w-xl, same column as the profile card
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.x + r.width).toBeLessThanOrEqual(width)
    })
  }

  test('heading level 2 under the page title; reachable and focusable by keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await page.setContent(page$(rendered.states.missingId))
    await expect(page.getByRole('heading', { level: 2, name: 'Complete your profile' })).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Complete profile' })).toBeFocused()
  })

  test('the notice text meets WCAG AA contrast (4.5:1) on its background', async ({ page }) => {
    await page.setContent(page$(rendered.states.missingBoth))
    const ratio = await page.evaluate(() => {
      const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
      }
      const region = document.querySelector('section')!
      const bg = parse(getComputedStyle(region).backgroundColor)
      const fg = parse(getComputedStyle(region.querySelector('p')!).color)
      const [a, b] = [lum(bg), lum(fg)].sort((x, y) => y - x)
      return (a + 0.05) / (b + 0.05)
    })
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  test('long text wraps rather than overflowing at 320px with browser text enlarged', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.setContent(page$(rendered.states.missingBoth).replace('<style>', '<style>html{font-size:20px}'))
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

test.describe('source contracts', () => {
  const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

  test('the Profile page passes only the missing-field names to the notice, and renders it before the profile card', () => {
    const src = read('app/(patient)/profile/page.tsx')
    expect(src).toContain('<ProfileCompletionNotice missing={missingProfileFields(profile)} />')
    expect(src.indexOf('<ProfileCompletionNotice')).toBeLessThan(src.indexOf('<section className="mx-auto'))
  })

  test('the notice component takes only field names and links to profile settings', () => {
    const src = read('components/profile/ProfileCompletionNotice.tsx')
    expect(src).toContain('{ missing }: { missing: MissingProfileField[] }')
    expect(src).not.toMatch(/id_number|date_of_birth/) // it names fields through lib/profileCompleteness only
    expect(src).toContain('href="/profile/settings"')
  })

  test('the profile settings page still exists and still edits both fields (what the notice links to)', () => {
    expect(read('app/(patient)/profile/settings/page.tsx')).toContain('date_of_birth')
    expect(read('components/profile/ProfileSettingsForm.tsx')).toMatch(/id_number/)
  })

  test('auth.ts no longer says Confirm Email is "currently off" nor that what is sent "is what is stored"', () => {
    const src = read('app/actions/auth.ts')
    expect(src).not.toMatch(/currently off/i)
    expect(src).not.toMatch(/what is sent is what is stored\./)
    expect(src).toMatch(/not verified live/)
  })

  test('sign-up behaviour is untouched: the same metadata keys are sent and the user is still sent to /verify', () => {
    const src = read('app/actions/auth.ts')
    expect(src).toMatch(/data: \{\s*full_name: fullName,[\s\S]*?phone: phone \?\? '',\s*date_of_birth: dateOfBirth,\s*id_number: idNumber,\s*\}/)
    expect(src).toContain('redirect(`/verify?email=${encodeURIComponent(email)}`)')
  })
})
