import { useState, useEffect, useCallback } from 'react'
import api from '@/lib/api'
import { getStoredUser } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'
import { useToast } from '@/lib/ToastContext'
import EmojiIcon from '@/components/EmojiIcon'
import Select from '@/components/Select'

interface OrgSubscription {
  tenant_id: string
  org_name: string
  plan_id: string
  plan_name: string
  status: string
  billing_cycle: string | null
  period_end: string | null
  trial_end: string | null
  submissions_limit: number | null
  submissions_used: number
}

interface PaymentRequest {
  id: string
  order_ref: string
  tenant_id: string
  org_name: string
  plan_name: string
  billing_cycle: string
  amount_inr: number
  utr_number: string | null
  status: 'pending' | 'confirmed' | 'rejected'
  confirmed_at: string | null
  rejection_reason: string | null
  notes: string | null
  created_at: string
}

interface AdminPlan {
  id: string; tier: string; segment: string; name: string
  description: string | null; is_active: boolean
  price_inr: number; price_usd_cents: number
  limits: {
    submissions_per_month: number | null; storage_mb: number | null; active_forms: number | null
    ai_reports_per_month: number | null; api_calls_per_month: number | null
    max_org_admins: number | null; max_supervisors: number | null; max_enumerators: number | null
    asr_minutes_limit: number | null; translation_chars: number | null
  }
  features: Record<string, boolean>
}

const LIMIT_FIELDS: { key: keyof AdminPlan['limits']; apiField: string; label: string }[] = [
  { key: 'submissions_per_month', apiField: 'submissions_limit',     label: 'Submissions / month' },
  { key: 'storage_mb',            apiField: 'storage_limit_mb',      label: 'Storage (MB)' },
  { key: 'active_forms',          apiField: 'active_forms_limit',    label: 'Active forms' },
  { key: 'ai_reports_per_month',  apiField: 'ai_reports_per_month',  label: 'AI reports / month' },
  { key: 'api_calls_per_month',   apiField: 'api_calls_per_month',   label: 'API calls / month' },
  { key: 'max_org_admins',        apiField: 'max_org_admins',        label: 'Org admins' },
  { key: 'max_supervisors',       apiField: 'max_supervisors',       label: 'Supervisors' },
  { key: 'max_enumerators',       apiField: 'max_enumerators',       label: 'Enumerators' },
  { key: 'asr_minutes_limit',     apiField: 'asr_minutes_limit',     label: 'ASR minutes / month' },
  { key: 'translation_chars',     apiField: 'translation_chars',     label: 'Translation chars / month' },
]

const FEATURE_FIELDS: { key: string; label: string }[] = [
  { key: 'ai_cleaning', label: 'AI Cleaning' }, { key: 'ai_writer', label: 'AI Writer' },
  { key: 'ai_smart_builder', label: 'AI Smart Builder' }, { key: 'ai_interpret', label: 'AI Interpret' },
  { key: 'ai_analyzer', label: 'AI Analyzer' }, { key: 'map_view', label: 'Map View' },
  { key: 'panel_study', label: 'Panel Study' }, { key: 'spss_export', label: 'SPSS Export' },
  { key: 'api_write', label: 'API Write' }, { key: 'webhooks', label: 'Webhooks' },
  { key: 'two_fa', label: '2FA' }, { key: 'sso', label: 'SSO' },
  { key: 'audit_log', label: 'Audit Log' }, { key: 'advanced_rbac', label: 'Advanced RBAC' },
  { key: 'white_label', label: 'White Label' }, { key: 'on_premise', label: 'On-Premise' },
  { key: 'priority_support', label: 'Priority Support' },
]

const card  = 'bg-catalan-surface border border-catalan-border rounded-xl p-5'
const btnPr = 'px-4 py-2 bg-catalan-primary text-catalan-bg rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40'
const btnSe = 'px-3 py-1.5 text-sm border border-catalan-border rounded-lg text-catalan-text hover:bg-catalan-hover transition-colors'
const btnDa = 'px-4 py-2 bg-catalan-error text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40'
const inp   = 'w-full border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text focus:ring-2 focus:ring-catalan-primary outline-none'

const CYCLE_LABEL: Record<string, string> = {
  monthly: 'Monthly', '6month': '6-Month', annual: 'Annual', '3year': '3-Year'
}

export default function AdminPayments() {
  const user  = getStoredUser()
  const toast = useToast()

  const [tab,     setTab]     = useState<'requests' | 'orgs' | 'plans'>('requests')

  // Plan pricing/limits editor
  const [plans,        setPlans]        = useState<AdminPlan[]>([])
  const [plansLoading,  setPlansLoading]  = useState(false)
  const [editingPlan,  setEditingPlan]  = useState<AdminPlan | null>(null)
  const [planDraft,    setPlanDraft]    = useState<Record<string, any>>({})
  const [planSaving,   setPlanSaving]   = useState(false)

  // Org subscriptions overview
  const [orgs,       setOrgs]       = useState<OrgSubscription[]>([])
  const [orgsLoading, setOrgsLoading] = useState(false)
  const [assignTenant, setAssignTenant] = useState<OrgSubscription | null>(null)
  const [assignPlan,   setAssignPlan]   = useState('')
  const [assignCycle,  setAssignCycle]  = useState('monthly')
  const [assignExpiry, setAssignExpiry] = useState('')
  const [assignAmount, setAssignAmount] = useState('')
  const [assignMethod, setAssignMethod] = useState('')
  const [assignRef,    setAssignRef]    = useState('')
  const [assignNotes,  setAssignNotes]  = useState('')
  const [assigning,    setAssigning]    = useState(false)
  const [allPlans,     setAllPlans]     = useState<{ id: string; name: string }[]>([])
  const [filter,  setFilter]  = useState<'pending' | 'confirmed' | 'rejected' | 'all'>('pending')
  const [requests, setRequests] = useState<PaymentRequest[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading,  setLoading]  = useState(false)
  const [acting,   setActing]   = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = filter !== 'all' ? `?status=${filter}` : ''
      const [res, pendingRes] = await Promise.all([
        api.get(`/billing/admin/requests${params}`),
        api.get('/billing/admin/requests?status=pending'),
      ])
      setRequests(res.data)
      setPendingCount(pendingRes.data.length)
    } catch {
      toast.error('Failed to load payment requests')
    } finally {
      setLoading(false)
    }
  }, [filter, toast])

  const loadOrgs = useCallback(async () => {
    setOrgsLoading(true)
    try {
      const [orgsRes, plansRes] = await Promise.all([
        api.get('/billing/admin/subscriptions'),
        api.get('/billing/plans'),
      ])
      setOrgs(orgsRes.data)
      setAllPlans(plansRes.data.map((p: any) => ({ id: p.id, name: p.name })))
    } catch { toast.error('Failed to load subscriptions') }
    finally { setOrgsLoading(false) }
  }, [toast])

  const loadPlans = useCallback(async () => {
    setPlansLoading(true)
    try {
      const res = await api.get('/billing/admin/plans')
      setPlans(res.data)
    } catch { toast.error('Failed to load plans') }
    finally { setPlansLoading(false) }
  }, [toast])

  const openPlanEditor = (p: AdminPlan) => {
    setEditingPlan(p)
    const draft: Record<string, any> = { name: p.name, price_inr: p.price_inr, is_active: p.is_active }
    for (const f of LIMIT_FIELDS) draft[f.apiField] = p.limits[f.key]
    for (const f of FEATURE_FIELDS) draft[f.key] = p.features[f.key]
    setPlanDraft(draft)
  }

  const savePlan = async () => {
    if (!editingPlan) return
    setPlanSaving(true)
    try {
      await api.patch(`/billing/admin/plans/${editingPlan.id}`, planDraft)
      toast.success(`${editingPlan.name} updated — live on the website now`)
      setEditingPlan(null)
      loadPlans()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to save plan')
    } finally { setPlanSaving(false) }
  }

  const assignPlanToOrg = async () => {
    if (!assignTenant || !assignPlan) return
    setAssigning(true)
    try {
      await api.post(`/billing/admin/subscriptions/${assignTenant.tenant_id}/assign`, {
        plan_id: assignPlan, billing_cycle: assignCycle,
        expires_at: assignExpiry || undefined,
        amount_inr: assignAmount ? Number(assignAmount) : undefined,
        payment_method: assignMethod || undefined,
        payment_ref: assignRef || undefined,
        notes: assignNotes || undefined,
      })
      toast.success(`Plan assigned to ${assignTenant.org_name}`)
      setAssignTenant(null)
      loadOrgs()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to assign plan')
    } finally { setAssigning(false) }
  }

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'orgs') loadOrgs() }, [tab, loadOrgs])
  useEffect(() => { if (tab === 'plans') loadPlans() }, [tab, loadPlans])

  const confirm = async (id: string) => {
    setActing(id)
    try {
      await api.patch(`/billing/admin/requests/${id}/confirm`, {})
      toast.success('Payment confirmed — subscription activated')
      setFilter('confirmed')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to confirm')
    } finally { setActing(null) }
  }

  const reject = async () => {
    if (!rejectId || !rejectReason.trim()) return
    setActing(rejectId)
    try {
      await api.patch(`/billing/admin/requests/${rejectId}/reject`, { reason: rejectReason })
      toast.success('Request rejected')
      setRejectId(null); setRejectReason('')
      setFilter('rejected')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to reject')
    } finally { setActing(null) }
  }

  const statusBadge = (s: string) => {
    const cls = s === 'confirmed' ? 'bg-green-500/10 text-green-500 border-green-500/20'
      : s === 'rejected'  ? 'bg-catalan-error/10 text-catalan-error border-catalan-error/20'
      : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
    return (
      <span className={`px-2 py-0.5 text-xs font-medium border rounded-full ${cls}`}>
        {s.charAt(0).toUpperCase() + s.slice(1)}
      </span>
    )
  }

  const pending = pendingCount

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={getNavItems(user?.role ?? '')} role={user?.role} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav titleNode={
          <div className="flex items-center gap-2">
            <span className="text-catalan-text font-semibold text-base">Payments</span>
            {pending > 0 && (
              <span className="px-2 py-0.5 text-xs bg-amber-500 text-white rounded-full font-bold">{pending}</span>
            )}
          </div>
        } />
        <main className="flex-1 overflow-auto p-6">

          {/* Top-level tabs */}
          <div className="flex gap-1 mb-6 border-b border-catalan-border">
            {([
              { key: 'requests', label: 'Payment Requests' },
              { key: 'orgs',     label: 'Organisations' },
              { key: 'plans',    label: 'Plans & Pricing' },
            ] as const).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-catalan-primary text-catalan-primary' : 'border-transparent text-catalan-textMuted hover:text-catalan-text'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── REQUESTS TAB ─────────────────────────────────────────── */}
          {tab === 'requests' && (
            <>
              <div className="flex gap-1 mb-5 border-b border-catalan-border/50">
                {(['pending', 'confirmed', 'rejected', 'all'] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
                      filter === f ? 'border-catalan-primary text-catalan-primary' : 'border-transparent text-catalan-textMuted hover:text-catalan-text'
                    }`}>
                    {f}
                  </button>
                ))}
                <button onClick={load} className={`${btnSe} ml-auto mb-1`}><EmojiIcon e="↻" /> Refresh</button>
              </div>

              {loading && <div className="text-catalan-textMuted text-sm text-center py-12">Loading…</div>}

              {!loading && requests.length === 0 && (
                <div className="text-center py-20 text-catalan-textMuted">
                  <div className="text-4xl mb-3"><EmojiIcon e="📭" /></div>
                  <p className="text-sm">No {filter !== 'all' ? filter : ''} payment requests</p>
                </div>
              )}

              <div className="space-y-4">
                {requests.map(r => (
                  <div key={r.id} className={card}>
                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-base font-bold text-catalan-text">{r.org_name}</span>
                          {statusBadge(r.status)}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-sm">
                          <div><span className="text-catalan-textMuted text-xs">Order Ref</span><div className="font-mono text-catalan-primary font-semibold">{r.order_ref}</div></div>
                          <div><span className="text-catalan-textMuted text-xs">Plan</span><div className="text-catalan-text">{r.plan_name}</div></div>
                          <div><span className="text-catalan-textMuted text-xs">Cycle</span><div className="text-catalan-text">{CYCLE_LABEL[r.billing_cycle] || r.billing_cycle}</div></div>
                          <div><span className="text-catalan-textMuted text-xs">Amount</span><div className="text-catalan-text font-bold">₹{r.amount_inr.toLocaleString('en-IN')}</div></div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm">
                          <div>
                            <span className="text-catalan-textMuted text-xs">UTR / Txn Ref</span>
                            <div className={`font-mono text-sm ${r.utr_number ? 'text-catalan-text' : 'text-catalan-textMuted italic'}`}>
                              {r.utr_number || 'Not submitted yet'}
                            </div>
                          </div>
                          <div><span className="text-catalan-textMuted text-xs">Requested</span><div className="text-catalan-text">{new Date(r.created_at).toLocaleString()}</div></div>
                          {r.confirmed_at && <div><span className="text-catalan-textMuted text-xs">Actioned</span><div className="text-catalan-text">{new Date(r.confirmed_at).toLocaleString()}</div></div>}
                        </div>
                        {r.rejection_reason && (
                          <div className="text-xs text-catalan-error bg-catalan-error/10 border border-catalan-error/20 rounded-lg px-3 py-2">
                            Rejection reason: {r.rejection_reason}
                          </div>
                        )}
                        {r.notes && (
                          <div className="text-xs text-catalan-textMuted bg-catalan-hover/30 rounded-lg px-3 py-2">
                            Notes: {r.notes}
                          </div>
                        )}
                      </div>

                      {r.status === 'pending' && (
                        <div className="flex flex-col gap-2 shrink-0 items-end">
                          {!r.utr_number && (
                            <span className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5">
                              Awaiting UTR from organisation
                            </span>
                          )}
                          <div className="flex gap-2">
                            <button onClick={() => confirm(r.id)} disabled={acting === r.id || !r.utr_number} className={btnPr}>
                              {acting === r.id ? 'Confirming…' : '✓ Confirm & Activate'}
                            </button>
                            <button onClick={() => { setRejectId(r.id); setRejectReason('') }} disabled={acting === r.id} className={btnDa}>
                              ✕ Reject
                            </button>
                          </div>
                        </div>
                      )}
                      {r.status === 'confirmed' && (
                        <span className="text-xs text-green-500 font-medium shrink-0">Subscription Active</span>
                      )}
                      {r.status === 'rejected' && (
                        <span className="text-xs text-catalan-error font-medium shrink-0">Rejected</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── ORGS TAB ────────────────────────────────────────────── */}
          {tab === 'orgs' && (
            <>
              <div className="flex justify-between items-center mb-4">
                <span className="text-sm text-catalan-textMuted">{orgs.length} organisation{orgs.length !== 1 ? 's' : ''}</span>
                <button onClick={loadOrgs} className={btnSe}><EmojiIcon e="↻" /> Refresh</button>
              </div>

              {orgsLoading && <div className="text-catalan-textMuted text-sm text-center py-12">Loading…</div>}

              {!orgsLoading && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-catalan-border text-left text-xs text-catalan-textMuted">
                        <th className="pb-2 pr-4 font-medium">Organisation</th>
                        <th className="pb-2 pr-4 font-medium">Plan</th>
                        <th className="pb-2 pr-4 font-medium">Status</th>
                        <th className="pb-2 pr-4 font-medium">Submissions</th>
                        <th className="pb-2 pr-4 font-medium">Expires</th>
                        <th className="pb-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-catalan-border/50">
                      {orgs.map(o => {
                        const pct = o.submissions_limit ? Math.min(100, Math.round(o.submissions_used / o.submissions_limit * 100)) : 0
                        const statusCls = o.status === 'active' ? 'text-green-500'
                          : o.status === 'trialing' ? 'text-catalan-primary'
                          : o.status === 'cancelled' || o.status === 'expired' ? 'text-catalan-error'
                          : 'text-amber-500'
                        return (
                          <tr key={o.tenant_id} className="hover:bg-catalan-hover/30 transition-colors">
                            <td className="py-3 pr-4 font-semibold text-catalan-text">{o.org_name}</td>
                            <td className="py-3 pr-4 text-catalan-textMuted">{o.plan_name}</td>
                            <td className={`py-3 pr-4 font-medium capitalize ${statusCls}`}>{o.status}</td>
                            <td className="py-3 pr-4">
                              {o.submissions_limit ? (
                                <div className="flex items-center gap-2">
                                  <div className="w-20 h-1.5 bg-catalan-border rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${pct >= 90 ? 'bg-catalan-error' : pct >= 70 ? 'bg-amber-500' : 'bg-catalan-primary'}`}
                                      style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="text-xs text-catalan-textMuted">{o.submissions_used}/{o.submissions_limit}</span>
                                </div>
                              ) : <span className="text-xs text-catalan-textMuted">Unlimited</span>}
                            </td>
                            <td className="py-3 pr-4 text-xs text-catalan-textMuted">
                              {o.period_end ? new Date(o.period_end).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                                : o.trial_end ? `Trial ends ${new Date(o.trial_end).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`
                                : '—'}
                            </td>
                            <td className="py-3">
                              <button onClick={() => {
                                setAssignTenant(o); setAssignPlan(o.plan_id); setAssignCycle(o.billing_cycle || 'monthly')
                                const existing = o.period_end || o.trial_end
                                setAssignExpiry(existing ? existing.slice(0, 10) : '')
                                setAssignAmount(''); setAssignMethod(''); setAssignRef(''); setAssignNotes('')
                              }} className={btnSe}>
                                Manage
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ── PLANS TAB ───────────────────────────────────────────── */}
          {tab === 'plans' && (
            <>
              <div className="flex justify-between items-center mb-4">
                <p className="text-xs text-catalan-textMuted max-w-lg">
                  Edits go live on fieldgovern.com/pricing.html immediately — the site fetches pricing at page load, no redeploy needed.
                </p>
                <button onClick={loadPlans} className={btnSe}><EmojiIcon e="↻" /> Refresh</button>
              </div>

              {plansLoading && <div className="text-catalan-textMuted text-sm text-center py-12">Loading…</div>}

              {!plansLoading && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-catalan-border text-left text-xs text-catalan-textMuted">
                        <th className="pb-2 pr-4 font-medium">Plan</th>
                        <th className="pb-2 pr-4 font-medium">Price / mo</th>
                        <th className="pb-2 pr-4 font-medium">Submissions</th>
                        <th className="pb-2 pr-4 font-medium">Storage</th>
                        <th className="pb-2 pr-4 font-medium">Forms</th>
                        <th className="pb-2 pr-4 font-medium">Status</th>
                        <th className="pb-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-catalan-border/50">
                      {plans.map(p => (
                        <tr key={p.id} className="hover:bg-catalan-hover/30 transition-colors">
                          <td className="py-3 pr-4 font-semibold text-catalan-text truncate max-w-[160px]">{p.name}</td>
                          <td className="py-3 pr-4 text-catalan-text">{p.price_inr > 0 ? `₹${p.price_inr.toLocaleString('en-IN')}` : 'Free'}</td>
                          <td className="py-3 pr-4 text-catalan-textMuted">{p.limits.submissions_per_month ?? 'Unlimited'}</td>
                          <td className="py-3 pr-4 text-catalan-textMuted">{p.limits.storage_mb != null ? `${p.limits.storage_mb} MB` : 'Unlimited'}</td>
                          <td className="py-3 pr-4 text-catalan-textMuted">{p.limits.active_forms ?? 'Unlimited'}</td>
                          <td className="py-3 pr-4">
                            <span className={`px-2 py-0.5 text-xs font-medium border rounded-full ${p.is_active ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-catalan-textMuted/10 text-catalan-textMuted border-catalan-border'}`}>
                              {p.is_active ? 'Active' : 'Hidden'}
                            </span>
                          </td>
                          <td className="py-3">
                            <button onClick={() => openPlanEditor(p)} className={btnSe}>Edit</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

        </main>
      </div>

      {/* Assign plan modal */}
      {assignTenant && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`${card} w-full max-w-sm max-h-[85vh] overflow-y-auto`}>
            <h3 className="text-base font-bold text-catalan-text mb-1">Manage Subscription</h3>
            <p className="text-xs text-catalan-textMuted mb-4">{assignTenant.org_name}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-catalan-text mb-1">Plan</label>
                <Select className={inp} value={assignPlan} onChange={e => setAssignPlan(e.target.value)}>
                  <option value="">Select plan…</option>
                  {allPlans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-catalan-text mb-1">Billing Cycle</label>
                <Select className={inp} value={assignCycle} onChange={e => setAssignCycle(e.target.value)}>
                  {[['monthly','Monthly'],['6month','6-Month (10% off)'],['annual','Annual (20% off)'],['3year','3-Year (30% off)']].map(([k,l]) =>
                    <option key={k} value={k}>{l}</option>
                  )}
                </Select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-catalan-text mb-1">Expiry Date</label>
                <input type="date" className={inp} value={assignExpiry} onChange={e => setAssignExpiry(e.target.value)} />
                <p className="text-[11px] text-catalan-textMuted mt-1">Leave as-is to auto-compute from the billing cycle. Change to override (e.g. backdate, extend, or match an offline invoice).</p>
              </div>

              <div className="pt-2 border-t border-catalan-border">
                <p className="text-xs font-semibold text-catalan-text mb-2">Manual Payment Details <span className="font-normal text-catalan-textMuted">(optional — logs an offline payment record)</span></p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-catalan-textMuted mb-1">Method</label>
                    <Select className={inp} value={assignMethod} onChange={e => setAssignMethod(e.target.value)}>
                      <option value="">None</option>
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="upi">UPI</option>
                      <option value="cash">Cash</option>
                      <option value="cheque">Cheque</option>
                      <option value="other">Other</option>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-catalan-textMuted mb-1">Amount (₹)</label>
                    <input type="number" min={0} className={inp} placeholder="auto" value={assignAmount}
                      onChange={e => setAssignAmount(e.target.value)} />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-[11px] text-catalan-textMuted mb-1">Reference (UTR / cheque no. / txn id)</label>
                  <input className={inp} value={assignRef} onChange={e => setAssignRef(e.target.value)} />
                </div>
                <div className="mt-3">
                  <label className="block text-[11px] text-catalan-textMuted mb-1">Notes</label>
                  <textarea className={inp} rows={2} value={assignNotes} onChange={e => setAssignNotes(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5 justify-end sticky bottom-0 bg-catalan-surface pt-2">
              <button onClick={() => setAssignTenant(null)} className={btnSe}>Cancel</button>
              <button onClick={assignPlanToOrg} disabled={!assignPlan || assigning} className={btnPr}>
                {assigning ? 'Saving…' : 'Save & Activate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Plan editor modal */}
      {editingPlan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`${card} w-full max-w-2xl max-h-[85vh] overflow-y-auto`}>
            <h3 className="text-base font-bold text-catalan-text mb-1">Edit Plan — {editingPlan.name}</h3>
            <p className="text-xs text-catalan-textMuted mb-4">Tier: {editingPlan.tier} · Changes apply immediately, no deploy needed.</p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-catalan-text mb-1">Display Name</label>
                  <input className={inp} value={planDraft.name ?? ''}
                    onChange={e => setPlanDraft(d => ({ ...d, name: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-catalan-text mb-1">Price (₹ / month)</label>
                  <input type="number" min={0} className={inp} value={planDraft.price_inr ?? 0}
                    onChange={e => setPlanDraft(d => ({ ...d, price_inr: Number(e.target.value) }))} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-catalan-text mb-2">Limits — blank = unlimited</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {LIMIT_FIELDS.map(f => (
                    <div key={f.apiField}>
                      <label className="block text-[11px] text-catalan-textMuted mb-1">{f.label}</label>
                      <input type="number" min={0} className={inp}
                        value={planDraft[f.apiField] ?? ''}
                        placeholder="∞"
                        onChange={e => setPlanDraft(d => ({ ...d, [f.apiField]: e.target.value === '' ? null : Number(e.target.value) }))} />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-catalan-text mb-2">Features</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {FEATURE_FIELDS.map(f => (
                    <label key={f.key} className="flex items-center gap-2 text-sm text-catalan-text cursor-pointer">
                      <input type="checkbox" checked={!!planDraft[f.key]}
                        onChange={e => setPlanDraft(d => ({ ...d, [f.key]: e.target.checked }))} />
                      {f.label}
                    </label>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-catalan-text cursor-pointer">
                <input type="checkbox" checked={!!planDraft.is_active}
                  onChange={e => setPlanDraft(d => ({ ...d, is_active: e.target.checked }))} />
                Active (visible on pricing page &amp; assignable)
              </label>
            </div>

            <div className="flex gap-2 mt-5 justify-end sticky bottom-0 bg-catalan-surface pt-2">
              <button onClick={() => setEditingPlan(null)} className={btnSe}>Cancel</button>
              <button onClick={savePlan} disabled={planSaving} className={btnPr}>
                {planSaving ? 'Saving…' : 'Save Plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {rejectId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`${card} w-full max-w-md`}>
            <h3 className="text-base font-bold text-catalan-text mb-4">Reject Payment Request</h3>
            <p className="text-sm text-catalan-textMuted mb-3">
              Provide a reason — this will be visible to the organisation.
            </p>
            <textarea
              className="w-full border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text resize-none outline-none focus:ring-2 focus:ring-catalan-primary"
              rows={3}
              placeholder="e.g. UTR not found in bank records. Please resubmit with correct reference."
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
            />
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setRejectId(null)} className={btnSe}>Cancel</button>
              <button onClick={reject} disabled={!rejectReason.trim() || acting === rejectId} className={btnDa}>
                {acting === rejectId ? 'Rejecting…' : 'Reject Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
