import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  headline: string
  body?: string
  action?: ReactNode
  fullWidth?: boolean
}

/** Design System: Empty state. Used wherever a list or section has nothing to show. Hugs its content by default — pass fullWidth to fill the parent (a plain div is block-level and would stretch otherwise). */
export function EmptyState({ icon, headline, body, action, fullWidth = false }: EmptyStateProps) {
  return (
    <div
      className={`inline-flex flex-col items-center gap-2 rounded-lg border border-border bg-surface px-6 py-8 text-center ${fullWidth ? 'w-full' : ''}`}
    >
      {icon && (
        <div className="text-muted" aria-hidden>
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-ink">{headline}</p>
      {body && <p className="text-sm text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
