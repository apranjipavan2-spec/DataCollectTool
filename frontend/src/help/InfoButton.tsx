/**
 * InfoButton — a small ⓘ icon shown next to complex operations.
 * Click → shows a compact popover with title + short steps.
 * "Full guide →" opens the HelpPanel to that topic.
 *
 * Usage:
 *   <InfoButton topicId="bulk-upload" />
 *   <InfoButton topicId="skip-logic" label="How does skip logic work?" />
 */
import { useState, useRef, useEffect } from 'react'
import { useHelp } from './HelpContext'
import { getTopicById } from './helpContent'

interface InfoButtonProps {
  topicId: string
  label?: string
  className?: string
}

export default function InfoButton({ topicId, label, className = '' }: InfoButtonProps) {
  const { openPanel } = useHelp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const topic = getTopicById(topicId)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!topic) return null

  return (
    <div ref={ref} className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v) }}
        aria-label={`Help: ${topic.title}`}
        title={label || `Help: ${topic.title}`}
        className="
          inline-flex items-center justify-center
          w-5 h-5 rounded-full text-xs font-bold
          border border-catalan-border
          text-catalan-textMuted bg-catalan-surface
          hover:bg-catalan-primary hover:text-white hover:border-catalan-primary
          transition-all duration-150 select-none
          focus:outline-none focus:ring-2 focus:ring-catalan-primary/40
        "
      >
        ⓘ
      </button>

      {open && (
        <div
          className="
            absolute z-50 w-72 rounded-xl shadow-xl border border-catalan-border
            bg-catalan-surface text-catalan-text
            bottom-full mb-2 left-0
          "
          style={{ minWidth: 260, maxWidth: 300 }}
          onClick={e => e.stopPropagation()}
        >
          {/* Arrow */}
          <div className="absolute -bottom-2 left-4 w-4 h-4 bg-catalan-surface border-r border-b border-catalan-border rotate-45" />

          <div className="p-4">
            <div className="flex items-start justify-between mb-2 gap-2">
              <h4 className="font-semibold text-sm text-catalan-text leading-tight">{topic.title}</h4>
              <button
                onClick={() => setOpen(false)}
                className="text-catalan-textMuted hover:text-catalan-text text-lg leading-none flex-shrink-0 -mt-0.5"
              >
                ×
              </button>
            </div>

            <p className="text-xs text-catalan-textMuted mb-3 leading-relaxed">{topic.description}</p>

            <ol className="space-y-1.5">
              {topic.steps.slice(0, 4).map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-catalan-text">
                  <span className="text-sm flex-shrink-0 leading-tight mt-0.5">{step.icon}</span>
                  <span className="leading-relaxed">{step.text}</span>
                </li>
              ))}
              {topic.steps.length > 4 && (
                <li className="text-xs text-catalan-textMuted pl-5">
                  + {topic.steps.length - 4} more steps…
                </li>
              )}
            </ol>

            <button
              onClick={() => { setOpen(false); openPanel(topicId) }}
              className="
                mt-3 w-full text-xs font-semibold text-catalan-primary
                border border-catalan-primary/30 rounded-lg py-1.5
                hover:bg-catalan-primary hover:text-white
                transition-all duration-150
              "
            >
              Full guide →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
