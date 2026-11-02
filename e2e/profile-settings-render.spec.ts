import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'

/**
 * Patient Profile Settings — the real ProfileSettingsForm / QuickActions components, rendered to static HTML
 * (through tsx, e2e/support/render-profile-settings.tsx) and styled with the app's real compiled Tailwind CSS.
 * Offline: no browser session, no network, no database, no Supabase client — the page itself needs a signed-in
 * patient and can't be opened offline (see profile-completeness.spec.ts for the same constraint on /profile).
 *
 * Covers: initial markup and copy, the disabled photo controls and their explanation, read-only fields, the
 * document-type default, and layout at 1440/768/390/320. Does NOT cover: the Avatar Preview / Photo-and-initials
 * cards (static markup owned by app/(patient)/profile/settings/page.tsx, not this component) or any interactive
 * behaviour (document-type switching, live error correction, the password accordion opening) — those need a
 * live browser event loop, which a static render can't exercise.
 */

type Rendered = {
  states: Record<
    'complete' | 'missingIdentity' | 'noClinic' | 'legacyPassportShaped' | 'quickActions' | 'quickActionsPasswordOpen',
    string
  >
  css: string
}
let rendered: Rendered

test.beforeAll(() => {
  const out = execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'e2e/support/render-profile-settings.tsx'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  rendered = JSON.parse(out)
})

test.describe('ProfileSettingsForm markup (real component)', () => {
  test('no validation error is shown on first render — nothing has been submitted yet', () => {
    for (const html of Object.values(rendered.states)) {
      expect(html).not.toMatch(/role="alert"/)
    }
  })

  test('Upload and Remove Photo are disabled and say why, honestly', () => {
    const html = rendered.states.complete
    expect(html).toMatch(/<button type="button" disabled="" class="[^"]*">Upload \/ Change Photo<\/button>/)
    expect(html).toMatch(/<button type="button" disabled="" class="[^"]*">Remove Photo<\/button>/)
    expect(html).toContain('JPG or PNG, max 5 MB.')
    expect(html).toContain('Photo upload isn’t available yet. Your initials are shown instead.')
  })

  test('role, clinic and email are read-only and marked as such for assistive tech', () => {
    const html = rendered.states.complete
    for (const name of ['role_readonly', 'clinic_readonly', 'email_readonly']) {
      const tag = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? ''
      expect(tag, name).toContain('readOnly=""')
      expect(tag, name).toContain('disabled=""')
      expect(tag, name).toContain('aria-readonly="true"')
    }
    expect(html).toContain('value="Patient"')
    expect(html).toContain('Your email is your login and can’t be changed here.')
  })

  test('clinic shows an em dash placeholder, not an empty box, when the patient has none on file', () => {
    const html = rendered.states.noClinic
    const tag = html.match(/<input[^>]*name="clinic_readonly"[^>]*>/)?.[0] ?? ''
    expect(tag).toContain('placeholder="—"')
    expect(tag).not.toMatch(/value="[^"]+"/)
  })

  test('South African ID is the default document type for a 13-digit (or empty) value', () => {
    const html = rendered.states.complete
    const fieldset = html.match(/<fieldset[\s\S]*?<\/fieldset>/)![0]
    const saIdRadio = fieldset.match(/<input type="radio"[^>]*value="sa_id"[^>]*>/)![0]
    const passportRadio = fieldset.match(/<input type="radio"[^>]*value="passport"[^>]*>/)![0]
    expect(saIdRadio).toContain('checked=""')
    expect(passportRadio).not.toContain('checked=""')
    expect(html).toContain('South African ID number')
    expect(html).not.toContain('Passport number') // the passport field isn't rendered while SA ID is selected
  })

  test('a legacy value that isn’t 13 digits starts in Passport — not re-validated, just displayed where the digit filter can’t mangle it', () => {
    const html = rendered.states.legacyPassportShaped
    const fieldset = html.match(/<fieldset[\s\S]*?<\/fieldset>/)![0]
    const passportRadio = fieldset.match(/<input type="radio"[^>]*value="passport"[^>]*>/)![0]
    expect(passportRadio).toContain('checked=""')
    expect(html).toContain('Passport number')
    expect(html).not.toContain('South African ID number')
    const idTag = html.match(/<input[^>]*name="id_number"[^>]*>/)?.[0] ?? ''
    expect(idTag).toContain('value="AB-12"') // shown exactly as stored — not stripped to digits, not an error
    expect(html).not.toMatch(/role="alert"/)
  })

  test('the South African ID field carries a live 0/13–13/13 digit counter as its helper', () => {
    expect(rendered.states.complete).toContain('13/13 digits')
  })

  test('with no date of birth or ID on file, both optional fields are empty and say so — no premature "0/13" counter before the person has started typing', () => {
    const html = rendered.states.missingIdentity
    const idTag = html.match(/<input[^>]*name="id_number"[^>]*>/)?.[0] ?? ''
    const dobTag = html.match(/<input[^>]*name="date_of_birth"[^>]*>/)?.[0] ?? ''
    expect(idTag).not.toMatch(/value="[^"]+"/)
    expect(dobTag).not.toMatch(/value="[^"]+"/)
    expect(html).not.toContain('/13 digits')
    expect(html.match(/Optional\./g)?.length ?? 0).toBe(2) // both the ID and date of birth helpers
  })

  test('Save Changes and Cancel are both present, Cancel links back to /profile', () => {
    const html = rendered.states.complete
    expect(html).toMatch(/<button type="submit"[^>]*>Save Changes<\/button>/)
    const cancel = html.match(/<a [^>]*>Cancel<\/a>/)?.[0] ?? '' // attribute order varies; check both separately
    expect(cancel).toContain('href="/profile"')
  })
})

test.describe('QuickActions markup (real component)', () => {
  test('Change Password starts collapsed; Update password (not "Change password") is the panel’s own submit, so the two never share an accessible name', () => {
    const html = rendered.states.quickActions
    const toggle = html.match(/<button type="button"[^>]*aria-expanded="false"[^>]*>[\s\S]*?Change Password[\s\S]*?<\/button>/)
    expect(toggle).toBeTruthy()
    expect(html).toContain('hidden=""') // the panel starts hidden
    expect(html).not.toContain('>Update password<') // not rendered until the panel opens client-side
  })

  test('Sign Out is a real form, not a link pretending to be one', () => {
    const html = rendered.states.quickActions
    expect(html).toMatch(/<form[^>]*><button type="submit"[^>]*>[\s\S]*?Sign Out[\s\S]*?<\/button><\/form>/)
  })

  test('initialOpenPassword renders the panel already expanded, with the real password form inside it — not merely a page that could open it', () => {
    const html = rendered.states.quickActionsPasswordOpen
    const toggle = html.match(/<button type="button"[^>]*aria-expanded="true"[^>]*>[\s\S]*?Change Password[\s\S]*?<\/button>/)
    expect(toggle).toBeTruthy()
    expect(html).not.toContain('hidden=""') // the panel is not hidden
    // The real ChangePasswordForm, not a placeholder: its own labelled fields and submit are present.
    expect(html).toMatch(/<form aria-label="Change password"/)
    expect(html).toContain('Current password')
    expect(html).toContain('New password')
    expect(html).toContain('Confirm new password')
    expect(html).toMatch(/<button type="submit"[^>]*>Update password<\/button>/)
    // Current password is the field a user opening this shortcut needs fastest — it carries the keyboard focus.
    const currentPasswordInput = html.match(/<input[^>]*name="current_password"[^>]*>/)?.[0] ?? ''
    expect(currentPasswordInput).toContain('autofocus=""')
  })
})

test.describe('ProfileSettingsForm layout (real component + real compiled CSS)', () => {
  const page$ = (html: string) =>
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${rendered.css}</style></head>` +
    `<body><div class="theme-patient min-h-dvh"><main class="mx-auto flex w-full max-w-[1176px] flex-col gap-6 px-4 py-6 md:px-9 md:py-9">` +
    `<div class="flex flex-col gap-5 rounded-lg border border-border bg-surface p-6">${html}</div></main></div></body></html>`

  for (const width of [1440, 768, 390, 320]) {
    test(`${width}px: no sideways scrolling; every control stays on screen`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1400 })
      await page.setContent(page$(rendered.states.complete))

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)

      for (const name of ['Upload / Change Photo', 'Remove Photo', 'Save Changes']) {
        const box = await page.getByRole('button', { name, exact: true }).boundingBox()
        expect(box, name).not.toBeNull()
        expect(box!.x, name).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width, name).toBeLessThanOrEqual(width + 1)
      }
    })
  }

  test('every disabled button and the radio labels still clear a 44px touch target', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1400 })
    await page.setContent(page$(rendered.states.complete))
    for (const name of ['Upload / Change Photo', 'Remove Photo', 'Save Changes']) {
      const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!
      expect(box.height, name).toBeGreaterThanOrEqual(44)
    }
    for (const name of ['South African ID', 'Passport']) {
      const box = (await page.getByText(name, { exact: true }).boundingBox())!
      expect(box.height, name).toBeGreaterThanOrEqual(44)
    }
  })

  test('read-only fields meet the same 4.5:1 text contrast as editable ones', async ({ page }) => {
    await page.setContent(page$(rendered.states.complete))
    const ratio = await page.evaluate(() => {
      const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
      }
      const input = document.querySelector('input[name="role_readonly"]')!
      const bg = parse(getComputedStyle(input).backgroundColor)
      const fg = parse(getComputedStyle(input).color)
      const [a, b] = [lum(bg), lum(fg)].sort((x, y) => y - x)
      return (a + 0.05) / (b + 0.05)
    })
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })
})
