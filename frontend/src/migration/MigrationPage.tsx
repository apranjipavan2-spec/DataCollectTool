/**
 * Migration Page — import forms from XLSForm, Kobo, SurveyCTO, ODK Central.
 * Accessible from OrgAdminPanel → Migration tab.
 */
import { useState, useRef } from 'react'
import api, { getStoredUser } from '@/lib/api'
import { getNavItems } from '@/lib/navigation'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import FormPreview from './FormPreview'
import EmojiIcon from '@/components/EmojiIcon'

// ── types ─────────────────────────────────────────────────────────────────────

export interface ParsedField {
  id: string
  type: string
  name: string
  label: string
  hint?: string
  required?: boolean
  options?: { value: string; label: string }[]
  fields?: ParsedField[]
  skipLogic?: object
  skipLogicRaw?: string
}

export interface ParsedSection {
  id: string
  title: string
  fields: ParsedField[]
}

export interface ParsedSchema {
  title: string
  sections: ParsedSection[]
  version: number
}

interface PlatformForm {
  uid?: string          // Kobo
  id?: string           // SurveyCTO / ODK
  name?: string
  title?: string
  submission_count?: number
  date_modified?: string
  date_updated?: string
}

type Tab = 'xlsform' | 'kobo' | 'surveycto' | 'odk'

// ── helpers ───────────────────────────────────────────────────────────────────

function countFields(sections: ParsedSection[]): number {
  return sections.reduce((n, s) => n + s.fields.length, 0)
}

/** Prefer the backend's error detail over axios's generic "Request failed with status code 500". */
function errMsg(err: any, fallback: string): string {
  return err?.response?.data?.detail || err?.message || fallback
}

function Input({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; type?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-catalan-text mb-1">{label}</label>
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

// ── main component ────────────────────────────────────────────────────────────

export default function MigrationPage() {
  const user = getStoredUser() || { name: '', role: '' }
  const sidebarItems = getNavItems(user.role)
  const [activeTab, setActiveTab] = useState<Tab>('xlsform')

  const tabs: { id: Tab; label: string; desc: string }[] = [
    { id: 'xlsform', label: 'XLSForm', desc: 'Upload .xlsx file' },
    { id: 'kobo',    label: 'KoboToolbox', desc: 'Connect via API token' },
    { id: 'surveycto', label: 'SurveyCTO', desc: 'Connect via credentials' },
    { id: 'odk',    label: 'ODK Central', desc: 'Connect via credentials' },
  ]

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={sidebarItems} role={user.role} />
      <div className="flex-1 flex flex-col overflow-auto">
        <TopNav title="Import from Other Platforms" />
        <div className="flex-1 p-6">
          {/* Tab bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`p-4 rounded-xl text-left transition-all ${
                  activeTab === t.id
                    ? 'border-2 border-catalan-primary bg-catalan-primary/10 shadow-md'
                    : 'border-2 border-catalan-border bg-catalan-surface hover:border-catalan-primary/50'
                }`}
              >
                <div className="font-semibold text-catalan-text text-sm">{t.label}</div>
                <p className="text-xs text-catalan-textMuted mt-0.5">{t.desc}</p>
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="bg-catalan-surface border border-catalan-border rounded-2xl p-6">
            {activeTab === 'xlsform'   && <XLSFormTab />}
            {activeTab === 'kobo'      && <KoboTab />}
            {activeTab === 'surveycto' && <SurveyCTOTab />}
            {activeTab === 'odk'       && <ODKTab />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── XLSForm tab ───────────────────────────────────────────────────────────────

function XLSFormTab() {
  const [parsed, setParsed] = useState<{ title: string; schema: ParsedSchema; warnings: string[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true); setError(''); setParsed(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const { data: res } = await api.post('/migration/xlsform/parse', fd)
      setParsed({ title: res.title, schema: res.json_schema, warnings: res.warnings })
    } catch (err: any) {
      setError(errMsg(err, 'Parse failed'))
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!parsed) return
    setSaving(true); setError('')
    try {
      const { data: res } = await api.post('/migration/xlsform/save', { title: parsed.title, json_schema: parsed.schema })
      setSuccess(`Form "${res.title}" saved as draft! Form ID: ${res.id}`)
      setParsed(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (err: any) {
      setError(errMsg(err, 'Save failed'))
    } finally {
      setSaving(false)
    }
  }

  if (parsed) {
    return (
      <FormPreview
        title={parsed.title}
        schema={parsed.schema}
        warnings={parsed.warnings}
        sectionCount={parsed.schema.sections.length}
        fieldCount={countFields(parsed.schema.sections)}
        onSave={handleSave}
        onBack={() => { setParsed(null); if (fileRef.current) fileRef.current.value = '' }}
        saving={saving}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-catalan-text mb-1">Upload XLSForm</h3>
        <p className="text-sm text-catalan-textMuted">Standard XLSForm format used by ODK, KoboToolbox, SurveyCTO, and others.</p>
      </div>

      <a
        href="/FieldGovern_Form_Template.xlsx"
        download
        className="flex items-center gap-2 rounded-lg border border-catalan-primary/40 bg-catalan-primary/5 px-4 py-3 text-sm font-medium text-catalan-primary hover:bg-catalan-primary/10 transition-colors"
      >
        <EmojiIcon e="⬇️" /> Download starter template (.xlsx) — one example row per field type
      </a>

      <label className="block border-2 border-dashed border-catalan-border rounded-xl p-10 text-center cursor-pointer hover:border-catalan-primary transition-colors group">
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
        <div className="text-4xl mb-3"><EmojiIcon e="📄" /></div>
        <p className="font-semibold text-catalan-text group-hover:text-catalan-primary">Click to select XLSForm file</p>
        <p className="text-sm text-catalan-textMuted mt-1">.xlsx or .xls · max 20 MB</p>
      </label>

      {loading && <p className="text-center text-catalan-textMuted text-sm animate-pulse">Parsing XLSForm…</p>}
      {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg p-3"><EmojiIcon e="❌" /> {error}</p>}
      {success && <p className="text-green-700 text-sm bg-green-50 border border-green-200 rounded-lg p-3"><EmojiIcon e="✅" /> {success}</p>}

      <div className="bg-catalan-bg rounded-xl p-4 text-sm text-catalan-textMuted space-y-1">
        <p className="font-semibold text-catalan-text">Supported field types</p>
        <p>text · integer · decimal · date · time · select_one · select_multiple · geopoint · image · audio · barcode · calculate · note · range · begin/end_group · begin/end_repeat</p>
      </div>
    </div>
  )
}

// ── Kobo tab ──────────────────────────────────────────────────────────────────

function KoboTab() {
  const [server, setServer] = useState('https://kf.kobotoolbox.org')
  const [token, setToken] = useState('')
  const [forms, setForms] = useState<PlatformForm[]>([])
  const [connecting, setConnecting] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [importData, setImportData] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<Record<string, any>>({})

  async function connect() {
    setConnecting(true); setError(''); setForms([])
    try {
      const { data: res } = await api.post('/migration/kobo/connect', { server, token })
      setForms(res.forms)
    } catch (err: any) { setError(err.message || 'Connection failed') }
    finally { setConnecting(false) }
  }

  async function importForm(uid: string) {
    setImporting(uid); setError('')
    try {
      const { data: res } = await api.post('/migration/kobo/import', { server, token, asset_uid: uid, import_submissions: importData })
      setResults(prev => ({ ...prev, [uid]: res }))
    } catch (err: any) { setError(err.message || 'Import failed') }
    finally { setImporting(null) }
  }

  return (
    <PlatformTab
      platformName="KoboToolbox"
      serverLabel="Server URL"
      serverPlaceholder="https://kf.kobotoolbox.org"
      server={server} onServerChange={setServer}
      authFields={<Input label="API Token" value={token} onChange={setToken} placeholder="Your KoboToolbox API token" type="password" />}
      onConnect={connect} connecting={connecting}
      forms={forms} importing={importing} importData={importData}
      onImportDataChange={setImportData} onImport={f => importForm(f.uid || f.id || '')}
      results={results} error={error}
      tokenHint="Get your token: KoboToolbox → Account Settings → API token"
    />
  )
}

// ── SurveyCTO tab ─────────────────────────────────────────────────────────────

function SurveyCTOTab() {
  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [forms, setForms] = useState<PlatformForm[]>([])
  const [connecting, setConnecting] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [importData, setImportData] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<Record<string, any>>({})

  async function connect() {
    setConnecting(true); setError(''); setForms([])
    try {
      const { data: res } = await api.post('/migration/surveycto/connect', { server, username, password })
      setForms(res.forms)
    } catch (err: any) { setError(err.message || 'Connection failed') }
    finally { setConnecting(false) }
  }

  async function importForm(id: string) {
    setImporting(id); setError('')
    try {
      const { data: res } = await api.post('/migration/surveycto/import', { server, username, password, form_id: id, import_submissions: importData })
      setResults(prev => ({ ...prev, [id]: res }))
    } catch (err: any) { setError(err.message || 'Import failed') }
    finally { setImporting(null) }
  }

  return (
    <PlatformTab
      platformName="SurveyCTO"
      serverLabel="Server name or URL"
      serverPlaceholder="yourserver or https://yourserver.surveycto.com"
      server={server} onServerChange={setServer}
      authFields={
        <>
          <Input label="Username" value={username} onChange={setUsername} placeholder="SurveyCTO login email" />
          <Input label="Password" value={password} onChange={setPassword} type="password" placeholder="••••••••" />
        </>
      }
      onConnect={connect} connecting={connecting}
      forms={forms} importing={importing} importData={importData}
      onImportDataChange={setImportData} onImport={f => importForm(f.id || '')}
      results={results} error={error}
      tokenHint="Use your SurveyCTO console login credentials."
    />
  )
}

// ── ODK tab ───────────────────────────────────────────────────────────────────

function ODKTab() {
  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [projectId, setProjectId] = useState('')
  const [forms, setForms] = useState<PlatformForm[]>([])
  const [connecting, setConnecting] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [importData, setImportData] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<Record<string, any>>({})

  async function connect() {
    setConnecting(true); setError(''); setForms([])
    try {
      const { data: res } = await api.post('/migration/odk/connect', { server, username, password, project_id: parseInt(projectId) })
      setForms(res.forms)
    } catch (err: any) { setError(err.message || 'Connection failed') }
    finally { setConnecting(false) }
  }

  async function importForm(id: string) {
    setImporting(id); setError('')
    try {
      const { data: res } = await api.post('/migration/odk/import', { server, username, password, project_id: parseInt(projectId), form_id: id, import_submissions: importData })
      setResults(prev => ({ ...prev, [id]: res }))
    } catch (err: any) { setError(err.message || 'Import failed') }
    finally { setImporting(null) }
  }

  return (
    <PlatformTab
      platformName="ODK Central"
      serverLabel="Server URL"
      serverPlaceholder="https://your-odk-server.com"
      server={server} onServerChange={setServer}
      authFields={
        <>
          <Input label="Email" value={username} onChange={setUsername} placeholder="admin@example.com" />
          <Input label="Password" value={password} onChange={setPassword} type="password" placeholder="••••••••" />
          <Input label="Project ID" value={projectId} onChange={setProjectId} placeholder="1" />
        </>
      }
      onConnect={connect} connecting={connecting}
      forms={forms} importing={importing} importData={importData}
      onImportDataChange={setImportData} onImport={f => importForm(f.id || '')}
      results={results} error={error}
      tokenHint="Find your Project ID in ODK Central → Projects → the number in the URL."
    />
  )
}

// ── shared platform UI ────────────────────────────────────────────────────────

interface PlatformTabProps {
  platformName: string
  serverLabel: string
  serverPlaceholder: string
  server: string
  onServerChange: (v: string) => void
  authFields: React.ReactNode
  onConnect: () => void
  connecting: boolean
  forms: PlatformForm[]
  importing: string | null
  importData: boolean
  onImportDataChange: (v: boolean) => void
  onImport: (form: PlatformForm) => void
  results: Record<string, any>
  error: string
  tokenHint: string
}

function PlatformTab({
  platformName, serverLabel, serverPlaceholder, server, onServerChange,
  authFields, onConnect, connecting, forms, importing, importData,
  onImportDataChange, onImport, results, error, tokenHint,
}: PlatformTabProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-catalan-text mb-1">Connect to {platformName}</h3>
        <p className="text-xs text-catalan-textMuted">{tokenHint}</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <Input label={serverLabel} value={server} onChange={onServerChange} placeholder={serverPlaceholder} />
        {authFields}
      </div>

      <button
        onClick={onConnect}
        disabled={connecting}
        className="w-full py-2.5 rounded-lg bg-catalan-primary text-white font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {connecting ? 'Connecting…' : `Connect to ${platformName}`}
      </button>

      {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg p-3"><EmojiIcon e="❌" /> {error}</p>}

      {forms.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-catalan-text text-sm">{forms.length} form{forms.length !== 1 ? 's' : ''} found</p>
            <label className="flex items-center gap-2 text-sm text-catalan-text cursor-pointer">
              <input type="checkbox" checked={importData} onChange={e => onImportDataChange(e.target.checked)} className="rounded" />
              Import historical submissions
            </label>
          </div>

          <div className="space-y-2">
            {forms.map((form, i) => {
              const fid = form.uid || form.id || String(i)
              const result = results[fid]
              return (
                <div key={fid} className="flex items-center justify-between p-3 rounded-xl border border-catalan-border bg-catalan-bg hover:border-catalan-primary/40 transition-colors">
                  <div>
                    <p className="font-medium text-catalan-text text-sm">{form.name || form.title}</p>
                    <p className="text-xs text-catalan-textMuted">
                      {form.submission_count !== undefined ? `${form.submission_count} submissions` : ''}
                      {form.date_modified || form.date_updated ? ` · ${(form.date_modified || form.date_updated || '').slice(0, 10)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {result && (
                      <span className="text-xs text-green-600 font-medium">
                        <EmojiIcon e="✅" /> {result.submissions_imported > 0 ? `+${result.submissions_imported} subs` : 'imported'}
                      </span>
                    )}
                    <button
                      onClick={() => onImport(form)}
                      disabled={importing === fid || !!result}
                      className="px-3 py-1.5 rounded-lg bg-catalan-primary text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
                    >
                      {importing === fid ? '…' : result ? 'Done' : 'Import'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
