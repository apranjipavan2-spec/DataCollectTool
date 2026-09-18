/**
 * HelpSpotlight — when a help topic's "Highlight in app" is clicked,
 * this component finds the target element by data-help-id, scrolls to it,
 * and renders a glowing ring + callout overlay around it.
 */
import { useEffect, useState, useRef } from 'react'
import { useHelp } from './HelpContext'
import { getTopicById } from './helpContent'

interface Rect { top: number; left: number; width: number; height: number }

export default function HelpSpotlight() {
  const { spotlightId, clearSpotlight } = useHelp()
  const [rect, setRect] = useState<Rect | null>(null)
  const [topicTitle, setTopicTitle] = useState('')
  const frameRef = useRef<number>(0)

  useEffect(() => {
    if (!spotlightId) { setRect(null); return }

    // Find element by data-help-id attribute
    const el = document.querySelector(`[data-help-id="${spotlightId}"]`) as HTMLElement | null
    if (!el) { setRect(null); return }

    // Scroll into view
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })

    // Find topic title
    const titleMatch = getTopicById(spotlightId)
    setTopicTitle(titleMatch?.title || '')

    // Update rect on each animation frame (handles scroll animation)
    let ticks = 0
    const track = () => {
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      if (ticks++ < 40) frameRef.current = requestAnimationFrame(track)
    }
    frameRef.current = requestAnimationFrame(track)

    return () => cancelAnimationFrame(frameRef.current)
  }, [spotlightId])

  if (!spotlightId || !rect) return null

  const PAD = 8
  const ringTop    = rect.top    - PAD
  const ringLeft   = rect.left   - PAD
  const ringWidth  = rect.width  + PAD * 2
  const ringHeight = rect.height + PAD * 2

  return (
    <div
      className="fixed inset-0 z-[200] pointer-events-none"
      onClick={clearSpotlight}
      style={{ pointerEvents: 'all', cursor: 'pointer' }}
    >
      {/* Dark overlay with hole */}
      <svg
        className="absolute inset-0 w-full h-full"
        style={{ display: 'block' }}
      >
        <defs>
          <mask id="spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={ringLeft}
              y={ringTop}
              width={ringWidth}
              height={ringHeight}
              rx="12"
              fill="black"
            />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.55)"
          mask="url(#spotlight-mask)"
        />
      </svg>

      {/* Glowing ring around the element */}
      <div
        className="absolute rounded-xl pointer-events-none"
        style={{
          top:    ringTop,
          left:   ringLeft,
          width:  ringWidth,
          height: ringHeight,
          boxShadow: '0 0 0 3px #0ea5e9, 0 0 0 6px rgba(14,165,233,0.3), 0 0 24px rgba(14,165,233,0.4)',
          animation: 'helpPulse 1.6s ease-in-out infinite',
        }}
      />

      {/* Callout bubble */}
      <div
        className="absolute pointer-events-auto"
        style={{
          top:  Math.min(ringTop + ringHeight + 12, window.innerHeight - 120),
          left: Math.max(8, Math.min(ringLeft, window.innerWidth - 280)),
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="bg-white rounded-xl shadow-2xl border border-blue-200 px-4 py-3 w-64">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-blue-500 text-sm font-bold">ⓘ</span>
            <span className="text-sm font-semibold text-gray-800 leading-tight">{topicTitle}</span>
          </div>
          <p className="text-xs text-gray-500 mb-2">This is the element described in the guide.</p>
          <button
            onClick={clearSpotlight}
            className="text-xs text-blue-600 font-semibold hover:underline"
          >
            × Dismiss
          </button>
        </div>
      </div>

      <style>{`
        @keyframes helpPulse {
          0%,100% { box-shadow: 0 0 0 3px #0ea5e9, 0 0 0 6px rgba(14,165,233,0.3), 0 0 24px rgba(14,165,233,0.4); }
          50%      { box-shadow: 0 0 0 3px #0ea5e9, 0 0 0 10px rgba(14,165,233,0.2), 0 0 40px rgba(14,165,233,0.25); }
        }
      `}</style>
    </div>
  )
}
