import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import { getStoredUser } from '@/lib/api'

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
  asr_minutes_limit: number | null; features: PlanFeatures
  billing: Record<string, BillingOption>
}
interface PaymentCfg { admin_whatsapp?: string; support_email?: string }

const SEGMENTS = [
  { key: 'ngo',       label: 'NGO / Social Impact', icon: '🌱' },
  { key: 'govt',      label: 'Government',           icon: '🏛️' },
  { key: 'research',  label: 'Research',             icon: '🔬' },
  { key: 'corporate', label: 'Corporate',            icon: '🏢' },
]

const CYCLES = [
  { key: 'monthly', label: 'Monthly',  months: 1,  save: '' },
  { key: '6month',  label: '6 Months', months: 6,  save: 'Save 10%' },
  { key: 'annual',  label: 'Annual',   months: 12, save: '2 months free' },
  { key: '3year',   label: '3 Years',  months: 36, save: 'Save 30%' },
]

const FEATURES: { key: keyof PlanFeatures; label: string; desc: string }[] = [
  { key: 'ai_cleaning',     label: 'AI Data Cleaning',     desc: 'Auto-detect and fix inconsistencies with a full cleaning audit trail' },
  { key: 'ai_analyzer',     label: 'AI Analyzer',          desc: 'AI-suggested cross-tabulations and automatic pivot tables' },
  { key: 'ai_writer',       label: 'FG Writer',            desc: 'Generate donor-ready reports (USAID, EU, Gates templates) in minutes' },
  { key: 'ai_smart_builder',label: 'Smart Builder',        desc: 'Design survey tables and cross-tabs using natural language' },
  { key: 'ai_interpret',    label: 'AI Interpretation',    desc: 'Narrative insights with iterative refinement below every tabulation' },
  { key: 'map_view',        label: 'Map View',             desc: 'Visualise GPS submissions and flag spoofing attempts' },
  { key: 'panel_study',     label: 'Panel Study',          desc: 'Longitudinal tracking with attrition reports and wave management' },
  { key: 'spss_export',     label: 'SPSS / Stata Export',  desc: 'Publication-grade export with data dictionary / codebook' },
  { key: 'api_write',       label: 'REST API (Write)',      desc: 'Read + write API for CRM / ERP / Zapier / n8n integration' },
  { key: 'webhooks',        label: 'Webhooks',             desc: 'Real-time submission events to any endpoint' },
  { key: 'two_fa',          label: '2-Factor Auth',        desc: 'Email OTP on every login — mandatory for sensitive data programmes' },
  { key: 'white_label',     label: 'White-Label',          desc: 'Custom branding, logo, and domain for reports and the platform' },
  { key: 'priority_support',label: 'Priority Support',     desc: 'Dedicated success manager with guaranteed SLA response times' },
]

const FAQS = [
  { q: 'How is FieldGovern different from KoboToolbox?', a: 'KoboToolbox collects data — FieldGovern collects and analyses it. Every paid plan includes AI Data Cleaning (with audit trail), FG Writer for donor reports, Smart Builder for cross-tabs, and panel study tracking. On KoboToolbox these require a separate data analyst costing ₹30,000–₹50,000/month. FieldGovern includes them from ₹6,499/month.' },
  { q: 'Do I need a credit card to start?', a: 'No. Your 30-day free trial starts the moment your organisation is created. No payment details required.' },
  { q: 'How do I pay?', a: 'We accept UPI (Google Pay, PhonePe, Paytm) and direct bank transfer (NEFT/RTGS). Our admin confirms payment and activates your plan within 2–4 business hours.' },
  { q: 'Can I switch plans mid-cycle?', a: 'Yes. Contact us and we will upgrade or downgrade your plan. Upgrades are prorated; downgrades take effect at the next billing cycle.' },
  { q: 'What happens when I hit the submission limit?', a: 'New submissions are blocked and you receive an in-app notification. All existing data remains safe. Upgrade anytime to continue collecting.' },
  { q: 'Is there a discount for NGOs?', a: 'The NGO segment already carries our lowest pricing — up to 20% below comparable KoboToolbox plans. Additional goodwill discounts for very small NGOs can be arranged — contact us on WhatsApp.' },
  { q: 'Can I get a demo?', a: 'Yes — message us on WhatsApp and we will schedule a live walkthrough for your team, including a sample data cleaning and AI report demonstration.' },
]

function FmtINR(n: number) { return `₹${n.toLocaleString('en-IN')}` }
function FmtUSD(cents: number) { return `$${Math.round(cents / 100)}` }

export default function PricingPage() {
  const navigate = useNavigate()
  const user = getStoredUser()

  const [plans,      setPlans]      = useState<Plan[]>([])
  const [loading,    setLoading]    = useState(true)
  const [segment,    setSegment]    = useState('ngo')
  const [cycle,      setCycle]      = useState('annual')
  const [openFaq,    setOpenFaq]    = useState<number | null>(null)
  const [paymentCfg, setPaymentCfg] = useState<PaymentCfg>({})

  useEffect(() => {
    api.get('/billing/plans').then(r => setPlans(r.data)).catch(() => {}).finally(() => setLoading(false))
    api.get('/billing/payment-config').then(r => setPaymentCfg(r.data)).catch(() => {})
  }, [])

  const waNumber  = paymentCfg.admin_whatsapp?.replace(/\D/g, '') || '918088709011'
  const waEnqLink = `https://wa.me/${waNumber}?text=Hi%2C%20I%27d%20like%20to%20know%20more%20about%20FieldGovern.`
  const waEntLink = `https://wa.me/${waNumber}?text=Hi%2C%20I%27m%20interested%20in%20FieldGovern%20Enterprise.`
  const supportEmail = paymentCfg.support_email || 'support@fieldgovern.in'

  const segmentPlans = plans.filter(p => p.segment === segment && p.tier !== 'enterprise')

  const handleCTA = (plan: Plan) => {
    if (plan.tier === 'enterprise') { window.open(waEntLink, '_blank'); return }
    if (user) navigate('/subscription')
    else navigate('/login')
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <img src="/logo-wide.png" alt="FieldGovern" className="h-9 w-auto object-contain" />
          <nav className="hidden md:flex items-center gap-8 text-sm text-slate-600">
            <a href="#pricing" className="hover:text-slate-900 transition-colors">Pricing</a>
            <a href="#features" className="hover:text-slate-900 transition-colors">Features</a>
            <a href="#faq" className="hover:text-slate-900 transition-colors">FAQ</a>
          </nav>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/login')}
              className="text-sm text-slate-600 hover:text-slate-900 transition-colors font-medium">
              Sign In
            </button>
            <button onClick={() => navigate('/login')}
              className="text-sm px-4 py-2 rounded-lg font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg,#0ea5e9,#7c3aed)' }}>
              Start Free Trial
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="pt-20 pb-12 text-center px-6">
        <div className="inline-flex items-center gap-2 mb-6 px-4 py-1.5 rounded-full text-xs font-semibold border border-blue-200 bg-blue-50 text-blue-700">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
          30-day free trial · No credit card
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold text-slate-900 mb-4 leading-tight">
          The AI-native alternative to KoboToolbox<br />
          <span style={{ background: 'linear-gradient(135deg,#0ea5e9,#7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            at 80% of the price
          </span>
        </h1>
        <p className="text-slate-500 text-lg max-w-xl mx-auto mb-3">
          Segment-specific plans for NGOs, Government, Research and Corporate. Built-in AI cleaning, FG Writer reports, and panel study. Pay by UPI.
        </p>
        <p className="text-sm text-slate-400">Prices in INR · USD shown for reference · GST extra</p>
      </section>

      {/* ── Pricing section ── */}
      <section id="pricing" className="max-w-7xl mx-auto px-6 pb-24">

        {/* Billing cycle toggle */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {CYCLES.map(c => (
            <button key={c.key} onClick={() => setCycle(c.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                cycle === c.key
                  ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}>
              {c.label}
              {c.save && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                  cycle === c.key ? 'bg-white/20 text-white' : 'bg-green-100 text-green-700'
                }`}>{c.save}</span>
              )}
            </button>
          ))}
        </div>

        {/* Segment tabs */}
        <div className="flex justify-center mb-10">
          <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
            {SEGMENTS.map(s => (
              <button key={s.key} onClick={() => setSegment(s.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  segment === s.key
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}>
                <span>{s.icon}</span>
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Plan cards */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {segmentPlans.map(plan => {
              const billing  = plan.billing[cycle]
              const isFree   = plan.tier === 'free'
              const isGrowth = plan.tier === 'growth'

              return (
                <div key={plan.id}
                  className={`relative flex flex-col rounded-2xl border p-7 transition-shadow hover:shadow-lg ${
                    isGrowth
                      ? 'border-blue-500 shadow-blue-100 shadow-lg bg-white ring-2 ring-blue-500/20'
                      : 'border-slate-200 bg-white'
                  }`}>

                  {isGrowth && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-xs font-bold text-white shadow-md"
                      style={{ background: 'linear-gradient(135deg,#0ea5e9,#7c3aed)' }}>
                      Most Popular
                    </div>
                  )}

                  {/* Plan name + tier */}
                  <div className="mb-5">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                        isFree ? 'bg-slate-100 text-slate-500'
                        : isGrowth ? 'bg-blue-50 text-blue-700'
                        : 'bg-amber-50 text-amber-700'
                      }`}>{plan.tier.toUpperCase()}</span>
                    </div>
                    <p className="text-sm text-slate-500">{plan.description}</p>
                  </div>

                  {/* Price */}
                  <div className="mb-6">
                    {isFree ? (
                      <div className="text-4xl font-extrabold text-slate-900">Free</div>
                    ) : (
                      <>
                        <div className="flex items-end gap-1">
                          <span className="text-4xl font-extrabold text-slate-900">
                            {FmtINR(billing.monthly_effective_inr)}
                          </span>
                          <span className="text-slate-400 text-sm mb-1.5">/month</span>
                        </div>
                        {cycle !== 'monthly' && (
                          <p className="text-sm text-slate-500 mt-1">
                            {FmtINR(billing.total_inr)} billed {CYCLES.find(c => c.key === cycle)?.label.toLowerCase()}
                            {' '}<span className="text-green-600 font-semibold">· Save {billing.discount_pct}%</span>
                          </p>
                        )}
                        <p className="text-xs text-slate-400 mt-0.5">
                          ≈ {FmtUSD(Math.round(billing.total_inr * 0.012 * 100) / (CYCLES.find(c => c.key === cycle)?.months ?? 1))}/mo USD
                        </p>
                      </>
                    )}
                  </div>

                  {/* CTA */}
                  <button onClick={() => handleCTA(plan)}
                    className={`w-full py-3 rounded-xl text-sm font-bold mb-6 transition-all ${
                      isGrowth
                        ? 'text-white shadow-md hover:shadow-lg hover:opacity-90'
                        : isFree
                        ? 'bg-slate-900 text-white hover:bg-slate-700'
                        : 'bg-slate-100 text-slate-900 hover:bg-slate-200'
                    }`}
                    style={isGrowth ? { background: 'linear-gradient(135deg,#0ea5e9,#7c3aed)' } : {}}>
                    {isFree ? 'Start Free' : 'Get Started'}
                  </button>

                  {/* Limits */}
                  <div className="space-y-2.5 text-sm border-t border-slate-100 pt-5 mb-5">
                    <div className="flex items-center gap-2.5 text-slate-700">
                      <span className="text-base">📊</span>
                      <span><b>{plan.submissions_limit?.toLocaleString() ?? 'Unlimited'}</b> submissions / month</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-slate-700">
                      <span className="text-base">💾</span>
                      <span><b>{plan.storage_limit_mb ? `${plan.storage_limit_mb} MB` : 'Unlimited'}</b> storage</span>
                    </div>
                    {plan.asr_minutes_limit ? (
                      <div className="flex items-center gap-2.5 text-slate-700">
                        <span className="text-base">🎤</span>
                        <span><b>{plan.asr_minutes_limit} min</b> voice transcription / month</span>
                      </div>
                    ) : null}
                  </div>

                  {/* Features */}
                  <div className="space-y-2 text-sm">
                    {FEATURES.map(f => {
                      const has = plan.features[f.key]
                      return (
                        <div key={f.key} className={`flex items-start gap-2.5 ${has ? 'text-slate-700' : 'text-slate-300'}`}>
                          <span className="mt-0.5 flex-shrink-0 text-base">{has ? '✓' : '✕'}</span>
                          <span className={has ? '' : 'line-through'}>{f.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {/* Enterprise card */}
            <div className="flex flex-col rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-7 justify-center items-center text-center gap-4">
              <div className="text-4xl">🏗️</div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-1">Enterprise</h3>
                <p className="text-sm text-slate-500">Custom limits · Dedicated infra · White-label · SSO · On-premise available</p>
              </div>
              <div className="text-2xl font-bold text-slate-900">Custom pricing</div>
              <a href={waEntLink} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
                style={{ background: '#25D366' }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Talk to us
              </a>
            </div>
          </div>
        )}

        {/* Savings callout */}
        {cycle !== 'monthly' && (
          <div className="text-center py-4 px-6 bg-green-50 border border-green-200 rounded-2xl max-w-lg mx-auto text-sm text-green-700 font-medium mb-10">
            You save {CYCLES.find(c => c.key === cycle)?.save} with the {CYCLES.find(c => c.key === cycle)?.label} plan. Billed as one payment.
          </div>
        )}

        {/* Payment methods */}
        <div className="flex flex-wrap justify-center items-center gap-6 py-6 border-y border-slate-100 mb-16 text-sm text-slate-500">
          <span className="font-semibold text-slate-700">Accepted payments:</span>
          {['Google Pay', 'PhonePe', 'Paytm', 'BHIM UPI', 'NEFT / RTGS'].map(m => (
            <span key={m} className="px-3 py-1.5 bg-slate-100 rounded-full text-xs font-medium text-slate-600">{m}</span>
          ))}
          <span className="text-xs text-slate-400">Activation within 2–4 business hours after payment</span>
        </div>

        {/* Features table */}
        <section id="features" className="mb-20">
          <h2 className="text-2xl font-bold text-slate-900 text-center mb-2">Everything in one platform</h2>
          <p className="text-slate-500 text-center mb-10">Every plan includes offline data collection, GPS tagging, role-based access, and auto-sync.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: '📡', title: 'Offline-first',          desc: 'Collect with zero internet. Auto-syncs the moment connectivity returns — no manual uploads.' },
              { icon: '🤖', title: 'AI Data Cleaning',       desc: 'Auto-detect and fix data errors with a full cleaning audit trail. No analyst salary needed.' },
              { icon: '📝', title: 'FG Writer Reports',      desc: 'AI-generated donor reports (USAID, EU, Gates templates) in minutes, not weeks.' },
              { icon: '📍', title: 'GPS + Fraud Detection',  desc: 'Record location at every submission and automatically flag GPS spoofing attempts.' },
              { icon: '👥', title: 'Role-based teams',       desc: 'Admins, supervisors, and enumerators with hierarchy-aware, scoped access control.' },
              { icon: '📋', title: 'Smart Form Builder',     desc: '25+ question types, skip logic, cascading selects, XLSForm import/export.' },
              { icon: '🌐', title: 'Multi-language',         desc: 'Forms and the platform UI in Hindi, Kannada, Telugu, English — more on roadmap.' },
              { icon: '📊', title: 'Panel Study',            desc: 'Track the same respondents across multiple waves with attrition and retention reports.' },
              { icon: '🔗', title: 'API + Webhooks',         desc: 'Push data to CRM, ERP, Zapier, or n8n in real time with read + write REST API.' },
            ].map(f => (
              <div key={f.title} className="flex gap-4 p-5 rounded-xl border border-slate-100 bg-slate-50 hover:border-slate-200 transition-colors">
                <span className="text-2xl flex-shrink-0">{f.icon}</span>
                <div>
                  <div className="font-semibold text-slate-900 text-sm">{f.title}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="max-w-2xl mx-auto mb-20">
          <h2 className="text-2xl font-bold text-slate-900 text-center mb-8">Frequently asked questions</h2>
          <div className="divide-y divide-slate-100 border border-slate-100 rounded-2xl overflow-hidden">
            {FAQS.map((faq, i) => (
              <div key={i}>
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-50 transition-colors">
                  <span className="font-medium text-slate-900 text-sm">{faq.q}</span>
                  <span className={`text-slate-400 transition-transform duration-200 flex-shrink-0 ml-4 ${openFaq === i ? 'rotate-180' : ''}`}>▾</span>
                </button>
                {openFaq === i && (
                  <div className="px-6 pb-5 text-sm text-slate-600 leading-relaxed">{faq.a}</div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <div className="text-center py-16 px-6 rounded-3xl bg-gradient-to-br from-blue-50 to-purple-50 border border-blue-100">
          <h2 className="text-3xl font-extrabold text-slate-900 mb-3">Ready to get started?</h2>
          <p className="text-slate-500 mb-8 max-w-md mx-auto">30-day free trial. No credit card. Activate your paid plan any time by UPI or bank transfer.</p>
          <div className="flex flex-wrap justify-center gap-4">
            <button onClick={() => navigate('/login')}
              className="px-8 py-3.5 rounded-xl font-bold text-white text-sm shadow-lg hover:opacity-90 transition-opacity"
              style={{ background: 'linear-gradient(135deg,#0ea5e9,#7c3aed)' }}>
              Start Free Trial →
            </button>
            <a href={waEnqLink}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-8 py-3.5 rounded-xl font-bold text-white text-sm shadow-md hover:opacity-90 transition-opacity"
              style={{ background: '#25D366' }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Chat with us
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 py-10 px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-400">
          <div className="flex items-center gap-3">
            <img src="/logo-wide.png" alt="FieldGovern" className="h-7 w-auto object-contain opacity-60" />
            <span>© 2026 FieldGovern · CEO: Pallavi Deshetty</span>
          </div>
          <div className="flex gap-6">
            <button onClick={() => navigate('/login')} className="hover:text-slate-700 transition-colors">Sign In</button>
            <a href={`mailto:${supportEmail}`} className="hover:text-slate-700 transition-colors">{supportEmail}</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
