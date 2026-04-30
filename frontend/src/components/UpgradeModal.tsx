import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function UpgradeModal() {
  const [msg, setMsg] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const onLimit = (e: Event) =>
      setMsg((e as CustomEvent).detail?.message ?? 'You have reached your plan limit.')
    const onGate = (e: Event) =>
      setMsg((e as CustomEvent).detail?.message ?? 'This feature is not available on your current plan.')

    window.addEventListener('fieldgovern:plan-limit', onLimit)
    window.addEventListener('fieldgovern:feature-gate', onGate)
    return () => {
      window.removeEventListener('fieldgovern:plan-limit', onLimit)
      window.removeEventListener('fieldgovern:feature-gate', onGate)
    }
  }, [])

  if (!msg) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
      <div className="bg-catalan-surface border border-catalan-border rounded-2xl p-6 w-full max-w-sm shadow-2xl text-center">
        <div className="text-4xl mb-3">🚀</div>
        <h2 className="text-base font-bold text-catalan-text mb-2">Upgrade your plan</h2>
        <p className="text-sm text-catalan-textMuted mb-6">{msg}</p>
        <div className="flex gap-3">
          <button
            onClick={() => setMsg(null)}
            className="flex-1 px-4 py-2 border border-catalan-border rounded-lg text-sm text-catalan-text hover:bg-catalan-hover transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={() => { setMsg(null); navigate('/subscription') }}
            className="flex-1 px-4 py-2 bg-catalan-primary text-catalan-bg rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            View Plans
          </button>
        </div>
      </div>
    </div>
  )
}
