/**
 * Renders the real ProfileSettingsForm / QuickActions to static HTML for a few profile states, and compiles
 * the app's real Tailwind CSS, then prints { states: { name: html }, css } as JSON. Run by
 * e2e/profile-settings-render.spec.ts through `tsx` (Playwright's own JSX transform can't render app
 * components). No network, no database, no Supabase client is created or called — the Server Actions are
 * only referenced (passed to useActionState), never invoked, since nothing here ever submits a form.
 */
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { ProfileSettingsForm, QuickActions, type QuickActionsProps } from '../../components/profile/ProfileSettingsForm'

const BASE = {
  fullName: 'Thabo Mokoena',
  phone: '082 123 4567',
  dateOfBirth: '1980-01-01',
  idNumber: '8001015009087',
  email: 'thabo@example.com',
  roleLabel: 'Patient',
  clinicName: 'Riverside Clinic',
  today: '2026-11-02',
}

async function main() {
  const states = {
    complete: renderToStaticMarkup(createElement(ProfileSettingsForm, BASE)),
    missingIdentity: renderToStaticMarkup(
      createElement(ProfileSettingsForm, { ...BASE, dateOfBirth: null, idNumber: null }),
    ),
    noClinic: renderToStaticMarkup(createElement(ProfileSettingsForm, { ...BASE, clinicName: null })),
    // A legacy value that predates the document-type choice — letters and a dash, not 13 digits. It must start
    // in the Passport field, the only one of the two that can show it without the SA ID field's digit filter
    // mangling it down to "12" on the very first render.
    legacyPassportShaped: renderToStaticMarkup(createElement(ProfileSettingsForm, { ...BASE, idNumber: 'AB-12' })),
    quickActions: renderToStaticMarkup(createElement(QuickActions)),
    // What /profile/settings?panel=password renders — the dashboard's "Change password" shortcut.
    quickActionsPasswordOpen: renderToStaticMarkup(createElement<QuickActionsProps>(QuickActions, { initialOpenPassword: true })),
  }
  const cssPath = 'app/globals.css'
  const result = await postcss([tailwind()]).process(readFileSync(cssPath, 'utf8'), { from: cssPath })
  process.stdout.write(JSON.stringify({ states, css: result.css }))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
