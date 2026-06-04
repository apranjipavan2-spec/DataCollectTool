import { useState, useEffect } from 'react'
import api, { getStoredUser } from '@/lib/api'
import EmojiIcon from '@/components/EmojiIcon'

const PROVIDERS = [
  { id: 'openai',    label: 'OpenAI',    icon: '🟢', placeholder: 'sk-…',     defaultModel: 'gpt-4o',               models: ['gpt-4o','gpt-4o-mini','gpt-4-turbo','gpt-3.5-turbo'] },
  { id: 'anthropic', label: 'Anthropic', icon: '🟠', placeholder: 'sk-ant-…', defaultModel: 'claude-sonnet-4-6',     models: ['claude-opus-4-7','claude-sonnet-4-6','claude-haiku-4-5-20251001'] },
  { id: 'gemini',    label: 'Google',    icon: '🔵', placeholder: 'AIzaSy…',  defaultModel: 'gemini-2.0-flash',      models: ['gemini-2.0-flash','gemini-1.5-pro','gemini-1.5-flash'] },
  { id: 'deepseek',  label: 'DeepSeek',  icon: '🐋', placeholder: 'sk-…',     defaultModel: 'deepseek-v4-flash',     models: ['deepseek-v4-flash','deepseek-v4-pro','deepseek-chat','deepseek-reasoner'] },
] as const

type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'deepseek'

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
      <div className="max-w-3xl space-y-4">
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
        <AiUsagePanel />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <MasterAiConfig initial={config} onUpdated={setConfig} />
      <AiUsagePanel />
    </div>
  )
}

// ── Usage tracking panel ──────────────────────────────────────────────────

interface UsageUserRow {
  user_id: string | null
  user_name: string
  user_email: string | null
  tenant_id: string
  calls: number
  tokens_in: number
  tokens_out: number
  errors: number
  last_call: string | null
}
interface UsageFeatureRow { feature: string; calls: number; tokens_in: number; tokens_out: number }
interface UsageData { days: number; scope: string; per_user: UsageUserRow[]; by_feature: UsageFeatureRow[] }

function AiUsagePanel() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get('/ai/usage', { params: { days } })
      .then(({ data }) => setData(data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [days])

  const fmt = (n: number) => n.toLocaleString()
  const fmtDate = (s: string | null) => s ? new Date(s).toLocaleString() : '—'

  const totals = data?.per_user.reduce(
    (a, r) => ({ calls: a.calls + r.calls, tokens_in: a.tokens_in + r.tokens_in, tokens_out: a.tokens_out + r.tokens_out, errors: a.errors + r.errors }),
    { calls: 0, tokens_in: 0, tokens_out: 0, errors: 0 }
  )

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-catalan-text"><EmojiIcon e="📊" /> AI Usage</div>
          <div className="text-xs text-catalan-textMuted">
            {data?.scope === 'global' ? 'All tenants' : 'Your organisation'} · last {days} days
          </div>
        </div>
        <select className="border border-catalan-border rounded-lg px-3 py-1.5 text-sm bg-catalan-bg text-catalan-text"
          value={days} onChange={e => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last 365 days</option>
        </select>
      </div>

      {loading ? (
        <div className="text-catalan-textMuted text-sm p-4">Loading…</div>
      ) : !data || data.per_user.length === 0 ? (
        <div className="p-4 rounded-xl border border-catalan-border bg-catalan-bg text-sm text-catalan-textMuted">
          No AI usage recorded in this window yet.
        </div>
      ) : (
        <>
          {totals && (
            <div className="grid grid-cols-4 gap-3">
              <Stat label="Total calls" value={fmt(totals.calls)} />
              <Stat label="Tokens in" value={fmt(totals.tokens_in)} />
              <Stat label="Tokens out" value={fmt(totals.tokens_out)} />
              <Stat label="Errors" value={fmt(totals.errors)} tone={totals.errors > 0 ? 'warn' : undefined} />
            </div>
          )}

          <div className="rounded-xl border border-catalan-border overflow-hidden">
            <div className="px-4 py-2 bg-catalan-primary/5 text-xs font-semibold text-catalan-text uppercase tracking-wide">
              Per User
            </div>
            <table className="w-full text-sm">
              <thead className="text-xs text-catalan-textMuted">
                <tr className="border-b border-catalan-border">
                  <th className="text-left px-4 py-2">User</th>
                  <th className="text-right px-4 py-2">Calls</th>
                  <th className="text-right px-4 py-2">Tokens in</th>
                  <th className="text-right px-4 py-2">Tokens out</th>
                  <th className="text-right px-4 py-2">Errors</th>
                  <th className="text-left px-4 py-2">Last call</th>
                </tr>
              </thead>
              <tbody>
                {data.per_user.map((r, i) => (
                  <tr key={`${r.user_id}-${i}`} className="border-b border-catalan-border/50 last:border-0">
                    <td className="px-4 py-2 text-catalan-text">
                      <div className="font-medium">{r.user_name}</div>
                      {r.user_email && <div className="text-xs text-catalan-textMuted">{r.user_email}</div>}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-catalan-text">{fmt(r.calls)}</td>
                    <td className="px-4 py-2 text-right font-mono text-catalan-textMuted">{fmt(r.tokens_in)}</td>
                    <td className="px-4 py-2 text-right font-mono text-catalan-textMuted">{fmt(r.tokens_out)}</td>
                    <td className={`px-4 py-2 text-right font-mono ${r.errors > 0 ? 'text-catalan-error' : 'text-catalan-textMuted'}`}>{fmt(r.errors)}</td>
                    <td className="px-4 py-2 text-xs text-catalan-textMuted">{fmtDate(r.last_call)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.by_feature.length > 0 && (
            <div className="rounded-xl border border-catalan-border overflow-hidden">
              <div className="px-4 py-2 bg-catalan-primary/5 text-xs font-semibold text-catalan-text uppercase tracking-wide">
                By Feature
              </div>
              <table className="w-full text-sm">
                <thead className="text-xs text-catalan-textMuted">
                  <tr className="border-b border-catalan-border">
                    <th className="text-left px-4 py-2">Feature</th>
                    <th className="text-right px-4 py-2">Calls</th>
                    <th className="text-right px-4 py-2">Tokens in</th>
                    <th className="text-right px-4 py-2">Tokens out</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_feature.map((f, i) => (
                    <tr key={`${f.feature}-${i}`} className="border-b border-catalan-border/50 last:border-0">
                      <td className="px-4 py-2 text-catalan-text font-mono text-xs">{f.feature}</td>
                      <td className="px-4 py-2 text-right font-mono text-catalan-text">{fmt(f.calls)}</td>
                      <td className="px-4 py-2 text-right font-mono text-catalan-textMuted">{fmt(f.tokens_in)}</td>
                      <td className="px-4 py-2 text-right font-mono text-catalan-textMuted">{fmt(f.tokens_out)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className={`p-3 rounded-xl border ${tone === 'warn' ? 'border-catalan-warning/30 bg-catalan-warning/5' : 'border-catalan-border bg-catalan-bg'}`}>
      <div className="text-xs text-catalan-textMuted">{label}</div>
      <div className={`text-lg font-semibold ${tone === 'warn' ? 'text-catalan-warning' : 'text-catalan-text'}`}>{value}</div>
    </div>
  )
}

function MasterAiConfig({ initial, onUpdated }: { initial: ConfigData | null; onUpdated: (c: ConfigData) => void }) {
  const [activeProvider, setActiveProvider] = useState<ProviderId>(
    (initial?.active_provider as ProviderId) || 'gemini'
  )
  const [keys, setKeys] = useState<Record<ProviderId, { apiKey: string; model: string }>>({
    openai:    { apiKey: '', model: initial?.keys?.openai?.model    || 'gpt-4o' },
    anthropic: { apiKey: '', model: initial?.keys?.anthropic?.model || 'claude-sonnet-4-6' },
    gemini:    { apiKey: '', model: initial?.keys?.gemini?.model    || 'gemini-2.0-flash' },
    deepseek:  { apiKey: '', model: initial?.keys?.deepseek?.model  || 'deepseek-v4-flash' },
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
        <div className="text-sm font-semibold text-catalan-text mb-1"><EmojiIcon e="🌐" /> Global AI Keys</div>
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
