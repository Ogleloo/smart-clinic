type Size = 'xl' | 'lg' | 'sm'
type Tone = 'ink' | 'white'

interface QueueTokenProps {
  token: string
  size?: Size
  /** 'ink' (default) for light surfaces; 'white' for a caller placing this on a dark/teal card — the token is the most important element on those cards and must stay readable. */
  tone?: Tone
}

/**
 * Design System: Queue token display (GC-016).
 * Purely presentational — callers own layout, labelling and context.
 */
const SIZE_STYLE: Record<Size, string> = {
  xl: 'text-[46px]',
  lg: 'text-[40px]',
  sm: 'text-lg',
}

const TONE_STYLE: Record<Tone, string> = {
  ink: 'text-ink',
  white: 'text-white',
}

export function QueueToken({ token, size = 'lg', tone = 'ink' }: QueueTokenProps) {
  return (
    <span className={`font-mono font-semibold tabular-nums ${TONE_STYLE[tone]} ${SIZE_STYLE[size]}`}>
      {token}
    </span>
  )
}
