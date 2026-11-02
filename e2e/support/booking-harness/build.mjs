/**
 * Bundles the real BookingWizard for a browser, with every boundary to the outside world replaced by an
 * in-page mock:
 *   @/app/actions/appointments -> mocks/actions.ts   (records each call; the test decides each response)
 *   @/lib/supabase/client       -> mocks/supabase.ts  (records each rpc call; the test decides each response)
 *   next/link                   -> mocks/next-link.tsx
 * Everything else — the step machine, the stale-response guard, the calendar, the slot grid — is the
 * production code.
 *
 * Usage: node build.mjs <outfile>
 */
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const outfile = process.argv[2]
if (!outfile) throw new Error('usage: node build.mjs <outfile>')

const swaps = {
  '@/app/actions/appointments': path.join(here, 'mocks/actions.ts'),
  '@/lib/supabase/client': path.join(here, 'mocks/supabase.ts'),
  'next/link': path.join(here, 'mocks/next-link.tsx'),
}

const swapPlugin = {
  name: 'swap-boundaries',
  setup(b) {
    const filter = new RegExp(`^(${Object.keys(swaps).map((k) => k.replace(/[/.]/g, '\\$&')).join('|')})$`)
    b.onResolve({ filter }, (args) => ({ path: swaps[args.path] }))
    // Anything that would reach a real server must have been swapped above; fail the build if not.
    b.onResolve({ filter: /^@\/lib\/supabase\/server$|^next\/cache$|^next\/headers$|^next\/navigation$/ }, (args) => ({
      errors: [{ text: `harness must not bundle ${args.path} (imported by ${args.importer})` }],
    }))
  },
}

await build({
  entryPoints: [path.join(here, 'entry.tsx')],
  bundle: true,
  outfile,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  target: 'es2022',
  absWorkingDir: root,
  tsconfig: path.join(root, 'tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [swapPlugin],
  logLevel: 'error',
})
