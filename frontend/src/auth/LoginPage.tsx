import React, { useState } from 'react'
import api, { storeUser } from '@/lib/api'
import { useNavigate } from 'react-router-dom'
import { subscribeToPush } from '@/lib/pushNotifications'

const DEMO_ACCOUNTS = [
  { role: 'Admin',       icon: '🛡',  phone: '+919999990001', password: 'test@123', color: '#2563eb' },
  { role: 'Supervisor',  icon: '👁',  phone: '+919999990002', password: 'test@123', color: '#7c3aed' },
  { role: 'Enumerator',  icon: '📋',  phone: '+919999990003', password: 'test@123', color: '#059669' },
]

export default function LoginPage() {
  const navigate = useNavigate()
  const [phone, setPhone]       = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [phoneErr, setPhoneErr] = useState('')
  const [pwdErr, setPwdErr]     = useState('')
  const [showDemo, setShowDemo] = useState(false)
  const [filledRole, setFilledRole] = useState('')

  const normalizePhone = (raw: string) => {
    const digits = raw.replace(/\D/g, '')
    if (digits.length === 10) return `+91${digits}`
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
    return raw.trim()
  }

  const validate = () => {
    let ok = true
    setPhoneErr(''); setPwdErr('')
    if (!phone.trim()) { setPhoneErr('Mobile number is required'); ok = false }
    if (!password)     { setPwdErr('Password is required'); ok = false }
    return ok
  }

  const handleLogin = async () => {
    if (!validate()) return
    setLoading(true); setError('')
    try {
      const { data } = await api.post('/auth/login', { phone: normalizePhone(phone), password })
      storeUser(data)
      subscribeToPush().catch(() => {})
      const dest = data.role === 'master_admin' ? '/admin'
                 : data.role === 'enumerator'   ? '/collect'
                 : '/'
      navigate(dest, { replace: true })
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Invalid phone or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-white">

      {/* ── Left branding panel ── */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[520px] flex-shrink-0 flex-col p-12 relative overflow-hidden"
           style={{ background: 'linear-gradient(160deg, #eff6ff 0%, #dbeafe 40%, #bfdbfe 100%)' }}>

        {/* Decorative blobs */}
        <div className="absolute top-[-80px] right-[-80px] w-[320px] h-[320px] rounded-full opacity-30"
             style={{ background: 'radial-gradient(circle, #3b82f6, transparent 70%)' }} />
        <div className="absolute bottom-[-60px] left-[-60px] w-[240px] h-[240px] rounded-full opacity-20"
             style={{ background: 'radial-gradient(circle, #6366f1, transparent 70%)' }} />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3 mb-auto">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white text-lg shadow-md"
               style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}>
            FP
          </div>
          <span className="text-slate-800 text-xl font-bold tracking-tight">FieldPulse</span>
        </div>

        {/* Headline */}
        <div className="relative z-10 mt-16 mb-auto">
          <h2 className="text-[2.6rem] font-extrabold text-slate-900 leading-tight mb-4">
            Field data,<br />
            <span style={{ background: 'linear-gradient(90deg, #2563eb, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              done right.
            </span>
          </h2>
          <p className="text-slate-500 text-base leading-relaxed max-w-xs">
            Offline-first surveys built for ground-level work across India.
          </p>

          {/* Feature cards */}
          <div className="mt-10 space-y-3">
            {[
              { icon: '📡', label: 'Works offline',      sub: 'Auto-syncs when back online' },
              { icon: '📋', label: 'Smart skip logic',   sub: 'Conditionals, calculations, branching' },
              { icon: '👥', label: 'Role-based teams',   sub: 'Admins, supervisors, enumerators' },
              { icon: '📊', label: 'Instant exports',    sub: 'CSV, Excel, live dashboards' },
            ].map(f => (
              <div key={f.label} className="flex items-center gap-3 bg-white/60 backdrop-blur rounded-xl px-4 py-3 shadow-sm border border-white/80">
                <span className="text-xl">{f.icon}</span>
                <div>
                  <div className="text-slate-800 text-sm font-semibold leading-none">{f.label}</div>
                  <div className="text-slate-400 text-xs mt-0.5">{f.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-slate-400 text-xs mt-10">© 2026 FieldPulse</p>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12" style={{ background: '#dbeafe' }}>
        <div className="w-full max-w-[420px]">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white text-base shadow"
                 style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}>FP</div>
            <span className="text-slate-800 text-xl font-bold">FieldPulse</span>
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl border border-blue-100 p-8"
               style={{ boxShadow: '0 8px 32px rgba(37, 99, 235, 0.12), 0 2px 8px rgba(0,0,0,0.06)' }}>

            {/* Heading */}
            <div className="mb-7 pb-6 border-b border-slate-100 text-center">
              <div className="flex items-center justify-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white text-base flex-shrink-0"
                     style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', boxShadow: '0 4px 12px rgba(37,99,235,0.35)' }}>
                  FP
                </div>
                <h1 className="text-2xl font-bold text-black tracking-tight">Welcome back</h1>
              </div>
              <p className="text-slate-500 text-sm">Sign in to continue to FieldPulse</p>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-3 mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                <span className="mt-0.5 flex-shrink-0">⚠</span>
                <span className="flex-1">{error}</span>
                <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 flex-shrink-0 ml-1">✕</button>
              </div>
            )}

            {/* Form */}
            <div className="space-y-4 mb-4">

              {/* Phone */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                  Mobile Number
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm select-none">📱</span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    placeholder="98765 43210"
                    value={phone}
                    autoFocus
                    onChange={e => { setPhone(e.target.value); setPhoneErr(''); setError('') }}
                    onKeyDown={e => e.key === 'Enter' && document.getElementById('pwd')?.focus()}
                    className={`w-full bg-slate-50 border rounded-xl pl-10 pr-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white transition-all duration-150 ${
                      phoneErr ? 'border-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-100'
                               : 'border-slate-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100'}`}
                    style={{ boxShadow: phoneErr ? undefined : '0 1px 4px rgba(0,0,0,0.06)' }}
                  />
                </div>
                {phoneErr && <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1"><span>⚠</span>{phoneErr}</p>}
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                  Password
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm select-none">🔒</span>
                  <input
                    id="pwd"
                    type={showPwd ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setPwdErr(''); setError('') }}
                    onKeyDown={e => e.key === 'Enter' && handleLogin()}
                    className={`w-full bg-slate-50 border rounded-xl pl-10 pr-16 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white transition-all duration-150 ${
                      pwdErr ? 'border-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-100'
                             : 'border-slate-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100'}`}
                    style={{ boxShadow: pwdErr ? undefined : '0 1px 4px rgba(0,0,0,0.06)' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-blue-500 hover:text-blue-700 transition-colors px-1.5 py-0.5 rounded"
                    tabIndex={-1}
                  >
                    {showPwd ? 'Hide' : 'Show'}
                  </button>
                </div>
                {pwdErr && <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1"><span>⚠</span>{pwdErr}</p>}
              </div>
            </div>

            {/* Forgot */}
            <div className="flex justify-end mb-6">
              <button
                onClick={() => navigate('/forgot-password')}
                className="text-xs text-blue-600 hover:text-blue-800 hover:underline transition-colors font-semibold"
              >
                Forgot password?
              </button>
            </div>

            {/* Submit */}
            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full py-3.5 rounded-xl font-bold text-sm text-white transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99]"
              style={{ background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', boxShadow: '0 4px 16px rgba(37,99,235,0.35)' }}
            >
              {loading ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>Signing in…</span></>
              ) : (
                <>Sign In &nbsp;→</>
              )}
            </button>

            <div className="mt-5 pt-5 border-t border-slate-100">
              {/* Demo accounts toggle */}
              <button
                type="button"
                onClick={() => setShowDemo(v => !v)}
                className="w-full flex items-center justify-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 font-semibold transition-colors py-1 rounded-lg hover:bg-blue-50"
              >
                <span className="text-sm">🔑</span>
                Try a demo account
                <span className={`transition-transform duration-200 ${showDemo ? 'rotate-180' : ''}`}>▾</span>
              </button>

              {showDemo && (
                <div className="mt-3 space-y-2">
                  {DEMO_ACCOUNTS.map(acc => (
                    <button
                      key={acc.role}
                      type="button"
                      onClick={() => {
                        setPhone(acc.phone)
                        setPassword(acc.password)
                        setPhoneErr(''); setPwdErr(''); setError('')
                        setFilledRole(acc.role)
                        setShowDemo(false)
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white hover:border-blue-300 hover:shadow-sm transition-all text-left group"
                    >
                      <span className="text-lg w-7 text-center flex-shrink-0">{acc.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-800 group-hover:text-blue-700 transition-colors">{acc.role}</div>
                        <div className="text-xs text-slate-400 font-mono truncate">{acc.phone} · {acc.password}</div>
                      </div>
                      <span className="text-xs text-blue-400 group-hover:text-blue-600 flex-shrink-0 font-medium">Use →</span>
                    </button>
                  ))}
                  <p className="text-[11px] text-slate-400 text-center pt-1">
                    These are read-only demo accounts — data is shared.
                  </p>
                </div>
              )}

              {filledRole && !showDemo && (
                <p className="text-xs text-center mt-2 text-emerald-600 font-medium">
                  ✓ Filled as {filledRole} — press Sign In
                </p>
              )}

              {!showDemo && !filledRole && (
                <p className="text-xs text-slate-400 text-center mt-2">
                  Having trouble? Contact your supervisor or administrator.
                </p>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
