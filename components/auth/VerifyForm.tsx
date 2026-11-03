'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { homeForRole } from '@/lib/auth/homeForRole'
import { AuthBrand, AuthShell } from '@/components/auth/v3/AuthShell'
import { BTN_PRIMARY, HEADING, LINK } from '@/components/auth/v3/authStyles'

const RESEND_COOLDOWN_SECONDS = 60
const DIGITS = 6

interface VerifyFormProps {
  email: string
}

/**
 * Patient V3 verify account (Figma 45:68).
 *
 * Signup confirms via a 6-digit code (verifyOtp), not an email link — the account isn't usable until this
 * succeeds, however the signUp() call itself behaved (see app/actions/auth.ts's register()). Runs entirely
 * client-side: verifyOtp/resend both need the browser's own Supabase client so a successful verification's
 * session lands in the cookies this app's middleware and Server Components already read.
 *
 * Wording: Figma says "We've sent a 6-digit verification code to …". Nothing here can support that claim —
 * signing up with an address that already has an account returns success without sending anything, and saying
 * otherwise would both be untrue and leak whether the address is registered. The heading therefore states what
 * the code is for, and only a resend that Supabase accepted reports that a code is on its way.
 */
export function VerifyForm({ email }: VerifyFormProps) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [digits, setDigits] = useState<string[]>(() => Array(DIGITS).fill(''))
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const boxes = useRef<(HTMLInputElement | null)[]>([])
  const labelId = useId()
  const helperId = useId()

  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [resendMessage, setResendMessage] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  const code = digits.join('')

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  // A submit in flight must not race a resend that invalidates the
  // code partway through typing it — same idempotency-adjacent
  // reasoning as the nurse workflow: don't let two async actions
  // interleave on the one thing that matters (the code just typed).
  const submittingRef = useRef(false)
  // The same reasoning applies to resend on its own: `resendState` is read from the closure, so two same-tick
  // clicks on "Resend code" (synthetic, or a very fast double-tap) both see it still 'idle' before either
  // setResendState('sending') has rendered. A ref is synchronous across both calls, same as submittingRef above.
  const resendingRef = useRef(false)

  /** Writes `value` (already digits only) from box `start` onward, and parks focus on the last box it filled. */
  function fill(start: number, value: string) {
    if (!value) return
    setDigits((prev) => {
      const next = [...prev]
      for (let i = 0; i < value.length && start + i < DIGITS; i++) next[start + i] = value[i]!
      return next
    })
    const last = Math.min(start + value.length, DIGITS - 1)
    boxes.current[last]?.focus()
  }

  function handleChange(index: number, raw: string) {
    const value = raw.replace(/\D/g, '')
    if (!value) {
      setDigits((prev) => {
        const next = [...prev]
        next[index] = ''
        return next
      })
      return
    }
    // One character normally; a whole code when the browser autofills the box from an email.
    fill(index, value.slice(0, DIGITS - index))
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      e.preventDefault()
      setDigits((prev) => {
        const next = [...prev]
        next[index - 1] = ''
        return next
      })
      boxes.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault()
      boxes.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowRight' && index < DIGITS - 1) {
      e.preventDefault()
      boxes.current[index + 1]?.focus()
    }
  }

  function handlePaste(index: number, e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '')
    if (!pasted) return
    e.preventDefault()
    fill(index, pasted.slice(0, DIGITS - index))
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    // resendingRef (not just resendState) guards the same-tick case: a resend's ref flips synchronously the
    // instant its click handler runs, before React has rendered the state update, so a Verify click landing in
    // the same tick right after a Resend click must still see it. A resend in flight can also invalidate the
    // very code about to be submitted, so the two actions are mutually exclusive, not just each non-reentrant.
    if (submittingRef.current || resendingRef.current || resendState === 'sending' || code.length !== DIGITS) return
    submittingRef.current = true
    setVerifying(true)
    setVerifyError(null)

    try {
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'signup' })
      if (error) {
        setVerifyError('That code is not correct or has expired.')
        return
      }

      // Staff onboarding (migration 0053). Safe and idempotent for every user: accept_staff_invitation()
      // does nothing unless an open, unexpired invitation exists for the caller's now-VERIFIED address, so a
      // patient signing up normally gets {status:'none'} and keeps the 'patient' role handle_new_user() gave
      // them. The database decides entirely — the browser passes no role, no email and no invitation id, and
      // the function re-reads the verified address from auth.users itself.
      //
      // A failure here must not strand a successfully verified account: the verification itself already
      // succeeded, so we fall through to the patient dashboard rather than showing an error for something the
      // person cannot act on. An invitation that was missed this way is still open, and applies on next sign-in
      // if that call is reached again.
      let destination = '/dashboard'
      try {
        const { data: accepted } = await supabase.rpc('accept_staff_invitation')
        const status = (accepted as { status?: string; role?: string } | null)?.status
        const role = (accepted as { status?: string; role?: string } | null)?.role
        if (status === 'accepted' && (role === 'nurse' || role === 'receptionist')) {
          destination = homeForRole(role)
        }
      } catch {
        // Network/RPC failure — keep the verified session and land on the patient dashboard.
      }

      // The role just changed server-side, so the cached session's claims are stale. Refreshing before
      // navigating means the destination's own requireRole() guard sees the new role rather than bouncing
      // a freshly-activated nurse straight back out.
      await supabase.auth.refreshSession()
      router.push(destination)
      router.refresh()
    } catch {
      // A thrown error (offline, DNS failure, the request never reaching Supabase at all) is not a
      // {error} response and would otherwise leave `verifying` true and the button disabled forever.
      setVerifyError("Couldn't verify right now. Check your connection and try again.")
    } finally {
      submittingRef.current = false
      setVerifying(false)
    }
  }

  async function handleResend() {
    // submittingRef guards the same-tick case the same way resendingRef does above: a Verify click's ref flips
    // synchronously before React renders `verifying`, so a Resend click landing in the same tick right after a
    // Verify click must still see it — `verifying` alone (a same-tick-stale state read) would not catch it.
    // resendingRef guards resend's own same-tick re-entrancy; the remaining checks guard the normal case
    // (cooldown, an earlier resend still sending, or a verify already confirmed in flight).
    if (resendingRef.current || submittingRef.current || cooldown > 0 || resendState === 'sending' || verifying) return
    resendingRef.current = true
    setResendState('sending')
    setResendMessage(null)

    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email })
      if (error) {
        setResendState('error')
        // The hourly cap gets its own message — anything else risks
        // implying an email went out when it didn't.
        setResendMessage(
          error.code === 'over_email_send_rate_limit'
            ? 'Too many requests, please wait a few minutes.'
            : "Couldn't send a new code. Try again."
        )
        return
      }
      setResendState('sent')
      setResendMessage('A new code is on its way.')
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } catch {
      // Same as verify: a thrown error must not leave resendState stuck at 'sending' (which would permanently
      // disable the resend control, since cooldown never started).
      setResendState('error')
      setResendMessage("Couldn't send a new code. Try again.")
    } finally {
      resendingRef.current = false
    }
  }

  return (
    <AuthShell>
      <div className="flex flex-col items-center gap-8">
        <AuthBrand />

        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className={HEADING}>Verify your account</h1>
          <p className="text-base leading-6 text-muted">
            Enter the 6-digit verification code for <span className="font-semibold text-[#037F74]">{email}</span>
          </p>
        </div>

        <form onSubmit={handleVerify} className="flex w-full flex-col gap-8">
          <div className="flex flex-col items-center gap-3">
            <span id={labelId} className="sr-only">
              Verification code
            </span>
            <div
              role="group"
              aria-labelledby={labelId}
              aria-describedby={helperId}
              className="grid w-full grid-cols-6 gap-2 sm:flex sm:justify-center sm:gap-4"
            >
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    boxes.current[i] = el
                  }}
                  value={digit}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  onPaste={(e) => handlePaste(i, e)}
                  onFocus={(e) => e.target.select()}
                  aria-label={`Digit ${i + 1} of 6`}
                  aria-invalid={!!verifyError}
                  inputMode="numeric"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  // maxLength 6, not 1: a browser autofilling the whole code into the first box must not be
                  // truncated — handleChange spreads it across the row.
                  maxLength={DIGITS}
                  className={`h-14 w-full rounded-[12px] border bg-surface text-center font-display text-2xl font-semibold text-ink
                    focus:border-[#037F74] focus:outline-none sm:h-[76px] sm:w-[70px]
                    ${verifyError ? 'border-[1.5px] border-danger' : 'border-border'}`}
                />
              ))}
            </div>
            <p id={helperId} className="text-center text-xs leading-[18px] text-muted">
              Codes are sent by email and expire after a short time. You can request a new one below.
            </p>
          </div>

          {verifyError && (
            <p role="alert" className="text-center text-sm font-semibold text-danger">
              {verifyError}
            </p>
          )}

          <button
            type="submit"
            className={BTN_PRIMARY}
            disabled={verifying || resendState === 'sending' || code.length !== DIGITS}
          >
            {verifying ? 'Verifying…' : 'Verify account →'}
          </button>
        </form>

        <div className="flex flex-col items-center gap-2">
          <p className="flex flex-wrap items-center justify-center gap-1 text-sm font-semibold text-muted">
            Didn&rsquo;t receive the code?{' '}
            <button
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0 || resendState === 'sending' || verifying}
              className={`${LINK} min-h-11 disabled:cursor-not-allowed disabled:text-muted disabled:no-underline`}
            >
              {resendState === 'sending' ? 'Sending…' : cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
            </button>
          </p>
          {resendMessage && (
            <p
              role={resendState === 'error' ? 'alert' : 'status'}
              className={`text-sm font-semibold ${resendState === 'error' ? 'text-danger' : 'text-[#037F74]'}`}
            >
              {resendMessage}
            </p>
          )}
          <Link href="/register" className="inline-flex min-h-11 items-center text-sm font-semibold text-muted hover:text-ink">
            ← Back to create account
          </Link>
        </div>
      </div>
    </AuthShell>
  )
}
