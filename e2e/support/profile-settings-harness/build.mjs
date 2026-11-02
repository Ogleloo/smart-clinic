/**
 * Bundles the real ProfileSettingsForm for a browser, with every boundary to the outside world replaced by an
 * in-page mock:
 *   @/app/actions/profile -> mocks/profile-actions.ts (records each call; returns the test-configured response)
 *   @/app/actions/auth    -> mocks/auth-actions.ts     (logout() only, recorded)
 *   next/link              -> the nurse-queue-harness's own next-link mock (a plain <a>; no router context exists here)
 * Everything else — the component itself, lib/profileEditValidation.ts, components/ui/* — is the production code.
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
  '@/app/actions/profile': path.join(here, 'mocks/profile-actions.ts'),
  '@/app/actions/auth': path.join(here, 'mocks/auth-actions.ts'),
  'next/link': path.join(here, '../nurse-queue-harness/mocks/next-link.tsx'),
}

const swapPlugin = {
  name: 'swap-boundaries',
  setup(b) {
    const filter = new RegExp(`^(${Object.keys(swaps).map((k) => k.replace(/[/.]/g, '\\$&')).join('|')})$`)
    b.onResolve({ filter }, (args) => ({ path: swaps[args.path] }))
    // Anything that would reach a real server must have been swapped above; fail the build if not.
    b.onResolve({ filter: /^@\/lib\/supabase\/server$|^next\/cache$|^next\/headers$/ }, (args) => ({
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
