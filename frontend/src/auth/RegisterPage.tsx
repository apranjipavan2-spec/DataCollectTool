import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { registerTenant } from '@/lib/api'

const WA_NUMBER = '918088709011'
const WA_LINK = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(
  'Hi Pallavi, I need help setting up my FieldGovern trial account.'
)}`

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined

const SEGMENTS = [
  { value: 'ngo', label: 'NGO / Social Impact' },
  { value: 'govt', label: 'Government' },
  { value: 'research', label: 'Research / Academia' },
  { value: 'corporate', label: 'Corporate / CSR' },
]

// Load the Turnstile widget only if a site key is configured (matches the
// backend, which skips verification when TURNSTILE_SECRET is unset).
declare global {
  interface Window { turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string } }
}

export default function RegisterPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    org_name: '', admin_name: '', email: '', phone: '', password: '', segment: 'ngo',
  })
  const [captchaToken, setCaptchaToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const captchaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.turnstile && captchaRef.current) {
        window.turnstile.render(captchaRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token: string) => setCaptchaToken(token),
        })
      }
    }
    document.body.appendChild(script)
    return () => { document.body.removeChild(script) }
  }, [])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async () => {
    setError('')
    if (!form.org_name.trim() || !form.admin_name.trim() || !form.email.trim() || !form.password) {
      setError('Please fill in all required fields.')
      return
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setError('Please complete the verification challenge.')
      return
    }
    setLoading(true)
    try {
      await registerTenant({
        org_name: form.org_name.trim(),
        admin_name: form.admin_name.trim(),
        email: form.email.trim(),
        password: form.password,
        segment: form.segment,
        phone: form.phone.trim() || undefined,
        turnstile_token: captchaToken || undefined,
      })
      setDone(true)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const input: React.CSSProperties = {
    width: '100%', padding: '10px 14px', borderRadius: '12px',
    border: '1px solid #e2e8f0', fontSize: '14px', outline: 'none', background: '#fff',
  }
  const labelCls = 'block text-xs font-semibold mb-1.5'

  return (
    <div className="min-h-screen flex items-center justify-center p-6"
         style={{ background: 'linear-gradient(160deg, #f8fafc 0%, #eef2ff 100%)' }}>
      <div className="w-full max-w-md">

        <div className="text-center mb-8">
          <img src="/logo-wide.png" alt="FieldGovern" className="h-9 w-auto object-contain mx-auto" />
        </div>

        <div className="rounded-3xl p-8"
             style={{ background: '#fff', border: '1px solid #e2e8f0', boxShadow: '0 20px 60px rgba(0,0,0,0.06)' }}>

          {done ? (
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-5 rounded-2xl flex items-center justify-center"
                   style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)' }}>
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="#6366f1" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold mb-2" style={{ color: '#1e293b' }}>Check your email</h1>
              <p className="text-sm mb-6" style={{ color: '#64748b' }}>
                We've sent a verification link to <strong style={{ color: '#1e293b' }}>{form.email}</strong>.
                Click it to activate your 15-day free trial.
              </p>
              <button onClick={() => navigate('/login')}
                      className="w-full py-3 rounded-xl font-bold text-sm text-white"
                      style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                Back to Sign in
              </button>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold mb-1 text-center" style={{ color: '#1e293b' }}>Start your free trial</h1>
              <p className="text-sm mb-6 text-center" style={{ color: '#64748b' }}>
                15 days, full features, no card required.
              </p>

              {error && (
                <div className="mb-4 px-4 py-3 rounded-xl text-sm"
                     style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}>
                  {error}
                </div>
              )}

              <div className="space-y-3.5">
                <div>
                  <label className={labelCls} style={{ color: '#475569' }}>Organization name *</label>
                  <input style={input} value={form.org_name} onChange={set('org_name')} placeholder="Your organization" />
                </div>
                <div>
                  <label className={labelCls} style={{ color: '#475569' }}>Your name *</label>
                  <input style={input} value={form.admin_name} onChange={set('admin_name')} placeholder="Full name" />
                </div>
                <div>
                  <label className={labelCls} style={{ color: '#475569' }}>Organization type</label>
                  <select style={input} value={form.segment} onChange={set('segment')}>
                    {SEGMENTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls} style={{ color: '#475569' }}>Work email *</label>
                  <input style={input} type="email" value={form.email} onChange={set('email')} placeholder="you@organization.org" />
                </div>
                <div>
                  <label className={labelCls} style={{ color: '#475569' }}>Phone (optional)</label>
                  <input style={input} value={form.phone} onChange={set('phone')} placeholder="+91…" />
                </div>
                <div>
                  <label className={labelCls} style={{ color: '#475569' }}>Password *</label>
                  <input style={input} type="password" value={form.password} onChange={set('password')} placeholder="At least 6 characters" />
                </div>

                {TURNSTILE_SITE_KEY && <div ref={captchaRef} className="flex justify-center pt-1" />}

                <button
                  onClick={submit}
                  disabled={loading}
                  className="w-full py-3.5 rounded-xl font-bold text-sm text-white transition-all active:scale-[0.98] disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', boxShadow: '0 4px 14px rgba(99,102,241,0.35)' }}
                >
                  {loading ? 'Creating your account…' : 'Start free trial'}
                </button>
              </div>

              <p className="text-xs mt-5 text-center" style={{ color: '#94a3b8' }}>
                Already have an account?{' '}
                <button onClick={() => navigate('/login')} className="font-semibold" style={{ color: '#6366f1' }}>
                  Sign in
                </button>
                {' · '}
                <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="font-semibold" style={{ color: '#6366f1' }}>
                  Need help?
                </a>
              </p>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
