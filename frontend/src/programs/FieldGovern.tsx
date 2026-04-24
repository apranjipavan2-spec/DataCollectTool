import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api, { getStoredUser } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'
import { useToast } from '@/lib/ToastContext'
import LineChart from '@/components/charts/LineChart'
import BarChart from '@/components/charts/BarChart'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ColHeader { id: string; label: string; type: string; options: any[] }

interface AnalyzerData {
  program_id: string; program_name: string; scheme: string
  is_panel_study: boolean; total_submissions: number
  trend: { date: string; count: number }[]
  status_counts: Record<string, number>
  enumerators: { name: string; count: number }[]
  wave_counts: { name: string; wave_number: number | null; count: number; form_id: string | null }[]
  column_headers: ColHeader[]
  quality: { total: number; flagged: number; approved: number; violations: number; quality_score: number }
}

interface CleanerItem {
  id: string; enumerator_name: string; form_title: string; status: string
  serial_no: number | null; received: string | null; issues: string[]; has_issues: boolean; household_id: string | null
}

interface CleanerData {
  total: number; page: number; page_size: number; items: CleanerItem[]
  quality_score: number
  issue_summary: Record<string, number>
}

interface Wave {
  questionnaire_id: string; name: string; wave_number: number | null
  wave_label: string | null; panel_key: string | null; form_id: string | null
}

interface AttritionData {
  is_panel_study: boolean; program_name?: string
  waves: { questionnaire_id: string; wave_number: number; wave_label: string; total: number; unique_respondents: number }[]
  transitions: { from_wave: string; to_wave: string; retained: number; lost: number; new_entrants: number; attrition_rate_pct: number }[]
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const card = 'bg-catalan-surface border border-catalan-border rounded-xl p-5'
const sectionTitle = 'text-xs font-semibold text-catalan-textMuted uppercase tracking-wider mb-3'
const btnPrimary = 'px-4 py-2 bg-catalan-primary text-catalan-bg rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40'
const btnSecondary = 'px-3 py-1.5 text-sm border border-catalan-border rounded-lg text-catalan-text hover:bg-catalan-hover transition-colors'
const selectCls = 'border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text focus:ring-2 focus:ring-catalan-primary outline-none'
const inputCls = 'border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text placeholder:text-catalan-textMuted focus:ring-2 focus:ring-catalan-primary outline-none'

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className={card}>
      <div className="text-2xl font-bold text-catalan-primary">{value}</div>
      <div className="text-sm font-medium text-catalan-text mt-0.5">{label}</div>
      {sub && <div className="text-xs text-catalan-textMuted mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Tab: Analyzer ─────────────────────────────────────────────────────────────

function AnalyzerTab({ programId }: { programId: string }) {
  const [data, setData] = useState<AnalyzerData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get(`/fg/programs/${programId}/analyzer-data`)
      .then(r => setData(r.data))
      .finally(() => setLoading(false))
  }, [programId])

  if (loading) return <div className="text-catalan-textMuted text-sm py-8 text-center">Loading analytics…</div>
  if (!data) return <div className="text-catalan-error text-sm py-8 text-center">Failed to load</div>

  const statusBars = Object.entries(data.status_counts).map(([k, v]) => ({ label: k, value: v }))
  const enumBars = data.enumerators.slice(0, 12).map(e => ({ label: e.name, value: e.count }))

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Submissions" value={data.total_submissions} />
        <StatCard label="Quality Score" value={`${data.quality.quality_score}%`} />
        <StatCard label="Flagged" value={data.quality.flagged} />
        <StatCard label="Violations" value={data.quality.violations} />
      </div>

      {/* Trend */}
      <div className={card}>
        <div className={sectionTitle}>Submission Trend (Daily)</div>
        <LineChart data={data.trend} height={200} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Status */}
        <div className={card}>
          <div className={sectionTitle}>Status Breakdown</div>
          <BarChart data={statusBars} height={180} />
        </div>

        {/* Enumerators */}
        <div className={card}>
          <div className={sectionTitle}>Enumerator Performance</div>
          <BarChart data={enumBars} height={180} />
        </div>
      </div>

      {/* Waves */}
      {data.wave_counts.length > 0 && (
        <div className={card}>
          <div className={sectionTitle}>Wave / Questionnaire Breakdown</div>
          <div className="space-y-2">
            {data.wave_counts.map((w, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-catalan-border last:border-0">
                <div>
                  <span className="text-sm font-medium text-catalan-text">{w.name}</span>
                  {w.wave_number && <span className="ml-2 text-xs text-catalan-textMuted">Wave {w.wave_number}</span>}
                </div>
                <span className="text-sm font-semibold text-catalan-primary">{w.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Column headers */}
      <div className={card}>
        <div className={sectionTitle}>Form Fields ({data.column_headers.length})</div>
        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
          {data.column_headers.map(c => (
            <span key={c.id} className="px-2 py-0.5 text-xs bg-catalan-hover border border-catalan-border rounded text-catalan-textMuted" title={c.id}>
              {c.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Tab: Cleaner ──────────────────────────────────────────────────────────────

const ISSUE_LABELS: Record<string, string> = {
  qc_violation: 'QC Violation',
  fast_completion: 'Fast (<2 min)',
  missing_required: 'Missing Required',
  no_gps: 'No GPS',
  flagged: 'Flagged',
  clean: 'Clean',
}

function CleanerTab({ programId }: { programId: string }) {
  const [data, setData] = useState<CleanerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [issueType, setIssueType] = useState('all')

  const load = useCallback(() => {
    setLoading(true)
    api.get(`/fg/programs/${programId}/cleaner`, { params: { page, page_size: 50, issue_type: issueType } })
      .then(r => setData(r.data))
      .finally(() => setLoading(false))
  }, [programId, page, issueType])

  useEffect(() => { load() }, [load])

  const totalPages = data ? Math.ceil(data.total / 50) : 1

  return (
    <div className="space-y-5">
      {/* Issue summary */}
      {data && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {Object.entries(data.issue_summary).map(([k, v]) => (
            <button
              key={k}
              onClick={() => { setIssueType(k === issueType ? 'all' : k); setPage(1) }}
              className={`rounded-lg p-3 text-center border transition-all ${
                issueType === k
                  ? 'border-catalan-primary bg-catalan-primary/10'
                  : 'border-catalan-border bg-catalan-surface hover:border-catalan-primary/40'
              }`}
            >
              <div className="text-lg font-bold text-catalan-primary">{v}</div>
              <div className="text-xs text-catalan-textMuted mt-0.5">{ISSUE_LABELS[k] ?? k}</div>
            </button>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <select className={selectCls} value={issueType} onChange={e => { setIssueType(e.target.value); setPage(1) }}>
          <option value="all">All submissions</option>
          <option value="issues_only">Issues only</option>
          {Object.keys(ISSUE_LABELS).map(k => <option key={k} value={k}>{ISSUE_LABELS[k]}</option>)}
        </select>
        <span className="text-sm text-catalan-textMuted">{data?.total ?? 0} records</span>
        <span className="text-sm text-catalan-textMuted">Quality: {data?.quality_score ?? 0}%</span>
      </div>

      {/* Table */}
      <div className="bg-catalan-surface border border-catalan-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-catalan-textMuted text-sm">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-catalan-bg border-b border-catalan-border">
              <tr>
                {['#', 'Enumerator', 'Form', 'Status', 'Received', 'Issues'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-catalan-border">
              {(data?.items ?? []).map(item => (
                <tr key={item.id} className={`hover:bg-catalan-hover transition-colors ${item.has_issues ? 'bg-catalan-error/3' : ''}`}>
                  <td className="px-4 py-3 text-catalan-textMuted font-mono text-xs">{item.serial_no ?? '—'}</td>
                  <td className="px-4 py-3 font-medium text-catalan-text">{item.enumerator_name}</td>
                  <td className="px-4 py-3 text-catalan-textMuted truncate max-w-[140px]">{item.form_title}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      item.status === 'approved' ? 'bg-green-500/15 text-green-400' :
                      item.status === 'flagged' ? 'bg-red-500/15 text-red-400' :
                      'bg-catalan-textMuted/10 text-catalan-textMuted'
                    }`}>{item.status}</span>
                  </td>
                  <td className="px-4 py-3 text-catalan-textMuted text-xs whitespace-nowrap">
                    {item.received ? new Date(item.received).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {item.issues.length === 0
                        ? <span className="text-xs text-green-400">Clean</span>
                        : item.issues.map(iss => (
                          <span key={iss} className="px-1.5 py-0.5 rounded text-xs bg-catalan-error/15 text-catalan-error">
                            {ISSUE_LABELS[iss] ?? iss}
                          </span>
                        ))
                      }
                    </div>
                  </td>
                </tr>
              ))}
              {(data?.items ?? []).length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-catalan-textMuted">No records</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className={btnSecondary}>Prev</button>
          <span className="text-sm text-catalan-textMuted">Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className={btnSecondary}>Next</button>
        </div>
      )}
    </div>
  )
}

// ── Tab: Tabulator ────────────────────────────────────────────────────────────

interface TabulateResult {
  rows: { group: string; value: number }[]
  total: number; groupby_field: string; value_field: string; aggregation: string
}

function TabulatorTab({ programId }: { programId: string }) {
  const [cols, setCols] = useState<ColHeader[]>([])
  const [groupby, setGroupby] = useState('')
  const [valueField, setValueField] = useState('*')
  const [aggregation, setAggregation] = useState('count')
  const [userPrompt, setUserPrompt] = useState('')
  const [aiSuggestion, setAiSuggestion] = useState<any>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [result, setResult] = useState<TabulateResult | null>(null)
  const [running, setRunning] = useState(false)
  const toast = useToast()

  useEffect(() => {
    api.get(`/fg/programs/${programId}/analyzer-data`)
      .then(r => {
        setCols(r.data.column_headers ?? [])
        if (r.data.column_headers?.length > 0) setGroupby(r.data.column_headers[0].id)
      })
  }, [programId])

  const suggestAI = async () => {
    setAiLoading(true)
    try {
      const sampleRows = result?.rows.slice(0, 5) ?? []
      const res = await api.post(`/fg/programs/${programId}/tabulate/suggest`, {
        column_headers: cols.map(c => ({ id: c.id, label: c.label, type: c.type })),
        sample_rows: sampleRows,
        user_prompt: userPrompt,
        research_type: 'field_survey',
      })
      setAiSuggestion(res.data)
      if (res.data.groupby_field) setGroupby(res.data.groupby_field)
      if (res.data.value_field) setValueField(res.data.value_field)
      if (res.data.aggregation) setAggregation(res.data.aggregation)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'AI suggestion failed')
    } finally {
      setAiLoading(false)
    }
  }

  const runTabulation = async () => {
    if (!groupby) return
    setRunning(true)
    try {
      const res = await api.post(`/fg/programs/${programId}/tabulate/execute`, {
        groupby_field: groupby,
        value_field: valueField || '*',
        aggregation,
      })
      setResult(res.data)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Tabulation failed')
    } finally {
      setRunning(false)
    }
  }

  const barData = (result?.rows ?? []).slice(0, 20).map(r => ({ label: r.group, value: r.value }))

  return (
    <div className="space-y-5">
      {/* AI Suggest */}
      <div className={card}>
        <div className={sectionTitle}>AI-Assisted Setup</div>
        <div className="flex gap-3">
          <input
            className={`${inputCls} flex-1`}
            placeholder='e.g. "Show me a district breakdown of survey count"'
            value={userPrompt}
            onChange={e => setUserPrompt(e.target.value)}
          />
          <button onClick={suggestAI} disabled={aiLoading} className={btnPrimary}>
            {aiLoading ? 'Thinking…' : '✨ AI Suggest'}
          </button>
        </div>
        {aiSuggestion?.rationale && (
          <p className="mt-3 text-xs text-catalan-textMuted bg-catalan-hover rounded-lg px-3 py-2">
            {aiSuggestion.rationale}
          </p>
        )}
      </div>

      {/* Manual config */}
      <div className={card}>
        <div className={sectionTitle}>Tabulation Config</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-catalan-textMuted block mb-1">Group by</label>
            <select className={`${selectCls} w-full`} value={groupby} onChange={e => setGroupby(e.target.value)}>
              {cols.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-catalan-textMuted block mb-1">Value field</label>
            <select className={`${selectCls} w-full`} value={valueField} onChange={e => setValueField(e.target.value)}>
              <option value="*">Count (*)</option>
              {cols.filter(c => ['number', 'integer'].includes(c.type)).map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-catalan-textMuted block mb-1">Aggregation</label>
            <select className={`${selectCls} w-full`} value={aggregation} onChange={e => setAggregation(e.target.value)}>
              <option value="count">Count</option>
              <option value="sum">Sum</option>
              <option value="mean">Mean</option>
            </select>
          </div>
        </div>
        <div className="mt-4">
          <button onClick={runTabulation} disabled={running || !groupby} className={btnPrimary}>
            {running ? 'Running…' : 'Run Tabulation'}
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <div className={sectionTitle}>Results — {result.total} submissions</div>
            <span className="text-xs text-catalan-textMuted">
              {result.groupby_field} → {result.aggregation}({result.value_field})
            </span>
          </div>
          <BarChart data={barData} height={Math.max(180, barData.length * 34 + 8)} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-catalan-border">
                  <th className="px-3 py-2 text-left text-xs text-catalan-textMuted">Group</th>
                  <th className="px-3 py-2 text-right text-xs text-catalan-textMuted">Value</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i} className="border-b border-catalan-border/50 hover:bg-catalan-hover">
                    <td className="px-3 py-2 text-catalan-text">{r.group}</td>
                    <td className="px-3 py-2 text-right font-semibold text-catalan-primary">{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab: Writer ───────────────────────────────────────────────────────────────

const STYLES = [
  { key: 'field_survey', label: 'Field Survey' },
  { key: 'progress', label: 'Progress' },
  { key: 'research', label: 'Research' },
  { key: 'government', label: 'Government' },
  { key: 'ngo', label: 'NGO/Donor' },
  { key: 'medical', label: 'Medical' },
]

function WriterTab({ programId }: { programId: string }) {
  const [style, setStyle] = useState('field_survey')
  const [dateRange, setDateRange] = useState('')
  const [customContext, setCustomContext] = useState('')
  const [tabulationData, setTabulationData] = useState('')
  const [reportMd, setReportMd] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const toast = useToast()

  const generate = async () => {
    setLoading(true); setError('')
    try {
      const res = await api.post(`/fg/programs/${programId}/writer/generate`, {
        style, date_range: dateRange, custom_context: customContext, tabulation_data: tabulationData,
      })
      setReportMd(res.data.report_md || '')
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Generation failed')
    } finally {
      setLoading(false)
    }
  }

  const copyMd = async () => {
    await navigator.clipboard.writeText(reportMd)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
    toast.success('Copied to clipboard')
  }

  const downloadDocx = async () => {
    try {
      const res = await api.post('/ai/writer/export-docx', {
        report_md: reportMd, title: 'Program Report',
      }, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url; a.download = 'program-report.docx'; a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Word export failed')
    }
  }

  return (
    <div className="space-y-5">
      <div className={card}>
        <div className={sectionTitle}>Report Style</div>
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

      <div className={card}>
        <div className={sectionTitle}>Context</div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-catalan-textMuted block mb-1">Date range (optional)</label>
            <input className={`${inputCls} w-full`} value={dateRange} onChange={e => setDateRange(e.target.value)}
              placeholder="e.g. Jan 2025 – Mar 2025 (auto-filled from program)" />
          </div>
          <div>
            <label className="text-xs text-catalan-textMuted block mb-1">Tabulation data (paste from Tabulator tab)</label>
            <textarea className={`${inputCls} w-full font-mono resize-y`} rows={4}
              value={tabulationData} onChange={e => setTabulationData(e.target.value)}
              placeholder="Paste CSV or JSON data from the Tabulator tab…" />
          </div>
          <div>
            <label className="text-xs text-catalan-textMuted block mb-1">Additional context (optional)</label>
            <textarea className={`${inputCls} w-full resize-y`} rows={2}
              value={customContext} onChange={e => setCustomContext(e.target.value)}
              placeholder="Background, geography, target population, special notes…" />
          </div>
        </div>
      </div>

      <button onClick={generate} disabled={loading} className={`${btnPrimary} w-full py-3 text-base`}>
        {loading ? 'Generating report…' : '✨ Generate Program Report'}
      </button>

      {error && (
        <div className="p-3 rounded-lg bg-catalan-error/10 border border-catalan-error/30 text-sm text-catalan-error">{error}</div>
      )}

      {reportMd && (
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <div className={sectionTitle}>Generated Report</div>
            <div className="flex gap-2">
              <button onClick={downloadDocx} className={btnSecondary}>Download Word</button>
              <button onClick={copyMd} className={btnSecondary}>{copied ? 'Copied!' : 'Copy Markdown'}</button>
            </div>
          </div>
          <textarea
            value={reportMd}
            onChange={e => setReportMd(e.target.value)}
            style={{ fontFamily: 'Georgia, serif', whiteSpace: 'pre-wrap' }}
            className={`${inputCls} w-full min-h-[500px] resize-y leading-relaxed`}
          />
        </div>
      )}
    </div>
  )
}

// ── Tab: Panel Study ──────────────────────────────────────────────────────────

function PanelStudyTab({ programId }: { programId: string }) {
  const [waves, setWaves] = useState<Wave[]>([])
  const [attrition, setAttrition] = useState<AttritionData | null>(null)
  const [isPanelStudy, setIsPanelStudy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Record<string, { wave_number: string; wave_label: string; panel_key: string }>>({})
  const toast = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [wRes, aRes] = await Promise.all([
        api.get(`/fg/programs/${programId}/waves`),
        api.get(`/fg/programs/${programId}/attrition`),
      ])
      setWaves(wRes.data)
      setAttrition(aRes.data)
      setIsPanelStudy(aRes.data.is_panel_study ?? false)
    } finally {
      setLoading(false)
    }
  }, [programId])

  useEffect(() => { load() }, [load])

  const togglePanel = async (val: boolean) => {
    await api.patch(`/fg/programs/${programId}/panel-study`, { is_panel_study: val })
    setIsPanelStudy(val)
    toast.success(val ? 'Panel study enabled' : 'Panel study disabled')
    await load()
  }

  const startEdit = (w: Wave) => {
    setEditing(prev => ({
      ...prev,
      [w.questionnaire_id]: {
        wave_number: w.wave_number?.toString() ?? '',
        wave_label: w.wave_label ?? '',
        panel_key: w.panel_key ?? '',
      }
    }))
  }

  const saveWave = async (qId: string) => {
    const e = editing[qId]
    if (!e) return
    await api.put(`/fg/programs/${programId}/waves`, {
      questionnaire_id: qId,
      wave_number: parseInt(e.wave_number) || 0,
      wave_label: e.wave_label,
      panel_key: e.panel_key || null,
    })
    setEditing(prev => { const n = { ...prev }; delete n[qId]; return n })
    toast.success('Wave saved')
    await load()
  }

  const clearWave = async (qId: string) => {
    await api.delete(`/fg/programs/${programId}/waves/${qId}`)
    toast.success('Wave cleared')
    await load()
  }

  if (loading) return <div className="py-8 text-center text-catalan-textMuted text-sm">Loading…</div>

  return (
    <div className="space-y-5">
      {/* Panel Study toggle */}
      <div className={`${card} flex items-center justify-between`}>
        <div>
          <div className="text-sm font-semibold text-catalan-text">Panel Study Mode</div>
          <div className="text-xs text-catalan-textMuted mt-0.5">Track the same respondents across multiple waves</div>
        </div>
        <button
          onClick={() => togglePanel(!isPanelStudy)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            isPanelStudy ? 'bg-catalan-primary' : 'bg-catalan-border'
          }`}
        >
          <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
            isPanelStudy ? 'translate-x-6' : 'translate-x-1'
          }`} />
        </button>
      </div>

      {/* Wave assignment */}
      <div className={card}>
        <div className={sectionTitle}>Questionnaire → Wave Assignment</div>
        {waves.length === 0 ? (
          <p className="text-sm text-catalan-textMuted">No questionnaires found for this program.</p>
        ) : (
          <div className="space-y-3">
            {waves.map(w => {
              const e = editing[w.questionnaire_id]
              return (
                <div key={w.questionnaire_id} className="flex items-center gap-3 border border-catalan-border rounded-lg p-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-catalan-text truncate">{w.name}</div>
                    {!e && w.wave_number && (
                      <div className="text-xs text-catalan-textMuted">Wave {w.wave_number} — {w.wave_label || 'no label'}</div>
                    )}
                  </div>
                  {e ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="number"
                        className={`${inputCls} w-16 text-center`}
                        placeholder="Wave#"
                        value={e.wave_number}
                        onChange={ev => setEditing(p => ({ ...p, [w.questionnaire_id]: { ...p[w.questionnaire_id], wave_number: ev.target.value } }))}
                      />
                      <input
                        className={`${inputCls} w-24`}
                        placeholder="Label"
                        value={e.wave_label}
                        onChange={ev => setEditing(p => ({ ...p, [w.questionnaire_id]: { ...p[w.questionnaire_id], wave_label: ev.target.value } }))}
                      />
                      <input
                        className={`${inputCls} w-28`}
                        placeholder="Panel key field"
                        value={e.panel_key}
                        onChange={ev => setEditing(p => ({ ...p, [w.questionnaire_id]: { ...p[w.questionnaire_id], panel_key: ev.target.value } }))}
                      />
                      <button onClick={() => saveWave(w.questionnaire_id)} className={btnPrimary}>Save</button>
                      <button onClick={() => setEditing(p => { const n = { ...p }; delete n[w.questionnaire_id]; return n })} className={btnSecondary}>Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => startEdit(w)} className={btnSecondary}>Edit Wave</button>
                      {w.wave_number && (
                        <button onClick={() => clearWave(w.questionnaire_id)} className="px-3 py-1.5 text-sm border border-catalan-error/30 text-catalan-error rounded-lg hover:bg-catalan-error/10 transition-colors">Clear</button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Attrition report */}
      {attrition?.is_panel_study && attrition.transitions && attrition.transitions.length > 0 && (
        <div className={card}>
          <div className={sectionTitle}>Attrition Report</div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-4">
            {attrition.waves.map((w, i) => (
              <div key={i} className="border border-catalan-border rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-catalan-primary">{w.unique_respondents}</div>
                <div className="text-xs text-catalan-textMuted">{w.wave_label}</div>
                <div className="text-xs text-catalan-textMuted">{w.total} total</div>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-catalan-border">
                <tr>
                  {['Transition', 'Retained', 'Lost', 'New', 'Attrition Rate'].map(h => (
                    <th key={h} className="px-4 py-2 text-left text-xs text-catalan-textMuted font-semibold uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-catalan-border">
                {attrition.transitions.map((t, i) => (
                  <tr key={i} className="hover:bg-catalan-hover">
                    <td className="px-4 py-3 font-medium text-catalan-text">{t.from_wave} → {t.to_wave}</td>
                    <td className="px-4 py-3 text-green-400 font-semibold">{t.retained}</td>
                    <td className="px-4 py-3 text-catalan-error font-semibold">{t.lost}</td>
                    <td className="px-4 py-3 text-catalan-primary font-semibold">{t.new_entrants}</td>
                    <td className="px-4 py-3">
                      <span className={`font-semibold ${t.attrition_rate_pct > 20 ? 'text-catalan-error' : t.attrition_rate_pct > 10 ? 'text-catalan-warning' : 'text-green-400'}`}>
                        {t.attrition_rate_pct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main FieldGovern Page ─────────────────────────────────────────────────────

type Tab = 'analyzer' | 'cleaner' | 'tabulator' | 'writer' | 'panel'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'analyzer', label: 'Analyzer', icon: '📊' },
  { key: 'cleaner',  label: 'Cleaner',  icon: '🧹' },
  { key: 'tabulator', label: 'Tabulator', icon: '🔢' },
  { key: 'writer',   label: 'Writer',   icon: '✍️' },
  { key: 'panel',    label: 'Panel Study', icon: '🔄' },
]

export default function FieldGovern() {
  const { programId } = useParams<{ programId: string }>()
  const navigate = useNavigate()
  const user = getStoredUser()
  const [tab, setTab] = useState<Tab>('analyzer')
  const [progName, setProgName] = useState('')

  useEffect(() => {
    if (programId) {
      api.get(`/fg/programs/${programId}/analyzer-data`)
        .then(r => setProgName(r.data.program_name || ''))
        .catch(() => {})
    }
  }, [programId])

  if (!programId) return <div className="p-8 text-catalan-error">No program ID</div>

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={getNavItems(user?.role ?? '')} role={user?.role} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav
          title="Field Govern"
          breadcrumbs={[
            { label: 'Programs', path: '/programs' },
            { label: progName || programId.slice(0, 8) },
            { label: 'Field Govern' },
          ]}
        />
        <main className="flex-1 overflow-auto">
          <div className="max-w-5xl mx-auto p-6">

            {/* Tab bar */}
            <div className="flex gap-1 mb-6 border-b border-catalan-border overflow-x-auto">
              {TABS.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                    tab === t.key
                      ? 'border-catalan-primary text-catalan-primary'
                      : 'border-transparent text-catalan-textMuted hover:text-catalan-text'
                  }`}>
                  <span>{t.icon}</span> {t.label}
                </button>
              ))}
            </div>

            {tab === 'analyzer'  && <AnalyzerTab  programId={programId} />}
            {tab === 'cleaner'   && <CleanerTab   programId={programId} />}
            {tab === 'tabulator' && <TabulatorTab programId={programId} />}
            {tab === 'writer'    && <WriterTab    programId={programId} />}
            {tab === 'panel'     && <PanelStudyTab programId={programId} />}
          </div>
        </main>
      </div>
    </div>
  )
}
