import { useState, useEffect, useCallback } from 'react'
import api, { getStoredUser } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'
import { useToast } from '@/lib/ToastContext'
import {
  loadTabulations, loadReports, saveReport, deleteReport,
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

function ProgramPicker({ value, onChange }: { value: string; onChange: (id: string, prog: Program | null) => void }) {
  const [programs, setPrograms] = useState<Program[]>([])
  useEffect(() => { api.get('/programs/').then(r => setPrograms(r.data)).catch(() => {}) }, [])
  return (
    <select className={`${sel} min-w-[220px]`} value={value}
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

function TabPreview({ tab }: { tab: SavedTabulation }) {
  return (
    <div className="border border-catalan-border rounded-lg p-3 bg-catalan-hover/30">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-sm font-medium text-catalan-text">{tab.title}</div>
        <span className="text-xs text-catalan-textMuted">{tab.rows.length} groups · {tab.total} records</span>
      </div>
      <div className="text-xs text-catalan-textMuted mb-2">{tab.description}</div>
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FgWriter() {
  const user    = getStoredUser()
  const toast   = useToast()

  const [programId, setProgramId] = useState(getLastProgram())
  const [prog, setProg]           = useState<Program | null>(null)
  const [tabulations, setTabulations] = useState<SavedTabulation[]>([])
  const [versions, setVersions]   = useState<SavedReport[]>([])

  // Writer form
  const [style, setStyle]               = useState('field_survey')
  const [dateRange, setDateRange]       = useState('')
  const [customContext, setCustomContext] = useState('')
  const [reportMd, setReportMd]         = useState('')
  const [generating, setGenerating]     = useState(false)
  const [error, setError]               = useState('')
  const [copied, setCopied]             = useState(false)

  const reload = useCallback(() => {
    if (!programId) return
    setTabulations(loadTabulations(programId))
    setVersions(loadReports(programId))
  }, [programId])

  useEffect(() => { reload() }, [reload])

  const onProgramChange = (id: string, p: Program | null) => {
    setProgramId(id); setProg(p)
    setReportMd(''); setError('')
    if (id) {
      setTabulations(loadTabulations(id))
      setVersions(loadReports(id))
    }
    // pre-fill date range from program
    if (p?.start_date || p?.end_date) {
      const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
      setDateRange([p.start_date && fmt(p.start_date), p.end_date && fmt(p.end_date)].filter(Boolean).join(' – '))
    }
  }

  const generate = async () => {
    if (!programId) { toast.error('Select a program first'); return }
    setGenerating(true); setError('')
    try {
      // Serialize saved tabulations as structured context
      const tabulationData = tabulations.length
        ? tabulations.map(t =>
            `### ${t.title}\n${t.description}\n\n` +
            t.rows.slice(0, 30).map(r => `${r.group}: ${r.value}`).join('\n')
          ).join('\n\n---\n\n')
        : ''

      const res = await api.post(`/fg/programs/${programId}/writer/generate`, {
        style,
        date_range: dateRange,
        custom_context: customContext,
        tabulation_data: tabulationData,
      })
      setReportMd(res.data.report_md || '')
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Report generation failed — check AI config')
    } finally {
      setGenerating(false)
    }
  }

  const saveCurrentReport = () => {
    if (!reportMd || !programId) return
    const versionNum = versions.length + 1
    const report: SavedReport = {
      id: crypto.randomUUID(),
      label: `v${versionNum} — ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
      style,
      content: reportMd,
      created_at: new Date().toISOString(),
    }
    saveReport(programId, report)
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
          <div className="max-w-4xl mx-auto p-6 space-y-5">

            {!programId && (
              <div className="flex flex-col items-center justify-center h-64 text-catalan-textMuted">
                <div className="text-5xl mb-4">✍️</div>
                <p className="text-sm font-medium">Select a program to generate an AI-powered report</p>
                <p className="text-xs mt-2 text-catalan-textMuted/70">Build tabulations first in FG Analyzer — the Writer will use them as data</p>
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
                {/* Tabulations from Analyzer */}
                <div className={card}>
                  <div className="flex items-center justify-between mb-3">
                    <div className={sh + ' mb-0'}>Data from FG Analyzer ({tabulations.length} tables)</div>
                    <button onClick={reload} className={btnSe}>Refresh</button>
                  </div>
                  {tabulations.length === 0 ? (
                    <p className="text-sm text-catalan-textMuted">
                      No saved tabulations found for this program.
                      Go to <strong>FG Analyzer</strong> → Tabulator tab to build tables first — the Writer will automatically use them.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {tabulations.map(t => <TabPreview key={t.id} tab={t} />)}
                    </div>
                  )}
                </div>

                {/* Report config */}
                <div className={card}>
                  <div className={sh}>Report Settings</div>
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

                <button onClick={generate} disabled={generating} className={`${btnPr} w-full py-3 text-base`}>
                  {generating ? '✨ Generating report…' : '✨ Generate AI Report'}
                </button>

                {error && (
                  <div className="p-4 rounded-xl bg-catalan-error/10 border border-catalan-error/30 text-catalan-error text-sm">{error}</div>
                )}

                {/* Report output */}
                {reportMd && (
                  <div className={card}>
                    <div className="flex items-center justify-between mb-3">
                      <div className={sh + ' mb-0'}>Generated Report</div>
                      <div className="flex gap-2">
                        <button onClick={saveCurrentReport} className={btnSe}>Save Version</button>
                        <button onClick={downloadDocx} className={btnSe}>Download Word</button>
                        <button onClick={copyMarkdown} className={btnSe}>{copied ? '✓ Copied' : 'Copy MD'}</button>
                      </div>
                    </div>
                    <textarea
                      value={reportMd}
                      onChange={e => setReportMd(e.target.value)}
                      style={{ fontFamily: 'Georgia, serif', whiteSpace: 'pre-wrap' }}
                      className={`${inp} w-full min-h-[540px] resize-y leading-relaxed`}
                    />
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
    </div>
  )
}
