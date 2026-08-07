interface OfflineBannerProps {
  fullWidth?: boolean
}

/** Design System: shown wherever a realtime channel drops so patients know data may be stale. Hugs its content by default — pass fullWidth to fill the parent. */
export function OfflineBanner({ fullWidth = false }: OfflineBannerProps) {
  return (
    <div
      role="status"
      className={`inline-flex items-center justify-center rounded-lg bg-warning-bg px-4 py-2 text-center text-sm font-semibold text-warning ${fullWidth ? 'w-full' : ''}`}
    >
      Connection lost — reconnecting…
    </div>
  )
}
