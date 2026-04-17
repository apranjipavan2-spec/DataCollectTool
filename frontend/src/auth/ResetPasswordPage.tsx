import React, { useState } from 'react'
import api from '@/lib/api'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Input, Alert } from '@/components/ui'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [confirmError, setConfirmError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    setPasswordError('')
    setConfirmError('')
    setError('')

    let valid = true
    if (password.length < 6) {
      setPasswordError('Password must be at least 6 characters')
      valid = false
    }
    if (password !== confirm) {
      setConfirmError('Passwords do not match')
      valid = false
    }
    if (!valid) return

    if (!token) {
      setError('Invalid or missing reset token. Please request a new link.')
      return
    }

    setLoading(true)
    try {
      await api.post('/auth/reset-password', { token, new_password: password })
      setDone(true)
    } catch (err: any) {
      const detail = err.response?.data?.detail
      setError(detail ?? 'Reset failed. The link may have expired — request a new one.')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-catalan-bg flex items-center justify-center p-6">
        <div className="w-full max-w-md text-center space-y-4">
          <div className="text-5xl mb-4">🔗</div>
          <h2 className="text-xl font-semibold text-catalan-text">Invalid Reset Link</h2>
          <p className="text-catalan-textMuted text-sm">
            This link is missing a reset token. Please request a new password reset link.
          </p>
          <Button onClick={() => navigate('/forgot-password')} fullWidth>
            Request New Link
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-catalan-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-catalan-primary mb-2">FieldPulse</h1>
          <h2 className="text-xl font-semibold text-catalan-text">Set New Password</h2>
          <p className="text-catalan-textMuted mt-2 text-sm">Enter your new password below.</p>
        </div>

        {done ? (
          <div className="space-y-4">
            <Alert
              type="success"
              title="Password updated"
              message="Your password has been reset successfully. You can now log in with your new password."
            />
            <Button onClick={() => navigate('/login')} fullWidth>
              Go to Login
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <Alert type="error" title="Reset Failed" message={error} onClose={() => setError('')} />
            )}

            <Input
              label="New Password"
              type="password"
              placeholder="Minimum 6 characters"
              value={password}
              error={passwordError}
              onChange={(e) => { setPassword(e.target.value); if (passwordError) setPasswordError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') document.getElementById('confirm-pwd')?.focus() }}
              autoFocus
            />

            <Input
              id="confirm-pwd"
              label="Confirm Password"
              type="password"
              placeholder="Repeat your new password"
              value={confirm}
              error={confirmError}
              onChange={(e) => { setConfirm(e.target.value); if (confirmError) setConfirmError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
            />

            <Button onClick={handleSubmit} disabled={loading} isLoading={loading} fullWidth size="lg">
              Update Password
            </Button>

            <div className="text-center">
              <button
                onClick={() => navigate('/login')}
                className="text-catalan-primary hover:text-catalan-primaryLight text-sm transition-colors"
              >
                Back to Login
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
