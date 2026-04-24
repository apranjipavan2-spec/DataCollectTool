import { useState, useEffect } from 'react'
import api, { getStoredUser } from '@/lib/api'

export default function AiConfigPanel() {
  const user = getStoredUser()
  const isMaster = user?.role === 'master_admin'
  const [provider, setProvider] = useState('')
  const [configured, setConfigured] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/ai/config').then(({ data }) => {
      setProvider(data.provider || '')
      setConfigured(data.configured || false)
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-catalan-textMuted text-sm p-4">Loading…</div>

  if (!isMaster) {
    return (
      <div className="max-w-lg space-y-4">
        <div className={`flex items-center gap-3 p-4 rounded-xl border ${
          configured
            ? 'bg-green-500/10 border-green-500/30'
            : 'bg-catalan-warning/10 border-catalan-warning/30'
        }`}>
          <span className="text-2xl">{configured ? '✅' : '⚠️'}</span>
          <div>
            <div className="text-sm font-semibold text-catalan-text">
              {configured ? `AI Enabled — Provider: ${provider}` : 'AI Not Configured'}
            </div>
            <div className="text-xs text-catalan-textMuted mt-0.5">
              {configured
                ? 'AI features (report writer, form builder, tabulator) are active for your organisation.'
                : 'AI features are not yet enabled. Contact your FieldGovern platform administrator.'}
            </div>
          </div>
        </div>
        <p className="text-xs text-catalan-textMuted">
          The AI key is managed globally by the FieldGovern super admin and applies to all organisations.
        </p>
      </div>
    )
  }

  return <MasterAiConfig />
}

function MasterAiConfig() {
  const [provider, setProvider] = useState('anthropic')
  const [apiKey, setApiKey]     = useState('')
  const [model, setModel]       = useState('claude-sonnet-4-6')
  const [saving, setSaving]     = useState(false)
  const [msg, setMsg]           = useState('')
  const [currentStatus, setCurrentStatus] = useState<{ provider?: string; configured: boolean } | null>(null)

  const DEFAULTS: Record<string, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-6',
    gemini: 'gemini-1.5-pro',
  }

  useEffect(() => {
    api.get('/ai/config').then(({ data }) => setCurrentStatus(data)).catch(() => {})
  }, [])

  const save = async () => {
    if (!provider || !apiKey) { setMsg('Provider and API key are required'); return }
    setSaving(true); setMsg('')
    try {
      await api.patch('/ai/config', { provider, api_key: apiKey, model })
      setMsg('✅ Global AI key saved — applies to all organisations')
      setApiKey('')
      setCurrentStatus({ provider, configured: true })
    } catch (e: any) {
      setMsg(`Error: ${e.response?.data?.detail || e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const inp = 'w-full border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text focus:ring-2 focus:ring-catalan-primary outline-none'

  return (
    <div className="max-w-lg space-y-5">
      <div className="p-4 rounded-xl bg-catalan-primary/5 border border-catalan-primary/20">
        <div className="text-sm font-semibold text-catalan-text mb-1">🌐 Global AI Configuration</div>
        <div className="text-xs text-catalan-textMuted">
          This key applies to <strong>all organisations</strong> on the platform. You set it once here — no per-org configuration needed.
        </div>
        {currentStatus && (
          <div className={`mt-3 flex items-center gap-2 text-xs font-semibold ${currentStatus.configured ? 'text-green-500' : 'text-catalan-warning'}`}>
            <span>{currentStatus.configured ? '✅' : '⚠️'}</span>
            {currentStatus.configured ? `Currently configured: ${currentStatus.provider}` : 'Not configured yet'}
          </div>
        )}
      </div>

      <div>
        <label className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wide block mb-2">AI Provider</label>
        <div className="flex gap-6">
          {[['openai','OpenAI GPT-4o'],['anthropic','Anthropic Claude'],['gemini','Google Gemini']].map(([id, label]) => (
            <label key={id} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="provider" value={id} checked={provider === id}
                onChange={() => { setProvider(id); setModel(DEFAULTS[id]) }}
                className="accent-catalan-primary" />
              <span className="text-sm text-catalan-text">{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wide block mb-1">API Key</label>
        <input type="password" className={inp} value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder={provider === 'openai' ? 'sk-…' : provider === 'anthropic' ? 'ant-…' : 'AIzaSy…'} />
        <p className="text-xs text-catalan-textMuted mt-1">Key is stored encrypted and never exposed to org admins.</p>
      </div>

      <div>
        <label className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wide block mb-1">
          Model <span className="text-catalan-textMuted font-normal">(optional, uses default if blank)</span>
        </label>
        <input className={inp} value={model} onChange={e => setModel(e.target.value)}
          placeholder={DEFAULTS[provider] || 'default'} />
      </div>

      <button onClick={save} disabled={saving}
        className="px-5 py-2.5 bg-catalan-primary text-catalan-bg rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity">
        {saving ? 'Saving…' : 'Save Global AI Key'}
      </button>

      {msg && <p className={`text-sm ${msg.startsWith('✅') ? 'text-green-500' : 'text-catalan-error'}`}>{msg}</p>}
    </div>
  )
}
