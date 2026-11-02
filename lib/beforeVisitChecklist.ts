/**
 * What a patient is actually told to prepare for a visit — the same four items regardless of where this
 * appears (the appointment details page, the booking wizard's review step, the booking confirmation screen).
 * A single source so none of them can quietly drift from each other, and so nothing describes a promise the
 * system doesn't keep (no arrival-time requirement, no reminder notification — neither is implemented).
 */
export const BEFORE_VISIT_CHECKLIST = [
  'Bring your ID document or passport.',
  'Bring any medication you are currently taking, or a list of it.',
  'Bring your clinic card, referral letter or test results if you have them.',
  'Check in at reception when you arrive — your queue token is issued then.',
] as const
