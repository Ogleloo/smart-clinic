import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { ADMIN_NAV_ITEMS } from '../components/admin/v3/navItems'

/**
 * Allocation Advisor page — layout, accessibility and read-only contracts. Offline: the real component and the app's
 * real compiled CSS inside the real Admin V3 shell parts, no session, no network, no database. (The route itself needs
 * a signed-in admin, so it cannot be opened offline; its role guard is checked from the source.)
 *
 * NOT covered: the interactive controls in a real browser session (the scenario logic is covered by
 * nurse-allocation-advisor.spec.ts), and the live page with real data (needs the shared project).
 */

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

type Rendered = { css: string; sidebar: string; mobileNav: string; states: Record<'live' | 'empty' | 'servicesError' | 'coverageError', string> }
let r: Rendered
test.beforeAll(() => {
  r = JSON.parse(
    execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'e2e/support/render-allocation-advisor.tsx'], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
  )
})

const doc = (content: string) =>
  `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${r.css}</style></head><body>` +
  `<div class="min-h-dvh md:flex">${r.sidebar}<div class="min-w-0 flex-1">${r.mobileNav}<main class="theme-admin min-h-dvh bg-paper text-ink">${content}</main></div></div></body></html>`
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test.describe('route, navigation and read-only contracts (source)', () => {
  test('the page is admin-guarded, and the sidebar links to it', () => {
    expect(read('app/admin/allocation-advisor/page.tsx')).toContain("requireRole('admin')")
    expect(ADMIN_NAV_ITEMS.map((i) => i.href)).toContain('/admin/allocation-advisor')
    expect(ADMIN_NAV_ITEMS.find((i) => i.href === '/admin/allocation-advisor')!.label).toBe('Allocation Lab')
  })
  test('the page sends the client only service-level aggregates (no names, ids of people, or raw rows)', () => {
    const s = read('app/admin/allocation-advisor/page.tsx')
    const sent = s.slice(s.indexOf('liveServices={'), s.indexOf('errors={{'))
    expect(sent.match(/(\w+):/g)!.sort()).toEqual(
      ['estimatedWaitMinutes:', 'isBeingServed:', 'nursesOnDuty:', 'serviceId:', 'serviceName:', 'waitingCount:']
    )
  })
  test('no mutation: the page, view and model import no write action, server action, or Supabase client', () => {
    for (const p of ['app/admin/allocation-advisor/page.tsx', 'components/admin/v3/AllocationAdvisorView.tsx', 'lib/research/nurseAllocationAdvisor.ts']) {
      const s = read(p)
      expect(s, p).not.toMatch(/from '@\/app\/actions|'use server'|createClient|\.from\(|\.rpc\(/)
    }
  })
  test('live figures are never fed into the simulation', () => {
    const view = read('components/admin/v3/AllocationAdvisorView.tsx')
    const model = read('lib/research/nurseAllocationAdvisor.ts')
    expect(model).not.toMatch(/adminDashboard|liveServices/)
    expect(view).not.toMatch(/evaluateScenario\([^)]*liveServices|useState\([^)]*liveServices/)
  })
})

test.describe('layout at 1440 / 390 / 320 (real component + real compiled CSS)', () => {
  for (const state of ['live', 'empty', 'servicesError', 'coverageError'] as const) {
    for (const width of [1440, 390, 320]) {
      test(`${state} at ${width}px: the page does not scroll sideways`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.setContent(doc(r.states[state]))
        expect(await overflow(page)).toBeLessThanOrEqual(0)
      })
    }
  }

  test('1440px: sidebar beside a content column of at most 1176px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.setContent(doc(r.states.live))
    expect((await page.locator('aside').boundingBox())!.width).toBe(264)
    const h1 = (await page.getByRole('heading', { level: 1 }).boundingBox())!
    expect(h1.x).toBeGreaterThan(264)
    const section = (await page.locator('section').first().boundingBox())!
    expect(section.width).toBeLessThanOrEqual(1176)
  })

  test('390px: sidebar hidden, mobile nav links to every admin area including Allocation Lab', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.setContent(doc(r.states.live))
    await expect(page.locator('aside')).toBeHidden()
    const nav = page.getByRole('navigation', { name: 'Main' })
    for (const i of ADMIN_NAV_ITEMS) await expect(nav.getByRole('link', { name: i.label, exact: true })).toBeAttached()
    await expect(nav.getByRole('link', { name: 'Allocation Lab', exact: true })).toHaveAttribute('href', '/admin/allocation-advisor')
  })

  test('controls: labelled, 44px+ touch targets; the Evaluate button and its status are present', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.setContent(doc(r.states.live))
    await expect(page.getByRole('heading', { level: 1, name: 'Smart Nurse Allocation Advisor' })).toBeVisible()
    const fields = page.getByRole('spinbutton')
    expect(await fields.count()).toBe(11) // 5 per service x 2 + the transfer delay
    for (let i = 0; i < (await fields.count()); i++) expect((await fields.nth(i).boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await expect(page.getByRole('combobox', { name: 'Scenario' })).toBeVisible()
    expect((await page.getByRole('combobox', { name: 'Scenario' }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
    const evaluate = page.getByRole('button', { name: 'Evaluate Allocation' })
    expect((await evaluate.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await expect(page.getByRole('status').filter({ hasText: 'Results match the current synthetic inputs' })).toBeVisible()
  })

  test('every control has an accessible name and the research disclaimers are on the page', async ({ page }) => {
    await page.setContent(doc(r.states.live))
    for (const c of await page.getByRole('spinbutton').all()) {
      const name = await c.evaluate((el) => (el as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? '')
      expect(name.length).toBeGreaterThan(0)
    }
    const body = await page.locator('main').innerText()
    expect(body).toContain('Research finding — not a staffing instruction')
    expect(body).toContain('does not use real patient or nurse data')
    expect(body).toContain('cannot reassign staff')
    expect(body).toContain('Policy comparison — synthetic only')
    expect(body).toContain('Assumptions and limitations')
  })

  test('keyboard: the scenario selector is reachable after the sidebar links and shows a focus ring', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.setContent(doc(r.states.live))
    const select = page.getByRole('combobox', { name: 'Scenario' })
    for (let i = 0; i < 40 && !(await select.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
    await expect(select).toBeFocused()
    expect(await select.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')
  })

  test('the Evaluate button text on #037F74 meets 4.5:1 and the muted body text meets 4.5:1', async ({ page }) => {
    await page.setContent(doc(r.states.live))
    const ratios = await page.evaluate(() => {
      const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
        return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!)
      }
      const ratio = (fg: string, bg: string) => {
        const [a, b] = [lum(parse(fg)), lum(parse(bg))].sort((x, y) => y - x)
        return (a! + 0.05) / (b! + 0.05)
      }
      const button = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Evaluate Allocation')!
      const bcs = getComputedStyle(button)
      const para = document.querySelector('section p.text-muted')!
      const pcs = getComputedStyle(para)
      return { button: ratio(bcs.color, bcs.backgroundColor), muted: ratio(pcs.color, 'rgb(255,255,255)') }
    })
    expect(ratios.button).toBeGreaterThanOrEqual(4.5)
    expect(ratios.muted).toBeGreaterThanOrEqual(4.5)
  })

  test('failed live reads are explicit, never zero', async ({ page }) => {
    await page.setContent(doc(r.states.servicesError))
    await expect(page.getByRole('alert')).toContainText('Services could not be loaded')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.setContent(doc(r.states.coverageError))
    await expect(page.getByRole('cell', { name: 'Unavailable' })).toBeVisible()
    await expect(page.getByText(/an unknown value is never treated as zero/)).toBeVisible()
    await page.setContent(doc(r.states.empty))
    await expect(page.getByText('There are no active services to display.')).toBeVisible()
  })
})

// ------------------------------------------------------------------------- tables, cards and scroll regions

const CARD_FIELDS = ['One hypothetical move', 'Overall mean start wait', 'General', 'Chronic', 'Unserved']
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Policy rows as [title, move, mean, general, chronic, unserved], from whichever presentation is visible. */
async function policyRows(page: Page): Promise<string[][]> {
  const table = page.getByRole('table', { name: /Hypothetical staffing-policy comparisons/ })
  if (await table.count()) {
    return table.locator('tbody tr').evaluateAll((rows) =>
      rows.map((tr) => [...tr.children].map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim()))
    )
  }
  return page.getByRole('list', { name: 'Policy comparison' }).getByRole('listitem').evaluateAll((items) =>
    items.map((li) => {
      const title = (li.querySelector('h3')?.textContent ?? '').trim()
      const values = [...li.querySelectorAll('dd')].map((d) => (d.textContent ?? '').replace(/\s+/g, ' ').trim())
      return [title, ...values]
    })
  )
}

test.describe('tables become cards below 1280px, with every value, and stay accessible', () => {
  for (const width of [320, 390, 768, 1024, 1279]) {
    test(`${width}px: no table, two labelled card lists, no sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(doc(r.states.live))
      await expect(page.getByRole('table')).toHaveCount(0)
      await expect(page.getByRole('list', { name: 'Observed services' })).toBeVisible()
      await expect(page.getByRole('list', { name: 'Policy comparison' })).toBeVisible()
      await expect(page.locator('[role="region"][tabindex]:visible')).toHaveCount(0) // no scroll region is needed (or shown) for cards
      expect(await overflow(page)).toBeLessThanOrEqual(0)
    })
  }

  test('1280px and 1440px: the two real tables, each in a focusable, named scroll region; no cards', async ({ page }) => {
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(doc(r.states.live))
      await expect(page.getByRole('table')).toHaveCount(2)
      await expect(page.getByRole('list', { name: 'Policy comparison' })).toHaveCount(0)
      for (const name of ['Observed service snapshot table', 'Policy comparison table']) {
        const region = page.getByRole('region', { name })
        await expect(region).toBeVisible()
        await expect(region).toHaveAttribute('tabindex', '0')
        await expect(region).toHaveAttribute('aria-describedby', /-hint$/)
      }
      expect(await overflow(page)).toBeLessThanOrEqual(0)
    }
  })

  test('no value is lost: the cards on a phone show exactly the values of the table on a desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.setContent(doc(r.states.live))
    const fromTable = await policyRows(page)
    await page.setViewportSize({ width: 390, height: 900 })
    const fromCards = await policyRows(page)
    expect(fromTable).toHaveLength(4)
    expect(fromCards).toEqual(fromTable)
    for (const row of fromCards) expect(row).toHaveLength(6)
    // the live snapshot too
    const live = async () => {
      const tbl = page.getByRole('table', { name: /per-service queue and staffing aggregates/ })
      if (await tbl.count()) return tbl.locator('tbody tr').evaluateAll((rows) => rows.map((tr) => [...tr.children].map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim())))
      return page.getByRole('list', { name: 'Observed services' }).getByRole('listitem').evaluateAll((items) =>
        items.map((li) => [(li.querySelector('h3')?.textContent ?? '').trim(), ...[...li.querySelectorAll('dd')].map((d) => (d.textContent ?? '').replace(/\s+/g, ' ').trim())])
      )
    }
    const liveCards = await live()
    await page.setViewportSize({ width: 1440, height: 900 })
    expect(liveCards).toEqual(await live())
    expect(liveCards).toHaveLength(2)
  })

  test('the cards and the table are fed by the same expressions (the default preset has no unserved patients, so this guards that column)', () => {
    const src = read('components/admin/v3/AllocationAdvisorView.tsx')
    for (const expr of ['moveDescription(p)', 'baselineMean(p)', 'generalMean(p)', 'chronicMean(p)', '{p.forecast.patientsUnserved}', 'liveEstimate(row, errors.coverage)']) {
      expect(src.split(expr).length - 1, expr).toBeGreaterThanOrEqual(2)
    }
  })

  test('each card labels every value (a term for each figure), so nothing relies on column position', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.setContent(doc(r.states.live))
    const cards = page.getByRole('list', { name: 'Policy comparison' }).getByRole('listitem')
    expect(await cards.count()).toBe(4)
    for (let i = 0; i < 4; i++) {
      const terms = await cards.nth(i).locator('dt').allInnerTexts()
      expect(terms.map(norm)).toEqual(CARD_FIELDS)
      await expect(cards.nth(i).getByRole('heading', { level: 3 })).toBeVisible()
    }
  })

  test('unknown values stay unknown on a card: a dash for an unserved forecast, never a number', async ({ page }) => {
    // the coverage-error snapshot has an unavailable estimate; the model preset itself has none unserved, so use the card text of the live list
    await page.setViewportSize({ width: 390, height: 900 })
    await page.setContent(doc(r.states.coverageError))
    const card = page.getByRole('list', { name: 'Observed services' }).getByRole('listitem').first()
    await expect(card).toContainText('Unavailable')
    expect(norm(await card.locator('dd').first().innerText())).toBe('—')
  })

  test('card text is large enough and has 4.5:1 contrast; cards are not scroll traps', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.setContent(doc(r.states.live))
    const min = await page.evaluate(() => {
      const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
        return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!)
      }
      let worst = 99
      let smallest = 99
      for (const el of document.querySelectorAll('ul[aria-label] dt, ul[aria-label] dd, ul[aria-label] h3')) {
        const cs = getComputedStyle(el)
        const [a, b] = [lum(parse(cs.color)), lum([255, 255, 255])].sort((x, y) => y - x)
        worst = Math.min(worst, (a! + 0.05) / (b! + 0.05))
        smallest = Math.min(smallest, parseFloat(cs.fontSize))
      }
      return { worst, smallest }
    })
    expect(min.worst).toBeGreaterThanOrEqual(4.5)
    expect(min.smallest).toBeGreaterThanOrEqual(12)
    await expect(page.locator('ul[aria-label] [tabindex]')).toHaveCount(0)
  })
})

test.describe('scroll hint and keyboard scrolling on a table that is narrower than it needs to be', () => {
  /** Show the real comparison table at 1440px but inside a container of the given width. */
  async function narrow(page: Page, px: number) {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.setContent(doc(r.states.live))
    await page.evaluate((w) => {
      const holder = document.querySelector<HTMLElement>('[aria-label="Policy comparison table"]')!.closest('.hidden')!
      ;(holder as HTMLElement).style.width = `${w}px`
    }, px)
  }
  const HINT = 'Swipe or scroll horizontally to view more columns'

  test('visible hint exactly when the table overflows its container (and gone when it fits)', async ({ page }) => {
    await narrow(page, 500)
    const hint = page.locator('#allocation-comparison-table-hint')
    await expect(hint).toBeVisible()
    await expect(hint).toHaveText(HINT)
    await expect(page.locator('#allocation-live-table-hint')).toBeHidden() // the other table fits, so no hint for it
    const region = page.getByRole('region', { name: 'Policy comparison table' })
    const [client, scroll] = await region.evaluate((el) => [el.clientWidth, el.scrollWidth])
    expect(scroll).toBeGreaterThan(client)
    await narrow(page, 900)
    await expect(hint).toBeHidden()
    const [c2, s2] = await region.evaluate((el) => [el.clientWidth, el.scrollWidth])
    expect(s2).toBeLessThanOrEqual(c2)
  })

  test('the hint is the region’s accessible description, in the document order before the table', async ({ page }) => {
    await narrow(page, 500)
    const region = page.getByRole('region', { name: 'Policy comparison table' })
    const id = await region.getAttribute('aria-describedby')
    const text = await page.locator(`[id="${id}"]`).evaluate((el) => (el.textContent ?? '').trim())
    expect(text).toBe(HINT)
    const order = await page.evaluate((i) => {
      const hint = document.getElementById(i)!
      const reg = hint.nextElementSibling!
      return { adjacent: reg.getAttribute('role') === 'region' }
    }, id!)
    expect(order.adjacent).toBe(true)
    expect(await page.getByText(HINT).count()).toBeGreaterThanOrEqual(1)
  })

  test('keyboard only: Tab reaches the region, a visible focus ring appears, and the arrow keys scroll it to the far edge and back', async ({ page }) => {
    await narrow(page, 500)
    const region = page.getByRole('region', { name: 'Policy comparison table' })
    for (let i = 0; i < 60 && !(await region.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
    await expect(region).toBeFocused()
    expect(await region.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')
    expect(await region.evaluate((el) => el.scrollLeft)).toBe(0)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    // keep pressing ArrowRight until the far edge is reached: every column becomes reachable without a mouse
    for (let i = 0; i < 40 && !(await region.evaluate((el) => el.scrollLeft + el.clientWidth >= el.scrollWidth - 1)); i++) await page.keyboard.press('ArrowRight')
    expect(await region.evaluate((el) => el.scrollLeft + el.clientWidth >= el.scrollWidth - 1)).toBe(true)
    for (let i = 0; i < 40 && (await region.evaluate((el) => el.scrollLeft)) > 0; i++) await page.keyboard.press('ArrowLeft')
    expect(await region.evaluate((el) => el.scrollLeft)).toBe(0)
  })

  test('the observed-snapshot table has the same hint and region', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.setContent(doc(r.states.live))
    await page.evaluate(() => {
      ;(document.querySelector<HTMLElement>('[aria-label="Observed service snapshot table"]')!.closest('.hidden') as HTMLElement).style.width = '400px'
    })
    await expect(page.getByText(HINT).first()).toBeVisible()
    const region = page.getByRole('region', { name: 'Observed service snapshot table' })
    await expect(page.locator('#allocation-live-table-hint')).toBeVisible()
    await region.focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  })
})

test.describe('no assignment actions, and the formulas are the package’s', () => {
  test('the only button on the page is "Evaluate Allocation"; there are no forms and no assignment wording', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.setContent(doc(r.states.live))
    const buttons = await page.locator('main button').allInnerTexts()
    expect(buttons.map(norm)).toEqual(['Evaluate Allocation'])
    expect(await page.locator('main form').count()).toBe(0)
    const body = (await page.locator('main').innerText()).toLowerCase()
    expect(body).not.toMatch(/\b(assign now|approve|confirm transfer|apply this move|move this nurse|notify)\b/)
  })

  test('the simulation module is byte-for-byte the handoff package’s (formulas unchanged)', () => {
    const digest = createHash('sha256').update(read('lib/research/nurseAllocationAdvisor.ts')).digest('hex')
    expect(digest).toBe('aa30a0d4977cdc93bb5b501f4fd2b7e06671ba0964e2a06ed975aaeaa8ded930')
  })
})

test.describe('research note states the real status', () => {
  const doc$ = read('docs/research/ALLOCATION_ADVISOR_MVP.md')
  const status = doc$.slice(0, doc$.indexOf('## What exists in the integrated code'))

  test('status block: draft PR #43, preview built, not merged / deployed / validated', () => {
    expect(status).toContain('draft PR #43')
    expect(status).toMatch(/Vercel preview[^|]*\*\*built successfully\*\*/)
    expect(status).toMatch(/\*\*No authenticated preview acceptance has been done yet|No authenticated preview acceptance/)
    expect(status).toMatch(/Merged \| \*\*No\.\*\*/)
    expect(status).toMatch(/Production \| \*\*Not deployed to production\.\*\*/)
    expect(status).toMatch(/Clinical validation \| \*\*Not clinically validated\.\*\*/)
  })

  test('it no longer claims to be an uncommitted package, and it states what it is not', () => {
    expect(doc$).not.toContain('NOT committed, reviewed, merged or deployed')
    expect(status).toContain('not a staffing tool')
    expect(doc$).toMatch(/not a validated staffing tool/)
    expect(doc$).not.toMatch(/production-ready/i)
  })

  test('keeps the small TypeScript snapshot model distinct from the eight-round WANR research', () => {
    expect(doc$).toMatch(/Eight-round WANR research/)
    expect(doc$).toMatch(/not a port of the standalone Python WANR discrete-event simulator/)
    expect(doc$).toContain('107,300 policy-day evaluations')
    expect(doc$).toMatch(/reproduces none of those results/)
  })

  test('says what is and is not verified, and that the authenticated preview review is still pending', () => {
    expect(doc$).toContain('## What has and has not been verified')
    expect(doc$).toMatch(/an authenticated admin opening the route on the preview/)
    expect(doc$).toMatch(/PR #43 remains a draft/)
    expect(doc$).toMatch(/Swipe or scroll horizontally to view more columns/)
  })

  test('describes only what exists: no assignment, write, server action, migration or RLS change', () => {
    expect(doc$).toMatch(/Not present, by design:[^\n]*assigns, moves, approves or notifies a nurse/)
  })
})
