/** Design System: shown wherever a realtime channel drops so patients know data may be stale. */
export function OfflineBanner() {
  return (
    <div
      role="status"
      className="rounded-lg bg-warning-bg px-4 py-2 text-center text-sm font-semibold text-warning"
    >
      Connection lost — reconnecting…
    </div>
  )
}
