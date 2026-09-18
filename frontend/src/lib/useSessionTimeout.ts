/**
 * useSessionTimeout — tracks user inactivity and fires callbacks.
 *
 * Timeline:
 *   0 ─────────── activity resets timer ──────────── 28 min ── 30 min
 *                                                     ↑ warn    ↑ expire
 *
 * Usage:
 *   const { remaining, isWarning, extend } = useSessionTimeout({
 *     warnAfterMs:   28 * 60 * 1000,
 *     expireAfterMs: 30 * 60 * 1000,
 *     onExpire: () => { saveFormDraft(); logout() },
 *   })
 */

import { useState, useEffect, useRef, useCallback } from 'react'

export interface SessionTimeoutOptions {
  /** Milliseconds of inactivity before showing warning (default: 28 min) */
  warnAfterMs?: number
  /** Milliseconds of inactivity before auto-logout (default: 30 min) */
  expireAfterMs?: number
  /** Called when session expires — perform logout + any cleanup here */
  onExpire: () => void
  /** Called when warning threshold is crossed */
  onWarn?: () => void
}

export interface SessionTimeoutState {
  /** Seconds remaining before expire, or null when not in warning phase */
  remaining: number | null
  /** True when the warning modal should be visible */
  isWarning: boolean
  /** Reset the inactivity timer (user clicked "Stay logged in") */
  extend: () => void
}

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'] as const

export function useSessionTimeout({
  warnAfterMs   = 28 * 60 * 1000,
  expireAfterMs = 30 * 60 * 1000,
  onExpire,
  onWarn,
}: SessionTimeoutOptions): SessionTimeoutState {
  const [isWarning, setIsWarning]   = useState(false)
  const [remaining, setRemaining]   = useState<number | null>(null)

  const lastActivityRef = useRef(Date.now())
  const warnTimerRef    = useRef<ReturnType<typeof setTimeout>>()
  const expireTimerRef  = useRef<ReturnType<typeof setTimeout>>()
  const tickRef         = useRef<ReturnType<typeof setInterval>>()
  const onExpireRef     = useRef(onExpire)
  const onWarnRef       = useRef(onWarn)

  // Keep refs current without re-scheduling timers
  useEffect(() => { onExpireRef.current = onExpire }, [onExpire])
  useEffect(() => { onWarnRef.current   = onWarn   }, [onWarn])

  const clearTimers = useCallback(() => {
    clearTimeout(warnTimerRef.current)
    clearTimeout(expireTimerRef.current)
    clearInterval(tickRef.current)
  }, [])

  const scheduleTimers = useCallback(() => {
    clearTimers()
    setIsWarning(false)
    setRemaining(null)

    warnTimerRef.current = setTimeout(() => {
      setIsWarning(true)
      onWarnRef.current?.()

      // Start countdown tick
      const warningDurationSec = Math.round((expireAfterMs - warnAfterMs) / 1000)
      setRemaining(warningDurationSec)
      tickRef.current = setInterval(() => {
        setRemaining(r => {
          if (r === null || r <= 1) return 0
          return r - 1
        })
      }, 1000)
    }, warnAfterMs)

    expireTimerRef.current = setTimeout(() => {
      clearTimers()
      setIsWarning(false)
      setRemaining(null)
      onExpireRef.current()
    }, expireAfterMs)
  }, [warnAfterMs, expireAfterMs, clearTimers])

  // Extend: reset timers and clear warning
  const extend = useCallback(() => {
    lastActivityRef.current = Date.now()
    scheduleTimers()
  }, [scheduleTimers])

  // Activity listener — throttle resets to once per 10s
  useEffect(() => {
    let lastReset = 0

    const handleActivity = () => {
      const now = Date.now()
      if (now - lastReset < 10_000) return   // throttle
      lastReset = now
      lastActivityRef.current = now

      // Only reschedule if not already in warning phase (avoid annoying resets mid-countdown)
      setIsWarning(w => {
        if (!w) scheduleTimers()
        return w
      })
    }

    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, handleActivity, { passive: true }))
    scheduleTimers()   // start timers on mount

    return () => {
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, handleActivity))
      clearTimers()
    }
  }, [scheduleTimers, clearTimers])

  return { remaining, isWarning, extend }
}
