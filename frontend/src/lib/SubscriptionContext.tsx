import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import api, { getStoredUser } from '@/lib/api'

export interface PlanFeatures {
  tier: string
  ai_cleaning: boolean; ai_writer: boolean; ai_smart_builder: boolean
  ai_interpret: boolean; ai_analyzer: boolean; map_view: boolean
  panel_study: boolean; spss_export: boolean; api_write: boolean
  webhooks: boolean; two_fa: boolean; sso: boolean; audit_log: boolean
  advanced_rbac: boolean; white_label: boolean; priority_support: boolean
}

export interface SubData {
  subscription: {
    plan_id: string
    plan_name: string
    status: string
    billing_cycle: string | null
    period_end: string | null
    trial_end: string | null
  }
  limits: {
    submissions_limit: number | null; storage_limit_mb: number | null
    active_forms_limit: number | null; ai_reports_per_month: number | null
    ai_calls_per_day: number | null; api_calls_per_month: number | null
    max_org_admins: number | null; max_supervisors: number | null; max_enumerators: number | null
  }
  features: PlanFeatures
  usage: { submissions_used: number; storage_used_mb: number; ai_reports_used: number }
  pending_payment: { order_ref: string; amount_inr: number; plan_id: string } | null
}

interface SubCtx {
  data: SubData | null
  loading: boolean
  refetch: () => void
}

const Ctx = createContext<SubCtx>({ data: null, loading: false, refetch: () => {} })

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<SubData | null>(null)
  const [loading, setLoading] = useState(false)

  const refetch = useCallback(async () => {
    // Read fresh from localStorage each call — avoids stale closure after login
    const user = getStoredUser()
    if (!user || user.role === 'master_admin') return
    setLoading(true)
    try {
      const r = await api.get('/billing/my-subscription')
      setData(r.data)
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { refetch() }, [refetch])

  return <Ctx.Provider value={{ data, loading, refetch }}>{children}</Ctx.Provider>
}

export const useSubscription = () => useContext(Ctx)
