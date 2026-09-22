import { useNavigate } from 'react-router-dom'
import { useSubscription, PlanFeatures } from '@/lib/SubscriptionContext'

/** True while the org's plan is still loading and we don't know yet — treat as unlocked to avoid flashing a locked state before data arrives. */
export function useFeatureLocked(feature: keyof PlanFeatures): boolean {
  const { data, loading } = useSubscription()
  if (loading || !data) return false
  return !data.features[feature]
}

/** Small inline badge to place next to a gated action's label. Click navigates to /subscription. */
export function UpgradeBadge({ className = '' }: { className?: string }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); navigate('/subscription') }}
      title="Upgrade your plan to unlock this feature"
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors ${className}`}
    >
      🔒 Upgrade
    </button>
  )
}

/** Spread onto a <button> to grey it out + block the click + show an upgrade tooltip when locked. */
export function lockProps(locked: boolean, reason = 'Upgrade your plan to unlock this feature') {
  return locked
    ? { disabled: true, title: reason, className: 'opacity-50 cursor-not-allowed' }
    : {}
}
