import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSubscription } from '@/lib/SubscriptionContext'
import { getStoredUser } from '@/lib/api'

export default function SubscriptionBanner() {
  const user = getStoredUser()
  const { data } = useSubscription()
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem('trial_banner_dismissed') === '1'
  )

  if (!data || dismissed) return null
  if (!['org_admin', 'supervisor'].includes(user?.role ?? '')) return null

  const sub = data.subscription

  // Trial banner
  if (sub.status === 'trialing' && sub.trial_end) {
    const daysLeft = Math.ceil((new Date(sub.trial_end).getTime() - Date.now()) / 86_400_000)
    if (daysLeft <= 0) return null

    const cls = daysLeft <= 3
      ? 'bg-catalan-error/10 border-catalan-error/30 text-catalan-error'
      : daysLeft <= 7
      ? 'bg-amber-500/10 border-amber-500/30 text-amber-600'
      : 'bg-catalan-primary/10 border-catalan-primary/30 text-catalan-primary'

    const dismiss = () => { sessionStorage.setItem('trial_banner_dismissed', '1'); setDismissed(true) }

    return (
      <div className={`flex items-center gap-3 px-5 py-2 border-b text-sm ${cls}`}>
        <span className="font-semibold">
          Free trial — {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining.
        </span>
        <button onClick={() => navigate('/subscription')} className="underline hover:no-underline font-medium">
          View plans →
        </button>
        <button onClick={dismiss} className="ml-auto text-xl leading-none opacity-50 hover:opacity-100">
          ×
        </button>
      </div>
    )
  }

  // Subscription expired banner
  if (sub.status === 'expired' || sub.status === 'past_due') {
    return (
      <div className="flex items-center gap-3 px-5 py-2 border-b bg-catalan-error/10 border-catalan-error/30 text-catalan-error text-sm">
        <span className="font-semibold">
          {sub.status === 'past_due' ? 'Payment overdue — your account may be suspended soon.' : 'Subscription expired.'}
        </span>
        <button onClick={() => navigate('/subscription')} className="underline hover:no-underline font-medium">
          Renew now →
        </button>
      </div>
    )
  }

  return null
}
