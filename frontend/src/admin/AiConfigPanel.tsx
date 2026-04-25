import { useState, useEffect } from 'react'
import api, { getStoredUser } from '@/lib/api'

const PROVIDERS = [
  { id: 'openai',    label: 'OpenAI',    icon: '🟢', placeholder: 'sk-…',     defaultModel: 'gpt-4o',               models: ['gpt-4o','gpt-4o-mini','gpt-4-turbo','gpt-3.5-turbo'] },
  { id: 'anthropic', label: 'Anthropic', icon: '🟠', placeholder: 'sk-ant-…', defaultModel: 'claude-sonnet-4-6',     models: ['claude-opus-4-7','claude-sonnet-4-6','claude-haiku-4-5-20251001'] },
  { id: 'gemini',    label: 'Google',    icon: '🔵', placeholder: 'AIzaSy…',  defaultModel: 'gemini-2.0-flash',      models: ['gemini-2.0-flash','gemini-1.5-pro','gemini-1.5-flash'] },
] as const

type ProviderId = 'openai' | 'anthropic' | 'gemini'

interface KeysStatus { [p: string]: { configured: boolean; model: string } }
interface ConfigData { active_provider: string; keys: KeysStatus; configured: boolean }

const inp = 'w-full border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text focus:ring-2 focus:ring-catalan-primary outline-none'
const sel = 'w-full border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text focus:ring-2 focus:ring-catalan-primary outline-none'

export default function AiConfigPanel() {
  const user = getStoredUser()
  const isMaster = user?.role === 'master_admin'
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/ai/config').then(({ data }) => setConfig(data)).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-catalan-textMuted text-sm p-4">Loading…</div>

  if (!isMaster) {
    const configured = config?.configured
    const active = config?.active_provider
    return (
      <div className="max-w-lg space-y-4">
        <div className={`flex items-center gap-3 p-4 rounded-xl border ${
          configured ? 'bg-green-500/10 border-green-500/30' : 'bg-catalan-warning/10 border-catalan-warning/30'
        }`}>
          <span className="text-2xl">{configured ? '✅' : '⚠️'}</span>
          <div>
            <div className="text-sm font-semibold text-catalan-text">
              {configured ? `AI Enabled — ${active}` : 'AI Not Configured'}
            </div>
            <div className="text-xs text-catalan-textMuted mt-0.5">
              {configured
                ? 'AI features are active for your organisation.'
                : 'Contact your FieldGovern platform administrator to enable AI.'}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return <MasterAiConfig initial={config} onUpdated={setConfig} />
}

function MasterAiConfig({ initial, onUpdated }: { initial: ConfigData | null; onUpdated: (c: ConfigData) => void }) {
  const [activeProvider, setActiveProvider] = useState<ProviderId>(
    (initial?.active_provider as ProviderId) || 'gemini'
  )
  const [keys, setKeys] = useState<Record<ProviderId, { apiKey: string; model: string }>>({
    openai:    { apiKey: '', model: initial?.keys?.openai?.model    || 'gpt-4o' },
    anthropic: { apiKey: '', model: initial?.keys?.anthropic?.model || 'claude-sonnet-4-6' },
    gemini:    { apiKey: '', model: initial?.keys?.gemini?.model    || 'gemini-2.0-flash' },
  })
  const [saving, setSaving] = useState<ProviderId | null>(null)
  const [msgs, setMsgs] = useState<Record<string, string>>({})
  const [configured, setConfigured] = useState<Record<string, boolean>>(
    Object.fromEntries(PROVIDERS.map(p => [p.id, initial?.keys?.[p.id]?.configured ?? false]))
  )

  const setKey = (p: ProviderId, field: 'apiKey' | 'model', val: string) =>
    setKeys(prev => ({ ...prev, [p]: { ...prev[p], [field]: val } }))

  const saveProvider = async (p: ProviderId) => {
    if (!keys[p].apiKey) { setMsgs(m => ({ ...m, [p]: 'Enter an API key to save' })); return }
    setSaving(p); setMsgs(m => ({ ...m, [p]: '' }))
    try {
      await api.patch('/ai/config', {
        provider: p, api_key: keys[p].apiKey, model: keys[p].model,
        active_provider: activeProvider,
      })
      setConfigured(c => ({ ...c, [p]: true }))
      setKeys(prev => ({ ...prev, [p]: { ...prev[p], apiKey: '' } }))
      setMsgs(m => ({ ...m, [p]: '✅ Saved' }))
      const { data } = await api.get('/ai/config')
      onUpdated(data)
    } catch (e: any) {
      setMsgs(m => ({ ...m, [p]: `Error: ${e.response?.data?.detail || e.message}` }))
    } finally {
      setSaving(null)
    }
  }

  const setActive = async (p: ProviderId) => {
    setActiveProvider(p)
    try {
      await api.patch('/ai/config', { active_provider: p })
      setMsgs(m => ({ ...m, active: `✅ Active provider set to ${p}` }))
      const { data } = await api.get('/ai/config')
      onUpdated(data)
    } catch { }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="p-4 rounded-xl bg-catalan-primary/5 border border-catalan-primary/20">
        <div className="text-sm font-semibold text-catalan-text mb-1">🌐 Global AI Keys</div>
        <div className="text-xs text-catalan-textMuted">
          Configure one or more AI providers. Select the <strong>active provider</strong> that will be used for all AI features.
          Keys are stored encrypted and never exposed to org admins.
        </div>
      </div>

      {/* Active provider picker */}
      <div>
        <div className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wide mb-2">Active Provider</div>
        <div className="flex gap-3">
          {PROVIDERS.map(p => (
            <button key={p.id} onClick={() => setActive(p.id as ProviderId)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                activeProvider === p.id
                  ? 'border-catalan-primary bg-catalan-primary/10 text-catalan-primary'
                  : 'border-catalan-border text-catalan-textMuted hover:border-catalan-primary/40'
              }`}>
              <span>{p.icon}</span>
              <span>{p.label}</span>
              {configured[p.id] && <span className="text-green-500 text-xs">●</span>}
            </button>
          ))}
        </div>
        {msgs.active && <p className="text-xs text-green-500 mt-1">{msgs.active}</p>}
      </div>

      {/* Per-provider key cards */}
      {PROVIDERS.map(p => {
        const pid = p.id as ProviderId
        return (
          <div key={p.id} className={`rounded-xl border p-5 space-y-4 transition-all ${
            activeProvider === pid ? 'border-catalan-primary/40 bg-catalan-primary/3' : 'border-catalan-border'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">{p.icon}</span>
                <span className="font-semibold text-catalan-text">{p.label}</span>
                {activeProvider === pid && (
                  <span className="text-xs bg-catalan-primary/15 text-catalan-primary px-2 py-0.5 rounded-full font-medium">Active</span>
                )}
              </div>
              <span className={`text-xs font-semibold ${configured[pid] ? 'text-green-500' : 'text-catalan-textMuted'}`}>
                {configured[pid] ? '✅ Configured' : '○ Not set'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-catalan-textMuted block mb-1">API Key</label>
                <input type="password" className={inp} value={keys[pid].apiKey}
                  onChange={e => setKey(pid, 'apiKey', e.target.value)}
                  placeholder={configured[pid] ? '••••••• (leave blank to keep)' : p.placeholder} />
              </div>
              <div>
                <label className="text-xs font-medium text-catalan-textMuted block mb-1">Model</label>
                <select className={sel} value={keys[pid].model} onChange={e => setKey(pid, 'model', e.target.value)}>
                  {p.models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={() => saveProvider(pid)} disabled={saving === pid}
                className="px-4 py-2 bg-catalan-primary text-catalan-bg rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity">
                {saving === pid ? 'Saving…' : `Save ${p.label} Key`}
              </button>
              {msgs[pid] && (
                <span className={`text-sm ${msgs[pid].startsWith('✅') ? 'text-green-500' : 'text-catalan-error'}`}>
                  {msgs[pid]}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
