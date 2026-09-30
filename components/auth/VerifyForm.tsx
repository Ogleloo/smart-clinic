'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

const RESEND_COOLDOWN_SECONDS = 60

interface VerifyFormProps {
  email: string
}

/**
 * Signup now confirms via a 6-digit code (verifyOtp), not an email
 * link — the account isn't usable until this succeeds, however the
 * signUp() call itself behaved (see app/actions/auth.ts's register()).
 * Runs entirely client-side: verifyOtp/resend both need the browser's
 * own Supabase client so a successful verification's session lands in
 * the cookies this app's middleware and Server Components already read
 * (createBrowserClient from @supabase/ssr keeps the two in sync).
 */
export function VerifyForm({ email }: VerifyFormProps) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [code, setCode] = useState('')
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [resendMessage, setResendMessage] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

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

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (submittingRef.current) return
    submittingRef.current = true
    setVerifying(true)
    setVerifyError(null)

    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'signup' })

    submittingRef.current = false
    if (error) {
      setVerifying(false)
      setVerifyError('That code is not correct or has expired.')
      return
    }

    router.push('/dashboard')
  }

  async function handleResend() {
    if (cooldown > 0 || resendState === 'sending') return
    setResendState('sending')
    setResendMessage(null)

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
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6">
      <div className="h-14 w-14 rounded-full bg-primary-700" aria-hidden />
      <h1 className="font-display text-[26px] font-bold text-ink">Verify your email</h1>
      <p className="text-center text-sm text-muted">
        We sent a 6-digit code to <span className="font-semibold text-ink">{email}</span>
      </p>

      <form onSubmit={handleVerify} className="flex w-full flex-col gap-4">
        <Input
          label="Verification code"
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          placeholder="123456"
          className="text-center font-mono text-lg tracking-[0.4em]"
        />

        {verifyError && (
          <p role="alert" className="text-sm font-semibold text-danger">
            {verifyError}
          </p>
        )}

        <Button type="submit" fullWidth loading={verifying} disabled={code.length !== 6}>
          Verify
        </Button>
      </form>

      <div className="flex flex-col items-center gap-1.5">
        <Button
          type="button"
          variant="tertiary"
          onClick={handleResend}
          loading={resendState === 'sending'}
          disabled={cooldown > 0}
        >
          {cooldown > 0 ? `Send a new code (${cooldown}s)` : 'Send a new code'}
        </Button>
        {resendMessage && (
          <p
            role={resendState === 'error' ? 'alert' : 'status'}
            className={`text-sm font-semibold ${resendState === 'error' ? 'text-danger' : 'text-success'}`}
          >
            {resendMessage}
          </p>
        )}
      </div>
    </main>
  )
}
