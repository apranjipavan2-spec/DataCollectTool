/**
 * Integrations settings panel — WhatsApp notifications + Google Sheets sync.
 * Embedded in OrgAdminPanel → Integrations tab.
 */
import { useState, useEffect } from 'react'
import api from '@/lib/api'

const ALL_EVENTS = [
  { id: 'submission.created',  label: 'New submission synced' },
  { id: 'submission.flagged',  label: 'Submission flagged' },
  { id: 'submission.approved', label: 'Submission approved' },
  { id: 'submission.rejected', label: 'Submission rejected' },
  { id: 'import.complete',     label: 'Platform import complete' },
]

interface Form { id: string; title: string; sheets_sync_config?: { enabled?: boolean; apps_script_url?: string; include_metadata?: boolean } }

function Input({ label, value, onChange, placeholder, type = 'text', hint }: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; type?: string; hint?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-catalan-text mb-1">{label}</label>
      {hint && <p className="text-xs text-catalan-textMuted mb-1">{hint}</p>}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-catalan-border bg-catalan-surface text-catalan-text text-sm focus:outline-none focus:ring-2 focus:ring-catalan-primary/30 focus:border-catalan-primary"
      />
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <div
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-catalan-primary' : 'bg-catalan-border'}`}
      >
        <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </div>
      <span className="text-sm font-medium text-catalan-text">{label}</span>
    </label>
  )
}

// ── WhatsApp Section ──────────────────────────────────────────────────────────

function WhatsAppSection() {
  const [enabled, setEnabled] = useState(false)
  const [authKey, setAuthKey] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [numbers, setNumbers] = useState('')
  const [events, setEvents] = useState<string[]>(['submission.created', 'submission.flagged', 'import.complete'])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/tenants/integrations').then(r => {
      const cfg = r.data
      setEnabled(cfg.whatsapp_enabled ?? false)
      setAuthKey(cfg.msg91_auth_key ?? '')
      setTemplateId(cfg.msg91_template_id ?? '')
      setNumbers((cfg.notify_numbers ?? []).join(', '))
      if (cfg.notify_events?.length) setEvents(cfg.notify_events)
    }).catch(() => {})
  }, [])

  function toggleEvent(id: string) {
    setEvents(prev => prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id])
  }

  async function save() {
    setSaving(true); setError(''); setSaved(false)
    try {
      await api.patch('/tenants/integrations/notifications', {
        whatsapp_enabled: enabled,
        msg91_auth_key: authKey,
        msg91_template_id: templateId,
        notify_events: events,
        notify_numbers: numbers.split(',').map(n => n.trim()).filter(Boolean),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h4 className="font-semibold text-catalan-text">🟢 WhatsApp Notifications</h4>
          <p className="text-xs text-catalan-textMuted mt-0.5">Powered by MSG91 WABA. Supervisors get notified on field events.</p>
        </div>
        <Toggle checked={enabled} onChange={setEnabled} label={enabled ? 'Enabled' : 'Disabled'} />
      </div>

      {enabled && (
        <div className="space-y-4 pl-2 border-l-2 border-catalan-primary/30">
          <Input
            label="MSG91 Auth Key"
            value={authKey}
            onChange={setAuthKey}
            placeholder="Your MSG91 authentication key"
            type="password"
            hint="Get from MSG91 → Dashboard → API → Auth Key"
          />
          <Input
            label="WhatsApp Template ID"
            value={templateId}
            onChange={setTemplateId}
            placeholder="Template ID from MSG91 WhatsApp panel"
            hint="Create a template in MSG91 → WhatsApp → Templates"
          />
          <Input
            label="Notify Numbers"
            value={numbers}
            onChange={setNumbers}
            placeholder="+919999990001, +919876543210"
            hint="Comma-separated mobile numbers with country code. These numbers must be registered in MSG91."
          />

          <div>
            <p className="text-sm font-medium text-catalan-text mb-2">Notify on events</p>
            <div className="space-y-2">
              {ALL_EVENTS.map(ev => (
                <label key={ev.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={events.includes(ev.id)}
                    onChange={() => toggleEvent(ev.id)}
                    className="rounded accent-catalan-primary"
                  />
                  <span className="text-catalan-text">{ev.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2 rounded-lg bg-catalan-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {saving ? 'Saving…' : 'Save WhatsApp Settings'}
        </button>
        {saved && <span className="text-green-600 text-sm">✅ Saved</span>}
        {error && <span className="text-red-500 text-sm">{error}</span>}
      </div>
    </div>
  )
}

// ── Google Sheets Section ─────────────────────────────────────────────────────

function SheetsSection() {
  const [forms, setForms] = useState<Form[]>([])
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [configs, setConfigs] = useState<Record<string, { enabled: boolean; url: string; meta: boolean }>>({})

  useEffect(() => {
    api.get('/forms/').then(r => {
      const fs: Form[] = r.data?.forms || r.data || []
      setForms(fs)
      const init: typeof configs = {}
      fs.forEach(f => {
        const cfg = f.sheets_sync_config || {}
        init[f.id] = { enabled: cfg.enabled ?? false, url: cfg.apps_script_url ?? '', meta: cfg.include_metadata ?? true }
      })
      setConfigs(init)
    }).catch(() => {})
  }, [])

  function update(id: string, patch: Partial<{ enabled: boolean; url: string; meta: boolean }>) {
    setConfigs(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function save(formId: string) {
    setSaving(formId)
    const cfg = configs[formId] || { enabled: false, url: '', meta: true }
    try {
      await api.patch('/tenants/integrations/sheets', {
        form_id: formId,
        enabled: cfg.enabled,
        apps_script_url: cfg.url,
        include_metadata: cfg.meta,
      })
      setSaved(formId)
      setTimeout(() => setSaved(null), 2500)
    } catch { /* ignore */ }
    finally { setSaving(null) }
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-semibold text-catalan-text">📊 Google Sheets Live Sync</h4>
        <p className="text-xs text-catalan-textMuted mt-0.5">
          Every new submission (including imported data) is appended as a row to your Google Sheet automatically.
        </p>
        <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 space-y-1">
          <p className="font-semibold">Setup (one-time per sheet):</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Open your Google Sheet → Extensions → Apps Script</li>
            <li>Paste the script from <code className="bg-amber-100 px-1 rounded">planning/MIGRATION_SPEC.md</code></li>
            <li>Deploy → Web app → Execute as: Me → Who has access: Anyone</li>
            <li>Copy the deployment URL and paste it below per form</li>
          </ol>
        </div>
      </div>

      {forms.length === 0 && <p className="text-catalan-textMuted text-sm">No forms found.</p>}

      <div className="space-y-3">
        {forms.map(form => {
          const cfg = configs[form.id] || { enabled: false, url: '', meta: true }
          return (
            <div key={form.id} className="border border-catalan-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-medium text-catalan-text text-sm">{form.title}</p>
                <Toggle checked={cfg.enabled} onChange={v => update(form.id, { enabled: v })} label={cfg.enabled ? 'On' : 'Off'} />
              </div>
              {cfg.enabled && (
                <div className="space-y-2">
                  <input
                    type="url"
                    value={cfg.url}
                    onChange={e => update(form.id, { url: e.target.value })}
                    placeholder="https://script.google.com/macros/s/.../exec"
                    className="w-full px-3 py-2 rounded-lg border border-catalan-border bg-catalan-surface text-catalan-text text-xs focus:outline-none focus:ring-2 focus:ring-catalan-primary/30 focus:border-catalan-primary font-mono"
                  />
                  <label className="flex items-center gap-2 text-xs text-catalan-textMuted cursor-pointer">
                    <input type="checkbox" checked={cfg.meta} onChange={e => update(form.id, { meta: e.target.checked })} className="rounded" />
                    Include metadata columns (submission ID, serial no, sync time)
                  </label>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => save(form.id)}
                  disabled={saving === form.id}
                  className="px-3 py-1.5 rounded-lg bg-catalan-primary text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {saving === form.id ? '…' : 'Save'}
                </button>
                {saved === form.id && <span className="text-green-600 text-xs">✅ Saved</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function IntegrationsPanel() {
  const [section, setSection] = useState<'whatsapp' | 'sheets'>('whatsapp')

  return (
    <div className="space-y-6">
      <div className="flex gap-3">
        {([['whatsapp', '🟢 WhatsApp'], ['sheets', '📊 Google Sheets']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              section === id ? 'bg-catalan-primary text-white' : 'bg-catalan-bg text-catalan-textMuted border border-catalan-border hover:border-catalan-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="border-t border-catalan-border pt-6">
        {section === 'whatsapp' && <WhatsAppSection />}
        {section === 'sheets'   && <SheetsSection />}
      </div>
    </div>
  )
}
