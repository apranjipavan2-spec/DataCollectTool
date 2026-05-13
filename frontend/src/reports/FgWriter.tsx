import { useState, useEffect, useCallback, ReactNode } from 'react'
import api, { getStoredUser } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'
import { useToast } from '@/lib/ToastContext'
import { useAiJob } from '@/lib/useAiJob'
import AiProgressBar from '@/components/AiProgressBar'
import {
  loadTabulations, loadTabulationsCache, loadWriterTables, loadReports, saveReport, deleteReport,
  getLastProgram, setLastProgram,
  type SavedTabulation, type SavedReport,
} from '@/lib/fgStorage'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Program { id: string; name: string; scheme_name: string; start_date: string | null; end_date: string | null }

// ── Shared styles ─────────────────────────────────────────────────────────────

const card  = 'bg-catalan-surface border border-catalan-border rounded-xl p-5'
const sh    = 'text-xs font-semibold text-catalan-textMuted uppercase tracking-wider mb-3'
const btnPr = 'px-4 py-2 bg-catalan-primary text-catalan-bg rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40'
const btnSe = 'px-3 py-1.5 text-sm border border-catalan-border rounded-lg text-catalan-text hover:bg-catalan-hover transition-colors disabled:opacity-40'
const btnDa = 'px-3 py-1.5 text-sm border border-catalan-error/30 text-catalan-error rounded-lg hover:bg-catalan-error/10 transition-colors'
const sel   = 'border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text focus:ring-2 focus:ring-catalan-primary outline-none'
const inp   = 'border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text placeholder:text-catalan-textMuted focus:ring-2 focus:ring-catalan-primary outline-none'

const STYLES = [
  { key: 'field_survey', label: 'Field Survey' },
  { key: 'progress',     label: 'Progress'     },
  { key: 'research',     label: 'Research'      },
  { key: 'government',   label: 'Government'    },
  { key: 'ngo',          label: 'NGO / Donor'   },
  { key: 'medical',      label: 'Medical'       },
]

// ── Program picker ─────────────────────────────────────────────────────────────

function ProgramPicker({ value, onChange, size = 'normal' }: { value: string; onChange: (id: string, prog: Program | null) => void; size?: 'normal' | 'large' }) {
  const [programs, setPrograms] = useState<Program[]>([])
  useEffect(() => { api.get('/programs/').then(r => setPrograms(Array.isArray(r.data) ? r.data : [])).catch(() => {}) }, [])
  return (
    <select className={size === 'large' ? `${sel} w-full py-3 text-base` : `${sel} min-w-[220px]`} value={value}
      onChange={e => {
        const p = programs.find(p => p.id === e.target.value) ?? null
        onChange(e.target.value, p)
        setLastProgram(e.target.value)
      }}>
      <option value="">— Select a program —</option>
      {programs.map(p => <option key={p.id} value={p.id}>{p.name}{p.scheme_name ? ` · ${p.scheme_name}` : ''}</option>)}
    </select>
  )
}

// ── Tabulation preview card ───────────────────────────────────────────────────

function TabPreview({ tab, selected, onToggle }: { tab: SavedTabulation; selected?: boolean; onToggle?: () => void }) {
  return (
    <div
      onClick={onToggle}
      className={`border rounded-lg p-3 transition-all ${onToggle ? 'cursor-pointer' : ''} ${
        selected ? 'border-catalan-primary bg-catalan-primary/5 shadow-sm' : 'border-catalan-border bg-catalan-hover/30'
      }`}
    >
      <div className="flex items-start gap-2 mb-1.5">
        {onToggle && (
          <div className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
            selected ? 'border-catalan-primary bg-catalan-primary' : 'border-catalan-border'
          }`}>
            {selected && <span className="text-[9px] text-white font-bold">✓</span>}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-catalan-text">{tab.title}</div>
            <span className="text-xs text-catalan-textMuted">{tab.rows.length} groups · {tab.total} records</span>
          </div>
          <div className="text-xs text-catalan-textMuted mt-0.5 mb-2">{tab.description}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-catalan-border">
                {tab.rows.slice(0, 5).map((r, i) => (
                  <tr key={i}>
                    <td className="py-1 text-catalan-textMuted">{r.group}</td>
                    <td className="py-1 text-right font-semibold text-catalan-primary">{r.value}</td>
                  </tr>
                ))}
                {tab.rows.length > 5 && <tr><td colSpan={2} className="py-1 text-catalan-textMuted italic">…{tab.rows.length - 5} more rows</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Lightweight markdown preview ─────────────────────────────────────────────

function fmtInline(text: string): ReactNode {
  const parts = text.split(/\*\*([^*]+)\*\*/)
  return parts.map((p, i) => i % 2 === 1 ? <strong key={i}>{p}</strong> : p)
}

function MarkdownPreview({ md }: { md: string }) {
  const blocks = md.split(/\n{2,}/)
  return (
    <div className="text-catalan-text text-sm leading-relaxed space-y-3" style={{ fontFamily: 'Georgia, serif' }}>
      {blocks.map((block, i) => {
        const t = block.trim()
        if (!t) return null
        if (t === '---') return <hr key={i} className="border-catalan-border my-2" />
        if (t.startsWith('### ')) return <h3 key={i} className="text-base font-semibold mt-4">{fmtInline(t.slice(4))}</h3>
        if (t.startsWith('## '))  return <h2 key={i} className="text-lg font-bold border-b border-catalan-border pb-1 mt-5">{fmtInline(t.slice(3))}</h2>
        if (t.startsWith('# '))   return <h1 key={i} className="text-xl font-bold mt-5">{fmtInline(t.slice(2))}</h1>
        const lines = t.split('\n')
        const listItems = lines.filter(l => /^[-*] /.test(l))
        if (listItems.length > 0 && listItems.length === lines.length) {
          return (
            <ul key={i} className="list-disc list-inside space-y-1 ml-3">
              {listItems.map((l, j) => <li key={j}>{fmtInline(l.slice(2))}</li>)}
            </ul>
          )
        }
        const hasReview = t.includes('[REVIEW NEEDED]')
        return (
          <p key={i}>
            {hasReview
              ? <>{fmtInline(t.replace('[REVIEW NEEDED]', ''))}<span className="ml-1 px-1.5 py-0.5 text-xs rounded bg-yellow-500/20 text-yellow-500 font-medium">REVIEW NEEDED</span></>
              : fmtInline(t)}
          </p>
        )
      })}
    </div>
  )
}

// ── Report version card ───────────────────────────────────────────────────────

function ReportVersionCard({ report, onRestore, onDelete }: {
  report: SavedReport; onRestore: (r: SavedReport) => void; onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="border border-catalan-border rounded-xl p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-catalan-text">{report.label}</div>
          <div className="text-xs text-catalan-textMuted mt-0.5">
            {report.style} · {new Date(report.created_at).toLocaleString()}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setExpanded(e => !e)} className={btnSe}>{expanded ? 'Hide' : 'Preview'}</button>
          <button onClick={() => onRestore(report)} className={btnSe}>Restore</button>
          <button onClick={onDelete} className={btnDa}>Delete</button>
        </div>
      </div>
      {expanded && (
        <pre className="mt-3 text-xs text-catalan-textMuted whitespace-pre-wrap leading-relaxed bg-catalan-bg rounded-lg p-3 max-h-48 overflow-y-auto font-mono">
          {report.content.slice(0, 2000)}{report.content.length > 2000 ? '\n\n…[truncated]' : ''}
        </pre>
      )}
    </div>
  )
}

// ── Schedule Modal ────────────────────────────────────────────────────────────

interface ScheduledReport {
  id: string; name: string; program_id: string | null; style: string
  frequency: string; send_hour: string; send_dow: string | null
  recipient_emails: string[]; is_active: boolean; last_sent_at: string | null
}

function ScheduleModal({ programId, programName, style, onClose }: {
  programId: string; programName: string; style: string; onClose: () => void
}) {
  const toast = useToast()
  const [schedules, setSchedules] = useState<ScheduledReport[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: `${programName} Report`,
    frequency: 'weekly',
    send_hour: '7',
    send_dow: '1',
    recipient_emails_raw: '',
    style,
  })

  useEffect(() => {
    api.get('/scheduled-reports/').then(r => setSchedules(r.data)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const save = async () => {
    const emails = form.recipient_emails_raw.split(',').map(e => e.trim()).filter(Boolean)
    if (!emails.length) { toast.error('Add at least one recipient email'); return }
    setSaving(true)
    try {
      await api.post('/scheduled-reports/', {
        name: form.name,
        program_id: programId || null,
        style: form.style,
        frequency: form.frequency,
        send_hour: parseInt(form.send_hour),
        send_dow: form.frequency === 'weekly' ? parseInt(form.send_dow) : null,
        recipient_emails: emails,
      })
      const r = await api.get('/scheduled-reports/')
      setSchedules(r.data)
      toast.success('Schedule created')
      setForm(f => ({ ...f, recipient_emails_raw: '', name: `${programName} Report` }))
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to save')
    } finally { setSaving(false) }
  }

  const toggle = async (sr: ScheduledReport) => {
    try {
      await api.patch(`/scheduled-reports/${sr.id}`, { is_active: !sr.is_active })
      setSchedules(prev => prev.map(s => s.id === sr.id ? { ...s, is_active: !sr.is_active } : s))
    } catch { toast.error('Failed to update') }
  }

  const remove = async (sr: ScheduledReport) => {
    if (!confirm(`Delete "${sr.name}"?`)) return
    try {
      await api.delete(`/scheduled-reports/${sr.id}`)
      setSchedules(prev => prev.filter(s => s.id !== sr.id))
    } catch { toast.error('Failed to delete') }
  }

  const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
  const f = (k: keyof typeof form, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-catalan-surface rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-catalan-text">Schedule Report Delivery</h2>
            <button onClick={onClose} className="text-catalan-textMuted hover:text-catalan-text">✕</button>
          </div>

          {/* New schedule form */}
          <div className="space-y-3">
            <div>
              <div className="text-xs text-catalan-textMuted mb-1">Schedule name</div>
              <input className={inp} value={form.name} onChange={e => f('name', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-catalan-textMuted mb-1">Frequency</div>
                <select className={sel} value={form.frequency} onChange={e => f('frequency', e.target.value)}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly (1st)</option>
                </select>
              </div>
              <div>
                <div className="text-xs text-catalan-textMuted mb-1">Send at (UTC hour)</div>
                <select className={sel} value={form.send_hour} onChange={e => f('send_hour', e.target.value)}>
                  {[0,4,6,7,8,9,10,12,14,16,18,20].map(h => (
                    <option key={h} value={String(h)}>{String(h).padStart(2,'0')}:00 UTC</option>
                  ))}
                </select>
              </div>
            </div>
            {form.frequency === 'weekly' && (
              <div>
                <div className="text-xs text-catalan-textMuted mb-1">Day of week</div>
                <select className={sel} value={form.send_dow} onChange={e => f('send_dow', e.target.value)}>
                  {DOW.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}
                </select>
              </div>
            )}
            <div>
              <div className="text-xs text-catalan-textMuted mb-1">Recipient emails (comma-separated)</div>
              <input className={inp} value={form.recipient_emails_raw}
                onChange={e => f('recipient_emails_raw', e.target.value)}
                placeholder="admin@org.com, boss@org.com" />
            </div>
          </div>

          <button onClick={save} disabled={saving}
            className={`${btnPr} w-full`}>
            {saving ? 'Saving…' : 'Create Schedule'}
          </button>

          {/* Existing schedules */}
          {!loading && schedules.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wider pt-2 border-t border-catalan-border">
                Active Schedules
              </div>
              {schedules.map(sr => (
                <div key={sr.id} className="flex items-start justify-between p-3 bg-catalan-hover rounded-lg gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-catalan-text truncate">{sr.name}</div>
                    <div className="text-xs text-catalan-textMuted mt-0.5">
                      {sr.frequency} · {String(sr.send_hour).padStart(2,'0')}:00 UTC
                      {sr.frequency === 'weekly' && sr.send_dow ? ` · ${DOW[parseInt(sr.send_dow)]}` : ''}
                      · {sr.recipient_emails.length} recipient{sr.recipient_emails.length !== 1 ? 's' : ''}
                    </div>
                    {sr.last_sent_at && (
                      <div className="text-xs text-catalan-textMuted mt-0.5">
                        Last sent: {new Date(sr.last_sent_at).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => toggle(sr)}
                      className={`text-xs px-2 py-1 rounded border font-medium transition-colors ${sr.is_active ? 'border-green-400/30 text-green-500 hover:bg-green-500/10' : 'border-catalan-border text-catalan-textMuted hover:text-catalan-text'}`}>
                      {sr.is_active ? 'Active' : 'Paused'}
                    </button>
                    <button onClick={() => remove(sr)} className="text-xs text-catalan-error hover:underline">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FgWriter() {
  const user    = getStoredUser()
  const toast   = useToast()

  const [programId, setProgramId] = useState(getLastProgram())
  const [prog, setProg]           = useState<Program | null>(null)
  const [tabulations, setTabulations] = useState<SavedTabulation[]>([])
  const [selectedTabIds, setSelectedTabIds] = useState<Set<string>>(new Set())
  const [versions, setVersions]   = useState<SavedReport[]>([])

  // Writer form
  const [style, setStyle]               = useState('field_survey')
  const [dateRange, setDateRange]       = useState('')
  const [customContext, setCustomContext] = useState('')
  const [reportMd, setReportMd]         = useState('')
  const [copied, setCopied]             = useState(false)
  const [previewMode, setPreviewMode]   = useState(false)
  const [showSchedule, setShowSchedule] = useState(false)

  const writerJob = useAiJob({ storageKey: `ai_writer_${programId || 'none'}` })

  const applyTabulations = (tabs: SavedTabulation[]) => {
    setTabulations(tabs)
    setSelectedTabIds(new Set(tabs.map(t => t.id)))
  }

  const reload = useCallback(() => {
    if (!programId) return
    const cached = loadTabulationsCache(programId)
    applyTabulations(cached)
    loadWriterTables(programId).then(applyTabulations).catch(() => {})
    setVersions(loadReports(programId))
  }, [programId])

  useEffect(() => { reload() }, [reload])

  // Capture result when job completes
  useEffect(() => {
    if (writerJob.job?.status === 'done' && writerJob.job.result) {
      setReportMd(writerJob.job.result)
    }
  }, [writerJob.job?.status, writerJob.job?.result])

  const onProgramChange = (id: string, p: Program | null) => {
    setProgramId(id); setProg(p)
    setReportMd('')
    writerJob.reset()
    if (id) {
      const cached = loadTabulationsCache(id)
      applyTabulations(cached)
      loadWriterTables(id).then(applyTabulations).catch(() => {})
      setVersions(loadReports(id))
    }
    if (p?.start_date || p?.end_date) {
      const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
      setDateRange([p.start_date && fmt(p.start_date), p.end_date && fmt(p.end_date)].filter(Boolean).join(' – '))
    }
  }

  const toggleTab = (id: string) => {
    setSelectedTabIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const generate = async () => {
    if (!programId) { toast.error('Select a program first'); return }
    const activeTabs = tabulations.filter(t => selectedTabIds.has(t.id))
    if (tabulations.length > 0 && activeTabs.length === 0) {
      toast.error('Select at least one table to narrate'); return
    }
    const tabulationData = activeTabs.length
      ? activeTabs.map(t =>
          `### ${t.title}\n${t.description}\n\n` +
          t.rows.slice(0, 30).map(r => `${r.group}: ${r.value}`).join('\n') +
          (t.interpretation ? `\n\n**Interpretation:** ${t.interpretation}` : '')
        ).join('\n\n---\n\n')
      : ''
    setReportMd('')
    try {
      await writerJob.startJob(() => api.post(`/fg/programs/${programId}/writer/generate`, {
        style, date_range: dateRange, custom_context: customContext, tabulation_data: tabulationData,
      }))
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to start report generation')
    }
  }

  const saveCurrentReport = () => {
    if (!reportMd || !programId) return
    const versionNum = versions.length + 1
    const label = `v${versionNum} — ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
    const report: SavedReport = {
      id: crypto.randomUUID(),
      label,
      style,
      content: reportMd,
      created_at: new Date().toISOString(),
    }
    saveReport(programId, report)
    // Also persist to server so it appears in File Manager
    api.post('/tool-projects/', {
      tool: 'writer',
      name: `${prog?.name || 'Report'} — ${label}`,
      program_id: programId,
      data: { content: reportMd, style, label, created_at: report.created_at },
    }).catch(() => {})
    reload()
    toast.success('Report version saved')
  }

  const copyMarkdown = async () => {
    await navigator.clipboard.writeText(reportMd)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const downloadDocx = async () => {
    try {
      const res = await api.post('/ai/writer/export-docx', {
        report_md: reportMd,
        title: prog?.name || 'Program Report',
      }, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a'); a.href = url
      a.download = `${prog?.name || 'report'}.docx`; a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Word export failed') }
  }

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={getNavItems(user?.role ?? '')} role={user?.role} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav
          title="FG Writer"
          breadcrumbs={[{ label: 'FG Writer' }]}
          rightContent={
            <ProgramPicker value={programId} onChange={onProgramChange} />
          }
        />
        <main className="flex-1 overflow-auto">
          <div className="p-6 space-y-5">

            {!programId && (
              <div className={card}>
                <div className="flex flex-col items-center text-center py-6">
                  <div className="text-5xl mb-4">✍️</div>
                  <h2 className="text-base font-semibold text-catalan-text mb-2">Step 1 — Select a Program</h2>
                  <p className="text-sm text-catalan-textMuted mb-5 max-w-sm">Choose the program you want to generate a report for. The Writer will use your saved Analyzer tables as data.</p>
                  <div className="w-full max-w-xs">
                    <ProgramPicker value={programId} onChange={onProgramChange} size="large" />
                  </div>
                </div>
              </div>
            )}

            {/* Launch banner */}
            {programId && (
              <div className="mb-5 bg-catalan-surface border border-catalan-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1">
                  <div className="text-base font-semibold text-catalan-text mb-1">FG Writer — AI Report Generator</div>
                  <p className="text-sm text-catalan-textMuted leading-relaxed">
                    Generate a structured, publication-ready report from your program's data and saved tabulations. Choose a report style (field survey, government, NGO, research), add context, and export to Word. Build your tables in FG Analyzer first for best results.
                  </p>
                </div>
                <a
                  href="/fg/analyzer"
                  className="shrink-0 px-5 py-2.5 border border-catalan-border text-catalan-text rounded-lg text-sm font-semibold hover:bg-catalan-hover transition-colors whitespace-nowrap"
                >
                  Build Tables in Analyzer →
                </a>
              </div>
            )}

            {programId && (
              <>
                {/* Step 2 — Select tables */}
                <div className={card}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className={sh + ' mb-0'}>Step 2 — Select Tables to Narrate</div>
                      {tabulations.length > 0 && (
                        <p className="text-xs text-catalan-textMuted mt-1">
                          {selectedTabIds.size} of {tabulations.length} selected
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {tabulations.length > 0 && (
                        <>
                          <button onClick={() => setSelectedTabIds(new Set(tabulations.map(t => t.id)))} className={btnSe}>All</button>
                          <button onClick={() => setSelectedTabIds(new Set())} className={btnSe}>None</button>
                        </>
                      )}
                      <button onClick={reload} className={btnSe}>↻ Refresh</button>
                    </div>
                  </div>
                  {tabulations.length === 0 ? (
                    <p className="text-sm text-catalan-textMuted">
                      No saved tabulations found for this program.
                      Go to <strong>FG Analyzer</strong> → Tabulator tab to build tables first — the Writer will automatically use them.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {tabulations.map(t => (
                        <TabPreview key={t.id} tab={t}
                          selected={selectedTabIds.has(t.id)}
                          onToggle={() => toggleTab(t.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Step 3 — Report config */}
                <div className={card}>
                  <div className={sh}>Step 3 — Report Settings</div>
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs text-catalan-textMuted block mb-2">Report Style</label>
                      <div className="flex flex-wrap gap-2">
                        {STYLES.map(s => (
                          <button key={s.key} onClick={() => setStyle(s.key)}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                              style === s.key
                                ? 'bg-catalan-primary text-catalan-bg border-catalan-primary'
                                : 'bg-catalan-hover text-catalan-text border-catalan-border hover:border-catalan-primary/50'
                            }`}>
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-catalan-textMuted block mb-1">Date / Study period</label>
                      <input className={`${inp} w-full`} value={dateRange} onChange={e => setDateRange(e.target.value)}
                        placeholder="e.g. Jan 2025 – Mar 2025" />
                    </div>
                    <div>
                      <label className="text-xs text-catalan-textMuted block mb-1">Additional context (optional)</label>
                      <textarea className={`${inp} w-full resize-y`} rows={3}
                        value={customContext} onChange={e => setCustomContext(e.target.value)}
                        placeholder="Background, geography, target population, objectives, special notes…" />
                    </div>
                  </div>
                </div>

                {!writerJob.isRunning && writerJob.job?.status !== 'done' && (
                  <button onClick={generate} disabled={writerJob.isRunning} className={`${btnPr} w-full py-3 text-base`}>
                    {selectedTabIds.size > 0
                      ? `✨ Narrate ${selectedTabIds.size} Table${selectedTabIds.size > 1 ? 's' : ''}`
                      : '✨ Generate AI Report'}
                  </button>
                )}

                <AiProgressBar
                  job={writerJob.job}
                  label="Report generation"
                  onReset={() => { writerJob.reset(); setReportMd('') }}
                />

                {/* Report output */}
                {reportMd && (
                  <div className={card}>
                    <div className="flex items-center justify-between mb-3">
                      <div className={sh + ' mb-0'}>Generated Report</div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setPreviewMode(p => !p)}
                          className={`${btnSe} ${previewMode ? 'border-catalan-primary text-catalan-primary' : ''}`}
                        >
                          {previewMode ? 'Edit' : 'Preview'}
                        </button>
                        <button onClick={saveCurrentReport} className={btnSe}>Save Version</button>
                        <button onClick={downloadDocx} className={btnSe}>Download Word</button>
                        <button onClick={copyMarkdown} className={btnSe}>{copied ? '✓ Copied' : 'Copy MD'}</button>
                        {programId && <button onClick={() => setShowSchedule(true)} className={btnSe}>Schedule</button>}
                      </div>
                    </div>
                    {previewMode ? (
                      <div className="min-h-[540px] p-1">
                        <MarkdownPreview md={reportMd} />
                      </div>
                    ) : (
                      <textarea
                        value={reportMd}
                        onChange={e => setReportMd(e.target.value)}
                        style={{ fontFamily: 'Georgia, serif', whiteSpace: 'pre-wrap' }}
                        className={`${inp} w-full min-h-[540px] resize-y leading-relaxed`}
                      />
                    )}
                  </div>
                )}

                {/* Version history */}
                {versions.length > 0 && (
                  <div className={card}>
                    <div className={sh}>Report Version History ({versions.length})</div>
                    <div className="space-y-3">
                      {versions.map(v => (
                        <ReportVersionCard key={v.id} report={v}
                          onRestore={r => setReportMd(r.content)}
                          onDelete={() => {
                            deleteReport(programId, v.id)
                            reload()
                            toast.success('Version deleted')
                          }} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>
      {showSchedule && programId && (
        <ScheduleModal
          programId={programId}
          programName={prog?.name ?? 'Program'}
          style={style}
          onClose={() => setShowSchedule(false)}
        />
      )}
    </div>
  )
}
