import { useState, useEffect, useRef } from 'react'
import api, { storeUser } from '@/lib/api'
import { useNavigate } from 'react-router-dom'
import { subscribeToPush } from '@/lib/pushNotifications'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

const DEMO_ACCOUNTS = [
  { role: 'Admin',       phone: '+919999990001', password: 'test@123', color: '#6366f1', bg: 'rgba(99,102,241,0.1)' },
  { role: 'Supervisor',  phone: '+919999990002', password: 'test@123', color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' },
  { role: 'Enumerator',  phone: '+919999990003', password: 'test@123', color: '#06b6d4', bg: 'rgba(6,182,212,0.1)' },
]

const FEATURES = [
  { icon: 'wifi-off', label: 'Works Offline', sub: 'Auto-syncs when back online', gradient: 'from-cyan-400 to-blue-500' },
  { icon: 'chart',    label: 'Real-time Analytics', sub: 'Cross-tabs & live dashboards', gradient: 'from-violet-400 to-purple-500' },
  { icon: 'branch',   label: 'Smart Skip Logic', sub: 'Conditionals & branching', gradient: 'from-amber-400 to-orange-500' },
  { icon: 'users',    label: 'Role-based Teams', sub: 'Admins, supervisors, enumerators', gradient: 'from-emerald-400 to-teal-500' },
]

function FeatureIcon({ name, className = '', style }: { name: string; className?: string; style?: React.CSSProperties }) {
  const paths: Record<string, string> = {
    'wifi-off': 'M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.56 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01',
    'chart': 'M18 20V10M12 20V4M6 20v-6',
    'branch': 'M6 3v12M18 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM18 9a9 9 0 01-9 9',
    'users': 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
    'phone': 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z',
    'lock': 'M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2zM7 11V7a5 5 0 0110 0v4',
    'shield': 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    'key': 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  }
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {(paths[name] || '').split(/(?=[A-Z])/).length > 1
        ? <path d={paths[name]} />
        : paths[name]?.split('z').filter(Boolean).map((d, i) => <path key={i} d={d + (i < paths[name].split('z').filter(Boolean).length - 1 ? 'z' : '')} />)
      }
    </svg>
  )
}

function Logo({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/logo-icon.png"
      alt="FieldGovern"
      width={size}
      height={size}
      className={`object-contain flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  )
}

const LOGIN_STYLES = `
  @keyframes float-orb {
    0%, 100% { transform: translateY(0px) scale(1); }
    50% { transform: translateY(-20px) scale(1.05); }
  }
  @keyframes float-orb-2 {
    0%, 100% { transform: translateY(0px) translateX(0px); }
    33% { transform: translateY(-15px) translateX(10px); }
    66% { transform: translateY(5px) translateX(-10px); }
  }
  @keyframes slide-up {
    from { opacity: 0; transform: translateY(24px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes gradient-shift {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  @keyframes demo-ping {
    0%   { opacity: 0.3; transform: scale(1); }
    70%  { opacity: 0;   transform: scale(1.08); }
    100% { opacity: 0;   transform: scale(1.08); }
  }
  @keyframes counter-up {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .login-slide-up { animation: slide-up 0.6s ease-out both; }
  .login-fade-in  { animation: fade-in 0.5s ease-out both; }
`

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
  const [step, setStep]           = useState<'login' | 'otp'>('login')
  const [otp, setOtp]             = useState('')
  const [maskedContact, setMaskedContact] = useState('')
  const [pendingPhone, setPendingPhone]   = useState('')
  const googleBtnRef = useRef<HTMLDivElement>(null)
  const [activeFeature, setActiveFeature] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setActiveFeature(i => (i + 1) % FEATURES.length), 3000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleBtnRef.current) return
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => {
      const g = (window as any).google
      if (!g) return
      g.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (resp: { credential: string }) => {
          setLoading(true); setError('')
          try {
            const { data } = await api.post('/auth/google', { credential: resp.credential })
            storeUser(data)
            subscribeToPush().catch(() => {})
            const dest = data.role === 'master_admin' ? '/admin'
                       : data.role === 'enumerator'   ? '/collect'
                       : '/'
            navigate(dest, { replace: true })
          } catch (e: any) {
            setError(e.response?.data?.detail ?? 'Google sign-in failed')
          } finally { setLoading(false) }
        },
      })
      g.accounts.id.renderButton(googleBtnRef.current!, {
        theme: 'outline', size: 'large', width: 360, text: 'signin_with',
      })
    }
    document.head.appendChild(script)
    return () => { document.head.removeChild(script) }
  }, [])

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
      if (data['2fa_required']) {
        setPendingPhone(data.phone)
        setMaskedContact(data.masked_contact)
        setStep('otp')
        return
      }
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

  const handleVerifyOtp = async () => {
    if (!otp.trim()) return
    setLoading(true); setError('')
    try {
      const { data } = await api.post('/auth/verify-otp', { phone: pendingPhone, otp: otp.trim() })
      storeUser(data)
      subscribeToPush().catch(() => {})
      const dest = data.role === 'master_admin' ? '/admin'
                 : data.role === 'enumerator'   ? '/collect'
                 : '/'
      navigate(dest, { replace: true })
    } catch {
      setError('Invalid or expired code. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleResendOtp = async () => {
    setError('')
    try {
      await api.post('/auth/send-otp', { phone: pendingPhone })
    } catch { }
  }

  return (
    <div className="min-h-screen flex" style={{ background: '#0a0a1a' }}>
      <style>{LOGIN_STYLES}</style>

      {/* ── Left branding panel ── */}
      <div className="hidden lg:flex lg:w-[520px] xl:w-[560px] flex-shrink-0 flex-col relative overflow-hidden"
           style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 40%, #0f172a 100%)' }}>

        {/* Animated mesh background */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute w-[600px] h-[600px] rounded-full opacity-20"
               style={{ top: '-10%', right: '-20%', background: 'radial-gradient(circle, #6366f1, transparent 70%)', animation: 'float-orb 8s ease-in-out infinite' }} />
          <div className="absolute w-[400px] h-[400px] rounded-full opacity-15"
               style={{ bottom: '-5%', left: '-10%', background: 'radial-gradient(circle, #06b6d4, transparent 70%)', animation: 'float-orb-2 10s ease-in-out infinite' }} />
          <div className="absolute w-[300px] h-[300px] rounded-full opacity-10"
               style={{ top: '40%', left: '30%', background: 'radial-gradient(circle, #8b5cf6, transparent 70%)', animation: 'float-orb 12s ease-in-out infinite 2s' }} />
          {/* Grid pattern */}
          <div className="absolute inset-0 opacity-[0.03]"
               style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
        </div>

        <div className="relative z-10 flex flex-col h-full p-10 xl:p-12">
          {/* Logo */}
          <div className="flex items-center login-slide-up">
            <img src="/logo-wide.png" alt="FieldGovern" className="h-10 w-auto object-contain" style={{ filter: 'brightness(1.1)' }} />
          </div>

          {/* Headline */}
          <div className="mt-10 mb-auto login-slide-up" style={{ animationDelay: '0.1s' }}>
            <div className="inline-flex items-center gap-2 mb-6 px-4 py-2 rounded-full text-xs font-semibold"
                 style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc' }}>
              <span className="w-2 h-2 rounded-full inline-block animate-pulse" style={{ background: '#34d399' }} />
              Trusted by research teams across India
            </div>
            <h2 className="text-[2.6rem] font-extrabold leading-[1.1] mb-5" style={{ color: '#f1f5f9' }}>
              Collect, Analyze
              <br />& Report
              <br />
              <span style={{
                background: 'linear-gradient(135deg, #06b6d4, #6366f1, #a855f7)',
                backgroundSize: '200% 200%',
                animation: 'gradient-shift 4s ease infinite',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                From the Field.
              </span>
            </h2>
            <p className="text-base leading-relaxed max-w-sm" style={{ color: '#94a3b8' }}>
              India's most affordable offline-first field data platform.
              Collect with <strong style={{ color: '#cbd5e1' }}>zero internet</strong>, auto-sync, and unlock <strong style={{ color: '#cbd5e1' }}>real-time analysis</strong>.
            </p>

            {/* Live stats bar */}
            <div className="mt-8 flex gap-6 login-slide-up" style={{ animationDelay: '0.3s' }}>
              {[
                { val: '30+', label: 'Brokers' },
                { val: '99.9%', label: 'Uptime' },
                { val: '50K+', label: 'Submissions' },
              ].map(s => (
                <div key={s.label}>
                  <div className="text-xl font-bold" style={{ color: '#e2e8f0', animation: 'counter-up 0.6s ease-out both', animationDelay: '0.5s' }}>{s.val}</div>
                  <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Feature cards — animated carousel */}
            <div className="mt-10 space-y-2.5">
              {FEATURES.map((f, i) => (
                <div
                  key={f.label}
                  className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-all duration-500 cursor-default login-slide-up"
                  style={{
                    animationDelay: `${0.2 + i * 0.08}s`,
                    background: i === activeFeature
                      ? 'rgba(99,102,241,0.12)'
                      : 'rgba(255,255,255,0.03)',
                    border: i === activeFeature
                      ? '1px solid rgba(99,102,241,0.3)'
                      : '1px solid rgba(255,255,255,0.06)',
                    transform: i === activeFeature ? 'translateX(4px)' : 'translateX(0)',
                  }}
                >
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${f.gradient} flex items-center justify-center flex-shrink-0`}
                       style={{ opacity: i === activeFeature ? 1 : 0.5, transition: 'opacity 0.5s' }}>
                    <FeatureIcon name={f.icon} className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: i === activeFeature ? '#e2e8f0' : '#94a3b8', transition: 'color 0.5s' }}>{f.label}</div>
                    <div className="text-xs mt-0.5" style={{ color: i === activeFeature ? '#94a3b8' : '#475569', transition: 'color 0.5s' }}>{f.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 mt-8 flex items-center justify-between login-fade-in" style={{ animationDelay: '0.5s' }}>
            <p className="text-xs" style={{ color: '#475569' }}>2026 FieldGovern</p>
            <button
              onClick={() => navigate('/pricing')}
              className="text-xs font-medium transition-colors"
              style={{ color: '#6366f1' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#818cf8')}
              onMouseLeave={e => (e.currentTarget.style.color = '#6366f1')}
            >
              View plans
            </button>
          </div>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 relative overflow-hidden"
           style={{ background: 'linear-gradient(160deg, #0f172a 0%, #1a1a2e 50%, #16132d 100%)' }}>

        {/* Subtle background glow */}
        <div className="absolute w-[500px] h-[500px] rounded-full opacity-10"
             style={{ top: '-15%', right: '-15%', background: 'radial-gradient(circle, #6366f1, transparent 70%)' }} />
        <div className="absolute w-[300px] h-[300px] rounded-full opacity-10"
             style={{ bottom: '-10%', left: '-10%', background: 'radial-gradient(circle, #06b6d4, transparent 70%)' }} />

        <div className="w-full max-w-[420px] relative z-10">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center mb-8">
            <img src="/logo-wide.png" alt="FieldGovern" className="h-10 w-auto object-contain" style={{ filter: 'brightness(1.1)' }} />
          </div>

          {/* Card — glassmorphism */}
          <div className="rounded-3xl p-8 login-slide-up"
               style={{
                 background: 'rgba(255,255,255,0.05)',
                 backdropFilter: 'blur(20px)',
                 WebkitBackdropFilter: 'blur(20px)',
                 border: '1px solid rgba(255,255,255,0.1)',
                 boxShadow: '0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05) inset',
               }}>

            {/* Heading */}
            <div className="mb-7 pb-6 text-center" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex flex-col items-center gap-3 mb-2">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                     style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.2))', border: '1px solid rgba(99,102,241,0.3)' }}>
                  <Logo size={36} />
                </div>
                <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#f1f5f9' }}>Welcome back</h1>
              </div>
              <p className="text-sm" style={{ color: '#94a3b8' }}>Sign in to continue to FieldGovern</p>
              <button
                onClick={() => navigate('/pricing')}
                className="mt-2 text-xs font-medium transition-colors"
                style={{ color: '#818cf8' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#a5b4fc')}
                onMouseLeave={e => (e.currentTarget.style.color = '#818cf8')}
              >
                New here? View pricing plans
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-3 mb-5 px-4 py-3 rounded-xl text-sm"
                   style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5' }}>
                <span className="mt-0.5 flex-shrink-0">!</span>
                <span className="flex-1">{error}</span>
                <button onClick={() => setError('')} className="flex-shrink-0 ml-1 opacity-60 hover:opacity-100 transition-opacity">x</button>
              </div>
            )}

            {/* OTP step */}
            {step === 'otp' && (
              <div className="space-y-5">
                <div className="text-center py-2">
                  <div className="w-16 h-16 mx-auto mb-3 rounded-2xl flex items-center justify-center"
                       style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.2))', border: '1px solid rgba(99,102,241,0.3)' }}>
                    <FeatureIcon name="shield" className="w-8 h-8" style={{ color: '#a5b4fc' }} />
                  </div>
                  <p className="text-sm" style={{ color: '#cbd5e1' }}>
                    We sent a 6-digit code to <strong style={{ color: '#f1f5f9' }}>{maskedContact}</strong>
                  </p>
                  <p className="text-xs mt-1" style={{ color: '#64748b' }}>Check your email inbox · expires in 10 min</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#94a3b8' }}>Verification Code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    autoFocus
                    value={otp}
                    onChange={e => { setOtp(e.target.value.replace(/\D/g, '')); setError('') }}
                    onKeyDown={e => e.key === 'Enter' && handleVerifyOtp()}
                    className="w-full rounded-xl px-4 py-3 text-center text-2xl font-bold tracking-[0.5em] focus:outline-none transition-all"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      color: '#f1f5f9',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                    }}
                    onFocus={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.15)' }}
                    onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)' }}
                  />
                </div>
                <button
                  onClick={handleVerifyOtp}
                  disabled={loading || otp.length < 6}
                  className="w-full py-3.5 rounded-xl font-bold text-sm text-white transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', boxShadow: '0 4px 20px rgba(99,102,241,0.4)' }}
                >
                  {loading ? (
                    <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>Verifying...</span></>
                  ) : 'Verify Code'}
                </button>
                <div className="flex items-center justify-between text-xs" style={{ color: '#64748b' }}>
                  <button onClick={() => { setStep('login'); setOtp(''); setError('') }} className="hover:text-white transition-colors">
                    Back to login
                  </button>
                  <button onClick={handleResendOtp} className="font-semibold transition-colors" style={{ color: '#818cf8' }}>
                    Resend code
                  </button>
                </div>
              </div>
            )}

            {/* Login form */}
            {step === 'login' && (<>
            <div className="space-y-4 mb-4">

              {/* Phone */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#94a3b8' }}>
                  Mobile Number
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: '#64748b' }}>
                    <FeatureIcon name="phone" className="w-4 h-4" />
                  </div>
                  <input
                    type="tel"
                    inputMode="numeric"
                    placeholder="98765 43210"
                    value={phone}
                    autoFocus
                    onChange={e => { setPhone(e.target.value); setPhoneErr(''); setError('') }}
                    onKeyDown={e => e.key === 'Enter' && document.getElementById('pwd')?.focus()}
                    className="w-full rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none transition-all duration-200"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: phoneErr ? '1px solid rgba(239,68,68,0.5)' : '1px solid rgba(255,255,255,0.1)',
                      color: '#f1f5f9',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    }}
                    onFocus={e => { if (!phoneErr) { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.15)' } }}
                    onBlur={e => { if (!phoneErr) { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)' } }}
                  />
                </div>
                {phoneErr && <p className="text-xs mt-1.5 flex items-center gap-1" style={{ color: '#fca5a5' }}>{phoneErr}</p>}
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#94a3b8' }}>
                  Password
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: '#64748b' }}>
                    <FeatureIcon name="lock" className="w-4 h-4" />
                  </div>
                  <input
                    id="pwd"
                    type={showPwd ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setPwdErr(''); setError('') }}
                    onKeyDown={e => e.key === 'Enter' && handleLogin()}
                    className="w-full rounded-xl pl-10 pr-16 py-3 text-sm focus:outline-none transition-all duration-200"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: pwdErr ? '1px solid rgba(239,68,68,0.5)' : '1px solid rgba(255,255,255,0.1)',
                      color: '#f1f5f9',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    }}
                    onFocus={e => { if (!pwdErr) { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.15)' } }}
                    onBlur={e => { if (!pwdErr) { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)' } }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold transition-colors px-1.5 py-0.5 rounded"
                    style={{ color: '#818cf8' }}
                    tabIndex={-1}
                  >
                    {showPwd ? 'Hide' : 'Show'}
                  </button>
                </div>
                {pwdErr && <p className="text-xs mt-1.5 flex items-center gap-1" style={{ color: '#fca5a5' }}>{pwdErr}</p>}
              </div>
            </div>

            {/* Forgot */}
            <div className="flex justify-end mb-6">
              <button
                onClick={() => navigate('/forgot-password')}
                className="text-xs font-semibold transition-colors"
                style={{ color: '#818cf8' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#a5b4fc')}
                onMouseLeave={e => (e.currentTarget.style.color = '#818cf8')}
              >
                Forgot password?
              </button>
            </div>

            {/* Submit */}
            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full py-3.5 rounded-xl font-bold text-sm text-white transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
              style={{
                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                boxShadow: '0 4px 20px rgba(99,102,241,0.4), 0 0 0 1px rgba(99,102,241,0.2) inset',
              }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 6px 28px rgba(99,102,241,0.5), 0 0 0 1px rgba(99,102,241,0.3) inset')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 4px 20px rgba(99,102,241,0.4), 0 0 0 1px rgba(99,102,241,0.2) inset')}
            >
              {loading ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>Signing in...</span></>
              ) : (
                <>Sign In</>
              )}
            </button>

            {GOOGLE_CLIENT_ID && (
              <div className="mt-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
                  <span className="text-xs font-medium" style={{ color: '#64748b' }}>or</span>
                  <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
                </div>
                <div ref={googleBtnRef} className="flex justify-center" />
              </div>
            )}

            <div className="mt-5 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              {/* Demo accounts toggle */}
              <div className="relative">
                {!showDemo && (
                  <span className="absolute inset-0 rounded-xl opacity-0 animate-[demo-ping_2s_ease-out_infinite]"
                        style={{ background: 'rgba(99,102,241,0.3)' }} />
                )}
                <button
                  type="button"
                  onClick={() => setShowDemo(v => !v)}
                  className="relative w-full flex items-center justify-center gap-2 text-sm font-bold transition-all duration-200 py-2.5 px-4 rounded-xl"
                  style={showDemo ? {
                    background: 'rgba(99,102,241,0.1)',
                    border: '1px solid rgba(99,102,241,0.3)',
                    color: '#a5b4fc',
                  } : {
                    background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.1))',
                    border: '1px solid rgba(99,102,241,0.3)',
                    color: '#a5b4fc',
                    boxShadow: '0 0 0 3px rgba(99,102,241,0.1), 0 2px 12px rgba(99,102,241,0.15)',
                  }}
                >
                  <FeatureIcon name="key" className={`w-4 h-4 transition-transform duration-300 ${!showDemo ? 'animate-bounce' : ''}`} />
                  Try a demo account
                  <span className={`ml-auto text-xs transition-transform duration-200 ${showDemo ? 'rotate-180' : ''}`}>&#9662;</span>
                </button>
              </div>

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
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left group"
                      style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.08)',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = acc.bg; e.currentTarget.style.borderColor = `${acc.color}40` }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
                    >
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                           style={{ background: acc.bg, border: `1px solid ${acc.color}30` }}>
                        <FeatureIcon name="shield" className="w-4 h-4" style={{ color: acc.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold transition-colors" style={{ color: '#e2e8f0' }}>{acc.role}</div>
                        <div className="text-xs font-mono truncate" style={{ color: '#64748b' }}>{acc.phone}</div>
                      </div>
                      <span className="text-xs flex-shrink-0 font-medium" style={{ color: acc.color }}>Use</span>
                    </button>
                  ))}
                  <p className="text-center pt-1" style={{ fontSize: '11px', color: '#475569' }}>
                    These are read-only demo accounts — data is shared.
                  </p>
                </div>
              )}

              {filledRole && !showDemo && (
                <p className="text-xs text-center mt-2 font-medium" style={{ color: '#34d399' }}>
                  Filled as {filledRole} — press Sign In
                </p>
              )}

              {!showDemo && !filledRole && (
                <p className="text-xs text-center mt-2" style={{ color: '#475569' }}>
                  Having trouble? Contact your supervisor or administrator.
                </p>
              )}
            </div>
            </>)}
          </div>

        </div>
      </div>
    </div>
  )
}
