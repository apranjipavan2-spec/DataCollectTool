import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'

const ACCESS_TOKEN_KEY = 'fieldgovern_access_token'
const REFRESH_TOKEN_KEY = 'fieldgovern_refresh_token'
const USER_KEY = 'fieldgovern_user'

export default function QrLoginPage() {
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('t')
    if (!token) { setError('No token provided'); return }

    api.post('/auth/qr-login', { token })
      .then(({ data }) => {
        localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token)
        localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token)
        localStorage.setItem(USER_KEY, JSON.stringify({
          id: data.id, name: data.name, email: data.email,
          phone: data.phone, role: data.role,
        }))
        navigate('/collect', { replace: true })
      })
      .catch(err => {
        setError(err.response?.data?.detail ?? 'Login failed. This link may have expired.')
      })
  }, [navigate])

  return (
    <div className="min-h-screen bg-catalan-bg flex items-center justify-center p-6">
      <div className="bg-catalan-surface border border-catalan-border rounded-2xl p-8 max-w-sm w-full text-center shadow-lg">
        {error ? (
          <>
            <div className="text-4xl mb-4">⚠️</div>
            <h2 className="text-lg font-semibold text-catalan-text mb-2">Login Failed</h2>
            <p className="text-sm text-catalan-textMuted">{error}</p>
          </>
        ) : (
          <>
            <div className="text-4xl mb-4 animate-spin">⏳</div>
            <h2 className="text-lg font-semibold text-catalan-text mb-2">Logging you in…</h2>
            <p className="text-sm text-catalan-textMuted">Please wait</p>
          </>
        )}
      </div>
    </div>
  )
}
