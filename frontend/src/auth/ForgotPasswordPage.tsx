import React, { useState } from 'react'
import api from '@/lib/api'
import { useNavigate } from 'react-router-dom'

export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [role, setRole] = useState<'enumerator' | 'admin' | null>(null)
  const [phone, setPhone]       = useState('')
  const [phoneErr, setPhoneErr] = useState('')
  const [loading, setLoading]   = useState(false)
  const [sent, setSent]         = useState(false)
  const [error, setError]       = useState('')

  const normalizePhone = (raw: string) => {
    const digits = raw.replace(/\D/g, '')
    if (digits.length === 10) return `+91${digits}`
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
    return raw.trim()
  }

  const handleSubmit = async () => {
    setPhoneErr(''); setError('')
    const normalized = normalizePhone(phone)
    if (!phone.trim() || normalized.length < 10) {
      setPhoneErr('Enter a valid mobile number')
      return
    }
    setLoading(true)
    try {
      await api.post('/auth/forgot-password', { phone: normalized })
      setSent(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-[420px]">

        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-10">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white text-lg shadow-md"
               style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}>FG</div>
          <span className="text-slate-800 text-xl font-bold tracking-tight">FieldGovern</span>
        </div>

        {/* Role selector — shown first */}
        {!role && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            <h1 className="text-xl font-bold text-slate-900 mb-1">Forgot password?</h1>
            <p className="text-slate-400 text-sm mb-7">Tell us who you are so we can help you.</p>
            <div className="space-y-3">
              <button
                onClick={() => setRole('enumerator')}
                className="w-full text-left p-4 rounded-xl border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 transition-all group"
              >
                <div className="font-semibold text-slate-800 group-hover:text-blue-700">📱 Field Enumerator / Supervisor</div>
                <div className="text-xs text-slate-500 mt-0.5">I collect data in the field</div>
              </button>
              <button
                onClick={() => setRole('admin')}
                className="w-full text-left p-4 rounded-xl border-2 border-slate-200 hover:border-purple-400 hover:bg-purple-50/50 transition-all group"
              >
                <div className="font-semibold text-slate-800 group-hover:text-purple-700">🏢 Organization Admin</div>
                <div className="text-xs text-slate-500 mt-0.5">I manage the organization account</div>
              </button>
            </div>
            <div className="mt-6 text-center">
              <button onClick={() => navigate('/login')} className="text-sm text-slate-400 hover:text-blue-600 transition-colors">
                ← Back to Sign In
              </button>
            </div>
          </div>
        )}

        {/* Enumerator — contact admin */}
        {role === 'enumerator' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            <div className="text-3xl mb-4 text-center">📞</div>
            <h2 className="text-xl font-bold text-slate-900 mb-3 text-center">Contact Your Admin</h2>
            <p className="text-slate-500 text-sm text-center leading-relaxed mb-6">
              Password resets for field users are done by your organization's admin. Please contact your supervisor or the admin who set up your account.
            </p>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-1">Ask your admin to:</p>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• Go to <strong>Settings → Users</strong></li>
                <li>• Find your name and reset your password</li>
                <li>• Share the new password with you</li>
              </ul>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Or log in without a password</p>
              <p className="text-sm text-slate-600 mb-3">Your supervisor can generate a QR code for instant login — no password needed.</p>
              <button
                onClick={() => navigate('/auth/qr-login')}
                className="w-full py-2.5 rounded-xl font-semibold text-sm text-white transition-all active:scale-[0.99]"
                style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}
              >
                📷 Login via QR Code
              </button>
            </div>

            <button onClick={() => setRole(null)} className="w-full py-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-all">
              ← Back
            </button>
          </div>
        )}

        {/* Admin — contact FieldGovern */}
        {role === 'admin' && !sent && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-8">
              <div className="mb-6">
                <h1 className="text-xl font-bold text-slate-900">Reset Admin Password</h1>
                <p className="text-slate-400 text-sm mt-1">
                  If your account has an email on file, we'll send a reset link. Otherwise, contact FieldGovern support.
                </p>
              </div>

              {error && (
                <div className="flex items-start gap-3 mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                  <span className="mt-0.5 flex-shrink-0">⚠</span>
                  <span className="flex-1">{error}</span>
                  <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-1 flex-shrink-0">✕</button>
                </div>
              )}

              <div className="mb-5">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Mobile Number
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  placeholder="98765 43210"
                  value={phone}
                  autoFocus
                  onChange={e => { setPhone(e.target.value); setPhoneErr(''); setError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  className={`w-full bg-slate-50 border rounded-xl px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white transition-all duration-150 ${
                    phoneErr ? 'border-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-100'
                             : 'border-slate-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100'}`}
                />
                {phoneErr && <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1"><span>⚠</span>{phoneErr}</p>}
              </div>

              <button
                onClick={handleSubmit}
                disabled={loading}
                className="w-full py-3.5 rounded-xl font-semibold text-sm text-white transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg active:scale-[0.99] mb-5"
                style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}
              >
                {loading ? (
                  <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>Sending…</span></>
                ) : (
                  'Send Reset Link'
                )}
              </button>

              {/* FieldGovern support contact */}
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-purple-700 uppercase tracking-wider mb-1">Need direct help?</p>
                <p className="text-sm text-purple-800 mb-2">Contact FieldGovern support to reset your admin account.</p>
                <a
                  href="tel:+918088709011"
                  className="inline-flex items-center gap-2 text-sm font-bold text-purple-700 hover:text-purple-900 transition-colors"
                >
                  📞 8088709011
                </a>
              </div>

              <button onClick={() => setRole(null)} className="w-full mt-4 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-all">
                ← Back
              </button>
            </div>
          </div>
        )}

        {/* Success state */}
        {role === 'admin' && sent && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
            <div className="w-14 h-14 rounded-full mx-auto mb-5 flex items-center justify-center text-2xl shadow-md"
                 style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Check your inbox</h2>
            <p className="text-slate-500 text-sm leading-relaxed mb-6">
              If that number is registered with an email on file, a password reset link has been sent.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all shadow-md hover:shadow-lg active:scale-[0.99] mb-3"
              style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}
            >
              Back to Sign In
            </button>
            <p className="text-xs text-slate-400">
              Still stuck? Call FieldGovern: <a href="tel:+918088709011" className="font-bold text-purple-600 hover:underline">8088709011</a>
            </p>
          </div>
        )}

      </div>
    </div>
  )
}
