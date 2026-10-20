import type { Page } from '@playwright/test'

/**
 * RECORD-ONLY observer for Server Action POSTs (a browser POST carrying a `next-action` header, sent to the URL of the page
 * that made it). It never intercepts, rewrites, delays or fulfils anything, so it cannot cause a write. A read-only spec may
 * use it to ASSERT that a page sent none; a spec that needs to intercept, forge, hold or expect Server Actions is submitting
 * something and belongs in a destructive spec (findMutationSubmissions() rejects "next-action" handling in read-only specs).
 *
 * Optionally narrowed to one path, e.g. when signing in lands on a page whose own screen reads state through a (read-only)
 * Server Action as it hydrates, and that must not be blamed on the page under test.
 */
export function observeServerActions(page: Page, onlyPath?: string): string[] {
  const posts: string[] = []
  page.on('request', (req) => {
    if (req.method() !== 'POST' || !req.headers()['next-action']) return
    if (onlyPath && new URL(req.url()).pathname !== onlyPath) return
    posts.push(req.url())
  })
  return posts
}
