import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { existsSync, readFileSync, statSync } from 'node:fs'

/**
 * Patient V3 authentication experience — Welcome (Figma 22:39), Login (28:40), Registration (33:49) and
 * Verify account (45:68).
 *
 * OFFLINE: the pages are loaded from the offline dev server, whose Supabase settings point at a closed local
 * port, and every non-GET request the browser attempts is aborted and recorded. Nothing is ever submitted, so
 * no account, code or session is created. Field-level rules live in registration-validation.spec.ts; this spec
 * covers the V3 screens themselves and the authentication contracts they must not break.
 */

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const slice = (s: string, from: string, to: string) => s.slice(s.indexOf(from), s.indexOf(to))

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
  await page.waitForFunction(() => document.readyState === 'complete', undefined, { timeout: 90_000 })
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

const SCREENS = [
  ['/welcome', 'Welcome'],
  ['/login', 'Login'],
  ['/register', 'Registration'],
  ['/verify?email=someone%40example.com', 'Verify'],
] as const

// --------------------------------------------------------------------------------- routes and shared shell

test.describe('the four V3 screens exist and share one shell', () => {
  test.setTimeout(180_000)

  test('every screen has its own route file and renders a single main landmark and one h1', async ({ page, context }) => {
    await sealed(context)
    for (const f of [
      'app/(auth)/welcome/page.tsx',
      'app/(auth)/login/page.tsx',
      'app/(auth)/register/page.tsx',
      'app/(auth)/verify/page.tsx',
    ]) {
      expect(existsSync(f), f).toBe(true)
    }
    for (const [path] of SCREENS) {
      await visit(page, path)
      await expect(page.getByRole('main'), path).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 }), path).toHaveCount(1)
    }
  })

  test('the three card screens share the brand lockup, the clinic line and the washed backdrop', async ({ page, context }) => {
    await sealed(context)
    for (const path of ['/login', '/register', '/verify?email=someone%40example.com']) {
      await visit(page, path)
      await expect(page.getByText('Smart Clinic').first(), path).toBeVisible()
      await expect(page.getByText('Riverside Clinic').first(), path).toBeVisible()
      // the approved clinic photograph, not a Figma download
      const src = await page.locator('img').first().getAttribute('src')
      expect(decodeURIComponent(src ?? ''), path).toContain('/images/clinic/riverside-reception.webp')
    }
  })

  test('no screen references a temporary Figma asset URL, and the photograph it does use exists', () => {
    for (const f of [
      'components/auth/v3/AuthShell.tsx',
      'components/auth/v3/WelcomeView.tsx',
      'components/auth/v3/authStyles.ts',
      'components/auth/LoginForm.tsx',
      'components/auth/VerifyForm.tsx',
      'app/(auth)/register/page.tsx',
      'app/(auth)/login/page.tsx',
      'app/(auth)/welcome/page.tsx',
    ]) {
      expect(read(f), f).not.toMatch(/figma\.com\/api|assetPathPrefix/)
    }
    expect(existsSync('public/images/clinic/riverside-reception.webp')).toBe(true)
    expect(statSync('public/images/clinic/riverside-reception.webp').size).toBeGreaterThan(1000)
  })

  for (const [path, name] of SCREENS) {
    for (const width of [1440, 768, 390, 320]) {
      test(`${name} at ${width}px: no sideways scrolling`, async ({ page, context }) => {
        await sealed(context)
        await page.setViewportSize({ width, height: 900 })
        await visit(page, path)
        expect(await overflow(page)).toBeLessThanOrEqual(0)
      })
    }
  }

  test('every screen keeps 44px+ touch targets for its links and buttons', async ({ page, context }) => {
    await sealed(context)
    for (const [path, name] of SCREENS) {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 })
        await visit(page, path)
        const small = await page.evaluate(() =>
          [...document.querySelectorAll('main a, main button')]
            .filter((el) => !el.closest('p') && !el.classList.contains('sr-only') && el.getBoundingClientRect().width > 0)
            .map((el) => ({ t: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 28), h: Math.round(el.getBoundingClientRect().height) }))
            .filter((x) => x.h < 44)
        )
        expect(small, `${name} @ ${width}`).toEqual([])
      }
    }
  })

  test('text on the cards meets 4.5:1, and the 40px headings clear the 3:1 large-text bar', async ({ page, context }) => {
    await sealed(context)
    for (const [path, name] of SCREENS) {
      await page.setViewportSize({ width: 1440, height: 900 })
      await visit(page, path)
      const worst = await page.evaluate(() => {
        const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
        const lum = ([r, g, b]: number[]) => {
          const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
          return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!)
        }
        const bgOf = (el: Element): string => {
          let e: Element | null = el
          while (e) {
            const c = getComputedStyle(e).backgroundColor
            if (c !== 'rgba(0, 0, 0, 0)' && !c.endsWith(', 0)')) return c
            e = e.parentElement
          }
          return 'rgb(245, 255, 253)'
        }
        const ratio = (fg: string, bg: string) => {
          const [a, b] = [lum(parse(fg)), lum(parse(bg))].sort((x, y) => y - x)
          return (a! + 0.05) / (b! + 0.05)
        }
        let min = 99
        let offender = ''
        for (const el of document.querySelectorAll('main a, main button, main p, main label, main h1, main span')) {
          const text = (el.textContent ?? '').trim()
          if (!text || el.children.length > 0) continue
          const cs = getComputedStyle(el)
          if (cs.visibility === 'hidden' || cs.display === 'none') continue
          const px = parseFloat(cs.fontSize)
          const bold = Number(cs.fontWeight) >= 700
          const large = px >= 24 || (px >= 18.66 && bold)
          const r = ratio(cs.color, bgOf(el)) / (large ? 3 / 4.5 : 1) // normalise large text to the 4.5 scale
          if (r < min) {
            min = r
            offender = `${text.slice(0, 30)} @ ${px}px`
          }
        }
        return { min, offender }
      })
      expect(worst.min, `${name}: ${worst.offender}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

// ------------------------------------------------------------------------------------------------ welcome

test.describe('Welcome entry (Figma 22:39)', () => {
  test.setTimeout(180_000)

  test('offers exactly the two authentication actions and links back to the public landing page', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/welcome')
    await expect(page.getByRole('heading', { level: 1, name: /Know where you stand/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Get started/ })).toHaveAttribute('href', '/register')
    await expect(page.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
    await expect(page.getByRole('link', { name: /Back to home/ })).toHaveAttribute('href', '/')
    expect(posts).toEqual([])
  })

  test('shows the three Figma feature items, and promises an estimate rather than accuracy', async ({ page, context }) => {
    await sealed(context)
    await visit(page, '/welcome')
    const body = await page.locator('main').innerText()
    for (const t of ['Live queue position', 'Honest wait estimates', 'In-app updates']) expect(body).toContain(t)
    expect(body).toContain('See your approximate wait')
    expect(body).not.toMatch(/accurate wait times/i)
    // Figma's hero line says "skip the queue"; booking does not bypass check-in.
    expect(body).not.toMatch(/skip the queue/i)
    expect(body).toContain('follow the queue')
  })

  test('it is not a second home page: no marketing sections, no public queue figures', async ({ page, context }) => {
    await sealed(context)
    await visit(page, '/welcome')
    const body = await page.locator('main').innerText()
    for (const t of ['Our services', 'How it works', 'Why Smart Clinic', 'Opening hours', 'waiting']) {
      expect(body, t).not.toContain(t)
    }
    expect(read('app/(auth)/welcome/page.tsx')).not.toMatch(/get_public_queue_display|clinic_hours/)
  })

  test('a signed-in visitor is sent to their own role home, and the log-in button still goes through /login', () => {
    const src = read('app/(auth)/welcome/page.tsx')
    expect(src).toContain("import { homeForRole } from '@/lib/auth/homeForRole'")
    expect(src).toContain('if (role) redirect(homeForRole(role))')
    expect(read('components/auth/v3/WelcomeView.tsx')).toContain('href="/login"')
  })
})

// -------------------------------------------------------------------------------------------------- login

test.describe('Login (Figma 28:40)', () => {
  test.setTimeout(180_000)

  test('the V3 card renders the heading, both fields with their icons and both secondary links', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/login')
    await expect(page.getByRole('heading', { level: 1, name: /Log in to see your queue/ })).toBeVisible()
    await expect(page.getByLabel('Email')).toHaveAttribute('autocomplete', 'email')
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'current-password')
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password')
    await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register')
    await expect(page.getByRole('button', { name: 'Log in' })).toBeEnabled()
    expect(posts).toEqual([])
  })

  test('each reason the app sends someone here still shows its own message', async ({ page, context }) => {
    await sealed(context)
    for (const [reason, text] of [
      ['idle', 'You were signed out because this device was inactive.'],
      ['link_invalid', 'That link is invalid or has expired.'],
      ['password_updated', 'Password updated. Log in with your new password.'],
    ] as const) {
      await visit(page, `/login?reason=${reason}`)
      await expect(page.getByText(text), reason).toBeVisible()
    }
  })

  test('the shared-device interstitial is intact: it is gated on a session with no reason, and is never bypassed', () => {
    const src = read('app/(auth)/login/page.tsx')
    expect(src).toContain('if (user && !reason) {')
    expect(src).toContain('Signed in as {fullName} — {roleLabel}')
    expect(src).toContain('On a shared device, sign out before leaving it unattended.')
    expect(src).toContain('Continue as {firstName}')
    expect(src).toContain('Sign out and use another account')
    // Recovery/confirmation links are still forwarded to the callback instead of being treated as a visit.
    expect(src).toContain('redirect(`/auth/callback?token_hash=')
    expect(src).toContain('redirect(`/auth/callback?code=')
    // Nothing auto-continues: the only way past it is one of the two deliberate controls.
    expect(src).not.toMatch(/redirect\(homeForRole/)
  })

  test('the login Server Action is unchanged: same vague error, same role routing, no password rule on sign-in', () => {
    const login = slice(read('app/actions/auth.ts'), 'export async function login', 'export async function logout')
    expect(login).toContain('signInWithPassword({ email, password })')
    // split so the assertion does not depend on whether the source escapes the apostrophe
    expect(login).toContain('Those details don')
    expect(login).toContain('t match an account.')
    expect(login).toContain("redirect(`/verify?email=${encodeURIComponent(email)}`)")
    expect(login).toContain('This account has been deactivated. Please contact the clinic.')
    expect(login).toContain('redirect(homeForRole(')
    expect(login).not.toContain('validatePassword')
  })
})

// ------------------------------------------------------------------------------------------- registration

test.describe('Registration (Figma 33:49)', () => {
  test.setTimeout(180_000)

  test('every field the account actually needs is present, including the two Figma leaves out', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/register')
    for (const [label, required] of [
      ['Full name', true],
      ['Email address', true],
      ['Mobile number (optional)', false],
      ['ID or passport number', true],
      ['Date of birth', true],
      ['Confirm password', true],
    ] as const) {
      const field = page.getByLabel(label, { exact: true })
      await expect(field, label).toHaveCount(1)
      if (required) await expect(field, label).toHaveAttribute('required', '')
      else await expect(field, label).not.toHaveAttribute('required', '')
    }
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('required', '')
    expect(posts).toEqual([])
  })

  test('the password helper states the rule the system actually enforces, not Figma’s', async ({ page, context }) => {
    await sealed(context)
    await visit(page, '/register')
    const body = await page.locator('main').innerText()
    expect(body).toContain('At least 8 characters, not counting spaces.')
    expect(body).not.toMatch(/mix of letters, numbers and a symbol/i)
  })

  test('there is no country-code control, because there is no country list behind one', async ({ page, context }) => {
    await sealed(context)
    await visit(page, '/register')
    await expect(page.locator('main select')).toHaveCount(0)
    await expect(page.getByLabel('Mobile number (optional)')).toHaveAttribute('placeholder', '+27 82 555 0134')
  })

  test('confirm password is enforced on the client and nothing is sent when it differs', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/register')
    await page.getByLabel('Full name').fill('Thabo Mokoena')
    await page.getByLabel('Email address').fill('thabo@example.com')
    await page.getByLabel('ID or passport number').fill('8001015009087')
    await page.getByLabel('Date of birth').fill('1980-01-01')
    await page.getByLabel('Password', { exact: true }).fill('longenough')
    await page.getByLabel('Confirm password').fill('longenoughX')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page.getByText('Those passwords don’t match.')).toBeVisible()
    await expect(page.getByLabel('Confirm password')).toBeFocused()
    await expect(page.getByLabel('Confirm password')).toHaveAttribute('aria-invalid', 'true')
    expect(posts).toEqual([])
  })

  test('confirm password is also enforced by the Server Action, not only the browser', () => {
    const src = read('app/actions/auth.ts')
    expect(src).toContain("passwordsMatch(password, String(formData.get('confirm') ?? ''))")
    expect(src).toMatch(/if \(!confirmed\.ok\) return \{ error: confirmed\.error/)
    // and it is checked after the account rules, so a missing name is still reported first
    expect(src.indexOf('validateRegistration(')).toBeLessThan(src.indexOf('passwordsMatch('))
  })

  test('the SA ID date suggestion still works inside the V3 card', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/register')
    await page.getByLabel('ID or passport number').fill('8001015009087')
    await expect(page.getByLabel('Date of birth')).toHaveValue('1980-01-01')
    await expect(page.getByRole('status')).toContainText('filled in from your ID number')

    await page.getByLabel('ID or passport number').fill('0506155012087') // fits two centuries
    await expect(page.getByRole('group', { name: /fits two birth years/i })).toBeVisible()
    await expect(page.getByLabel('Date of birth')).toHaveValue('')
    expect(posts).toEqual([])
  })

  test('registration still creates patients only: no role is ever sent with the signup', () => {
    const register = slice(read('app/actions/auth.ts'), 'export async function register', 'export async function login')
    expect(register).toContain('supabase.auth.signUp(')
    expect(register).not.toMatch(/role\s*:/)
    expect(register).toContain('handle_new_user')
    expect(register).toContain("redirect(`/verify?email=${encodeURIComponent(email)}`)")
  })
})

// ------------------------------------------------------------------------------------------------- verify

test.describe('Verify account (Figma 45:68)', () => {
  test.setTimeout(180_000)

  test('the card shows the code entry, the resend control and the way back to registration', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/verify?email=someone%40example.com')
    await expect(page.getByRole('heading', { level: 1, name: 'Verify your account' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Verification code' })).toBeVisible()
    await expect(page.getByRole('button', { name: /resend code/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Back to create account/ })).toHaveAttribute('href', '/register')
    expect(posts).toEqual([])
  })

  test('without an email there is nothing to verify, so the route sends people to registration', () => {
    const src = read('app/(auth)/verify/page.tsx')
    expect(src).toContain("if (!email) redirect('/register')")
  })

  test('the real verifyOtp and resend calls, the cooldown and the double-submit guard are all still there', () => {
    const src = read('components/auth/VerifyForm.tsx')
    expect(src).toContain("supabase.auth.verifyOtp({ email, token: code, type: 'signup' })")
    expect(src).toContain("supabase.auth.resend({ type: 'signup', email })")
    expect(src).toContain('RESEND_COOLDOWN_SECONDS = 60')
    expect(src).toContain('submittingRef')
    expect(src).toContain('over_email_send_rate_limit')
    expect(src).toContain('That code is not correct or has expired.')
    expect(src).toContain("router.push('/dashboard')")
  })

  test('the code is six digits: fewer leaves Verify disabled and the action is never reached', async ({ page, context }) => {
    const posts = await sealed(context)
    await visit(page, '/verify?email=someone%40example.com')
    const boxes = page.getByRole('group', { name: 'Verification code' }).getByRole('textbox')
    await boxes.nth(0).fill('12345')
    await expect(page.getByRole('button', { name: 'Verify account' })).toBeDisabled()
    await boxes.nth(5).pressSequentially('6')
    await expect(page.getByRole('button', { name: 'Verify account' })).toBeEnabled()
    expect(posts).toEqual([])
  })
})

// --------------------------------------------------------------------------- OTP concurrency safety (PR #45)

/**
 * These tests exercise the real verifyOtp()/resend() calls against the offline server's own dead Supabase URL
 * (http://127.0.0.1:9 — nothing listens there, so nothing ever leaves this machine; see web-server-plan.ts).
 * No OTP is ever correct and no email account exists, so neither call could succeed even if it reached a real
 * project — these tests only ever exercise the failure and in-flight paths, never a real verification or send.
 *
 * `page.route()` is used (not the file's usual `sealed(context)`) because these tests need to see and control
 * the verify/resend request itself — holding it open to get a deterministic in-flight window, or letting it run
 * to its natural (fast, since the port is dead) failure. Every test still tracks every non-GET request itself
 * and asserts only the expected auth call was ever attempted — the same guarantee `sealed()` gives, just not
 * blind to the one request each test needs to observe.
 */
test.describe('Verify account: OTP concurrency safety', () => {
  test.setTimeout(180_000)

  /** Every non-GET request the page attempts, method + URL, collected for the life of the test. */
  function trackNonGet(page: Page): string[] {
    const requests: string[] = []
    page.on('request', (req) => {
      if (req.method() !== 'GET' && req.method() !== 'HEAD') requests.push(`${req.method()} ${req.url()}`)
    })
    return requests
  }

  const fillCode = (page: Page, code = '123456') =>
    page.getByRole('group', { name: 'Verification code' }).getByRole('textbox').nth(0).fill(code)

  /**
   * Holds the first request matching `pattern` open until the test calls `release()`, then fails it — the same
   * shape a dropped connection takes. `entered` resolves once the request has actually started, so a test can
   * assert the in-flight UI state deterministically instead of racing a timer against a fast local failure.
   */
  function holdRequest(page: Page, pattern: string) {
    let resolveEntered!: () => void
    const entered = new Promise<void>((resolve) => {
      resolveEntered = resolve
    })
    let resolveReleased!: () => void
    const released = new Promise<void>((resolve) => {
      resolveReleased = resolve
    })
    let count = 0
    page.route(pattern, async (route) => {
      count += 1
      resolveEntered()
      await released
      await route.abort('failed')
    })
    return { entered, release: () => resolveReleased(), count: () => count }
  }

  test('source: both calls are wrapped so a thrown (not just a {error}-returning) failure cannot leave the form stuck', () => {
    const src = read('components/auth/VerifyForm.tsx')
    const verify = slice(src, 'async function handleVerify', 'async function handleResend')
    const resend = src.slice(src.indexOf('async function handleResend'))
    expect(verify).toMatch(/try \{[\s\S]*verifyOtp[\s\S]*\} catch \{[\s\S]*\} finally \{[\s\S]*submittingRef\.current = false[\s\S]*setVerifying\(false\)/)
    expect(resend).toMatch(/try \{[\s\S]*resend\(\{[\s\S]*\} catch \{[\s\S]*\} finally \{[\s\S]*resendingRef\.current = false/)
  })

  test('verification in progress disables resend; releasing it (a network failure) leaves both controls usable again', async ({ page }) => {
    const requests = trackNonGet(page)
    await visit(page, '/verify?email=someone%40example.com')
    const held = holdRequest(page, '**/auth/v1/verify*')

    await fillCode(page)
    await page.getByRole('button', { name: 'Verify account' }).click()
    await held.entered

    await expect(page.getByRole('button', { name: 'Verifying…' })).toBeVisible()
    const resend = page.getByRole('button', { name: /resend code/i })
    await expect(resend, 'resend must not be startable while verifyOtp is in flight').toBeDisabled()

    held.release()
    await expect(page.getByText('That code is not correct or has expired.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Verify account →' }), 'recoverable, not stuck disabled').toBeEnabled()
    await expect(resend, 'resend is usable again once verify has settled').toBeEnabled()

    expect(held.count()).toBe(1)
    expect(requests.filter((r) => !r.includes('/auth/v1/verify'))).toEqual([])
  })

  test('a resend in progress disables Verify even with a complete code; releasing it leaves both controls usable again', async ({ page }) => {
    const requests = trackNonGet(page)
    await visit(page, '/verify?email=someone%40example.com')
    await fillCode(page)
    const held = holdRequest(page, '**/auth/v1/resend*')

    await page.getByRole('button', { name: /resend code/i }).click()
    await held.entered

    await expect(page.getByRole('button', { name: 'Sending…' })).toBeVisible()
    const verify = page.getByRole('button', { name: 'Verify account →' })
    await expect(verify, 'verification must not be startable while a resend is in flight').toBeDisabled()

    held.release()
    await expect(page.getByText("Couldn't send a new code. Try again.")).toBeVisible()
    await expect(verify, 'the code is still complete, so Verify is usable again once resend has settled').toBeEnabled()
    await expect(page.getByRole('button', { name: /resend code/i }), 'recoverable, not stuck disabled (no cooldown on a failure)').toBeEnabled()

    expect(held.count()).toBe(1)
    expect(requests.filter((r) => !r.includes('/auth/v1/resend'))).toEqual([])
  })

  test('same-tick duplicate clicks on Verify send exactly one request, and the form recovers afterward', async ({ page }) => {
    const requests = trackNonGet(page)
    await visit(page, '/verify?email=someone%40example.com')
    await fillCode(page)

    await page.getByRole('button', { name: 'Verify account →' }).evaluate((el) => {
      const b = el as HTMLButtonElement
      b.click()
      b.click()
      b.click()
    })

    await expect(page.getByText('That code is not correct or has expired.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Verify account →' })).toBeEnabled()
    expect(requests.filter((r) => r.includes('/auth/v1/verify'))).toHaveLength(1)
    expect(requests.filter((r) => !r.includes('/auth/v1/verify'))).toEqual([])
  })

  test('same-tick duplicate clicks on Resend send exactly one request, and the form recovers afterward', async ({ page }) => {
    const requests = trackNonGet(page)
    await visit(page, '/verify?email=someone%40example.com')

    await page.getByRole('button', { name: /resend code/i }).evaluate((el) => {
      const b = el as HTMLButtonElement
      b.click()
      b.click()
      b.click()
    })

    await expect(page.getByText("Couldn't send a new code. Try again.")).toBeVisible()
    await expect(page.getByRole('button', { name: /resend code/i })).toBeEnabled()
    expect(requests.filter((r) => r.includes('/auth/v1/resend'))).toHaveLength(1)
    expect(requests.filter((r) => !r.includes('/auth/v1/resend'))).toEqual([])
  })
})

// ------------------------------------------------------------------- security contracts that must not move

test.describe('authentication security contracts', () => {
  test('this change touches no migration, RLS policy or Supabase auth setting', () => {
    for (const f of [
      'components/auth/v3/AuthShell.tsx',
      'components/auth/v3/WelcomeView.tsx',
      'components/auth/LoginForm.tsx',
      'components/auth/VerifyForm.tsx',
      'app/(auth)/register/page.tsx',
      'app/(auth)/welcome/page.tsx',
      'app/actions/auth.ts',
    ]) {
      // comments stripped: the point is what the code does, not what a note about it says
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
      expect(src, f).not.toMatch(/create policy|alter table|grant\s+(select|insert|update|delete|execute|all)|service_role|SUPABASE_SECRET|admin\.createUser/i)
    }
  })

  test('the auth screens read no personal data beyond the signed-in user’s own role and name', () => {
    expect(read('app/(auth)/welcome/page.tsx')).toMatch(/select\('role'\)[\s\S]{0,80}eq\('auth_user_id', user\.id\)/)
    expect(read('app/(auth)/login/page.tsx')).toMatch(/select\('full_name, role'\)[\s\S]{0,80}eq\('auth_user_id', user\.id\)/)
  })

  test('no password, code or identity value is ever logged', () => {
    for (const f of [
      'components/auth/LoginForm.tsx',
      'components/auth/VerifyForm.tsx',
      'app/(auth)/register/page.tsx',
      'app/actions/auth.ts',
    ]) {
      expect(read(f), f).not.toMatch(/console\.(log|info|debug|warn|error)/)
    }
  })
})
