/**
 * Integrations settings panel — Alerts (Telegram/WhatsApp), Webhooks, Google Sheets, Consent Reports.
 * Embedded in OrgAdminPanel → Integrations tab.
 */
import { useState, useEffect } from 'react'
import api from '@/lib/api'
import type { FormListItem, ProgramListItem } from '@/types/api'
import EmojiIcon from '@/components/EmojiIcon'

const ALL_EVENTS = [
  { id: 'submission.created',  label: 'New submission synced' },
  { id: 'submission.flagged',  label: 'Submission flagged' },
  { id: 'submission.approved', label: 'Submission approved' },
  { id: 'submission.rejected', label: 'Submission rejected' },
  { id: 'import.complete',     label: 'Platform import complete' },
]

const WEBHOOK_EVENTS = [
  'submission.created', 'submission.synced', 'submission.flagged',
  'submission.approved', 'submission.rejected',
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

// ── Alerts Section (Telegram + WhatsApp) ─────────────────────────────────────

function AlertsSection() {
  const [tgEnabled, setTgEnabled] = useState(false)
  const [botToken, setBotToken] = useState('')
  const [chatIds, setChatIds] = useState('')
  const [tgEvents, setTgEvents] = useState<string[]>(['submission.created', 'submission.flagged', 'import.complete'])

  const [waEnabled, setWaEnabled] = useState(false)
  const [authKey, setAuthKey] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [numbers, setNumbers] = useState('')
  const [waEvents, setWaEvents] = useState<string[]>(['submission.created', 'submission.flagged', 'import.complete'])

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/tenants/integrations').then(r => {
      const cfg = r.data
      setTgEnabled(cfg.telegram_enabled ?? false)
      setBotToken(cfg.telegram_bot_token ?? '')
      setChatIds((cfg.telegram_chat_ids ?? []).join('\n'))
      if (cfg.notify_events?.length) setTgEvents(cfg.notify_events)

      setWaEnabled(cfg.whatsapp_enabled ?? false)
      setAuthKey(cfg.msg91_auth_key ?? '')
      setTemplateId(cfg.msg91_template_id ?? '')
      setNumbers((cfg.notify_numbers ?? []).join(', '))
      if (cfg.notify_events?.length) setWaEvents(cfg.notify_events)
    }).catch(() => {})
  }, [])

  function toggleTgEvent(id: string) {
    setTgEvents(prev => prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id])
  }
  function toggleWaEvent(id: string) {
    setWaEvents(prev => prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id])
  }

  async function save() {
    setSaving(true); setError(''); setSaved(false)
    try {
      const ids = chatIds.split(/[\n,]/).map(s => s.trim()).filter(Boolean)
      await api.patch('/tenants/integrations/notifications', {
        telegram_enabled: tgEnabled,
        telegram_bot_token: botToken,
        telegram_chat_ids: ids,
        notify_events: tgEvents,
        whatsapp_enabled: waEnabled,
        msg91_auth_key: authKey,
        msg91_template_id: templateId,
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
    <div className="space-y-8">
      <p className="text-sm text-catalan-textMuted">Send real-time notifications to supervisors when field events occur.</p>

      {/* Telegram */}
      <div className="border border-catalan-border rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h4 className="font-semibold text-catalan-text"><EmojiIcon e="✈" /> Telegram</h4>
            <p className="text-xs text-catalan-textMuted mt-0.5">Free, instant, no approval needed.</p>
          </div>
          <Toggle checked={tgEnabled} onChange={setTgEnabled} label={tgEnabled ? 'Enabled' : 'Disabled'} />
        </div>

        {tgEnabled && (
          <>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 space-y-1">
              <p className="font-semibold">Setup:</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Create a bot via @BotFather → copy the token</li>
                <li>Supervisors message your bot and send /start</li>
                <li>Find chat_id at: <code className="bg-blue-100 px-1 rounded">{'https://api.telegram.org/bot{TOKEN}/getUpdates'}</code></li>
                <li>Paste the token and chat IDs below</li>
              </ol>
            </div>
            <div className="space-y-4 pl-2 border-l-2 border-catalan-primary/30">
              <Input label="Bot Token" value={botToken} onChange={setBotToken}
                placeholder="7123456789:ABCDef..." type="password"
                hint="From @BotFather → /mybots → select bot → API Token" />
              <div>
                <label className="block text-sm font-medium text-catalan-text mb-1">Chat IDs</label>
                <p className="text-xs text-catalan-textMuted mb-1">One per line or comma-separated.</p>
                <textarea value={chatIds} onChange={e => setChatIds(e.target.value)}
                  placeholder={"123456789\n987654321"} rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-catalan-border bg-catalan-surface text-catalan-text text-sm focus:outline-none focus:ring-2 focus:ring-catalan-primary/30 focus:border-catalan-primary font-mono" />
              </div>
              <div>
                <p className="text-sm font-medium text-catalan-text mb-2">Notify on events</p>
                <div className="space-y-2">
                  {ALL_EVENTS.map(ev => (
                    <label key={ev.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={tgEvents.includes(ev.id)} onChange={() => toggleTgEvent(ev.id)} className="rounded accent-catalan-primary" />
                      <span className="text-catalan-text">{ev.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* WhatsApp */}
      <div className="border border-catalan-border rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h4 className="font-semibold text-catalan-text"><EmojiIcon e="🟢" /> WhatsApp</h4>
            <p className="text-xs text-catalan-textMuted mt-0.5">Powered by MSG91 WABA. Requires Meta approval.</p>
          </div>
          <Toggle checked={waEnabled} onChange={setWaEnabled} label={waEnabled ? 'Enabled' : 'Disabled'} />
        </div>

        {waEnabled && (
          <div className="space-y-4 pl-2 border-l-2 border-catalan-primary/30">
            <Input label="MSG91 Auth Key" value={authKey} onChange={setAuthKey}
              placeholder="Your MSG91 authentication key" type="password"
              hint="Get from MSG91 → Dashboard → API → Auth Key" />
            <Input label="WhatsApp Template ID" value={templateId} onChange={setTemplateId}
              placeholder="Template ID from MSG91 WhatsApp panel"
              hint="Create a template in MSG91 → WhatsApp → Templates" />
            <Input label="Notify Numbers" value={numbers} onChange={setNumbers}
              placeholder="+919999990001, +919876543210"
              hint="Comma-separated mobile numbers with country code." />
            <div>
              <p className="text-sm font-medium text-catalan-text mb-2">Notify on events</p>
              <div className="space-y-2">
                {ALL_EVENTS.map(ev => (
                  <label key={ev.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={waEvents.includes(ev.id)} onChange={() => toggleWaEvent(ev.id)} className="rounded accent-catalan-primary" />
                    <span className="text-catalan-text">{ev.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="px-5 py-2 rounded-lg bg-catalan-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity">
          {saving ? 'Saving…' : 'Save Alert Settings'}
        </button>
        {saved && <span className="text-green-600 text-sm"><EmojiIcon e="✅" /> Saved</span>}
        {error && <span className="text-red-500 text-sm">{error}</span>}
      </div>
    </div>
  )
}

// ── Webhooks Section ──────────────────────────────────────────────────────────

interface WebhookItem {
  id: string; name: string; url: string; events: string[]
  is_active: boolean; created_at: string; secret: string | null
}

function WebhooksSection() {
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', url: '', secret: '', events: [] as string[] })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState('')
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; status_code: number | null } | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try { const { data } = await api.get('/webhooks/'); setWebhooks(data.items ?? []) }
    catch { /* ignore */ }
    finally { setLoading(false) }
  }

  function toggleEvent(ev: string) {
    setForm(f => ({ ...f, events: f.events.includes(ev) ? f.events.filter(e => e !== ev) : [...f.events, ev] }))
  }

  async function create() {
    if (!form.name || !form.url) return
    setSaving(true)
    try {
      const { data } = await api.post('/webhooks/', {
        name: form.name, url: form.url,
        secret: form.secret || undefined,
        events: form.events, is_active: true,
      })
      setWebhooks(w => [...w, data])
      setForm({ name: '', url: '', secret: '', events: [] })
      setShowForm(false)
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  async function remove(id: string) {
    if (!confirm('Delete this webhook?')) return
    try {
      await api.delete(`/webhooks/${id}`)
      setWebhooks(w => w.filter(x => x.id !== id))
    } catch { /* ignore */ }
  }

  async function test(id: string) {
    setTesting(id); setTestResult(null)
    try {
      const { data } = await api.post(`/webhooks/${id}/test`)
      setTestResult({ id, success: data.success, status_code: data.status_code })
    } catch { /* ignore */ }
    finally { setTesting('') }
  }

  return (
    <div className="space-y-5">
      <div>
        <h4 className="font-semibold text-catalan-text"><EmojiIcon e="🔗" /> Webhooks</h4>
        <p className="text-xs text-catalan-textMuted mt-0.5">Push real-time event payloads to your own endpoints (HMAC-signed).</p>
      </div>

      <div className="flex justify-between items-center">
        <span className="text-sm text-catalan-textMuted">{webhooks.length} webhook{webhooks.length !== 1 ? 's' : ''}</span>
        <button onClick={() => setShowForm(v => !v)}
          className="px-3 py-1.5 text-xs rounded-lg bg-catalan-primary text-white font-semibold hover:opacity-90">
          {showForm ? 'Cancel' : '+ New Webhook'}
        </button>
      </div>

      {showForm && (
        <div className="border border-catalan-primary/30 rounded-xl p-4 space-y-3 bg-catalan-surface">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="My webhook" />
            <Input label="URL" value={form.url} onChange={v => setForm(f => ({ ...f, url: v }))} placeholder="https://..." />
          </div>
          <Input label="Secret (optional)" value={form.secret} onChange={v => setForm(f => ({ ...f, secret: v }))}
            placeholder="HMAC signing secret" type="password" />
          <div>
            <p className="text-xs text-catalan-textMuted mb-2">Events</p>
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_EVENTS.map(ev => (
                <label key={ev} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" checked={form.events.includes(ev)} onChange={() => toggleEvent(ev)} className="rounded accent-catalan-primary" />
                  <code className="text-catalan-text">{ev}</code>
                </label>
              ))}
            </div>
          </div>
          <button onClick={create} disabled={saving || !form.name || !form.url}
            className="px-4 py-2 rounded-lg bg-catalan-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Webhook'}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-catalan-textMuted text-center py-4">Loading…</p>
      ) : webhooks.length === 0 ? (
        <p className="text-sm text-catalan-textMuted text-center py-6">No webhooks yet</p>
      ) : (
        <div className="space-y-3">
          {webhooks.map(wh => (
            <div key={wh.id} className="p-4 bg-catalan-hover rounded-lg border border-catalan-border">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-catalan-text text-sm">{wh.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${wh.is_active ? 'text-green-600 bg-green-50' : 'text-catalan-textMuted bg-catalan-hover'}`}>
                      {wh.is_active ? 'active' : 'inactive'}
                    </span>
                  </div>
                  <code className="text-xs text-catalan-textMuted truncate block">{wh.url}</code>
                  {wh.events.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {wh.events.map(ev => (
                        <code key={ev} className="text-xs bg-catalan-surface px-1.5 py-0.5 rounded text-catalan-textMuted">{ev}</code>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => test(wh.id)} disabled={testing === wh.id}
                    className="text-xs px-2.5 py-1.5 rounded border border-catalan-border text-catalan-textMuted hover:text-catalan-primary hover:border-catalan-primary/50 transition-colors disabled:opacity-50">
                    {testing === wh.id ? '…' : 'Test'}
                  </button>
                  <button onClick={() => remove(wh.id)}
                    className="text-xs px-2.5 py-1.5 rounded border border-red-200 text-red-500 hover:bg-red-50 transition-colors">
                    Delete
                  </button>
                </div>
              </div>
              {testResult?.id === wh.id && (
                <div className={`mt-2 text-xs px-2.5 py-1.5 rounded ${testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                  {testResult.success ? `✓ Succeeded (HTTP ${testResult.status_code})` : `⚠ Failed (HTTP ${testResult.status_code ?? 'error'})`}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
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
        <h4 className="font-semibold text-catalan-text"><EmojiIcon e="📊" /> Google Sheets Live Sync</h4>
        <p className="text-xs text-catalan-textMuted mt-0.5">
          Every new submission is appended as a row to your Google Sheet automatically.
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
                  <input type="url" value={cfg.url} onChange={e => update(form.id, { url: e.target.value })}
                    placeholder="https://script.google.com/macros/s/.../exec"
                    className="w-full px-3 py-2 rounded-lg border border-catalan-border bg-catalan-surface text-catalan-text text-xs focus:outline-none focus:ring-2 focus:ring-catalan-primary/30 focus:border-catalan-primary font-mono" />
                  <label className="flex items-center gap-2 text-xs text-catalan-textMuted cursor-pointer">
                    <input type="checkbox" checked={cfg.meta} onChange={e => update(form.id, { meta: e.target.checked })} className="rounded" />
                    Include metadata columns (submission ID, serial no, sync time)
                  </label>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button onClick={() => save(form.id)} disabled={saving === form.id}
                  className="px-3 py-1.5 rounded-lg bg-catalan-primary text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50">
                  {saving === form.id ? '…' : 'Save'}
                </button>
                {saved === form.id && <span className="text-green-600 text-xs"><EmojiIcon e="✅" /> Saved</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Consent Reports Section ───────────────────────────────────────────────────

function ConsentReportsSection() {
  const [forms, setForms] = useState<Form[]>([])

  useEffect(() => {
    api.get('/forms/').then(r => {
      const fs: Form[] = r.data?.forms || r.data || []
      setForms(fs)
    }).catch(() => {})
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-semibold text-catalan-text"><EmojiIcon e="📑" /> Consent Reports</h4>
        <p className="text-xs text-catalan-textMuted mt-0.5">
          Download DPDP consent audit records. Includes submission ID, enumerator phone, consent flag and timestamp.
        </p>
      </div>

      {forms.length === 0 ? (
        <p className="text-sm text-catalan-textMuted">No forms available.</p>
      ) : (
        <div className="space-y-2">
          {forms.map(f => (
            <div key={f.id} className="flex items-center justify-between py-2 px-3 border border-catalan-border rounded-lg">
              <span className="text-sm text-catalan-text">{f.title}</span>
              <a href={`/api/v1/export/consent-report?form_id=${f.id}`} target="_blank" rel="noopener noreferrer"
                className="text-xs px-2.5 py-1 rounded border border-catalan-primary/30 text-catalan-primary hover:bg-catalan-primary/10 transition-colors">
                <EmojiIcon e="📥" /> Download CSV
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Org Settings Section (enumerator edit access) ────────────────────────────

interface FormEditOverride   { id: string; title: string; allow_enumerator_edit: boolean | null }
interface ProgramEditOverride { id: string; name: string;  allow_enumerator_edit: boolean | null }

function OrgSettingsSection() {
  const [tenantId, setTenantId] = useState('')
  const [allowEdit, setAllowEdit] = useState(false)
  const [savingOrg, setSavingOrg] = useState(false)
  const [formOverrides, setFormOverrides] = useState<FormEditOverride[]>([])
  const [programOverrides, setProgramOverrides] = useState<ProgramEditOverride[]>([])
  const [savingOverride, setSavingOverride] = useState(false)

  useEffect(() => {
    api.get('/tenants/branding').then(r => {
      if (r.data.id) setTenantId(r.data.id)
      if (typeof r.data.allow_enumerator_edit === 'boolean') setAllowEdit(r.data.allow_enumerator_edit)
    }).catch(() => {})
    api.get('/forms/').then(r => {
      const fs = r.data?.forms ?? r.data ?? []
      setFormOverrides(fs.map((f: FormListItem) => ({ id: f.id, title: f.title, allow_enumerator_edit: f.allow_enumerator_edit ?? null })))
    }).catch(() => {})
    api.get('/programs/').then(r => {
      const ps = Array.isArray(r.data) ? r.data : []
      setProgramOverrides(ps.map((p: ProgramListItem) => ({ id: p.id, name: p.name, allow_enumerator_edit: p.allow_enumerator_edit ?? null })))
    }).catch(() => {})
  }, [])

  async function saveOrgDefault() {
    setSavingOrg(true)
    try {
      await api.patch(`/tenants/${tenantId}`, { allow_enumerator_edit: !allowEdit })
      setAllowEdit(v => !v)
    } catch { /* ignore */ }
    finally { setSavingOrg(false) }
  }

  async function bulkForm(val: boolean | null) {
    setSavingOverride(true)
    try {
      await api.patch('/forms/bulk-edit-setting', { allow_enumerator_edit: val })
      setFormOverrides(prev => prev.map(f => ({ ...f, allow_enumerator_edit: val })))
    } catch { /* ignore */ }
    finally { setSavingOverride(false) }
  }

  async function bulkProgram(val: boolean | null) {
    setSavingOverride(true)
    try {
      await api.patch('/programs/bulk-edit-setting', { allow_enumerator_edit: val })
      setProgramOverrides(prev => prev.map(p => ({ ...p, allow_enumerator_edit: val })))
    } catch { /* ignore */ }
    finally { setSavingOverride(false) }
  }

  async function setFormOverride(id: string, current: boolean | null) {
    const next = current === null ? true : current === true ? false : null
    try {
      await api.put(`/forms/${id}`, { allow_enumerator_edit: next })
      setFormOverrides(prev => prev.map(f => f.id === id ? { ...f, allow_enumerator_edit: next } : f))
    } catch { /* ignore */ }
  }

  async function setProgramOverride(id: string, current: boolean | null) {
    const next = current === null ? true : current === true ? false : null
    try {
      await api.patch(`/programs/${id}`, { allow_enumerator_edit: next })
      setProgramOverrides(prev => prev.map(p => p.id === id ? { ...p, allow_enumerator_edit: next } : p))
    } catch { /* ignore */ }
  }

  const triToggleClass = (val: boolean | null) =>
    val === true ? 'bg-catalan-primary' : val === false ? 'bg-red-400' : 'bg-catalan-border'
  const triDotClass = (val: boolean | null) =>
    val === true ? 'translate-x-5' : val === false ? 'translate-x-0' : 'translate-x-2.5'

  return (
    <div className="space-y-7">
      <div>
        <h4 className="font-semibold text-catalan-text"><EmojiIcon e="⚙" /> Enumerator Edit Access</h4>
        <p className="text-xs text-catalan-textMuted mt-0.5">
          Control whether enumerators can edit their own previously submitted records. Set an org-wide default, then override per form or per program. Form-level overrides take priority.
        </p>
      </div>

      {/* Org-wide default */}
      <div className="flex items-center justify-between gap-4 p-3 bg-catalan-hover rounded-lg">
        <div>
          <p className="text-sm font-medium text-catalan-text">Org-wide default</p>
          <p className="text-xs text-catalan-textMuted">Applies to all forms/programs without a specific override</p>
        </div>
        <button onClick={saveOrgDefault} disabled={savingOrg}
          className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${allowEdit ? 'bg-catalan-primary' : 'bg-catalan-border'}`}>
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${allowEdit ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      {/* Per-form overrides */}
      {formOverrides.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-catalan-text">Per-form overrides</p>
            <div className="flex gap-2">
              {([['Enable All', true], ['Disable All', false], ['Reset All', null]] as const).map(([label, val]) => (
                <button key={label} onClick={() => bulkForm(val)} disabled={savingOverride}
                  className={`text-xs px-2 py-1 rounded transition-colors disabled:opacity-50 ${
                    val === true ? 'bg-catalan-primary/10 text-catalan-primary hover:bg-catalan-primary/20' :
                    val === false ? 'bg-red-50 text-red-500 hover:bg-red-100' :
                    'bg-catalan-hover border border-catalan-border text-catalan-textMuted hover:text-catalan-text'
                  }`}>{label}</button>
              ))}
            </div>
          </div>
          <div className="border border-catalan-border rounded-lg overflow-hidden divide-y divide-catalan-border">
            {formOverrides.map(f => (
              <div key={f.id} className="flex items-center justify-between py-2 px-3 hover:bg-catalan-hover/50">
                <span className="text-sm text-catalan-text truncate flex-1">{f.title}</span>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  {f.allow_enumerator_edit === null && <span className="text-xs text-catalan-textMuted italic">org default</span>}
                  <button onClick={() => setFormOverride(f.id, f.allow_enumerator_edit)}
                    title={f.allow_enumerator_edit === null ? 'Uses org default — click to override' : f.allow_enumerator_edit ? 'Enabled — click to disable' : 'Disabled — click to reset'}
                    className={`relative w-10 h-5 rounded-full transition-colors ${triToggleClass(f.allow_enumerator_edit)}`}>
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${triDotClass(f.allow_enumerator_edit)}`} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-program overrides */}
      {programOverrides.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-catalan-text">Per-program overrides</p>
            <div className="flex gap-2">
              {([['Enable All', true], ['Disable All', false], ['Reset All', null]] as const).map(([label, val]) => (
                <button key={label} onClick={() => bulkProgram(val)} disabled={savingOverride}
                  className={`text-xs px-2 py-1 rounded transition-colors disabled:opacity-50 ${
                    val === true ? 'bg-catalan-primary/10 text-catalan-primary hover:bg-catalan-primary/20' :
                    val === false ? 'bg-red-50 text-red-500 hover:bg-red-100' :
                    'bg-catalan-hover border border-catalan-border text-catalan-textMuted hover:text-catalan-text'
                  }`}>{label}</button>
              ))}
            </div>
          </div>
          <div className="border border-catalan-border rounded-lg overflow-hidden divide-y divide-catalan-border">
            {programOverrides.map(p => (
              <div key={p.id} className="flex items-center justify-between py-2 px-3 hover:bg-catalan-hover/50">
                <span className="text-sm text-catalan-text truncate flex-1">{p.name}</span>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  {p.allow_enumerator_edit === null && <span className="text-xs text-catalan-textMuted italic">org default</span>}
                  <button onClick={() => setProgramOverride(p.id, p.allow_enumerator_edit)}
                    title={p.allow_enumerator_edit === null ? 'Uses org default — click to override' : p.allow_enumerator_edit ? 'Enabled — click to disable' : 'Disabled — click to reset'}
                    className={`relative w-10 h-5 rounded-full transition-colors ${triToggleClass(p.allow_enumerator_edit)}`}>
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${triDotClass(p.allow_enumerator_edit)}`} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function IntegrationsPanel() {
  const [section, setSection] = useState<'alerts' | 'webhooks' | 'sheets' | 'consent' | 'access'>('alerts')

  return (
    <div className="space-y-6">
      <div className="flex gap-3 flex-wrap">
        {([
          ['alerts',   '🔔 Alerts'],
          ['webhooks', '🔗 Webhooks'],
          ['sheets',   '📊 Google Sheets'],
          ['consent',  '📑 Consent Reports'],
          ['access',   '⚙️ Form Access'],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setSection(id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              section === id ? 'bg-catalan-primary text-white' : 'bg-catalan-bg text-catalan-textMuted border border-catalan-border hover:border-catalan-primary'
            }`}>
            {label}
          </button>
        ))}
      </div>

      <div className="border-t border-catalan-border pt-6">
        {section === 'alerts'   && <AlertsSection />}
        {section === 'webhooks' && <WebhooksSection />}
        {section === 'sheets'   && <SheetsSection />}
        {section === 'consent'  && <ConsentReportsSection />}
        {section === 'access'   && <OrgSettingsSection />}
      </div>
    </div>
  )
}
