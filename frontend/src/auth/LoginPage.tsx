import React, { useState } from 'react'
import api, { storeUser } from '@/lib/api'
import { useNavigate } from 'react-router-dom'
import { subscribeToPush } from '@/lib/pushNotifications'
import { Button, Input, Alert } from '@/components/ui'

export default function LoginPage() {
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [showForgotPassword, setShowForgotPassword] = useState(false)

  const normalizePhone = (raw: string) => {
    const digits = raw.replace(/\D/g, '')
    if (digits.length === 10) return `+91${digits}`
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
    return raw.trim()
  }

  const validateForm = () => {
    let isValid = true
    setPhoneError('')
    setPasswordError('')

    const normalized = normalizePhone(phone)
    if (!phone.trim()) {
      setPhoneError('Mobile number is required')
      isValid = false
    } else if (normalized.length < 10) {
      setPhoneError('Enter a valid phone number')
      isValid = false
    }

    if (!password) {
      setPasswordError('Password is required')
      isValid = false
    }

    return isValid
  }

  const handleLogin = async () => {
    if (!validateForm()) return

    const normalized = normalizePhone(phone)
    setLoading(true)
    setError('')
    try {
      const { data } = await api.post('/auth/login', { phone: normalized, password })
      storeUser(data)
      subscribeToPush().catch(() => {})
      const dest = data.role === 'enumerator' ? '/collect' : '/'
      navigate(dest, { replace: true })
    } catch (err: any) {
      const detail = err.response?.data?.detail
      setError(detail ?? 'Invalid phone or password')
    } finally {
      setLoading(false)
    }
  }

  const features = [
    { icon: '📱', title: 'Offline First', description: 'Collect data without internet connection' },
    { icon: '🔒', title: 'Secure', description: 'End-to-end encryption for all data' },
    { icon: '⚡', title: 'Fast Sync', description: 'Automatic background synchronization' },
    { icon: '🌍', title: 'Multi-Language', description: 'English, Hindi, Kannada, Telugu' },
  ]

  return (
    <div className="min-h-screen bg-catalan-bg flex">
      {/* Left Side - Hero Section */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-catalan-primary to-catalan-primaryDark p-12 flex-col justify-between text-white">
        <div>
          <h1 className="text-4xl font-bold mb-4">FieldPulse</h1>
          <p className="text-lg opacity-90">Offline-first field data collection for India</p>
        </div>

        <div className="space-y-6">
          {features.map((feature, i) => (
            <div key={i} className="flex gap-4">
              <div className="text-3xl">{feature.icon}</div>
              <div>
                <h3 className="font-semibold text-lg">{feature.title}</h3>
                <p className="text-sm opacity-80">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="text-sm opacity-75">
          <p>© 2026 FieldPulse. All rights reserved.</p>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="w-full lg:w-1/2 bg-catalan-bg flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          {/* Mobile Header */}
          <div className="lg:hidden mb-8 text-center">
            <h1 className="text-3xl font-bold text-catalan-primary">FieldPulse</h1>
            <p className="text-catalan-textMuted mt-2">Offline-first field data collection</p>
          </div>

          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-catalan-text">Welcome Back</h2>
              <p className="text-catalan-textMuted mt-2">Sign in to your account to continue</p>
            </div>

            {error && (
              <Alert
                type="error"
                title="Login Failed"
                message={error}
                onClose={() => setError('')}
              />
            )}

            {showForgotPassword && (
              <Alert
                type="info"
                title="Password Reset"
                message="Contact your administrator to reset your password."
                onClose={() => setShowForgotPassword(false)}
              />
            )}

            <div className="space-y-4">
              <Input
                label="Mobile Number"
                type="tel"
                placeholder="+91 98765 43210"
                value={phone}
                error={phoneError}
                onChange={(e) => {
                  setPhone(e.target.value)
                  if (phoneError) setPhoneError('')
                  if (error) setError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') document.getElementById('pwd-input')?.focus()
                }}
                autoFocus
              />

              <Input
                id="pwd-input"
                label="Password"
                type="password"
                placeholder="Enter your password"
                value={password}
                error={passwordError}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (passwordError) setPasswordError('')
                  if (error) setError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLogin()
                }}
              />
            </div>

            <Button
              onClick={handleLogin}
              disabled={loading}
              isLoading={loading}
              fullWidth
              size="lg"
            >
              Sign In
            </Button>

            <div className="text-center">
              <button
                onClick={() => setShowForgotPassword(!showForgotPassword)}
                className="text-catalan-primary hover:text-catalan-primaryLight text-sm transition-colors"
              >
                Forgot password?
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
