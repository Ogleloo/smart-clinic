import type { MyQueueStatus } from '@/lib/nurseQueue'

/**
 * Status pills for My Queue. Figma's pill colours (#F59E0B on #FFF8E6, #10B981 on #E6FBF4) are far below
 * WCAG AA for 13px text, so the same hues are darkened — the Waiting pair is the one the dashboard already uses.
 * The word always carries the meaning; colour is never the only cue.
 */
const PILL = 'inline-flex items-center whitespace-nowrap rounded-[12px] px-2.5 py-[5px] text-[13px] leading-[18px]'

export const PILL_CLASSES: Record<MyQueueStatus | 'emergency', string> = {
  waiting: `${PILL} bg-[#FFF5DB] text-[#8A5600]`,
  in_consultation: `${PILL} bg-primary-50 text-[#037F74]`,
  completed: `${PILL} bg-[#ECFDF3] text-[#067647]`,
  emergency: `${PILL} bg-danger-bg text-[#B42318]`,
}

export const STATUS_LABEL: Record<MyQueueStatus, string> = {
  waiting: 'Waiting',
  in_consultation: 'In consultation',
  completed: 'Completed',
}

export function StatusPill({ status }: { status: MyQueueStatus }) {
  return <span className={PILL_CLASSES[status]}>{STATUS_LABEL[status]}</span>
}

export function EmergencyPill() {
  return <span className={PILL_CLASSES.emergency}>Emergency</span>
}
