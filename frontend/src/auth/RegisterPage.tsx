import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { registerTenant } from '@/lib/api'

const SEGMENTS = [
  { value: 'ngo',       label: 'NGO / Non-profit' },
  { value: 'govt',      label: 'Government' },
  { value: 'research',  label: 'Research / Academia' },
  { value: 'corporate', label: 'Corporate / Private' },
]

export default function RegisterPage() {
  const navigate = useNavigate()

  const [orgName, setOrgName]       = useState('')
  const [adminName, setAdminName]   = useState('')
  const [email, setEmail]           = useState('')
  const [phone, setPhone]           = useState('')
  const [password, setPassword]     = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [segment, setSegment]       = useState('ngo')
  const [showPwd, setShowPwd]       = useState(false)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [done, setDone]             = useState(false)

  const validate = () => {
    if (!orgName.trim()) return 'Organisation name is required.'
    if (!adminName.trim()) return 'Your name is required.'
    if (!email.trim() || !email.includes('@')) return 'A valid email is required.'
    if (password.length < 6) return 'Password must be at least 6 characters.'
    if (password !== confirmPwd) return 'Passwords do not match.'
    return null
  }

  const handleSubmit = async () => {
    const err = validate()
    if (err) { setError(err); return }
    setLoading(true); setError('')
    try {
      await registerTenant({
        org_name: orgName.trim(),
        admin_name: adminName.trim(),
        email: email.trim().toLowerCase(),
        password,
        segment,
        phone: phone.trim() || undefined,
      })
      setDone(true)
    } catch (e: any) {
      setError(e.response?.data?.detail ?? 'Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6"
           style={{ background: 'linear-gradient(160deg, #f8fafc 0%, #eef2ff 100%)' }}>
        <div className="w-full max-w-md text-center">
          <div className="rounded-3xl p-10"
               style={{ background: '#fff', border: '1px solid #e2e8f0', boxShadow: '0 20px 60px rgba(0,0,0,0.06)' }}>
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl flex items-center justify-center"
                 style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.1))', border: '1px solid rgba(99,102,241,0.2)' }}>
              <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-2" style={{ color: '#1e293b' }}>Check your inbox</h2>
            <p className="text-sm mb-1" style={{ color: '#64748b' }}>
              We sent a verification link to
            </p>
            <p className="font-semibold mb-6" style={{ color: '#6366f1' }}>{email}</p>
            <p className="text-xs mb-8" style={{ color: '#94a3b8' }}>
              Click the link in the email to activate your account. The link expires in 24 hours.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="text-sm font-semibold transition-colors"
              style={{ color: '#6366f1' }}
            >
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6"
         style={{ background: 'linear-gradient(160deg, #f8fafc 0%, #eef2ff 100%)' }}>
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <img src="/logo-wide.png" alt="FieldGovern" className="h-9 w-auto object-contain mx-auto" />
        </div>

        <div className="rounded-3xl p-8"
             style={{ background: '#fff', border: '1px solid #e2e8f0', boxShadow: '0 20px 60px rgba(0,0,0,0.06)' }}>

          <div className="mb-6 pb-5 text-center" style={{ borderBottom: '1px solid #e2e8f0' }}>
            <h1 className="text-2xl font-bold" style={{ color: '#1e293b' }}>Start for free</h1>
            <p className="text-sm mt-1" style={{ color: '#64748b' }}>
              30-day trial · No credit card required
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-3 mb-5 px-4 py-3 rounded-xl text-sm"
                 style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}>
              <span className="mt-0.5 flex-shrink-0">!</span>
              <span className="flex-1">{error}</span>
              <button onClick={() => setError('')} className="flex-shrink-0 ml-1 opacity-60 hover:opacity-100">×</button>
            </div>
          )}

          <div className="space-y-4">

            {/* Org name */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#64748b' }}>
                Organisation Name
              </label>
              <input
                type="text"
                placeholder="e.g. Prayas NGO"
                value={orgName}
                autoFocus
                onChange={e => { setOrgName(e.target.value); setError('') }}
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none transition-all"
                style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#1e293b' }}
                onFocus={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)' }}
                onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none' }}
              />
            </div>

            {/* Admin name */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#64748b' }}>
                Your Name
              </label>
              <input
                type="text"
                placeholder="Full name"
                value={adminName}
                onChange={e => { setAdminName(e.target.value); setError('') }}
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none transition-all"
                style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#1e293b' }}
                onFocus={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)' }}
                onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none' }}
              />
            </div>

            {/* Sector */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#64748b' }}>
                Sector
              </label>
              <select
                value={segment}
                onChange={e => setSegment(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none transition-all appearance-none"
                style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#1e293b' }}
                onFocus={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)' }}
                onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none' }}
              >
                {SEGMENTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#64748b' }}>
                Work Email
              </label>
              <input
                type="email"
                placeholder="you@organisation.org"
                value={email}
                onChange={e => { setEmail(e.target.value); setError('') }}
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none transition-all"
                style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#1e293b' }}
                onFocus={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)' }}
                onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none' }}
              />
            </div>

            {/* Phone (optional) */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#64748b' }}>
                Mobile Number <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                type="tel"
                placeholder="98765 43210"
                value={phone}
                onChange={e => { setPhone(e.target.value); setError('') }}
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none transition-all"
                style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#1e293b' }}
                onFocus={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)' }}
                onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none' }}
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#64748b' }}>
                Password
              </label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  placeholder="Min. 6 characters"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError('') }}
                  className="w-full rounded-xl px-4 pr-16 py-3 text-sm focus:outline-none transition-all"
                  style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#1e293b' }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)' }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold px-1.5 py-0.5 rounded"
                  style={{ color: '#6366f1' }}
                  tabIndex={-1}
                >
                  {showPwd ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {/* Confirm password */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#64748b' }}>
                Confirm Password
              </label>
              <input
                type={showPwd ? 'text' : 'password'}
                placeholder="Repeat password"
                value={confirmPwd}
                onChange={e => { setConfirmPwd(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none transition-all"
                style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#1e293b' }}
                onFocus={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)' }}
                onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none' }}
              />
            </div>

          </div>

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full mt-6 py-3.5 rounded-xl font-bold text-sm text-white transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
          >
            {loading
              ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>Creating account...</span></>
              : 'Create Free Account'}
          </button>

          <p className="text-xs text-center mt-4" style={{ color: '#94a3b8' }}>
            Already have an account?{' '}
            <button
              onClick={() => navigate('/login')}
              className="font-semibold transition-colors"
              style={{ color: '#6366f1' }}
            >
              Sign in
            </button>
          </p>

        </div>

        <p className="text-center text-xs mt-6" style={{ color: '#94a3b8' }}>
          Free plan · 30-day trial · No credit card
        </p>
      </div>
    </div>
  )
}
