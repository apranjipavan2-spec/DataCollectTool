import { useState, useEffect, useCallback } from 'react'
import api from '@/lib/api'
import { getStoredUser } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'
import { useToast } from '@/lib/ToastContext'

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
  created_at: string
}

interface PaymentConfig {
  upi_id: string
  upi_name: string
  bank_account: string
  bank_ifsc: string
  bank_name: string
  admin_whatsapp: string
  support_email: string
}

const EMPTY_CFG: PaymentConfig = {
  upi_id: '', upi_name: '', bank_account: '',
  bank_ifsc: '', bank_name: '', admin_whatsapp: '', support_email: '',
}

const card  = 'bg-catalan-surface border border-catalan-border rounded-xl p-5'
const btnPr = 'px-4 py-2 bg-catalan-primary text-catalan-bg rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40'
const btnSe = 'px-3 py-1.5 text-sm border border-catalan-border rounded-lg text-catalan-text hover:bg-catalan-hover transition-colors'
const btnDa = 'px-4 py-2 bg-catalan-error text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40'
const inp   = 'w-full border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text focus:ring-2 focus:ring-catalan-primary outline-none'

const CYCLE_LABEL: Record<string, string> = {
  monthly: 'Monthly', '6month': '6-Month', annual: 'Annual', '3year': '3-Year'
}

const CFG_FIELDS: { key: keyof PaymentConfig; label: string; placeholder: string; hint?: string }[] = [
  { key: 'upi_id',         label: 'UPI ID',           placeholder: 'yourname@upi',              hint: 'Shown on the QR code payment screen' },
  { key: 'upi_name',       label: 'UPI Display Name',  placeholder: 'FieldGovern Technologies' },
  { key: 'bank_account',   label: 'Bank Account No.',  placeholder: '00000012345678' },
  { key: 'bank_ifsc',      label: 'IFSC Code',         placeholder: 'HDFC0001234' },
  { key: 'bank_name',      label: 'Bank Name',         placeholder: 'HDFC Bank' },
  { key: 'admin_whatsapp', label: 'WhatsApp Number',   placeholder: '919876543210',             hint: 'With country code, no + or spaces (e.g. 919876543210)' },
  { key: 'support_email',  label: 'Support Email',     placeholder: 'support@fieldgovern.in' },
]

export default function AdminPayments() {
  const user  = getStoredUser()
  const toast = useToast()

  const [tab,     setTab]     = useState<'requests' | 'orgs' | 'settings'>('requests')

  // Org subscriptions overview
  const [orgs,       setOrgs]       = useState<OrgSubscription[]>([])
  const [orgsLoading, setOrgsLoading] = useState(false)
  const [assignTenant, setAssignTenant] = useState<OrgSubscription | null>(null)
  const [assignPlan,   setAssignPlan]   = useState('')
  const [assignCycle,  setAssignCycle]  = useState('monthly')
  const [assigning,    setAssigning]    = useState(false)
  const [allPlans,     setAllPlans]     = useState<{ id: string; name: string }[]>([])
  const [filter,  setFilter]  = useState<'pending' | 'confirmed' | 'rejected' | 'all'>('pending')
  const [requests, setRequests] = useState<PaymentRequest[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading,  setLoading]  = useState(false)
  const [acting,   setActing]   = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  // Settings state
  const [cfg,        setCfg]        = useState<PaymentConfig>(EMPTY_CFG)
  const [cfgLoading, setCfgLoading] = useState(false)
  const [cfgSaving,  setCfgSaving]  = useState(false)

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

  const loadCfg = useCallback(async () => {
    setCfgLoading(true)
    try {
      const res = await api.get('/billing/admin/payment-config')
      setCfg({ ...EMPTY_CFG, ...res.data })
    } catch {
      toast.error('Failed to load payment config')
    } finally {
      setCfgLoading(false)
    }
  }, [toast])

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

  const assignPlanToOrg = async () => {
    if (!assignTenant || !assignPlan) return
    setAssigning(true)
    try {
      await api.post(`/billing/admin/subscriptions/${assignTenant.tenant_id}/assign`, {
        plan_id: assignPlan, billing_cycle: assignCycle,
      })
      toast.success(`Plan assigned to ${assignTenant.org_name}`)
      setAssignTenant(null)
      loadOrgs()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to assign plan')
    } finally { setAssigning(false) }
  }

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'settings') loadCfg() }, [tab, loadCfg])
  useEffect(() => { if (tab === 'orgs') loadOrgs() }, [tab, loadOrgs])

  const saveCfg = async () => {
    setCfgSaving(true)
    try {
      await api.patch('/billing/admin/payment-config', cfg)
      toast.success('Payment settings saved')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to save')
    } finally {
      setCfgSaving(false)
    }
  }

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
              { key: 'settings', label: '⚙ Payment Settings' },
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
                <button onClick={load} className={`${btnSe} ml-auto mb-1`}>↻ Refresh</button>
              </div>

              {loading && <div className="text-catalan-textMuted text-sm text-center py-12">Loading…</div>}

              {!loading && requests.length === 0 && (
                <div className="text-center py-20 text-catalan-textMuted">
                  <div className="text-4xl mb-3">📭</div>
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
                <button onClick={loadOrgs} className={btnSe}>↻ Refresh</button>
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
                              <button onClick={() => { setAssignTenant(o); setAssignPlan(o.plan_id); setAssignCycle(o.billing_cycle || 'monthly') }}
                                className={btnSe}>
                                Assign Plan
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

          {/* ── SETTINGS TAB ─────────────────────────────────────────── */}
          {tab === 'settings' && (
            <div className="max-w-xl space-y-6">
              <div className={card}>
                <h2 className="text-base font-bold text-catalan-text mb-1">Payment Configuration</h2>
                <p className="text-xs text-catalan-textMuted mb-5">
                  These details are shown to organisations on the subscription page when they make a payment.
                  Changes take effect immediately — no redeploy needed.
                </p>

                {cfgLoading ? (
                  <div className="text-catalan-textMuted text-sm text-center py-8">Loading…</div>
                ) : (
                  <div className="space-y-4">
                    {CFG_FIELDS.map(f => (
                      <div key={f.key}>
                        <label className="block text-xs font-semibold text-catalan-text mb-1">{f.label}</label>
                        <input
                          className={inp}
                          placeholder={f.placeholder}
                          value={cfg[f.key]}
                          onChange={e => setCfg(prev => ({ ...prev, [f.key]: e.target.value }))}
                        />
                        {f.hint && <p className="text-xs text-catalan-textMuted mt-1">{f.hint}</p>}
                      </div>
                    ))}

                    <div className="pt-2 flex items-center gap-3">
                      <button onClick={saveCfg} disabled={cfgSaving} className={btnPr}>
                        {cfgSaving ? 'Saving…' : 'Save Payment Settings'}
                      </button>
                      <button onClick={loadCfg} className={btnSe}>Reset</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Live preview */}
              <div className={card}>
                <h3 className="text-sm font-bold text-catalan-text mb-3">Preview — what organisations will see</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex gap-3">
                    <span className="text-catalan-textMuted w-32 shrink-0">UPI ID</span>
                    <span className="font-mono text-catalan-primary">{cfg.upi_id || <span className="text-catalan-textMuted italic">not set</span>}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-catalan-textMuted w-32 shrink-0">Bank Account</span>
                    <span className="font-mono text-catalan-text">{cfg.bank_account || <span className="text-catalan-textMuted italic">not set</span>}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-catalan-textMuted w-32 shrink-0">IFSC</span>
                    <span className="font-mono text-catalan-text">{cfg.bank_ifsc || <span className="text-catalan-textMuted italic">not set</span>}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-catalan-textMuted w-32 shrink-0">Bank</span>
                    <span className="text-catalan-text">{cfg.bank_name || <span className="text-catalan-textMuted italic">not set</span>}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-catalan-textMuted w-32 shrink-0">WhatsApp</span>
                    {cfg.admin_whatsapp ? (
                      <a href={`https://wa.me/${cfg.admin_whatsapp}`} target="_blank" rel="noopener noreferrer"
                        className="text-green-500 hover:underline">+{cfg.admin_whatsapp}</a>
                    ) : <span className="text-catalan-textMuted italic">not set</span>}
                  </div>
                  <div className="flex gap-3">
                    <span className="text-catalan-textMuted w-32 shrink-0">Support Email</span>
                    <span className="text-catalan-text">{cfg.support_email || <span className="text-catalan-textMuted italic">not set</span>}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Assign plan modal */}
      {assignTenant && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`${card} w-full max-w-sm`}>
            <h3 className="text-base font-bold text-catalan-text mb-1">Assign Plan</h3>
            <p className="text-xs text-catalan-textMuted mb-4">{assignTenant.org_name}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-catalan-text mb-1">Plan</label>
                <select className={inp} value={assignPlan} onChange={e => setAssignPlan(e.target.value)}>
                  <option value="">Select plan…</option>
                  {allPlans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-catalan-text mb-1">Billing Cycle</label>
                <select className={inp} value={assignCycle} onChange={e => setAssignCycle(e.target.value)}>
                  {[['monthly','Monthly'],['6month','6-Month (10% off)'],['annual','Annual (20% off)'],['3year','3-Year (30% off)']].map(([k,l]) =>
                    <option key={k} value={k}>{l}</option>
                  )}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setAssignTenant(null)} className={btnSe}>Cancel</button>
              <button onClick={assignPlanToOrg} disabled={!assignPlan || assigning} className={btnPr}>
                {assigning ? 'Assigning…' : 'Assign & Activate'}
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
