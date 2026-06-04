import { useState, useEffect } from 'react'
import api, { getStoredUser } from '@/lib/api'
import { getNavItems } from '@/lib/navigation'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { Card } from '@/components/ui'
import ApiKeyManager from './ApiKeyManager'
import IntegrationsPanel from './IntegrationsPanel'
import AiConfigPanel from './AiConfigPanel'
import EmojiIcon from '@/components/EmojiIcon'

export default function OrgAdminPanel() {
  const [activeTab, setActiveTab] = useState('users')

  const user = getStoredUser() || { name: '', role: '' }
  const sidebarItems = getNavItems(user.role)

  const isMasterAdmin = user.role === 'master_admin'
  const tabs = [
    { id: 'users',        label: 'Users',        description: 'Manage team members' },
    { id: 'api-keys',     label: 'API Keys',      description: 'Integration access' },
    { id: 'forms',        label: 'Forms',         description: 'Form templates' },
    { id: 'migration',    label: 'Import',        description: 'Kobo · SurveyCTO · XLSForm' },
    { id: 'integrations', label: 'Integrations',  description: 'Alerts · Webhooks · Sheets · Access' },
    { id: 'security',     label: 'Security',      description: 'QR login · Password' },
    ...(isMasterAdmin ? [{ id: 'ai', label: 'AI', description: 'OpenAI · Claude · Gemini' }] : []),
  ]

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={sidebarItems} role={user.role} />
      <div className="flex-1 flex flex-col overflow-auto">
        <TopNav title="Organization Settings" />
        <div className="flex-1 p-6">
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-catalan-text mb-2">Organization Admin</h2>
            <p className="text-catalan-textMuted">Manage users, API keys, and form assignments</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`p-4 rounded-lg text-left transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'border-2 border-catalan-primary bg-catalan-primary/10 shadow-md shadow-catalan-primary/10'
                    : 'border-2 border-catalan-border bg-catalan-surface hover:border-catalan-primary/50 hover:shadow-md hover:shadow-catalan-primary/5'
                }`}
              >
                <div className="text-lg font-semibold text-catalan-text mb-1">{tab.label}</div>
                <p className="text-sm text-catalan-textMuted">{tab.description}</p>
              </button>
            ))}
          </div>

          <div>
            {activeTab === 'users' && <UsersTab />}
            {activeTab === 'api-keys' && <ApiKeyManager />}
            {activeTab === 'forms' && <FormsTab />}
            {activeTab === 'migration' && <MigrationTab />}
            {activeTab === 'integrations' && (
              <div className="p-6">
                <h3 className="text-lg font-semibold text-catalan-text mb-6">Integrations</h3>
                <IntegrationsPanel />
              </div>
            )}
            {activeTab === 'security' && <SecurityTab />}
            {activeTab === 'ai' && (
              <div className="p-6">
                <h3 className="text-lg font-semibold text-catalan-text mb-2">AI Configuration</h3>
                <p className="text-sm text-catalan-textMuted mb-6">Connect your own LLM API key to enable AI-powered report generation, skip logic suggestions, and label translation.</p>
                <AiConfigPanel />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function UsersTab() {
  return (
    <Card>
      <div className="p-6">
        <h3 className="text-lg font-semibold text-catalan-text mb-4">Team Management</h3>
        <div className="space-y-3">
          <p className="text-catalan-textMuted">
            User management is available in the <strong className="text-catalan-primary">Team tab</strong> of the main Dashboard.
          </p>
          <p className="text-sm text-catalan-textMuted">
            You can add new users, remove team members, and manage their roles and permissions from there.
          </p>
          <div className="mt-6">
            <a href="/" className="inline-block px-4 py-2 bg-catalan-primary text-catalan-bg rounded font-medium hover:bg-catalan-primaryDark transition-colors">
              Go to Dashboard
            </a>
          </div>
        </div>
      </div>
    </Card>
  )
}

function MigrationTab() {
  return (
    <Card>
      <div className="p-6">
        <h3 className="text-lg font-semibold text-catalan-text mb-2">Import from Other Platforms</h3>
        <p className="text-catalan-textMuted mb-6">
          Migrate your forms and historical data from KoboToolbox, SurveyCTO, ODK Central, or any standard XLSForm file.
        </p>
        <a href="/migration" className="inline-block px-5 py-2.5 bg-catalan-primary text-catalan-bg rounded-lg font-semibold hover:opacity-90 transition-opacity">
          <EmojiIcon e="🔄" /> Open Migration Wizard →
        </a>
      </div>
    </Card>
  )
}

function FormsTab() {
  return (
    <Card>
      <div className="p-6">
        <h3 className="text-lg font-semibold text-catalan-text mb-2">Form Builder</h3>
        <p className="text-sm text-catalan-textMuted mb-6">
          Design questionnaires, configure skip logic, add photos and GPS fields, and publish forms to your field team.
        </p>
        <div className="flex flex-wrap gap-3">
          <a href="/builder" className="inline-flex items-center gap-2 px-5 py-3 bg-catalan-primary text-catalan-bg rounded-xl font-semibold text-sm hover:bg-catalan-primaryDark transition-colors shadow-sm">
            <EmojiIcon e="📋" /> Open Form Builder →
          </a>
          <a href="/builder" className="inline-flex items-center gap-2 px-5 py-3 border border-catalan-border text-catalan-text rounded-xl font-medium text-sm hover:bg-catalan-hover transition-colors">
            <EmojiIcon e="➕" /> Create New Form
          </a>
        </div>
        <div className="mt-6 p-4 bg-catalan-bg border border-catalan-border rounded-xl text-sm text-catalan-textMuted">
          <p className="font-medium text-catalan-text mb-1">What you can do in the Form Builder:</p>
          <ul className="space-y-1 text-xs mt-2">
            <li>• Build multi-section questionnaires with skip logic</li>
            <li>• Add text, number, GPS, photo, audio, and choice fields</li>
            <li>• Import existing XLSForm / KoboToolbox forms</li>
            <li>• Publish and assign forms to enumerators</li>
          </ul>
        </div>
      </div>
    </Card>
  )
}

function SecurityTab() {
  const [qrEnabled,    setQrEnabled]    = useState(false)
  const [twoFaEnabled, setTwoFaEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [twoFaError, setTwoFaError] = useState('')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwSaved, setPwSaved] = useState(false)

  useEffect(() => {
    api.get('/tenants/security')
      .then(({ data }) => {
        setQrEnabled(data.qr_login_enabled ?? false)
        setTwoFaEnabled(data.two_fa_enabled ?? false)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function toggleQr() {
    setSaving(true); setSaved(false)
    try {
      const { data } = await api.patch('/tenants/security', { qr_login_enabled: !qrEnabled, two_fa_enabled: twoFaEnabled })
      setQrEnabled(data.qr_login_enabled)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch { } finally { setSaving(false) }
  }

  async function toggleTwoFa() {
    setTwoFaError('')
    setSaving(true)
    try {
      const { data } = await api.patch('/tenants/security', { qr_login_enabled: qrEnabled, two_fa_enabled: !twoFaEnabled })
      setTwoFaEnabled(data.two_fa_enabled)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e: any) {
      setTwoFaError(e?.response?.data?.detail ?? 'Failed to update 2FA setting')
    } finally { setSaving(false) }
  }

  async function handlePasswordChange() {
    setPwError('')
    if (newPw.length < 6) { setPwError('New password must be at least 6 characters'); return }
    if (newPw !== confirmPw) { setPwError('Passwords do not match'); return }
    setPwSaving(true)
    try {
      await api.post('/auth/change-password', { current_password: currentPw, new_password: newPw })
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
      setPwSaved(true); setTimeout(() => setPwSaved(false), 2500)
    } catch (e: any) {
      setPwError(e?.response?.data?.detail ?? 'Failed to change password')
    } finally { setPwSaving(false) }
  }

  if (loading) return <div className="p-6 text-catalan-textMuted text-sm">Loading…</div>

  return (
    <div className="p-6 space-y-6 max-w-xl">
      {/* QR Login toggle */}
      <Card>
        <div className="p-6">
          <h3 className="text-base font-semibold text-catalan-text mb-1">QR Login</h3>
          <p className="text-sm text-catalan-textMuted mb-5">
            When enabled, supervisors can generate a QR code for instant enumerator login — no password needed. Disable to require password-only login.
          </p>
          <div className="flex items-center justify-between p-4 bg-catalan-bg border border-catalan-border rounded-xl">
            <div>
              <p className="text-sm font-medium text-catalan-text">Allow QR login for field staff</p>
              <p className="text-xs text-catalan-textMuted mt-0.5">
                {qrEnabled ? 'Enabled — supervisors can generate QR codes' : 'Disabled — password login required'}
              </p>
            </div>
            <button
              onClick={toggleQr}
              disabled={saving}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${qrEnabled ? 'bg-catalan-primary' : 'bg-catalan-border'} ${saving ? 'opacity-50' : ''}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${qrEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          {saved && <p className="text-xs text-catalan-success mt-2">✓ Saved</p>}
        </div>
      </Card>

      {/* 2FA toggle */}
      <Card>
        <div className="p-6">
          <h3 className="text-base font-semibold text-catalan-text mb-1">Two-Factor Authentication (2FA)</h3>
          <p className="text-sm text-catalan-textMuted mb-5">
            When enabled, all users must enter a one-time code sent to their email after entering their password. Requires a plan that includes 2FA.
          </p>
          <div className="flex items-center justify-between p-4 bg-catalan-bg border border-catalan-border rounded-xl">
            <div>
              <p className="text-sm font-medium text-catalan-text">Require OTP on login</p>
              <p className="text-xs text-catalan-textMuted mt-0.5">
                {twoFaEnabled ? 'Enabled — users must verify via email OTP' : 'Disabled — password-only login'}
              </p>
            </div>
            <button
              onClick={toggleTwoFa}
              disabled={saving}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${twoFaEnabled ? 'bg-catalan-primary' : 'bg-catalan-border'} ${saving ? 'opacity-50' : ''}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${twoFaEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          {twoFaError && (
            <p className="text-xs text-catalan-error mt-2 flex items-center gap-1">
              <span><EmojiIcon e="⚠" /></span>{twoFaError}
              {twoFaError.includes('plan') && (
                <a href="/subscription" className="underline ml-1 font-semibold">Upgrade →</a>
              )}
            </p>
          )}
        </div>
      </Card>

      {/* Password change */}
      <Card>
        <div className="p-6">
          <h3 className="text-base font-semibold text-catalan-text mb-1">Change Password</h3>
          <p className="text-sm text-catalan-textMuted mb-5">Update your admin account password.</p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-catalan-textMuted uppercase tracking-wider mb-1.5">Current Password</label>
              <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)}
                className="w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary transition-colors"
                placeholder="••••••••" />
            </div>
            <div>
              <label className="block text-xs font-medium text-catalan-textMuted uppercase tracking-wider mb-1.5">New Password</label>
              <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                className="w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary transition-colors"
                placeholder="Min. 6 characters" />
            </div>
            <div>
              <label className="block text-xs font-medium text-catalan-textMuted uppercase tracking-wider mb-1.5">Confirm New Password</label>
              <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handlePasswordChange()}
                className="w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary transition-colors"
                placeholder="Re-enter new password" />
            </div>
            {pwError && <p className="text-xs text-catalan-error flex items-center gap-1"><span><EmojiIcon e="⚠" /></span>{pwError}</p>}
            <button
              onClick={handlePasswordChange}
              disabled={pwSaving || !currentPw || !newPw || !confirmPw}
              className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${pwSaved ? 'bg-catalan-success text-catalan-bg' : 'bg-catalan-primary text-catalan-bg hover:bg-catalan-primaryDark'}`}
            >
              {pwSaving ? 'Saving…' : pwSaved ? '✓ Password changed' : 'Update Password'}
            </button>
          </div>
        </div>
      </Card>
    </div>
  )
}
