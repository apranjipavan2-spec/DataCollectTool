import { useEffect, useState } from 'react'
import type { AiJob, AiJobStatus } from '@/lib/useAiJob'

interface Props {
  job: AiJob | null
  onReset?: () => void
  /** Label shown on the generate button */
  label?: string
}

const STATUS_LABEL: Record<AiJobStatus, string> = {
  idle:    '',
  pending: 'Starting…',
  running: 'Running…',
  done:    'Complete',
  failed:  'Failed',
}

// Fake progress: crawls to 85% during AI call, jumps to 100% on done
function useFakeProgress(status: AiJobStatus): number {
  const [pct, setPct] = useState(0)

  useEffect(() => {
    if (status === 'idle') { setPct(0); return }
    if (status === 'done') { setPct(100); return }
    if (status === 'failed') { setPct(0); return }

    // pending → 0→20 quickly
    if (status === 'pending') {
      setPct(0)
      const t = setTimeout(() => setPct(20), 400)
      return () => clearTimeout(t)
    }

    // running → crawl 20→85 over ~90s (slows as it approaches 85)
    if (status === 'running') {
      setPct(p => Math.max(p, 20))
      const id = setInterval(() => {
        setPct(p => {
          const remaining = 85 - p
          return p + Math.max(0.3, remaining * 0.015)
        })
      }, 800)
      return () => clearInterval(id)
    }
  }, [status])

  return Math.min(100, Math.round(pct))
}

export default function AiProgressBar({ job, onReset, label = 'Generate' }: Props) {
  const status = job?.status ?? 'idle'
  const pct = useFakeProgress(status)
  const steps = job?.steps ?? []
  const latestStep = steps[steps.length - 1] ?? STATUS_LABEL[status]

  if (status === 'idle') return null

  const isRunning = status === 'pending' || status === 'running'
  const isDone    = status === 'done'
  const isFailed  = status === 'failed'

  return (
    <div className={`rounded-xl border p-4 space-y-3 transition-all ${
      isDone   ? 'border-green-500/30 bg-green-500/5'  :
      isFailed ? 'border-catalan-error/30 bg-catalan-error/5' :
                 'border-catalan-primary/30 bg-catalan-primary/5'
    }`}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isRunning && (
            <svg className="animate-spin h-4 w-4 text-catalan-primary flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
          {isDone   && <span className="text-green-500 text-sm">✓</span>}
          {isFailed && <span className="text-catalan-error text-sm">✕</span>}
          <span className={`text-sm font-medium ${
            isDone ? 'text-green-500' : isFailed ? 'text-catalan-error' : 'text-catalan-primary'
          }`}>
            {isDone ? `${label} complete` : isFailed ? 'Generation failed' : `${label} in progress…`}
          </span>
        </div>
        {(isDone || isFailed) && onReset && (
          <button
            onClick={onReset}
            className="text-xs text-catalan-textMuted hover:text-catalan-text transition-colors px-2 py-1 rounded border border-catalan-border hover:border-catalan-primary/40"
          >
            {isDone ? 'Start over' : 'Retry'}
          </button>
        )}
      </div>

      {/* Progress bar */}
      {!isFailed && (
        <div className="w-full bg-catalan-border rounded-full h-2 overflow-hidden">
          <div
            className={`h-2 rounded-full transition-all duration-700 ease-out ${isDone ? 'bg-green-500' : 'bg-catalan-primary'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Current step */}
      {latestStep && (
        <p className={`text-xs ${isFailed ? 'text-catalan-error' : 'text-catalan-textMuted'}`}>
          {isFailed ? `Error: ${job?.error || latestStep}` : latestStep}
        </p>
      )}

      {/* Step history */}
      {steps.length > 1 && isRunning && (
        <details className="text-xs text-catalan-textMuted cursor-pointer">
          <summary className="hover:text-catalan-text select-none">Show all steps ({steps.length})</summary>
          <ul className="mt-1.5 space-y-0.5 pl-3 border-l border-catalan-border">
            {steps.map((s, i) => (
              <li key={i} className={i === steps.length - 1 ? 'text-catalan-text' : ''}>{s}</li>
            ))}
          </ul>
        </details>
      )}

      {isRunning && (
        <p className="text-xs text-catalan-textMuted italic">
          You can navigate away — the report will keep generating in the background and be here when you return.
        </p>
      )}
    </div>
  )
}
