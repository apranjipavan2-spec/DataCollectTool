/**
 * SessionTimeoutModal — shown when the session is about to expire.
 *
 * Features:
 * - Countdown ring (SVG) that shrinks as time runs out
 * - "Stay logged in" resets the timer
 * - "Log out now" triggers immediate logout
 * - Auto-dismisses when remaining hits 0 (parent handles logout)
 */


interface Props {
  /** Seconds remaining until auto-logout */
  remaining: number | null
  /** Called when user clicks "Stay logged in" */
  onExtend: () => void
  /** Called when user clicks "Log out now" */
  onLogout: () => void
}

const WARN_SECS = 120   // max value for the countdown ring (should match expireAfterMs - warnAfterMs)

export default function SessionTimeoutModal({ remaining, onExtend, onLogout }: Props) {
  if (remaining === null) return null

  // SVG ring params
  const R     = 28
  const CIRC  = 2 * Math.PI * R
  const frac  = Math.max(0, Math.min(1, remaining / WARN_SECS))
  const dash  = frac * CIRC
  const isUrgent = remaining <= 30

  const mins = Math.floor(remaining / 60)
  const secs = remaining % 60
  const label = mins > 0
    ? `${mins}:${secs.toString().padStart(2, '0')}`
    : `${secs}s`

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      aria-modal="true"
      role="alertdialog"
      aria-labelledby="timeout-title"
    >
      <div className="bg-catalan-surface border border-catalan-border rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col items-center gap-5">

        {/* Countdown ring */}
        <div className="relative w-20 h-20 flex-shrink-0">
          <svg width="80" height="80" className="-rotate-90">
            {/* Track */}
            <circle cx="40" cy="40" r={R} fill="none" strokeWidth="5"
              className="stroke-catalan-border" />
            {/* Progress */}
            <circle cx="40" cy="40" r={R} fill="none" strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${CIRC}`}
              className={isUrgent ? 'stroke-catalan-error' : 'stroke-catalan-warning'}
              style={{ transition: 'stroke-dasharray 1s linear, stroke 0.5s' }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`font-bold text-sm tabular-nums ${isUrgent ? 'text-catalan-error' : 'text-catalan-warning'}`}>
              {label}
            </span>
          </div>
        </div>

        {/* Text */}
        <div className="text-center space-y-1.5">
          <h2 id="timeout-title" className="text-base font-semibold text-catalan-text">
            Session expiring soon
          </h2>
          <p className="text-sm text-catalan-textMuted">
            You've been inactive. Your session will automatically end in{' '}
            <span className={`font-semibold ${isUrgent ? 'text-catalan-error' : 'text-catalan-warning'}`}>
              {label}
            </span>
            .
          </p>
          {remaining <= 60 && (
            <p className="text-xs text-catalan-textMuted/70 mt-1">
              Any unsaved form data has been saved as a draft.
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 w-full">
          <button
            onClick={onExtend}
            className="flex-1 px-4 py-2.5 bg-catalan-primary text-catalan-bg rounded-xl text-sm font-semibold hover:bg-catalan-primary/80 transition-colors"
            autoFocus
          >
            Stay logged in
          </button>
          <button
            onClick={onLogout}
            className="flex-1 px-4 py-2.5 border border-catalan-border text-catalan-textMuted rounded-xl text-sm hover:bg-catalan-hover hover:text-catalan-text transition-colors"
          >
            Log out now
          </button>
        </div>
      </div>
    </div>
  )
}
