/**
 * Renders the real Nurse V3 navigation and boundary components to static HTML and compiles the app's real Tailwind
 * CSS, then prints { css, ...html } as JSON. Run by e2e/nurse-v3-landing.spec.ts through `tsx`. No network, no
 * database, no Supabase client.
 */
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { NurseSidebar } from '../../components/nurse/v3/NurseSidebar'
import { NurseMobileNav } from '../../components/nurse/v3/NurseMobileNav'
import NurseV3Loading from '../../app/nurse/(v3)/loading'
import NurseV3Error from '../../app/nurse/(v3)/error'

async function main() {
  const p = 'app/globals.css'
  const css = (await postcss([tailwind()]).process(readFileSync(p, 'utf8'), { from: p })).css
  const h = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)
  process.stdout.write(
    JSON.stringify({
      css,
      sidebar: h(createElement(NurseSidebar, { clinicName: 'Test Clinic', clinicPhone: null })),
      mobileNav: h(createElement(NurseMobileNav)),
      loading: h(createElement(NurseV3Loading)),
      error: h(createElement(NurseV3Error, { error: new Error('boom'), retry: () => {} })),
    })
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
