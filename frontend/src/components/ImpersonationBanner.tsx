import { useEffect } from 'react'
import { getImpersonator, stopImpersonation } from '@/lib/api'

const BANNER_HEIGHT = 36

export default function ImpersonationBanner() {
  const impersonator = getImpersonator()

  // Pages under this banner use `h-screen` layouts, so push the whole
  // document down by the banner's height rather than overlaying it —
  // otherwise the bottom of every h-screen page gets clipped.
  useEffect(() => {
    if (!impersonator) return
    document.body.style.paddingTop = `${BANNER_HEIGHT}px`
    return () => { document.body.style.paddingTop = '' }
  }, [!!impersonator])

  if (!impersonator) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-3 px-4 text-sm font-medium text-white"
      style={{ background: 'linear-gradient(90deg, #f59e0b, #d97706)', height: BANNER_HEIGHT }}>
      <span>Managing this organisation as its admin — actions you take here affect real data.</span>
      <button
        onClick={() => { stopImpersonation(); window.location.href = '/admin' }}
        className="px-3 py-1 rounded-lg text-xs font-semibold bg-white/20 hover:bg-white/30 transition-colors"
      >
        Exit to Platform Admin
      </button>
    </div>
  )
}
