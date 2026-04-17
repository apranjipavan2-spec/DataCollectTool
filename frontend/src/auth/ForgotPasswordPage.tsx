import React, { useState } from 'react'
import api from '@/lib/api'
import { useNavigate } from 'react-router-dom'

export default function ForgotPasswordPage() {
  const navigate = useNavigate()
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
               style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}>FP</div>
          <span className="text-slate-800 text-xl font-bold tracking-tight">FieldPulse</span>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">

          {sent ? (
            /* ── Success state ── */
            <div className="p-8 text-center">
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

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left mb-6">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Didn't receive it?</p>
                <ul className="space-y-1.5 text-xs text-slate-500">
                  <li className="flex items-center gap-2"><span className="text-slate-400">•</span>Check your spam or junk folder</li>
                  <li className="flex items-center gap-2"><span className="text-slate-400">•</span>Make sure the number has an email linked</li>
                  <li className="flex items-center gap-2"><span className="text-slate-400">•</span>Wait a moment and try again</li>
                </ul>
              </div>

              <button
                onClick={() => navigate('/login')}
                className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all duration-150 shadow-md hover:shadow-lg active:scale-[0.99] mb-3"
                style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}
              >
                Back to Sign In
              </button>
              <button
                onClick={() => { setSent(false); setPhone('') }}
                className="w-full py-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150"
              >
                Try a different number
              </button>
            </div>

          ) : (
            /* ── Form state ── */
            <div className="p-8">
              <div className="mb-7">
                <h1 className="text-xl font-bold text-slate-900">Reset your password</h1>
                <p className="text-slate-400 text-sm mt-1">
                  We'll send a reset link to your registered email.
                </p>
              </div>

              {error && (
                <div className="flex items-start gap-3 mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                  <span className="mt-0.5 flex-shrink-0">⚠</span>
                  <span className="flex-1">{error}</span>
                  <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-1 flex-shrink-0">✕</button>
                </div>
              )}

              <div className="mb-6">
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
                className="w-full py-3.5 rounded-xl font-semibold text-sm text-white transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg active:scale-[0.99]"
                style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}
              >
                {loading ? (
                  <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>Sending…</span></>
                ) : (
                  'Send Reset Link'
                )}
              </button>
            </div>
          )}
        </div>

        {/* Back link */}
        {!sent && (
          <div className="text-center mt-5">
            <button
              onClick={() => navigate('/login')}
              className="text-sm text-slate-500 hover:text-blue-600 transition-colors font-medium"
            >
              ← Back to Sign In
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
