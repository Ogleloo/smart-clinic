/**
 * The `test` the destructive specs use. It is the local-only guarded test from local-stack.ts: every browser context
 * blocks and records requests/WebSockets to any non-local Supabase host, and opening a browser WITHOUT a verified local
 * target (LOCAL_SUPABASE_* + E2E_BASE_URL, validated by e2e/support/e2e-safety.ts) throws. A spec that wrote to the
 * shared project by mistake would therefore fail before its first navigation.
 */
export { test, expect, guardedContext } from './local-stack'
