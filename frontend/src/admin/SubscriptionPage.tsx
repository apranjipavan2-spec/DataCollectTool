import { useState, useEffect } from 'react'
import QRCode from 'react-qr-code'
import api, { getStoredUser } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'
import { useToast } from '@/lib/ToastContext'

interface PlanFeatures {
  ai_cleaning: boolean; ai_writer: boolean; ai_smart_builder: boolean
  ai_interpret: boolean; ai_analyzer: boolean; map_view: boolean
  panel_study: boolean; spss_export: boolean; api_write: boolean
  webhooks: boolean; two_fa: boolean; sso: boolean; audit_log: boolean
  advanced_rbac: boolean; white_label: boolean; priority_support: boolean
}
interface BillingOption { discount_pct: number; months: number; total_inr: number; monthly_effective_inr: number }
interface Plan {
  id: string; segment: string; tier: string; name: string; description: string
  price_inr: number; price_usd_cents: number
  submissions_limit: number | null; storage_limit_mb: number | null
  asr_minutes_limit: number | null
  features: PlanFeatures
  billing: Record<string, BillingOption>
}
interface PaymentDetails {
  order_ref: string; plan_name: string; billing_cycle: string
  amount_inr: number; discount_pct: number
  upi_string: string; upi_id: string; upi_name: string
  bank_account: string; bank_ifsc: string; bank_name: string
  payment_reference: string; instructions: string[]
}

const card  = 'bg-catalan-surface border border-catalan-border rounded-xl p-5'
const btnPr = 'px-4 py-2 bg-catalan-primary text-catalan-bg rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40'
const btnSe = 'px-3 py-1.5 text-sm border border-catalan-border rounded-lg text-catalan-text hover:bg-catalan-hover transition-colors'
const inp   = 'border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text focus:ring-2 focus:ring-catalan-primary outline-none w-full'

const CYCLES = [
  { key: 'monthly', label: 'Monthly',  badge: '' },
  { key: '6month',  label: '6-Month',  badge: '10% off' },
  { key: 'annual',  label: 'Annual',   badge: '20% off' },
  { key: '3year',   label: '3-Year',   badge: '30% off' },
]

const FEATURE_LABELS: Partial<Record<keyof PlanFeatures, string>> = {
  ai_cleaning: 'AI Data Cleaning', ai_writer: 'FG Writer (AI Reports)',
  ai_smart_builder: 'Smart Builder', ai_interpret: 'AI Interpretation',
  ai_analyzer: 'Analyzer', map_view: 'Map View',
  panel_study: 'Panel Study', spss_export: 'SPSS / Stata Export',
  api_write: 'REST API (Write)', webhooks: 'Webhooks',
  two_fa: '2-Factor Authentication', sso: 'Single Sign-On',
  audit_log: 'Audit Log', advanced_rbac: 'Advanced RBAC',
  white_label: 'White-Label Reports', priority_support: 'Priority Support',
}

const SEGMENT_LABELS: Record<string, string> = {
  ngo: 'NGO / Social Impact', govt: 'Government', research: 'Research', corporate: 'Corporate'
}

export default function SubscriptionPage() {
  const user  = getStoredUser()
  const toast = useToast()

  const [plans,    setPlans]    = useState<Plan[]>([])
  const [segment,  setSegment]  = useState('ngo')
  const [cycle,    setCycle]    = useState('monthly')
  const [loading,  setLoading]  = useState(false)

  // Payment flow state
  const [selectedPlan,  setSelectedPlan]  = useState<Plan | null>(null)
  const [paymentDetail, setPaymentDetail] = useState<PaymentDetails | null>(null)
  const [utrInput,      setUtrInput]      = useState('')
  const [submittingUTR, setSubmittingUTR] = useState(false)
  const [utrSubmitted,  setUtrSubmitted]  = useState(false)
  const [paymentTab,    setPaymentTab]    = useState<'upi' | 'bank'>('upi')

  // Current subscription
  const [currentSub, setCurrentSub] = useState<any>(null)

  useEffect(() => {
    api.get('/billing/plans').then(r => setPlans(r.data)).catch(() => {})
    api.get('/billing/my-subscription').then(r => setCurrentSub(r.data)).catch(() => {})
  }, [])

  const segmentPlans = plans.filter(p => p.segment === segment && p.tier !== 'enterprise')

  const requestPayment = async (plan: Plan) => {
    setLoading(true)
    try {
      const res = await api.post('/billing/request', { plan_id: plan.id, billing_cycle: cycle })
      setSelectedPlan(plan)
      setPaymentDetail(res.data)
      setUtrSubmitted(false)
      setUtrInput('')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to create payment request')
    } finally { setLoading(false) }
  }

  const submitUTR = async () => {
    if (!paymentDetail || !utrInput.trim()) return
    setSubmittingUTR(true)
    try {
      await api.post('/billing/utr', { order_ref: paymentDetail.order_ref, utr_number: utrInput.trim() })
      setUtrSubmitted(true)
      toast.success('UTR submitted! We\'ll activate your plan within 2–4 hours.')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to submit UTR')
    } finally { setSubmittingUTR(false) }
  }

  const formatINR = (n: number) => `₹${n.toLocaleString('en-IN')}`
  const formatUSD = (cents: number) => `$${(cents / 100).toFixed(0)}`

  const tierBadge = (tier: string) => {
    const cls = tier === 'growth' ? 'bg-catalan-primary/10 text-catalan-primary border-catalan-primary/20'
      : tier === 'starter' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
      : 'bg-catalan-hover text-catalan-textMuted border-catalan-border'
    return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cls}`}>{tier.toUpperCase()}</span>
  }

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={getNavItems(user?.role ?? '')} role={user?.role} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav titleNode={<span className="text-catalan-text font-semibold text-base">Subscription & Plans</span>} />
        <main className="flex-1 overflow-auto p-6 space-y-6">

          {/* Current subscription banner */}
          {currentSub && (
            <div className={`${card} flex flex-col sm:flex-row sm:items-center gap-4`}>
              <div className="flex-1">
                <div className="text-sm font-semibold text-catalan-text mb-1">
                  Current Plan: <span className="text-catalan-primary">{currentSub.subscription.plan_name}</span>
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                    currentSub.subscription.status === 'active' ? 'bg-green-500/10 text-green-500'
                    : 'bg-amber-500/10 text-amber-500'
                  }`}>{currentSub.subscription.status}</span>
                </div>
                <div className="flex gap-6 text-xs text-catalan-textMuted">
                  <span>Submissions: <b className="text-catalan-text">{currentSub.usage.submissions_used.toLocaleString()}</b> / {currentSub.limits.submissions_limit?.toLocaleString() ?? '∞'}</span>
                  <span>Storage: <b className="text-catalan-text">{currentSub.usage.storage_used_mb.toFixed(1)} MB</b> / {currentSub.limits.storage_limit_mb ? `${currentSub.limits.storage_limit_mb} MB` : '∞'}</span>
                  {currentSub.subscription.period_end && (
                    <span>Renews: <b className="text-catalan-text">{new Date(currentSub.subscription.period_end).toLocaleDateString()}</b></span>
                  )}
                </div>
              </div>
              {currentSub.pending_payment && (
                <div className="text-xs bg-amber-500/10 border border-amber-500/20 text-amber-600 rounded-lg px-3 py-2">
                  Payment pending for <b>{currentSub.pending_payment.order_ref}</b> — awaiting admin confirmation
                </div>
              )}
            </div>
          )}

          {/* Segment tabs */}
          <div className="flex gap-1 border-b border-catalan-border">
            {Object.entries(SEGMENT_LABELS).map(([k, v]) => (
              <button key={k} onClick={() => setSegment(k)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  segment === k ? 'border-catalan-primary text-catalan-primary' : 'border-transparent text-catalan-textMuted hover:text-catalan-text'
                }`}>
                {v}
              </button>
            ))}
          </div>

          {/* Billing cycle toggle */}
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-xs text-catalan-textMuted">Billing cycle:</span>
            {CYCLES.map(c => (
              <button key={c.key} onClick={() => setCycle(c.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-all ${
                  cycle === c.key
                    ? 'bg-catalan-primary text-catalan-bg border-catalan-primary'
                    : 'border-catalan-border text-catalan-text hover:bg-catalan-hover'
                }`}>
                {c.label}
                {c.badge && <span className={`text-xs px-1.5 py-0.5 rounded-full ${cycle === c.key ? 'bg-white/20' : 'bg-green-500/10 text-green-600'}`}>{c.badge}</span>}
              </button>
            ))}
          </div>

          {/* Plan cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {segmentPlans.map(plan => {
              const billing = plan.billing[cycle]
              const isFree  = plan.tier === 'free'
              const isGrowth= plan.tier === 'growth'
              return (
                <div key={plan.id} className={`${card} flex flex-col gap-4 relative ${isGrowth ? 'border-catalan-primary ring-1 ring-catalan-primary/30' : ''}`}>
                  {isGrowth && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-catalan-primary text-catalan-bg text-xs font-bold px-3 py-0.5 rounded-full">
                      Most Popular
                    </div>
                  )}
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-base font-bold text-catalan-text">{plan.name}</div>
                      <div className="text-xs text-catalan-textMuted mt-0.5">{plan.description}</div>
                    </div>
                    {tierBadge(plan.tier)}
                  </div>

                  <div>
                    {isFree ? (
                      <div className="text-3xl font-bold text-catalan-primary">Free</div>
                    ) : (
                      <>
                        <div className="text-3xl font-bold text-catalan-text">
                          {formatINR(billing.monthly_effective_inr)}
                          <span className="text-base font-normal text-catalan-textMuted">/mo</span>
                        </div>
                        {cycle !== 'monthly' && (
                          <div className="text-xs text-catalan-textMuted mt-0.5">
                            {formatINR(billing.total_inr)} billed {CYCLES.find(c => c.key === cycle)?.label.toLowerCase()}
                            {' '}· <span className="text-green-500">Save {billing.discount_pct}%</span>
                          </div>
                        )}
                        <div className="text-xs text-catalan-textMuted">
                          (~{formatUSD(Math.round(billing.total_inr * 0.012 * 100) / CYCLES.find(c=>c.key===cycle)!.months)}/mo)
                        </div>
                      </>
                    )}
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center gap-2 text-catalan-text">
                      <span className="text-catalan-primary">📊</span>
                      <span><b>{plan.submissions_limit?.toLocaleString() ?? 'Unlimited'}</b> submissions/mo</span>
                    </div>
                    <div className="flex items-center gap-2 text-catalan-text">
                      <span className="text-catalan-primary">💾</span>
                      <span><b>{plan.storage_limit_mb ? `${plan.storage_limit_mb} MB` : 'Unlimited'}</b> storage</span>
                    </div>
                    <div className="flex items-center gap-2 text-catalan-text">
                      <span className="text-catalan-primary">🎤</span>
                      <span><b>{plan.asr_minutes_limit ?? 'Unlimited'} min</b> auto-transcription/mo</span>
                    </div>
                    <div className="border-t border-catalan-border/50 pt-2 mt-2 space-y-1">
                      {(Object.keys(FEATURE_LABELS) as (keyof PlanFeatures)[]).map(f => (
                        <div key={f} className={`flex items-center gap-1.5 ${plan.features[f] ? 'text-catalan-text' : 'text-catalan-textMuted/50 line-through'}`}>
                          <span>{plan.features[f] ? '✓' : '✕'}</span>
                          <span>{FEATURE_LABELS[f]}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => isFree ? null : requestPayment(plan)}
                    disabled={loading || isFree}
                    className={`mt-auto ${isFree
                      ? 'px-4 py-2 bg-catalan-hover text-catalan-textMuted rounded-lg text-sm cursor-default'
                      : `${btnPr} w-full`
                    }`}
                  >
                    {isFree ? 'Current Free Plan' : loading ? 'Loading…' : `Choose ${plan.name} →`}
                  </button>
                </div>
              )
            })}

            {/* Enterprise CTA */}
            <div className={`${card} flex flex-col gap-3 border-dashed`}>
              <div className="text-base font-bold text-catalan-text">Enterprise</div>
              <div className="text-xs text-catalan-textMuted">Custom volume, SSO, on-premise, white-label, DPDP compliance, dedicated support.</div>
              <div className="text-2xl font-bold text-catalan-text">Custom</div>
              <div className="space-y-1 text-xs text-catalan-textMuted">
                <div>✓ Unlimited submissions & storage</div>
                <div>✓ All AI features</div>
                <div>✓ SSO + Audit log + On-premise</div>
                <div>✓ Dedicated CSM + Priority SLA</div>
              </div>
              <a href="mailto:pallavi@dataworx.co.in?subject=FieldGovern Enterprise Enquiry"
                className={`${btnSe} text-center mt-auto`}>
                Contact Sales →
              </a>
            </div>
          </div>

          {/* 1-month free trial note */}
          <p className="text-xs text-catalan-textMuted text-center">
            All paid plans include a <b>1-month free trial</b> — full access, no payment required upfront. · Dual pricing: INR for India, USD for international.
          </p>
        </main>
      </div>

      {/* Payment modal */}
      {paymentDetail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className={`${card} w-full max-w-lg max-h-[90vh] overflow-y-auto`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-catalan-text">Complete Payment</h2>
              <button onClick={() => setPaymentDetail(null)} className="text-catalan-textMuted hover:text-catalan-text text-lg">✕</button>
            </div>

            {/* Summary */}
            <div className="bg-catalan-hover rounded-xl p-4 mb-4 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-catalan-textMuted">Plan</span><span className="font-semibold text-catalan-text">{paymentDetail.plan_name}</span></div>
              <div className="flex justify-between"><span className="text-catalan-textMuted">Billing</span><span className="text-catalan-text">{CYCLES.find(c => c.key === paymentDetail.billing_cycle)?.label}</span></div>
              {paymentDetail.discount_pct > 0 && <div className="flex justify-between"><span className="text-catalan-textMuted">Discount</span><span className="text-green-500">−{paymentDetail.discount_pct}%</span></div>}
              <div className="flex justify-between font-bold text-base border-t border-catalan-border pt-2 mt-2">
                <span className="text-catalan-text">Total</span>
                <span className="text-catalan-primary">₹{paymentDetail.amount_inr.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between text-xs text-catalan-textMuted pt-1">
                <span>Reference Code (mention in payment)</span>
                <span className="font-mono font-bold text-catalan-primary">{paymentDetail.order_ref}</span>
              </div>
            </div>

            {/* Payment method tabs */}
            <div className="flex gap-1 mb-4 bg-catalan-hover rounded-lg p-1">
              {(['upi', 'bank'] as const).map(t => (
                <button key={t} onClick={() => setPaymentTab(t)}
                  className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${
                    paymentTab === t ? 'bg-catalan-surface text-catalan-text shadow-sm' : 'text-catalan-textMuted hover:text-catalan-text'
                  }`}>
                  {t === 'upi' ? '📱 UPI / QR Code' : '🏦 Bank Transfer'}
                </button>
              ))}
            </div>

            {paymentTab === 'upi' && (
              <div className="flex flex-col items-center gap-4">
                <div className="bg-white p-4 rounded-xl">
                  <QRCode value={paymentDetail.upi_string} size={200} />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-semibold text-catalan-text">Scan with any UPI app</p>
                  <p className="text-xs text-catalan-textMuted">Google Pay · PhonePe · Paytm · BHIM · Any UPI app</p>
                  <div className="mt-2 text-xs font-mono bg-catalan-hover px-3 py-1.5 rounded-lg text-catalan-text">
                    {paymentDetail.upi_id}
                  </div>
                </div>
              </div>
            )}

            {paymentTab === 'bank' && (
              <div className="space-y-2 text-sm">
                {[
                  ['Account Name', paymentDetail.upi_name],
                  ['Account Number', paymentDetail.bank_account],
                  ['IFSC Code', paymentDetail.bank_ifsc],
                  ['Bank', paymentDetail.bank_name],
                  ['Amount', `₹${paymentDetail.amount_inr.toLocaleString('en-IN')}`],
                  ['Reference / Remarks', paymentDetail.order_ref],
                ].map(([label, val]) => (
                  <div key={label} className="flex justify-between items-center bg-catalan-hover rounded-lg px-3 py-2">
                    <span className="text-catalan-textMuted text-xs">{label}</span>
                    <span className="font-mono font-semibold text-catalan-text text-xs">{val}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Instructions */}
            <div className="mt-4 space-y-1">
              {paymentDetail.instructions.map((inst, i) => (
                <div key={i} className="flex gap-2 text-xs text-catalan-textMuted">
                  <span className="text-catalan-primary font-bold shrink-0">{i + 1}.</span>
                  <span>{inst}</span>
                </div>
              ))}
            </div>

            {/* UTR submission */}
            {utrSubmitted ? (
              <div className="mt-4 bg-green-500/10 border border-green-500/20 text-green-600 rounded-xl px-4 py-3 text-sm text-center">
                ✓ UTR submitted! We'll activate your plan within 2–4 business hours.
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                <label className="text-xs font-semibold text-catalan-text">Enter UTR / Transaction Reference Number</label>
                <input
                  className={inp}
                  placeholder="e.g. 426112345678 or HDFC26042026XXXXXX"
                  value={utrInput}
                  onChange={e => setUtrInput(e.target.value)}
                />
                <button
                  onClick={submitUTR}
                  disabled={!utrInput.trim() || submittingUTR}
                  className={`${btnPr} w-full`}
                >
                  {submittingUTR ? 'Submitting…' : 'I've Paid — Submit UTR →'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
