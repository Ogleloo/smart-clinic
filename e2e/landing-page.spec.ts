import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import {
  NAV_LINKS, ANCHORS, EMPTY_SERVICES_TEXT, SNAPSHOT_NOTE, UNAVAILABLE_SERVICES_TEXT, serviceIconFor, serviceStatusText,
} from '../components/landing/content'

/**
 * Public Landing V3 (Figma frame 16:6). Offline: no session, no network beyond the local dev server's own static
 * assets, no database.
 *
 *  - the REAL view rendered for populated / empty / unavailable / long-name states, laid out with the app's REAL
 *    compiled CSS at 1440, 1024, 768, 390 and 320px;
 *  - the REAL `/` route against an unreachable Supabase (so the "unavailable" states are exercised for real);
 *  - source contracts: signed-in redirect, public-data boundary, no temporary Figma URLs, assets present.
 *
 * NOT covered: the signed-in redirect against a live session and live queue / opening-hours data (needs the shared
 * project). The pixel comparison with Figma is a manual review recorded in the PR.
 */

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

type States = 'populated' | 'empty' | 'unavailable' | 'longName'
type Rendered = { css: string; states: Record<States, string> }
let r: Rendered
test.beforeAll(() => {
  r = JSON.parse(execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'e2e/support/render-landing.tsx'], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }))
})

const BASE = 'http://localhost:3000/'
const doc = (html: string) =>
  `<!doctype html><html lang="en"><head><base href="${BASE}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${r.css}</style></head><body>${html}</body></html>`
const text = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
async function open(page: Page, state: States, width: number, height = 900) {
  await page.setViewportSize({ width, height })
  await page.setContent(doc(r.states[state]), { waitUntil: 'load' })
}

// ------------------------------------------------------------------------------------------ structure & copy

test.describe('structure: the seven Figma sections, one landmark each', () => {
  test('header, hero, why, services, how it works, CTA panel and footer, in order, inside one <main>', () => {
    const h = r.states.populated
    expect((h.match(/<main[ >]/g) ?? []).length).toBe(1)
    expect((h.match(/<header[ >]/g) ?? []).length).toBe(1)
    expect((h.match(/<footer[ >]/g) ?? []).length).toBe(1)
    const order = ['id="top"', 'id="about"', 'id="services"', 'id="how-it-works"', 'id="cta-title"'].map((s) => h.indexOf(s))
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(h.indexOf('<header')).toBeLessThan(h.indexOf('<main'))
    expect(h.indexOf('</main>')).toBeLessThan(h.indexOf('<footer'))
  })

  test('headings: one h1, then h2 sections in order, h3 only under them', () => {
    const t = [...r.states.populated.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => [Number(m[1]), text(m[2]!).trim()] as const)
    expect(t.filter(([l]) => l === 1)).toEqual([[1, 'Know where you stand']])
    expect(t.filter(([l]) => l === 2).map(([, s]) => s)).toEqual([
      'A simpler, smarter way to experience care',
      'Our services',
      'How it works',
      'Experience a better way to clinic.',
    ])
    let prev = 0
    for (const [l] of t) {
      expect(l - prev).toBeLessThanOrEqual(1) // never skips a level
      prev = l
    }
  })

  test('copy from the design is present: hero, four feature cards, four steps, CTA', () => {
    const t = text(r.states.populated)
    for (const s of [
      'Get started →', 'Live queue position', 'Honest wait estimates', 'In-app updates', 'WHY SMART CLINIC',
      'Live queue tracking', 'Appointment booking', 'Notifications & reminders',
      'Create your profile', 'Book or check in', 'Track your turn', 'Get seen',
      'Experience a better way to clinic.', 'Book appointment →',
    ]) expect(t, s).toContain(s)
    expect(t).toContain('Get from queue to care in four simple steps.')
  })

  test('the four steps are an ordered list numbered 1–4 and each has an icon asset', () => {
    const ol = r.states.populated.match(/<ol[\s\S]*?<\/ol>/)![0]
    expect([...ol.matchAll(/<li/g)].length).toBe(4)
    expect(text(ol)).toMatch(/Step 1 .*Step 2 .*Step 3 .*Step 4/)
    expect((ol.match(/\/images\/landing\/icons\/step-/g) ?? []).length).toBe(4)
    expect(ol).toContain('/images/landing/connector.png')
  })

  test('document and images: decorative images have empty alt; every image has an alt attribute', () => {
    const imgs = [...r.states.populated.matchAll(/<img[^>]*>/g)].map((m) => m[0])
    expect(imgs.length).toBeGreaterThan(15)
    for (const i of imgs) expect(i, i).toMatch(/\salt=""/)
  })
})

test.describe('accuracy: nothing invented, nothing guaranteed', () => {
  test('Figma’s fictional address, e-mail and other unverified details never appear in any state', () => {
    for (const html of Object.values(r.states)) {
      const t = text(html)
      expect(t).not.toMatch(/New York|100 Riverside Boulevard|support@smartclinic|123 Main Road|@smartclinic\.com|\+1 |\(\d{3}\)/)
      expect(html).not.toMatch(/href="(mailto|tel):/)
    }
  })

  test('no unverified marketing or capability claims: "skip the queue", "reschedule", "premium", "high quality care"', () => {
    for (const html of Object.values(r.states)) {
      expect(text(html)).not.toMatch(/skip the queue|reschedule|premium|next-generation|high quality care|medical team|our values/i)
    }
  })

  test('booking is not check-in bypass, and estimates are not guarantees — stated on the page', () => {
    const t = text(r.states.populated)
    expect(t).toContain('Booking a slot does not skip check-in')
    expect(t).toContain('Estimated waits are approximate and not guaranteed')
    expect(t).toContain('check in at reception when you arrive')
  })

  test('services come only from the live data: with none, none of Figma’s example services appear', () => {
    for (const state of ['empty', 'unavailable'] as const) {
      const t = text(r.states[state])
      for (const name of ['General Consultation', 'Family Planning', 'Immunization', 'Immunisation', 'Chronic Care']) expect(t, `${state}: ${name}`).not.toContain(name)
    }
    const t = text(r.states.populated)
    for (const name of ['General Consultation', 'Immunisation', 'Chronic Care', 'Family Planning']) expect(t).toContain(name)
  })

  test('the status line uses only the public fields, and gives no estimate where nobody is on duty', () => {
    const base = { waiting_count: 0, estimated_wait_minutes: 0, is_being_served: true }
    expect(serviceStatusText({ ...base, waiting_count: 3, estimated_wait_minutes: 12 })).toBe('3 waiting · estimated wait about 12 min')
    expect(serviceStatusText(base)).toBe('No one is waiting')
    const uncovered = serviceStatusText({ waiting_count: 2, estimated_wait_minutes: 99, is_being_served: false })
    expect(uncovered).toBe('2 waiting · no nurse on duty, so no estimate')
    expect(uncovered).not.toMatch(/\d+ min/)
    expect(serviceStatusText({ waiting_count: 0, estimated_wait_minutes: 99, is_being_served: false })).toBe('No nurse on duty')
  })

  test('service icons are chosen from the service name only and fall back to a neutral one', () => {
    expect(serviceIconFor('Immunisation').src).toMatch(/syringe/)
    expect(serviceIconFor('Immunization').src).toMatch(/syringe/)
    expect(serviceIconFor('Chronic Care').src).toMatch(/heart-pulse/)
    expect(serviceIconFor('Family Planning').src).toMatch(/users-24/)
    expect(serviceIconFor('Anything else').src).toMatch(/stethoscope/)
  })
})

// ------------------------------------------------------------------------------------- navigation & links

test.describe('navigation: every link goes somewhere real', () => {
  test('header links: Home, Services, How it works, About, Log in, Book appointment', () => {
    expect(NAV_LINKS.map((l) => l.label)).toEqual(['Home', 'Services', 'How it works', 'About'])
    const header = r.states.populated.match(/<header[\s\S]*?<\/header>/)![0]
    expect(header).toMatch(/href="#top"[^>]*aria-current="page"/)
    for (const href of ['#services', '#how-it-works', '#about', '/login', '/register']) expect(header).toContain(`href="${href}"`)
    expect(header).toContain('aria-label="Book appointment"')
  })

  test('every in-page anchor resolves to an element on the page; none is "#" or empty', () => {
    for (const html of Object.values(r.states)) {
      const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!)
      for (const href of hrefs) {
        expect(href, 'empty or bare hash link').not.toMatch(/^(#?)$/)
        if (href.startsWith('#')) expect(html, `anchor ${href}`).toContain(`id="${href.slice(1)}"`)
      }
    }
    for (const id of Object.values(ANCHORS)) expect(r.states.populated).toContain(`id="${id}"`)
    expect(r.states.populated).toContain('id="main"')
  })

  test('every other link is an app route that exists: /, /login, /register or /display/<service id>', () => {
    for (const html of Object.values(r.states)) {
      for (const [, href] of html.matchAll(/href="([^"#][^"]*)"/g)) {
        expect(href, href).toMatch(/^(\/|\/login|\/register|\/display\/[0-9a-f-]{36})$/)
      }
    }
    expect(existsSync('app/login/page.tsx') || existsSync('app/(auth)/login/page.tsx')).toBe(true)
    expect(existsSync('app/(auth)/register/page.tsx')).toBe(true)
    expect(existsSync('app/display/[serviceId]/page.tsx')).toBe(true)
  })

  test('Book appointment and Get started lead to registration; Log in leads to login — in the header, hero and CTA panel', () => {
    const h = r.states.populated
    expect((h.match(/href="\/register"/g) ?? []).length).toBeGreaterThanOrEqual(4) // header, hero, CTA, footer
    expect((h.match(/href="\/login"/g) ?? []).length).toBeGreaterThanOrEqual(4)
    const cta = h.match(/<section[^>]*aria-labelledby="cta-title"[\s\S]*?<\/section>/)![0]
    expect(cta).toMatch(/href="\/register"[^>]*>Book appointment →/)
    expect(cta).toMatch(/href="\/login"[^>]*>Log in/)
  })

  test('service rows and the waiting-room links go to the public display of a real service id', () => {
    const t = r.states.populated
    const ids = [...t.matchAll(/href="\/display\/([0-9a-f-]{36})"/g)].map((m) => m[1])
    expect(new Set(ids).size).toBe(4)
    expect(t).toContain('Waiting-room display →')
    expect(t).toContain('View the waiting-room display')
    for (const state of ['empty', 'unavailable'] as const) expect(r.states[state]).not.toContain('/display/')
  })
})

// ------------------------------------------------------------------------------- data boundary & states

test.describe('public data boundary and empty / error states', () => {
  test('page data comes only from get_public_queue_display and clinic_hours (plus the role lookup for a signed-in visitor)', () => {
    const src = read('app/page.tsx')
    expect(src.match(/\.rpc\('([a-z_]+)'/g)).toEqual([".rpc('get_public_queue_display'"])
    expect(src.match(/\.from\('([a-z_]+)'/g)!.sort()).toEqual([".from('clinic_hours'", ".from('profiles'"])
    expect(src).toMatch(/select\('role'\)/)
    expect(read('components/landing/LandingPageView.tsx')).not.toMatch(/supabase|createClient|\.rpc\(|\.from\(/i)
  })

  test('the public RPC exposes no names or identifiers, and the page uses only five of its columns', () => {
    const types = read('lib/types/database.types.ts')
    const block = types.slice(types.indexOf('get_public_queue_display: {'))
    const returns = block.slice(block.indexOf('Returns: {'), block.indexOf('}[]'))
    expect([...returns.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]).sort()).toEqual(
      ['confidence', 'estimated_wait_minutes', 'is_being_served', 'next_token', 'now_serving_token', 'service_id', 'service_name', 'updated_at', 'waiting_count']
    )
    const view = read('components/landing/LandingPageView.tsx') + read('components/landing/content.ts')
    expect(view).not.toMatch(/next_token|now_serving_token|updated_at|confidence/)
  })

  test('canary: queue tokens present in the data never reach the page', () => {
    for (const html of Object.values(r.states)) expect(html).not.toMatch(/GC-09[89]/)
  })

  test('populated: one row per service with its live status, linking to the display', () => {
    const t = text(r.states.populated)
    expect(t).toContain('3 waiting · estimated wait about 12 min')
    expect(t).toContain('No one is waiting')
    expect(t).toContain('2 waiting · no nurse on duty, so no estimate')
    expect(t).toContain('No nurse on duty')
    expect(t).toContain('Mon–Fri 07:30–16:30')
    expect(t).toContain('Closed Sunday')
  })

  test('unavailable (read failed): an honest message, no invented services or hours, the rest of the page still works', () => {
    const h = r.states.unavailable
    const t = text(h)
    expect(t).toContain('We couldn’t load the current service information')
    expect(t).toContain('Opening hours are unavailable right now.')
    expect(t).toContain('Service list unavailable')
    expect(h).toContain('role="status"')
    expect(h).toContain('href="/register"')
    expect(h).toContain('href="/login"')
    expect(t).not.toMatch(/\d+ waiting|estimated wait about/)
  })

  test('empty (read succeeded, nothing there) is worded differently from unavailable', () => {
    const t = text(r.states.empty)
    expect(t).toContain('No services are available at the moment')
    expect(t).toContain('Opening hours have not been published yet.')
    expect(t).not.toContain('unavailable')
  })
})

// ------------------------------------------------------------------------------------------- copy contracts

test.describe('copy contract 1: empty services is not "failed", and does not offer booking', () => {
  const statusOf = (html: string) => text(html.match(/<p role="status"[^>]*>([\s\S]*?)<\/p>/)![1]!).trim()

  test('empty: says no services are available and that appointments cannot be booked right now', () => {
    const msg = statusOf(r.states.empty)
    expect(msg).toBe(EMPTY_SERVICES_TEXT)
    expect(msg).toMatch(/No services are available/)
    expect(msg).toMatch(/appointments can’t be booked right now/)
    expect(msg).toMatch(/check back soon/)
  })

  test('empty: nothing in the message tells the visitor they can book — it only offers an account or a login', () => {
    const msg = statusOf(r.states.empty)
    expect(msg).not.toMatch(/\bbook an appointment\b|you can (still )?book|can book|to book/i)
    expect(msg).not.toMatch(/open for queueing/i)
    expect(msg).toMatch(/create an account or log in/)
  })

  test('empty is not worded as an error, and unavailable is not worded as "no services"', () => {
    const empty = statusOf(r.states.empty)
    const failed = statusOf(r.states.unavailable)
    expect(empty).not.toMatch(/couldn’t|unavailable|problem|refresh/i)
    expect(failed).toBe(UNAVAILABLE_SERVICES_TEXT)
    expect(failed).toMatch(/couldn’t load/)
    expect(failed).toMatch(/temporary problem with the request/)
    expect(failed).toMatch(/not a sign that the clinic is closed/)
    expect(failed).toMatch(/refresh the page/)
    expect(failed).not.toMatch(/No services are available|can’t be booked/)
    expect(empty).not.toBe(failed)
  })

  test('the footer list says the same thing: "No services available right now" vs "Service list unavailable"', () => {
    expect(text(r.states.empty)).toContain('No services available right now')
    expect(text(r.states.unavailable)).toContain('Service list unavailable')
    expect(text(r.states.empty)).not.toContain('Service list unavailable')
  })

  test('a populated page shows neither message', () => {
    expect(text(r.states.populated)).not.toContain('No services are available at the moment')
    expect(text(r.states.populated)).not.toContain('We couldn’t load the current service information')
  })
})

test.describe('copy contract 2: the landing figures are a snapshot, not a live feed', () => {
  const servicesSection = (html: string) => text(html.match(/<section[^>]*id="services"[\s\S]*?<\/section>/)![0])

  test('the services block says the figures are from when the page loaded and can be refreshed', () => {
    const t = servicesSection(r.states.populated)
    expect(t).toContain(SNAPSHOT_NOTE)
    expect(t).toMatch(/snapshot from when this page loaded/)
    expect(t).toMatch(/refresh the page for the latest/)
  })

  test('estimated waits are described as approximate and not guaranteed, and as changing with the queue', () => {
    const t = servicesSection(r.states.populated)
    expect(t).toMatch(/Estimated waits are approximate and not guaranteed/)
    expect(t).toMatch(/they change as the queue moves/)
    expect(t).toMatch(/no estimate rather than a guess/)
  })

  test('the services block no longer calls its figures live or implies they update by themselves', () => {
    const t = servicesSection(r.states.populated).toLowerCase()
    expect(t).not.toMatch(/figures are live|real-time|realtime|live update|auto-?(matically)? updat|continuous|moves with the queue|updates? (live|instantly)/)
    expect(r.states.populated).not.toContain('aria-label="Services and their queues right now"')
    expect(r.states.populated).toContain('aria-label="Services and their queue figures when this page loaded"')
    expect(t).not.toContain('waiting right now')
    expect(t).not.toContain('on duty right now')
  })

  test('the snapshot note is not shown with the empty / unavailable messages', () => {
    for (const state of ['empty', 'unavailable'] as const) expect(servicesSection(r.states[state])).not.toContain('snapshot')
  })

  test('this page really is a snapshot: no client component, no polling, no realtime subscription, no revalidation timer', () => {
    for (const f of ['app/page.tsx', 'components/landing/LandingPageView.tsx', 'components/landing/content.ts']) {
      const s = read(f)
      expect(s, f).not.toMatch(/^['"]use client['"]/m)
      expect(s, f).not.toMatch(/setInterval|setTimeout|\.channel\(|\.subscribe\(|useEffect|router\.refresh|EventSource|WebSocket|export const revalidate/)
    }
  })

  test('the product claims about live tracking stay about the signed-in app, not about this page', () => {
    // Figma's feature cards describe the patient queue screen, which does update live.
    expect(text(r.states.populated)).toContain('Live queue tracking')
    expect(servicesSection(r.states.populated)).not.toContain('Live queue tracking')
  })
})

// --------------------------------------------------------------------------- redirects, assets, contracts

test.describe('signed-in redirect and source contracts', () => {
  test('a signed-in visitor is sent to their role home through homeForRole, and the redirect is not inside a try block', () => {
    const src = read('app/page.tsx')
    expect(src).toContain("import { homeForRole } from '@/lib/auth/homeForRole'")
    expect(src).toContain('if (role) redirect(homeForRole(role))')
    const tries = [...src.matchAll(/try \{([\s\S]*?)\n  \} catch/g)].map((m) => m[1]!)
    for (const body of tries) expect(body).not.toContain('redirect(')
    expect(src).toContain("profile?.role ?? 'patient'")
  })

  test('a failed session check means "signed out": the page does not crash for anonymous visitors', () => {
    const src = read('app/page.tsx')
    expect(src).toMatch(/async function getSignedInRole[\s\S]*catch \{\s*return null/)
  })

  test('homeForRole still sends each role where it belongs', async () => {
    const { homeForRole } = await import('../lib/auth/homeForRole')
    expect([homeForRole('patient'), homeForRole('receptionist'), homeForRole('nurse'), homeForRole('admin')]).toEqual(['/dashboard', '/reception', '/nurse/dashboard', '/admin'])
  })

  test('no runtime code points at a temporary Figma URL; every referenced asset exists and is not empty', () => {
    const files = ['app/page.tsx', 'components/landing/LandingPageView.tsx', 'components/landing/content.ts']
    const refs = new Set<string>()
    for (const f of files) {
      const s = read(f)
      expect(s, f).not.toMatch(/figma\.com\/api|assetPathPrefix/)
      for (const m of s.matchAll(/['"`](\/images\/landing\/[^'"`]+)['"`]/g)) refs.add(m[1]!)
    }
    expect(refs.size).toBeGreaterThanOrEqual(16)
    for (const ref of refs) {
      const file = `public${ref}`
      expect(existsSync(file), file).toBe(true)
      expect(statSync(file).size, file).toBeGreaterThan(100)
    }
    // nothing downloaded that the page does not use
    const all = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(`${dir}/${e.name}`) : [`${dir}/${e.name}`]))
    for (const f of all('public/images/landing')) expect(refs.has(f.replace(/^public/, '')), `${f} is unused`).toBe(true)
  })

  test('the SVG assets keep their own root width and height; the hero photograph is a JPEG, not mislabelled', () => {
    for (const f of readdirSync('public/images/landing/icons')) {
      const svg = read(`public/images/landing/icons/${f}`)
      expect(svg, f).toMatch(/<svg[^>]*\swidth="[\d.]+"[^>]*\sheight="[\d.]+"/)
    }
    const head = readFileSync('public/images/landing/hero-lobby.jpg').subarray(0, 3)
    expect([...head]).toEqual([0xff, 0xd8, 0xff])
  })
})

// ------------------------------------------------------------------------------------ layout (real CSS)

test.describe('layout, geometry and accessibility (real component + real compiled CSS)', () => {
  for (const [state, widths] of [['populated', [1440, 1024, 768, 390, 320]], ['unavailable', [1440, 390, 320]], ['empty', [390]], ['longName', [1440, 390, 320]]] as const) {
    for (const w of widths) {
      test(`${state} at ${w}px: no sideways scrolling`, async ({ page }) => {
        await open(page, state, w)
        expect(await overflow(page)).toBeLessThanOrEqual(0)
      })
    }
  }

  test('1440px matches the Figma geometry: header 88, hero photograph 760×592 at x=680, four 302px cards, CTA 1280px', async ({ page }) => {
    await open(page, 'populated', 1440, 1000)
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!
    expect((await box('header')).height).toBeCloseTo(88, 0)
    const hero = page.locator('#top img[src*="hero-lobby"], #top img[srcset*="hero-lobby"]').first()
    const photo = (await hero.evaluate((el) => { const r = el.parentElement!.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }))
    expect(photo.x).toBeCloseTo(680, 0)
    expect(photo.w).toBeCloseTo(760, 0)
    expect(photo.h).toBeCloseTo(592, 0)
    expect(photo.y).toBeCloseTo(88, 0) // directly under the 88px header (its 1px rule is inside the 88)
    const cards = await page.locator('#about ul > li').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.width), Math.round(r.height)] }))
    expect(cards.map((c) => c[1])).toEqual([302, 302, 302, 302])
    expect(cards[0]![0]).toBe(80)
    expect(cards.every((c) => c[2] >= 260)).toBe(true)
    const cta = await page.locator('section[aria-labelledby="cta-title"] > div').boundingBox()
    expect(cta!.width).toBeCloseTo(1280, 0)
    expect(cta!.x).toBeCloseTo(80, 0)
    expect(cta!.height).toBeGreaterThanOrEqual(160)
    const services = await page.locator('#services ul[aria-label] > li').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
    expect(services.every((h) => h >= 88 && h <= 96)).toBe(true)
  })

  test('1440px: the four geometry details corrected after the Figma comparison stay corrected', async ({ page }) => {
    await open(page, 'populated', 1440, 1000)
    // 1. Hero text column is Figma's 560 (680 column − 80 left − 40 right), not 520: SECTION_PAD's xl:px-20 would
    //    otherwise beat lg:pr-10, because Tailwind emits the xl variant after the lg one.
    for (const sel of ['h1', '#top ul[aria-label]']) {
      expect(Math.round((await page.locator(sel).first().boundingBox())!.width), sel).toBe(560)
    }
    // 2. Figma nests the card title and body in one block: 8px apart, 16px below the icon.
    const cardGaps = await page.locator('#about ul > li').evaluateAll((els) =>
      els.map((li) => {
        const h3 = li.querySelector('h3')!.getBoundingClientRect()
        const p = li.querySelector('p')!.getBoundingClientRect()
        const icon = li.querySelector('span')!.getBoundingClientRect()
        return [Math.round(p.top - h3.bottom), Math.round(h3.top - icon.bottom)]
      })
    )
    for (const [titleToBody, iconToTitle] of cardGaps) {
      expect(titleToBody).toBe(8)
      expect(iconToTitle).toBe(16)
    }
    // 3. The CTA card is Figma's 160 tall with its content on a 40px vertical inset (48px padding made it 176).
    const cta = (await page.locator('section[aria-labelledby="cta-title"] > div').boundingBox())!
    expect(Math.round(cta.height)).toBe(160)
    const ctaTitle = (await page.locator('#cta-title').boundingBox())!
    expect(Math.round(ctaTitle.y - cta.y)).toBe(40)
    // 4. The section eyebrow is Figma's Inter Regular, not semibold.
    const eyebrow = page.locator('#about p').filter({ hasText: 'WHY SMART CLINIC' })
    expect(await eyebrow.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('400')
  })

  test('1440px: the four steps sit in one row with a connector between each pair', async ({ page }) => {
    await open(page, 'populated', 1440, 1000)
    const ys = await page.locator('#how-it-works ol > li > div').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
    expect(new Set(ys).size).toBe(1)
    expect(ys).toHaveLength(4)
    const conn = page.locator('#how-it-works ol img[src*="connector"]')
    await expect(conn).toHaveCount(3)
    for (let i = 0; i < 3; i++) expect((await conn.nth(i).boundingBox())!.width).toBeGreaterThanOrEqual(40)
  })

  test('390px and 320px: steps stack vertically, feature cards go one per row, the photograph sits under the headline', async ({ page }) => {
    for (const w of [390, 320]) {
      await open(page, 'populated', w)
      const xs = await page.locator('#how-it-works ol > li > div').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)))
      expect(new Set(xs).size).toBe(1)
      const tops = await page.locator('#about ul > li').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
      expect(new Set(tops).size).toBe(4)
      const h1 = (await page.getByRole('heading', { level: 1 }).boundingBox())!
      const photo = (await page.locator('#top img[src*="hero-lobby"], #top img[srcset*="hero-lobby"]').first().boundingBox())!
      expect(photo.y).toBeGreaterThan(h1.y + h1.height)
      expect(photo.width).toBeLessThanOrEqual(w)
    }
  })

  test('images load, are not stretched (icons render at their own width and height), and none comes from Figma', async ({ page }) => {
    await open(page, 'populated', 1440, 1000)
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 30_000 })
    const imgs = await page.evaluate(() =>
      [...document.images].map((i) => ({ src: i.currentSrc || i.src, ok: i.naturalWidth > 0, nw: i.naturalWidth, nh: i.naturalHeight, w: Math.round(i.getBoundingClientRect().width * 100) / 100, h: Math.round(i.getBoundingClientRect().height * 100) / 100, attrW: Number(i.getAttribute('width')), attrH: Number(i.getAttribute('height')) }))
    )
    for (const i of imgs) {
      expect(i.src, i.src).not.toMatch(/figma\.com/)
      expect(i.ok, `${i.src} did not load`).toBe(true)
    }
    for (const i of imgs.filter((x) => /icons\/(?!footer)/.test(x.src))) {
      expect(Math.abs(i.w - i.attrW), i.src).toBeLessThan(0.6)
      expect(Math.abs(i.h - i.attrH), i.src).toBeLessThan(0.6)
    }
    const photo = imgs.find((x) => /hero-lobby|_next\/image/.test(x.src) && x.nw > 600)!
    expect(photo.nw).toBeGreaterThan(700)
  })

  test('keyboard: the skip link is first, then every header control, each with a visible focus ring; the skip target exists', async ({ page }) => {
    await open(page, 'populated', 1440, 1000)
    const order: string[] = []
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press('Tab')
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement
        return { label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' '), ring: getComputedStyle(el).boxShadow, href: el.getAttribute('href') }
      })
      order.push(info.label)
      expect(info.ring, info.label).not.toBe('none')
    }
    expect(order.slice(0, 8)).toEqual(['Skip to content', 'Smart Clinic — home', 'Home', 'Services', 'How it works', 'About', 'Log in', 'Book appointment'])
    await expect(page.locator('#main')).toHaveCount(1)
  })

  test('every link and button is a 44px+ target (inline links inside a sentence excepted)', async ({ page }) => {
    for (const w of [1440, 390, 320]) {
      await open(page, 'populated', w, 1000)
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('a, button')]
          .filter((el) => !el.closest('p') && !el.classList.contains('sr-only') && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0)
          .map((el) => ({ t: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30), h: Math.round(el.getBoundingClientRect().height) }))
          .filter((x) => x.h < 44)
      )
      expect(small, `width ${w}`).toEqual([])
    }
  })

  test('text contrast: body and small text 4.5:1 or better; the 40px accent words and white-on-teal panel clear their bars', async ({ page }) => {
    await open(page, 'populated', 1440, 1000)
    const res = await page.evaluate(() => {
      const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
        return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!)
      }
      const ratio = (fg: string, bg: string) => { const [a, b] = [lum(parse(fg)), lum(parse(bg))].sort((x, y) => y - x); return (a! + 0.05) / (b! + 0.05) }
      const bgOf = (el: Element): string => { let e: Element | null = el; while (e) { const c = getComputedStyle(e).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)' && !c.endsWith(', 0)')) return c; e = e.parentElement } return 'rgb(245, 255, 253)' }
      const out: Record<string, number> = {}
      const pick = (k: string, el: Element | null | undefined) => { if (el) out[k] = ratio(getComputedStyle(el).color, bgOf(el)) }
      const byText = (sel: string, t: string) => [...document.querySelectorAll(sel)].find((e) => e.textContent?.trim().startsWith(t))
      pick('primaryButton', byText('a', 'Get started'))
      pick('outlineButton', document.querySelector('#top a[href="/login"]'))
      pick('headerLogin', document.querySelector('header a[href="/login"]'))
      pick('headerBook', document.querySelector('header a[href="/register"]'))
      pick('navActive', document.querySelector('header nav a[aria-current]'))
      pick('navOther', document.querySelector('header nav li:nth-child(2) a'))
      pick('muted', document.querySelector('#about p.text-muted'))
      pick('eyebrow', byText('p', 'WHY SMART'))
      pick('cardBody', document.querySelector('#about li p'))
      pick('stepBadge', document.querySelector('#how-it-works ol li span.rounded-full'))
      pick('ctaTitle', document.querySelector('#cta-title'))
      pick('ctaSub', document.querySelector('#cta-title + p'))
      pick('ctaWhiteButton', byText('a', 'Book appointment →'))
      pick('footerLink', document.querySelector('footer nav a'))
      pick('textLink', document.querySelector('#services a.underline, #how-it-works a.underline'))
      const accent = [...document.querySelectorAll('h1 span, h2 span')].find((s) => s.textContent === 'stand')
      if (accent) out['accentWord'] = ratio(getComputedStyle(accent).color, 'rgb(245, 255, 253)')
      return out
    })
    for (const [k, v] of Object.entries(res)) {
      const bar = k === 'accentWord' ? 3 : 4.5
      expect(v, k).toBeGreaterThanOrEqual(bar)
    }
    expect(Object.keys(res).length).toBeGreaterThanOrEqual(14)
  })

  test('the long service name wraps inside its row rather than overflowing it', async ({ page }) => {
    await open(page, 'longName', 320)
    const ok = await page.evaluate(() => {
      const li = document.querySelector('#services ul[aria-label] > li a')!
      return li.scrollWidth <= li.clientWidth + 1
    })
    expect(ok).toBe(true)
  })

  test('reduced layout shifts: the page has exactly one <main>, one h1 and each nav landmark has its own name', async ({ page }) => {
    await open(page, 'populated', 1440)
    await expect(page.getByRole('main')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    const names = await page.getByRole('navigation').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    expect(names).toEqual(['Main', 'Services', 'Learn more'])
  })
})

// ------------------------------------------------------------------------------ the real route, no backend

test.describe('the real / route with an unreachable Supabase (the offline server points at a closed port)', () => {
  test('renders for an anonymous visitor with honest unavailable states, correct fonts, and sends no write requests', async ({ page, context }) => {
    const writes: string[] = []
    await context.route('**/*', (route) => {
      const req = route.request()
      if (req.method() !== 'GET') {
        writes.push(`${req.method()} ${req.url()}`)
        return route.abort()
      }
      return route.continue()
    })
    const res = await page.goto('/', { waitUntil: 'load', timeout: 120_000 })
    expect(res!.status()).toBe(200)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Know where you stand' })).toBeVisible()
    await expect(page.getByText('We couldn’t load the current service information')).toBeVisible()
    await expect(page.getByText('Opening hours are unavailable right now.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Book appointment' }).first()).toHaveAttribute('href', '/register')
    await expect(page.getByRole('link', { name: 'Log in' }).first()).toHaveAttribute('href', '/login')
    const fonts = await page.evaluate(() => ({
      h1: getComputedStyle(document.querySelector('h1')!).fontFamily,
      body: getComputedStyle(document.querySelector('#about p.text-muted')!).fontFamily,
    }))
    expect(fonts.h1).toMatch(/hanken/i)
    expect(fonts.body).toMatch(/inter/i)
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    expect(writes).toEqual([])
  })

  test('the anchors work on the real page: Services and How it works scroll their sections into view', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/', { waitUntil: 'load', timeout: 120_000 })
    for (const [name, id] of [['Services', 'services'], ['How it works', 'how-it-works'], ['About', 'about']] as const) {
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`#${id}$`))
      const top = await page.locator(`#${id}`).evaluate((el) => Math.round(el.getBoundingClientRect().top))
      expect(top).toBeLessThan(300)
    }
  })

  test('at 320px the real page does not scroll sideways', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 })
    await page.goto('/', { waitUntil: 'load', timeout: 120_000 })
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await overflow(page)).toBeLessThanOrEqual(0)
  })
})
