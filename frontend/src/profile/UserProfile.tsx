import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { getStoredUser, storeUser } from '@/lib/api'
import { getNavItems } from '@/lib/navigation'
import { useToast } from '@/lib/ToastContext'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { Card, Button, Input, Alert } from '@/components/ui'
import NotificationSettings from '@/components/NotificationSettings'

const ROLE_LABELS: Record<string, string> = {
  master_admin: 'Master Admin',
  org_admin:    'Org Admin',
  supervisor:   'Supervisor',
  enumerator:   'Enumerator',
}

const ROLE_COLORS: Record<string, string> = {
  master_admin: 'text-catalan-error   bg-catalan-error/10',
  org_admin:    'text-catalan-primary bg-catalan-primary/10',
  supervisor:   'text-catalan-warning bg-catalan-warning/10',
  enumerator:   'text-catalan-success bg-catalan-success/10',
}

export default function UserProfile() {
  const navigate = useNavigate()
  const toast    = useToast()
  const user     = getStoredUser() || { id: '', name: '', phone: '', role: '' }
  const sidebarItems = getNavItems(user.role)

  // ── Profile edit state ────────────────────────────────────────────────────
  const [name,    setName]    = useState(user.name   ?? '')
  const [phone,   setPhone]   = useState(user.phone  ?? '')
  const [editing, setEditing] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [profileError, setProfileError] = useState('')

  // ── Password change state ─────────────────────────────────────────────────
  const [showPwForm,   setShowPwForm]   = useState(false)
  const [currentPw,    setCurrentPw]    = useState('')
  const [newPw,        setNewPw]        = useState('')
  const [confirmPw,    setConfirmPw]    = useState('')
  const [pwSaving,     setPwSaving]     = useState(false)
  const [pwError,      setPwError]      = useState('')
  const [pwErrors,     setPwErrors]     = useState<Record<string, string>>({})

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSaveProfile = async () => {
    const errs: Record<string, string> = {}
    if (!name.trim())  errs.name  = 'Name is required'
    if (!phone.trim()) errs.phone = 'Phone is required'
    if (Object.keys(errs).length) {
      // show inline — reuse pwErrors pattern
      setPwErrors(errs)
      return
    }
    setPwErrors({})
    setSaving(true)
    setProfileError('')
    try {
      const { data } = await api.patch(`/users/${user.id}`, { name: name.trim(), phone: phone.trim() })
      storeUser({ ...user, name: name.trim(), phone: phone.trim() })
      toast.success('Profile updated')
      setEditing(false)
    } catch (err: any) {
      setProfileError(err.response?.data?.detail ?? 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async () => {
    const errs: Record<string, string> = {}
    if (!currentPw) errs.currentPw = 'Current password is required'
    if (newPw.length < 6) errs.newPw = 'New password must be at least 6 characters'
    if (newPw !== confirmPw) errs.confirmPw = 'Passwords do not match'
    if (Object.keys(errs).length) { setPwErrors(errs); return }

    setPwErrors({})
    setPwSaving(true)
    setPwError('')
    try {
      await api.post('/auth/change-password', {
        current_password: currentPw,
        new_password: newPw,
      })
      toast.success('Password changed successfully')
      setShowPwForm(false)
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch (err: any) {
      setPwError(err.response?.data?.detail ?? 'Failed to change password')
    } finally {
      setPwSaving(false)
    }
  }

  const cancelEdit = () => {
    setName(user.name ?? '')
    setPhone(user.phone ?? '')
    setEditing(false)
    setPwErrors({})
    setProfileError('')
  }

  const avatarInitial = (name || user.phone || 'U')[0]?.toUpperCase()
  const roleLabel = ROLE_LABELS[user.role] ?? user.role
  const roleCls   = ROLE_COLORS[user.role]  ?? 'text-catalan-textMuted bg-catalan-textMuted/10'

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={sidebarItems} role={user.role} />

      <div className="flex-1 flex flex-col overflow-auto">
        <TopNav
          breadcrumbs={[
            { label: 'Dashboard', path: '/' },
            { label: 'Profile' },
          ]}
        />

        <div className="flex-1 p-6 max-w-2xl mx-auto w-full space-y-6">

          {/* ── Avatar + header ── */}
          <div className="flex items-center gap-5">
            <div className="w-20 h-20 rounded-full bg-catalan-primary flex items-center justify-center text-catalan-bg text-3xl font-bold flex-shrink-0">
              {avatarInitial}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-catalan-text">{name || 'Your Profile'}</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium ${roleCls}`}>
                  {roleLabel}
                </span>
                <span className="text-catalan-textMuted text-sm">{phone}</span>
              </div>
            </div>
          </div>

          {/* ── Profile details ── */}
          <Card title="Profile Information">
            {profileError && (
              <Alert type="error" message={profileError} onClose={() => setProfileError('')} className="mb-4" />
            )}

            {editing ? (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-catalan-textMuted block mb-1">Full Name</label>
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className={`w-full bg-catalan-hover border rounded-lg px-3 py-2 text-sm text-catalan-text outline-none transition-colors ${
                      pwErrors.name ? 'border-catalan-error focus:border-catalan-error' : 'border-catalan-border focus:border-catalan-primary'
                    }`}
                  />
                  {pwErrors.name && <p className="text-xs text-catalan-error mt-1">{pwErrors.name}</p>}
                </div>
                <div>
                  <label className="text-xs text-catalan-textMuted block mb-1">Phone</label>
                  <input
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    className={`w-full bg-catalan-hover border rounded-lg px-3 py-2 text-sm text-catalan-text outline-none transition-colors ${
                      pwErrors.phone ? 'border-catalan-error focus:border-catalan-error' : 'border-catalan-border focus:border-catalan-primary'
                    }`}
                  />
                  {pwErrors.phone && <p className="text-xs text-catalan-error mt-1">{pwErrors.phone}</p>}
                </div>
                <div className="flex gap-3 pt-1">
                  <Button variant="primary" size="sm" onClick={handleSaveProfile} disabled={saving}>
                    {saving ? 'Saving…' : 'Save Changes'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={cancelEdit}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {[
                    ['Full Name', name || '—'],
                    ['Phone',     phone || '—'],
                    ['Role',      roleLabel],
                    ['User ID',   user.id ? user.id.slice(0, 12) + '…' : '—'],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div className="text-xs text-catalan-textMuted mb-0.5">{label}</div>
                      <div className="text-sm text-catalan-text font-medium">{val}</div>
                    </div>
                  ))}
                </div>
                <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                  ✎ Edit Profile
                </Button>
              </div>
            )}
          </Card>

          {/* ── Change Password ── */}
          <Card title="Security">
            {!showPwForm ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-catalan-text font-medium">Password</p>
                  <p className="text-xs text-catalan-textMuted mt-0.5">••••••••••</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => { setShowPwForm(true); setPwErrors({}) }}>
                  Change Password
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {pwError && (
                  <Alert type="error" message={pwError} onClose={() => setPwError('')} />
                )}

                <div>
                  <label className="text-xs text-catalan-textMuted block mb-1">Current Password</label>
                  <input
                    type="password"
                    value={currentPw}
                    onChange={e => setCurrentPw(e.target.value)}
                    className={`w-full bg-catalan-hover border rounded-lg px-3 py-2 text-sm text-catalan-text outline-none transition-colors ${
                      pwErrors.currentPw ? 'border-catalan-error' : 'border-catalan-border focus:border-catalan-primary'
                    }`}
                  />
                  {pwErrors.currentPw && <p className="text-xs text-catalan-error mt-1">{pwErrors.currentPw}</p>}
                </div>

                <div>
                  <label className="text-xs text-catalan-textMuted block mb-1">New Password</label>
                  <input
                    type="password"
                    value={newPw}
                    onChange={e => setNewPw(e.target.value)}
                    className={`w-full bg-catalan-hover border rounded-lg px-3 py-2 text-sm text-catalan-text outline-none transition-colors ${
                      pwErrors.newPw ? 'border-catalan-error' : 'border-catalan-border focus:border-catalan-primary'
                    }`}
                  />
                  {pwErrors.newPw && <p className="text-xs text-catalan-error mt-1">{pwErrors.newPw}</p>}
                </div>

                <div>
                  <label className="text-xs text-catalan-textMuted block mb-1">Confirm New Password</label>
                  <input
                    type="password"
                    value={confirmPw}
                    onChange={e => setConfirmPw(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleChangePassword() }}
                    className={`w-full bg-catalan-hover border rounded-lg px-3 py-2 text-sm text-catalan-text outline-none transition-colors ${
                      pwErrors.confirmPw ? 'border-catalan-error' : 'border-catalan-border focus:border-catalan-primary'
                    }`}
                  />
                  {pwErrors.confirmPw && <p className="text-xs text-catalan-error mt-1">{pwErrors.confirmPw}</p>}
                </div>

                <div className="flex gap-3 pt-1">
                  <Button variant="primary" size="sm" onClick={handleChangePassword} disabled={pwSaving}>
                    {pwSaving ? 'Saving…' : 'Change Password'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => {
                    setShowPwForm(false)
                    setCurrentPw(''); setNewPw(''); setConfirmPw('')
                    setPwErrors({}); setPwError('')
                  }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* ── Notifications ── */}
          <Card title="Notifications">
            <NotificationSettings />
          </Card>

          {/* ── Danger zone ── */}
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-catalan-error">Danger Zone</p>
                <p className="text-xs text-catalan-textMuted mt-0.5">Log out of all devices</p>
              </div>
              <Button variant="danger" size="sm" onClick={() => navigate('/login')}>
                Sign Out
              </Button>
            </div>
          </Card>

        </div>
      </div>
    </div>
  )
}
