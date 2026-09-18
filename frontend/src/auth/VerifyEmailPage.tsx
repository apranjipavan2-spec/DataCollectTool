import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { verifyEmail, storeUser } from '@/lib/api'

export default function VerifyEmailPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    const token = params.get('token')
    if (!token) {
      setErrorMsg('No verification token found in the link.')
      setStatus('error')
      return
    }

    verifyEmail(token)
      .then(user => {
        storeUser(user)
        setStatus('success')
        setTimeout(() => navigate('/', { replace: true }), 1500)
      })
      .catch(e => {
        setErrorMsg(e.response?.data?.detail ?? 'Verification failed. The link may have expired.')
        setStatus('error')
      })
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center p-6"
         style={{ background: 'linear-gradient(160deg, #f8fafc 0%, #eef2ff 100%)' }}>
      <div className="w-full max-w-md text-center">
        <div className="rounded-3xl p-10"
             style={{ background: '#fff', border: '1px solid #e2e8f0', boxShadow: '0 20px 60px rgba(0,0,0,0.06)' }}>

          {status === 'verifying' && (
            <>
              <div className="w-12 h-12 mx-auto mb-5 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin" />
              <h2 className="text-xl font-bold mb-2" style={{ color: '#1e293b' }}>Verifying your email…</h2>
              <p className="text-sm" style={{ color: '#64748b' }}>Just a moment</p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="w-16 h-16 mx-auto mb-5 rounded-2xl flex items-center justify-center"
                   style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <h2 className="text-xl font-bold mb-2" style={{ color: '#1e293b' }}>Email verified!</h2>
              <p className="text-sm" style={{ color: '#64748b' }}>Redirecting to your dashboard…</p>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-16 h-16 mx-auto mb-5 rounded-2xl flex items-center justify-center"
                   style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <h2 className="text-xl font-bold mb-2" style={{ color: '#1e293b' }}>Link invalid or expired</h2>
              <p className="text-sm mb-6" style={{ color: '#64748b' }}>{errorMsg}</p>
              <button
                onClick={() => navigate('/register')}
                className="px-6 py-2.5 rounded-xl font-semibold text-sm text-white transition-all"
                style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
              >
                Register again
              </button>
              <div className="mt-3">
                <button
                  onClick={() => navigate('/login')}
                  className="text-sm font-medium transition-colors"
                  style={{ color: '#6366f1' }}
                >
                  Back to sign in
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
