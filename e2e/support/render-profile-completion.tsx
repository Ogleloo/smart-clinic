/**
 * Renders the real ProfileCompletionNotice to static HTML for several profile states, and compiles the app's
 * real Tailwind CSS, then prints { states: { name: html }, css } as JSON. Run by e2e/profile-completeness.spec.ts
 * through `tsx` (Playwright's own JSX transform can't render app components). No network, no database, no Supabase
 * client is created.
 */
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { ProfileCompletionNotice } from '../../components/profile/ProfileCompletionNotice'
import { missingProfileFields } from '../../lib/profileCompleteness'

const SECRET_ID = '8001015009087' // an ID that must never appear in the notice
const render = (p: { date_of_birth: string | null; id_number: string | null }) =>
  renderToStaticMarkup(createElement(ProfileCompletionNotice, { missing: missingProfileFields(p) }))

async function main() {
  const states = {
    complete: render({ date_of_birth: '1980-01-01', id_number: SECRET_ID }),
    missingBoth: render({ date_of_birth: null, id_number: null }),
    missingDob: render({ date_of_birth: null, id_number: SECRET_ID }),
    missingId: render({ date_of_birth: '1980-01-01', id_number: null }),
  }
  const cssPath = 'app/globals.css'
  const result = await postcss([tailwind()]).process(readFileSync(cssPath, 'utf8'), { from: cssPath })
  process.stdout.write(JSON.stringify({ states, css: result.css }))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
