const router = {
  refresh() {
    window.__harness.calls.push({ name: 'router.refresh', args: [] })
  },
  push(href: string) {
    window.__harness.calls.push({ name: 'router.push', args: [href] })
  },
}

export function useRouter() {
  return router
}

export function usePathname() {
  return '/nurse/queue'
}
