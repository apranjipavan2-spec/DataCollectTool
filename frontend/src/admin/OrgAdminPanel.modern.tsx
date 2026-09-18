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
  const [activeTab, setActiveTab] = useState('api-keys')

  const user = getStoredUser() || { name: '', role: '' }
  const sidebarItems = getNavItems(user.role)

  const isMasterAdmin = user.role === 'master_admin'
  const tabs = [
    { id: 'api-keys',     label: 'API Keys',      description: 'Integration access' },
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
            {activeTab === 'api-keys' && <ApiKeyManager />}
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

function SecurityTab() {
  const [qrEnabled,    setQrEnabled]    = useState(false)
  const [twoFaEnabled, setTwoFaEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [twoFaError, setTwoFaError] = useState('')
  const [aiEnabled, setAiEnabled] = useState(true)
  const [aiSaving, setAiSaving] = useState(false)
  const [aiSaved, setAiSaved] = useState(false)
  const [byoEnabled, setByoEnabled] = useState(false)
  const [byoProvider, setByoProvider] = useState('openai')
  const [byoConfigured, setByoConfigured] = useState(false)
  const [byoModel, setByoModel] = useState('')
  const [byoApiKeyInput, setByoApiKeyInput] = useState('')
  const [byoSaving, setByoSaving] = useState(false)
  const [byoSaved, setByoSaved] = useState(false)
  const [byoError, setByoError] = useState('')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwSaved, setPwSaved] = useState(false)
  const [withdrawCode, setWithdrawCode] = useState('')
  const [withdrawLookup, setWithdrawLookup] = useState<{ id: string; form_id: string; already_withdrawn: boolean; server_received_at: string | null } | null>(null)
  const [withdrawError, setWithdrawError] = useState('')
  const [withdrawBusy, setWithdrawBusy] = useState(false)
  const [withdrawDone, setWithdrawDone] = useState(false)

  useEffect(() => {
    api.get('/tenants/security')
      .then(({ data }) => {
        setQrEnabled(data.qr_login_enabled ?? false)
        setTwoFaEnabled(data.two_fa_enabled ?? false)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    api.get('/tenants/ai-config')
      .then(({ data }) => {
        setAiEnabled(data.enabled ?? true)
        setByoEnabled(data.byo_enabled ?? false)
        setByoProvider(data.byo_provider || 'openai')
        setByoConfigured(data.byo_configured ?? false)
        setByoModel(data.byo_model || '')
      })
      .catch(() => {})
  }, [])

  async function toggleAi() {
    setAiSaving(true); setAiSaved(false)
    try {
      const { data } = await api.patch('/tenants/ai-config', { enabled: !aiEnabled })
      setAiEnabled(data.enabled)
      setAiSaved(true); setTimeout(() => setAiSaved(false), 2000)
    } catch { } finally { setAiSaving(false) }
  }

  async function toggleByo() {
    setByoSaving(true); setByoSaved(false); setByoError('')
    try {
      const { data } = await api.patch('/tenants/ai-config', { enabled: aiEnabled, byo_enabled: !byoEnabled })
      setByoEnabled(data.byo_enabled)
      setByoSaved(true); setTimeout(() => setByoSaved(false), 2000)
    } catch (e: any) {
      setByoError(e?.response?.data?.detail ?? 'Failed to update')
    } finally { setByoSaving(false) }
  }

  async function saveByoKey() {
    setByoSaving(true); setByoSaved(false); setByoError('')
    try {
      const { data } = await api.patch('/tenants/ai-config', {
        enabled: aiEnabled,
        byo_provider: byoProvider,
        byo_model: byoModel,
        byo_api_key: byoApiKeyInput,
      })
      setByoConfigured(data.byo_configured)
      setByoApiKeyInput('')
      setByoSaved(true); setTimeout(() => setByoSaved(false), 2000)
    } catch (e: any) {
      setByoError(e?.response?.data?.detail ?? 'Failed to save key')
    } finally { setByoSaving(false) }
  }

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

  async function lookupWithdrawCode() {
    setWithdrawError(''); setWithdrawLookup(null); setWithdrawDone(false)
    if (!withdrawCode.trim()) return
    try {
      const { data } = await api.get('/submissions/consent-withdrawal/lookup', { params: { ref_code: withdrawCode.trim() } })
      setWithdrawLookup(data)
    } catch (e: any) {
      setWithdrawError(e?.response?.data?.detail ?? 'Lookup failed')
    }
  }

  async function confirmWithdraw() {
    if (!withdrawLookup) return
    setWithdrawBusy(true); setWithdrawError('')
    try {
      await api.post('/submissions/consent-withdrawal/withdraw', { ref_code: withdrawCode.trim() })
      setWithdrawDone(true)
      setWithdrawLookup(null)
      setWithdrawCode('')
    } catch (e: any) {
      setWithdrawError(e?.response?.data?.detail ?? 'Withdrawal failed')
    } finally { setWithdrawBusy(false) }
  }

  if (loading) return <div className="p-6 text-catalan-textMuted text-sm">Loading…</div>

  return (
    <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl items-start">
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

      {/* AI features opt-out */}
      <Card>
        <div className="p-6">
          <h3 className="text-base font-semibold text-catalan-text mb-1">AI Features</h3>
          <p className="text-sm text-catalan-textMuted mb-5">
            AI Cleaner, Writer, Analyzer and Smart Builder send data to a third-party AI
            model (direct identifiers like names, phone numbers and GPS are stripped
            before anything is sent). Turn this off if your organisation doesn't want
            data processed by an external AI provider at all.
          </p>
          <div className="flex items-center justify-between p-4 bg-catalan-bg border border-catalan-border rounded-xl">
            <div>
              <p className="text-sm font-medium text-catalan-text">Allow AI processing</p>
              <p className="text-xs text-catalan-textMuted mt-0.5">
                {aiEnabled ? 'Enabled — AI features available on your plan will work' : 'Disabled — all AI features are blocked for this organisation'}
              </p>
            </div>
            <button
              onClick={toggleAi}
              disabled={aiSaving}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${aiEnabled ? 'bg-catalan-primary' : 'bg-catalan-border'} ${aiSaving ? 'opacity-50' : ''}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${aiEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          {aiSaved && <p className="text-xs text-catalan-success mt-2">✓ Saved</p>}

          {aiEnabled && (
            <div className="mt-5 pt-5 border-t border-catalan-border">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-catalan-text">Use your own API key (BYO)</p>
                <button
                  onClick={toggleByo}
                  disabled={byoSaving}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${byoEnabled ? 'bg-catalan-primary' : 'bg-catalan-border'} ${byoSaving ? 'opacity-50' : ''}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${byoEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              <p className="text-xs text-catalan-textMuted mb-3">
                Off: AI requests use the platform's shared key, billed on your plan. On: requests use
                your own provider key below, billed directly to your account by that provider.
              </p>
              {byoEnabled && (
                <div className="space-y-3 bg-catalan-bg border border-catalan-border rounded-xl p-4">
                  <div>
                    <label className="block text-xs font-medium text-catalan-textMuted uppercase tracking-wider mb-1.5">Provider</label>
                    <select
                      value={byoProvider}
                      onChange={e => setByoProvider(e.target.value)}
                      className="w-full bg-catalan-surface border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text outline-none focus:border-catalan-primary"
                    >
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic (Claude)</option>
                      <option value="gemini">Google Gemini</option>
                      <option value="deepseek">DeepSeek</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-catalan-textMuted uppercase tracking-wider mb-1.5">Model (optional)</label>
                    <input
                      value={byoModel}
                      onChange={e => setByoModel(e.target.value)}
                      placeholder="Leave blank to use the provider's default"
                      className="w-full bg-catalan-surface border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text outline-none focus:border-catalan-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-catalan-textMuted uppercase tracking-wider mb-1.5">
                      API Key {byoConfigured && <span className="text-catalan-success normal-case">— a key is currently stored</span>}
                    </label>
                    <input
                      type="password"
                      value={byoApiKeyInput}
                      onChange={e => setByoApiKeyInput(e.target.value)}
                      placeholder={byoConfigured ? 'Enter a new key to replace the stored one' : 'sk-...'}
                      className="w-full bg-catalan-surface border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text outline-none focus:border-catalan-primary"
                    />
                    <p className="text-xs text-catalan-textMuted mt-1">Stored encrypted. Never shown again after saving.</p>
                  </div>
                  {byoError && <p className="text-xs text-catalan-error">{byoError}</p>}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={saveByoKey}
                      disabled={byoSaving || !byoApiKeyInput}
                      className="px-4 py-2 text-sm font-medium rounded-lg bg-catalan-primary text-white disabled:opacity-50"
                    >
                      {byoSaving ? 'Saving…' : 'Save key'}
                    </button>
                    {byoSaved && <span className="text-xs text-catalan-success">✓ Saved</span>}
                  </div>
                  {byoEnabled && !byoConfigured && (
                    <p className="text-xs text-catalan-error">
                      BYO is on but no key is saved yet — AI requests will fail until you save one.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Password change */}
      <Card className="lg:col-span-2 max-w-xl">
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

      {/* Consent withdrawal — DPDP */}
      <Card>
        <div className="p-6">
          <h3 className="text-base font-semibold text-catalan-text mb-1">Consent Withdrawal</h3>
          <p className="text-sm text-catalan-textMuted mb-5">
            A respondent quotes their reference code (shown to them after submitting) through your grievance
            channel. Look it up here to confirm the right response, then withdraw — this erases their
            answers, GPS, and any photos/audio, the same as a full erasure request.
          </p>
          <div className="flex gap-2 mb-3">
            <input
              value={withdrawCode}
              onChange={e => { setWithdrawCode(e.target.value); setWithdrawLookup(null); setWithdrawDone(false) }}
              onKeyDown={e => e.key === 'Enter' && lookupWithdrawCode()}
              placeholder="e.g. A1B2-C3D4"
              className="flex-1 bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text font-mono uppercase tracking-wider focus:outline-none focus:border-catalan-primary transition-colors"
            />
            <button
              onClick={lookupWithdrawCode}
              disabled={!withdrawCode.trim()}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-catalan-hover border border-catalan-border text-catalan-text hover:bg-catalan-border transition-colors disabled:opacity-50"
            >
              Look up
            </button>
          </div>
          {withdrawError && <p className="text-xs text-catalan-error flex items-center gap-1 mb-2"><span><EmojiIcon e="⚠" /></span>{withdrawError}</p>}
          {withdrawLookup && (
            <div className="p-4 bg-catalan-bg border border-catalan-border rounded-xl mb-2">
              <p className="text-sm text-catalan-text mb-1">
                Submission <span className="font-mono text-xs">{withdrawLookup.id.slice(0, 8)}…</span>
                {withdrawLookup.server_received_at && <> — received {new Date(withdrawLookup.server_received_at).toLocaleString()}</>}
              </p>
              {withdrawLookup.already_withdrawn ? (
                <p className="text-xs text-catalan-textMuted">Already withdrawn/erased — nothing left to do.</p>
              ) : (
                <button
                  onClick={confirmWithdraw}
                  disabled={withdrawBusy}
                  className="mt-2 w-full py-2 rounded-lg text-sm font-semibold bg-catalan-error text-white hover:brightness-110 transition-all disabled:opacity-50"
                >
                  {withdrawBusy ? 'Withdrawing…' : 'Confirm withdrawal — erase this response'}
                </button>
              )}
            </div>
          )}
          {withdrawDone && <p className="text-xs text-catalan-success">✓ Consent withdrawn — response erased</p>}
        </div>
      </Card>
    </div>
  )
}
