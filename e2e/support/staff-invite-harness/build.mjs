/**
 * Bundles the real StaffInviteForm / PendingInvitations for a browser, with app/actions/admin swapped for an
 * in-page mock (mocks/actions.ts, records each call; the test decides each response) — no Supabase, no
 * network, no Server Action ever reached.
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
  '@/app/actions/admin': path.join(here, 'mocks/actions.ts'),
}

const swapPlugin = {
  name: 'swap-boundaries',
  setup(b) {
    const filter = new RegExp(`^(${Object.keys(swaps).map((k) => k.replace(/[/.]/g, '\\$&')).join('|')})$`)
    b.onResolve({ filter }, (args) => ({ path: swaps[args.path] }))
    // Anything that would reach a real server must have been swapped above; fail the build if not.
    b.onResolve({ filter: /^@\/lib\/supabase\/(server|client)$|^next\/cache$|^next\/headers$/ }, (args) => ({
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
