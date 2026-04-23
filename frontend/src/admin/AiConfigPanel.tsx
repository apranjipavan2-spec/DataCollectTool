import { useState, useEffect } from 'react'
import api from '@/lib/api'

const PROVIDER_DEFAULTS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-6',
  gemini: 'gemini-1.5-pro',
}

export default function AiConfigPanel() {
  const [provider, setProvider] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [configured, setConfigured] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/ai/config').then(({ data }) => {
      setProvider(data.provider || '')
      setModel(data.model || '')
      setConfigured(data.configured || false)
    }).finally(() => setLoading(false))
  }, [])

  const handleProviderChange = (p: string) => {
    setProvider(p)
    setModel(PROVIDER_DEFAULTS[p] || '')
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await api.patch('/ai/config', { provider, api_key: apiKey, model })
      setSaved(true)
      setConfigured(true)
      setApiKey('')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-catalan-textMuted text-sm p-4">Loading…</div>
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <p className="text-sm text-catalan-textMuted mb-1">
          {configured
            ? `✅ AI Configured — Provider: ${provider}`
            : '⚠️ Not configured — paste your API key below to enable AI features'}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-catalan-text mb-2">Provider</label>
        <div className="flex gap-4">
          {[
            { id: 'openai', label: 'OpenAI' },
            { id: 'anthropic', label: 'Anthropic Claude' },
            { id: 'gemini', label: 'Google Gemini' },
          ].map((p) => (
            <label key={p.id} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="provider"
                value={p.id}
                checked={provider === p.id}
                onChange={() => handleProviderChange(p.id)}
                className="accent-catalan-primary"
              />
              <span className="text-sm text-catalan-text">{p.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-catalan-text mb-1">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={e => { setApiKey(e.target.value); setSaved(false) }}
          placeholder="Paste your API key here"
          className="w-full bg-catalan-surface border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
        />
        <p className="text-xs text-catalan-textMuted mt-1">Stored securely per organisation. Leave blank to keep existing key.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-catalan-text mb-1">Model</label>
        <input
          type="text"
          value={model}
          onChange={e => { setModel(e.target.value); setSaved(false) }}
          placeholder={provider ? PROVIDER_DEFAULTS[provider] : 'Select a provider first'}
          className="w-full bg-catalan-surface border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
        />
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving || !provider}
          className="px-5 py-2 bg-catalan-primary text-white rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-catalan-text text-sm">✅ Saved</span>}
      </div>
    </div>
  )
}
