type Size = 'lg' | 'sm'

interface QueueTokenProps {
  token: string
  size?: Size
}

/**
 * Design System: Queue token display (GC-016).
 * Purely presentational — callers own layout, labelling and context.
 */
const SIZE_STYLE: Record<Size, string> = {
  lg: 'text-[40px]',
  sm: 'text-lg',
}

export function QueueToken({ token, size = 'lg' }: QueueTokenProps) {
  return (
    <span className={`font-mono font-semibold tabular-nums text-ink ${SIZE_STYLE[size]}`}>
      {token}
    </span>
  )
}
