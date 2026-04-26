import { useState, useEffect, useCallback, useRef } from 'react'
import api, { getStoredUser } from '@/lib/api'
import Modal from '@/components/ui/Modal'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'
import { useToast } from '@/lib/ToastContext'
import LineChart from '@/components/charts/LineChart'
import BarChart from '@/components/charts/BarChart'
import {
  loadTabulations, loadTabulationsCache, saveTabulation, deleteTabulation,
  getLastProgram, setLastProgram, type SavedTabulation,
} from '@/lib/fgStorage'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ColHeader { id: string; label: string; type: string; options: any[] }
interface Program { id: string; name: string; scheme_name: string; status: string }
interface AnalyzerData {
  program_id: string; program_name: string; scheme: string; is_panel_study: boolean
  total_submissions: number
  trend: { date: string; count: number }[]
  status_counts: Record<string, number>
  enumerators: { name: string; count: number }[]
  wave_counts: { name: string; wave_number: number | null; count: number }[]
  column_headers: ColHeader[]
  sample_rows: Record<string, any>[]
  quality: { total: number; flagged: number; approved: number; violations: number; quality_score: number }
}
interface Wave {
  questionnaire_id: string; name: string; wave_number: number | null
  wave_label: string | null; panel_key: string | null
}
interface AttritionData {
  is_panel_study: boolean; program_name?: string
  waves: { questionnaire_id: string; wave_number: number; wave_label: string; total: number; unique_respondents: number }[]
  transitions: { from_wave: string; to_wave: string; retained: number; lost: number; new_entrants: number; attrition_rate_pct: number; lost_ids: string[] }[]
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const card  = 'bg-catalan-surface border border-catalan-border rounded-xl p-5'
const sh    = 'text-xs font-semibold text-catalan-textMuted uppercase tracking-wider mb-3'
const btnPr = 'px-4 py-2 bg-catalan-primary text-catalan-bg rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40'
const btnSe = 'px-3 py-1.5 text-sm border border-catalan-border rounded-lg text-catalan-text hover:bg-catalan-hover transition-colors disabled:opacity-40'
const sel   = 'border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text focus:ring-2 focus:ring-catalan-primary outline-none'
const inp   = 'border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text placeholder:text-catalan-textMuted focus:ring-2 focus:ring-catalan-primary outline-none'

function StatCard({ label, value, color = 'text-catalan-primary' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className={card}>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-sm text-catalan-text mt-0.5">{label}</div>
    </div>
  )
}

// ── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: AnalyzerData }) {
  const statusBars = Object.entries(data.status_counts).map(([k, v]) => ({ label: k, value: v }))
  const enumBars   = data.enumerators.slice(0, 15).map(e => ({ label: e.name, value: e.count }))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Submissions" value={data.total_submissions} />
        <StatCard label="Quality Score" value={`${data.quality.quality_score}%`}
          color={data.quality.quality_score >= 80 ? 'text-green-400' : data.quality.quality_score >= 60 ? 'text-catalan-warning' : 'text-catalan-error'} />
        <StatCard label="Flagged" value={data.quality.flagged} color="text-catalan-warning" />
        <StatCard label="QC Violations" value={data.quality.violations} color="text-catalan-error" />
      </div>

      <div className={card}>
        <div className={sh}>Submission Trend (Daily)</div>
        <LineChart data={data.trend} height={200} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className={card}>
          <div className={sh}>Status Breakdown</div>
          <BarChart data={statusBars} height={160} />
        </div>
        <div className={card}>
          <div className={sh}>Enumerator Performance (Top 15)</div>
          <BarChart data={enumBars} height={Math.max(160, enumBars.length * 34 + 8)} />
        </div>
      </div>

      {data.wave_counts.length > 0 && (
        <div className={card}>
          <div className={sh}>Questionnaire / Wave Breakdown</div>
          <div className="divide-y divide-catalan-border">
            {data.wave_counts.map((w, i) => (
              <div key={i} className="flex items-center justify-between py-2.5">
                <div>
                  <span className="text-sm font-medium text-catalan-text">{w.name}</span>
                  {w.wave_number != null && <span className="ml-2 text-xs text-catalan-textMuted">Wave {w.wave_number}</span>}
                </div>
                <span className="text-sm font-bold text-catalan-primary">{w.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={card}>
        <div className={sh}>Form Fields ({data.column_headers.length})</div>
        <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
          {data.column_headers.map(c => (
            <span key={c.id} title={`id: ${c.id} | type: ${c.type}`}
              className="px-2 py-0.5 text-xs bg-catalan-hover border border-catalan-border rounded text-catalan-textMuted">
              {c.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Tabulator tab ─────────────────────────────────────────────────────────────

interface AiSuggestion {
  title: string; groupby_field: string; value_field: string
  aggregation: string; chart_type: string; description: string
  show_percent?: boolean; secondary_groupby?: string
}

interface HistoryRecord {
  analysis_id: string
  source: string
  status: string
  objectives: string | null
  table_count: number
  created_at: string
  cleaning_summary: { total?: number; skipped?: number; cols_high_missing?: Record<string, number> }
}

function TabulationCard({ tab, onDelete, programId }: { tab: SavedTabulation; onDelete: () => void; programId: string }) {
  const [expanded, setExpanded] = useState(false)
  const [showRationale, setShowRationale] = useState(false)
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(tab.feedback ?? null)
  const barData = tab.rows.slice(0, 20).map(r => ({ label: r.group, value: r.value }))
  const subKeys = tab.sub_keys ?? []

  const submitFeedback = async (vote: 'up' | 'down') => {
    const next = feedback === vote ? null : vote
    setFeedback(next)
    try {
      await api.patch(`/fg/programs/${programId}/analysis/tabulations/${tab.id}/feedback`, { vote: next })
    } catch {
      setFeedback(feedback)
    }
  }

  const copyCSV = () => {
    const headers = tab.is_cross_tab
      ? ['Group', ...subKeys, 'Total', ...(tab.show_percent ? ['%'] : [])]
      : ['Group', 'Value', ...(tab.show_percent ? ['%'] : [])]
    const rowLines = tab.rows.map(r =>
      tab.is_cross_tab
        ? [`"${r.group}"`, ...subKeys.map(k => r[k] ?? 0), r.value, ...(tab.show_percent ? [r.pct ?? ''] : [])]
        : [`"${r.group}"`, r.value, ...(tab.show_percent ? [r.pct ?? ''] : [])]
    )
    navigator.clipboard.writeText([headers.join(','), ...rowLines.map(l => l.join(','))].join('\n'))
  }

  return (
    <div className={`${card} space-y-3`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-catalan-text">{tab.title || 'Untitled'}</div>
          <div className="text-xs text-catalan-textMuted mt-0.5">
            {tab.description || `${tab.groupby_field}${tab.secondary_groupby ? ` × ${tab.secondary_groupby}` : ''} → ${tab.aggregation}(${tab.value_field})`}
          </div>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap justify-end">
          {tab.description && (
            <button onClick={() => setShowRationale(r => !r)} className={btnSe} title="Why did AI choose this?">Why?</button>
          )}
          <button
            onClick={() => submitFeedback('up')}
            className={`px-2 py-1.5 text-sm rounded-lg border transition-colors ${feedback === 'up' ? 'border-green-500 text-green-400 bg-green-500/10' : 'border-catalan-border text-catalan-textMuted hover:text-catalan-text'}`}
            title="Useful table"
          >👍</button>
          <button
            onClick={() => submitFeedback('down')}
            className={`px-2 py-1.5 text-sm rounded-lg border transition-colors ${feedback === 'down' ? 'border-catalan-error text-catalan-error bg-catalan-error/10' : 'border-catalan-border text-catalan-textMuted hover:text-catalan-text'}`}
            title="Not useful"
          >👎</button>
          <button onClick={copyCSV} className={btnSe} title="Copy as CSV">CSV</button>
          <button onClick={() => setExpanded(e => !e)} className={btnSe}>{expanded ? 'Hide' : 'Expand'}</button>
          <button onClick={onDelete} className="px-2 py-1.5 text-sm border border-catalan-error/30 text-catalan-error rounded-lg hover:bg-catalan-error/10">✕</button>
        </div>
      </div>

      {showRationale && tab.description && (
        <div className="px-3 py-2 bg-catalan-primary/5 border border-catalan-primary/20 rounded-lg text-xs text-catalan-textMuted">
          <span className="font-semibold text-catalan-primary">Why this table: </span>{tab.description}
        </div>
      )}

      {!tab.is_cross_tab && <BarChart data={barData} height={Math.max(120, Math.min(barData.length * 30 + 8, 300))} />}

      {expanded && (
        <div className="overflow-x-auto rounded-lg border border-catalan-border">
          <table className="w-full text-sm">
            <thead className="bg-catalan-bg border-b border-catalan-border">
              <tr>
                <th className="px-3 py-2 text-left text-xs text-catalan-textMuted font-semibold uppercase">{tab.groupby_field}</th>
                {tab.is_cross_tab
                  ? subKeys.map(k => (
                      <th key={k} className="px-3 py-2 text-right text-xs text-catalan-textMuted font-semibold uppercase">{k}</th>
                    ))
                  : null}
                <th className="px-3 py-2 text-right text-xs text-catalan-textMuted font-semibold uppercase">
                  {tab.is_cross_tab ? 'Total' : `${tab.aggregation}(${tab.value_field})`}
                </th>
                {tab.show_percent && <th className="px-3 py-2 text-right text-xs text-catalan-textMuted font-semibold uppercase">%</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-catalan-border">
              {tab.rows.map((r, i) => (
                <tr key={i} className="hover:bg-catalan-hover">
                  <td className="px-3 py-2 text-catalan-text">{r.group}</td>
                  {tab.is_cross_tab && subKeys.map(k => (
                    <td key={k} className="px-3 py-2 text-right text-catalan-textMuted">{r[k] ?? 0}</td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold text-catalan-primary">{r.value}</td>
                  {tab.show_percent && (
                    <td className="px-3 py-2 text-right text-catalan-textMuted">{r.pct ?? 0}%</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-xs text-catalan-textMuted">{tab.total} total records · saved {new Date(tab.created_at).toLocaleString()}</div>
    </div>
  )
}

const AI_MSGS = [
  'Analyzing dataset schema...',
  'Mapping study objectives...',
  'Identifying key variables...',
  'Generating cross-tabulations...',
  'Validating outputs...',
  'Almost ready...',
]

function TabulatorTab({ programId, cols, sampleRows }: { programId: string; cols: ColHeader[]; sampleRows: Record<string, any>[] }) {
  const toast = useToast()
  const [saved, setSaved] = useState<SavedTabulation[]>([])

  // Auto-generate state
  const [autoStatus, setAutoStatus] = useState<'idle' | 'pending' | 'failed'>('idle')
  const [autoError, setAutoError] = useState('')
  const [autoObjectives, setAutoObjectives] = useState('')
  const [autoMsgIdx, setAutoMsgIdx] = useState(0)
  const [runsToday, setRunsToday] = useState(0)
  const [runsRemaining, setRunsRemaining] = useState(2)
  const [showGuardrailModal, setShowGuardrailModal] = useState(false)
  const [showObjectivesModal, setShowObjectivesModal] = useState(false)
  const [lastGeneratedAt, setLastGeneratedAt] = useState<string | null>(null)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [aiRationale, setAiRationale] = useState<string | null>(null)

  // History panel state
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<HistoryRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  // AI suggest mode
  const [prompt, setPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([])
  const [runningIdx, setRunningIdx] = useState<number | null>(null)

  // Manual mode
  const [groupby, setGroupby] = useState(cols[0]?.id ?? '')
  const [valueField, setValueField] = useState('*')
  const [aggregation, setAggregation] = useState('count')
  const [chartType, setChartType] = useState('bar')
  const [manualTitle, setManualTitle] = useState('')
  const [manualRunning, setManualRunning] = useState(false)

  const reload = useCallback(async () => {
    setSaved(loadTabulationsCache(programId))
    const fresh = await loadTabulations(programId)
    setSaved(fresh)
    if (fresh.length > 0) setLastRefreshedAt(new Date())
  }, [programId])
  useEffect(() => { reload() }, [reload])
  useEffect(() => { if (cols.length && !groupby) setGroupby(cols[0].id) }, [cols])

  // Check AI status on mount
  useEffect(() => {
    api.get(`/fg/programs/${programId}/analysis/status`).then(res => {
      const { status, runs_today, runs_remaining, updated_at, table_count, ai_rationale } = res.data
      if (runs_today != null) setRunsToday(runs_today)
      if (runs_remaining != null) setRunsRemaining(runs_remaining)
      if (updated_at && table_count > 0) setLastGeneratedAt(updated_at)
      if (ai_rationale) setAiRationale(ai_rationale)
      if (status === 'pending') setAutoStatus('pending')
    }).catch(() => {})
  }, [programId])

  // Poll when pending: cycling messages every 8s, status check every 30s
  useEffect(() => {
    if (autoStatus !== 'pending') return
    const msgInterval = setInterval(() => setAutoMsgIdx(i => (i + 1) % AI_MSGS.length), 8000)
    const pollInterval = setInterval(async () => {
      try {
        const res = await api.get(`/fg/programs/${programId}/analysis/status`)
        const { status, runs_today, runs_remaining: rr, ai_rationale } = res.data
        if (runs_today != null) setRunsToday(runs_today)
        if (rr != null) setRunsRemaining(rr)
        if (status !== 'pending') {
          clearInterval(msgInterval)
          clearInterval(pollInterval)
          if (status === 'failed') {
            setAutoStatus('failed')
            setAutoError('AI generation failed. Please try again.')
          } else {
            if (ai_rationale) setAiRationale(ai_rationale)
            setAutoStatus('idle')
            await reload()
            toast.success('AI insights generated — your tables are ready!')
          }
        }
      } catch {}
    }, 30000)
    return () => { clearInterval(msgInterval); clearInterval(pollInterval) }
  }, [autoStatus, programId, reload])

  const triggerAutoGenerate = async (objectives?: string) => {
    const obj = objectives !== undefined ? objectives : autoObjectives
    setAutoError('')
    try {
      const res = await api.post(`/fg/programs/${programId}/auto-generate`, { objectives: obj })
      setRunsToday(res.data.runs_today ?? runsToday + 1)
      setRunsRemaining(res.data.runs_remaining ?? Math.max(0, runsRemaining - 1))
      setAutoStatus('pending')
      setAutoMsgIdx(0)
    } catch (e: any) {
      const msg = e.response?.data?.detail || 'Failed to start AI generation'
      setAutoError(msg)
      toast.error(msg)
    }
  }

  const handleAutoGenerateClick = () => {
    setAutoError('')
    if (saved.length > 0) setShowGuardrailModal(true)
    else setShowObjectivesModal(true)
  }

  const handleObjectivesSubmit = () => {
    setShowObjectivesModal(false)
    triggerAutoGenerate(autoObjectives)
  }

  const refreshTableData = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const res = await api.post(`/fg/programs/${programId}/analysis/refresh`)
      if (res.data.table_configs) {
        setSaved(res.data.table_configs)
        localStorage.setItem(`fg_tabs_${programId}`, JSON.stringify(res.data.table_configs))
        setLastRefreshedAt(new Date())
      }
    } catch {} finally {
      setIsRefreshing(false)
    }
  }, [programId])

  // 30-min auto-refresh (pure Python aggregation, no AI call)
  useEffect(() => {
    const timer = setInterval(refreshTableData, 30 * 60 * 1000)
    return () => clearInterval(timer)
  }, [refreshTableData])

  const loadHistory = async () => {
    setHistoryLoading(true)
    try {
      const res = await api.get(`/fg/programs/${programId}/analysis/history`)
      setHistory(res.data)
    } catch {} finally {
      setHistoryLoading(false)
    }
  }

  const toggleHistory = () => {
    if (!historyOpen && history.length === 0) loadHistory()
    setHistoryOpen(o => !o)
  }

  const restoreRun = async (analysisId: string) => {
    setRestoringId(analysisId)
    try {
      const res = await api.post(`/fg/programs/${programId}/analysis/restore`, { analysis_id: analysisId })
      if (res.data.table_configs) {
        setSaved(res.data.table_configs)
        localStorage.setItem(`fg_tabs_${programId}`, JSON.stringify(res.data.table_configs))
        setLastRefreshedAt(new Date())
      }
      toast.success('Run restored — tables updated')
      setHistoryOpen(false)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Restore failed')
    } finally {
      setRestoringId(null)
    }
  }

  const callSuggest = async () => {
    if (!cols.length) return
    setAiLoading(true); setSuggestions([])
    try {
      const res = await api.post(`/fg/programs/${programId}/tabulate/suggest`, {
        column_headers: cols.map(c => ({ id: c.id, label: c.label, type: c.type })),
        sample_rows: sampleRows.slice(0, 8),
        user_prompt: prompt,
        research_type: 'field_survey',
      })
      setSuggestions(res.data.tables ?? [])
      if (!res.data.tables?.length) toast.error('AI returned no suggestions. Try a more specific prompt.')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'AI suggestion failed — check AI config')
    } finally {
      setAiLoading(false)
    }
  }

  const runSuggestion = async (s: AiSuggestion, idx: number) => {
    setRunningIdx(idx)
    try {
      const res = await api.post(`/fg/programs/${programId}/tabulate/execute`, {
        groupby_field: s.groupby_field,
        value_field: s.value_field || '*',
        aggregation: s.aggregation || 'count',
        chart_type: s.chart_type || 'bar',
        title: s.title,
        show_percent: s.show_percent ?? false,
        secondary_groupby: s.secondary_groupby ?? '',
      })
      const tab: SavedTabulation = {
        id: crypto.randomUUID(),
        title: s.title,
        description: s.description,
        groupby_field: s.groupby_field,
        value_field: s.value_field || '*',
        aggregation: s.aggregation || 'count',
        chart_type: s.chart_type || 'bar',
        rows: res.data.rows,
        total: res.data.total,
        created_at: new Date().toISOString(),
        show_percent: res.data.show_percent,
        secondary_groupby: res.data.secondary_groupby,
        sub_keys: res.data.sub_keys,
        is_cross_tab: res.data.is_cross_tab,
      }
      await saveTabulation(programId, tab)
      await reload()
      toast.success(`"${s.title}" saved`)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Tabulation failed')
    } finally {
      setRunningIdx(null)
    }
  }

  const runAllSuggestions = async () => {
    for (let i = 0; i < suggestions.length; i++) {
      await runSuggestion(suggestions[i], i)
    }
  }

  const runManual = async () => {
    if (!groupby) return
    setManualRunning(true)
    try {
      const res = await api.post(`/fg/programs/${programId}/tabulate/execute`, {
        groupby_field: groupby,
        value_field: valueField || '*',
        aggregation,
        chart_type: chartType,
        title: manualTitle || `${groupby} × ${aggregation}(${valueField})`,
      })
      const tab: SavedTabulation = {
        id: crypto.randomUUID(),
        title: manualTitle || `${groupby} breakdown`,
        description: `${aggregation}(${valueField}) grouped by ${groupby}`,
        groupby_field: groupby,
        value_field: valueField || '*',
        aggregation,
        chart_type: chartType,
        rows: res.data.rows,
        total: res.data.total,
        created_at: new Date().toISOString(),
      }
      await saveTabulation(programId, tab)
      await reload()
      setManualTitle('')
      toast.success('Tabulation saved')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Tabulation failed')
    } finally {
      setManualRunning(false)
    }
  }

  const numericCols = cols.filter(c => ['number', 'integer', 'decimal'].includes(c.type))

  return (
    <div className="space-y-5">
      {/* Auto-Generate Section */}
      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <div className={`${sh} mb-0`}>1-Click AI Insights</div>
          <span className="text-xs text-catalan-textMuted">{runsToday} of 2 AI runs used today</span>
        </div>

        {autoStatus === 'pending' ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-sm text-catalan-primary font-medium">
              <div className="w-4 h-4 border-2 border-catalan-primary border-t-transparent rounded-full animate-spin shrink-0" />
              {AI_MSGS[autoMsgIdx]}
            </div>
            <p className="text-xs text-catalan-textMuted">AI is analyzing your dataset — ~2 minutes. You can navigate away and come back.</p>
          </div>
        ) : autoStatus === 'failed' ? (
          <div className="space-y-2">
            <p className="text-sm text-catalan-error">{autoError}</p>
            <button onClick={() => { setAutoStatus('idle'); setAutoError('') }} className={btnSe}>Try Again</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-catalan-textMuted">
              AI reads all {cols.length} column headers and builds a full set of cross-tabulation charts automatically.
              {saved.length > 0 && ` You already have ${saved.length} table${saved.length !== 1 ? 's' : ''} — you can regenerate or keep existing.`}
            </p>
            {aiRationale && (
              <div className={`px-3 py-2 rounded-lg text-xs border ${
                /not found|missing|cannot|no column/i.test(aiRationale)
                  ? 'bg-catalan-warning/10 border-catalan-warning/30 text-catalan-warning'
                  : 'bg-catalan-primary/5 border-catalan-primary/20 text-catalan-textMuted'
              }`}>
                <span className="font-semibold">AI note: </span>{aiRationale}
              </div>
            )}
            {runsRemaining <= 0 ? (
              <p className="text-xs text-catalan-warning">
                Daily limit reached (2 of 2 used) — resets at midnight. Your existing tables auto-refresh with new data.
              </p>
            ) : (
              <button
                onClick={handleAutoGenerateClick}
                disabled={!cols.length}
                className={btnPr}
              >
                Generate AI Insights
              </button>
            )}
          </div>
        )}
      </div>

      {/* Manual AI Suggest Section */}
      <div className={card}>
        <div className={sh}>AI-Powered Table Builder</div>
        <p className="text-xs text-catalan-textMuted mb-3">
          Describe the tables you want — AI reads all {cols.length} column headers and auto-suggests the right groupings and aggregations.
        </p>
        <div className="space-y-3">
          <textarea
            className={`${inp} w-full resize-none`} rows={3}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={`e.g. "Create a district-wise distribution of samples across benefit year"\nor leave blank to let AI suggest all useful tables for this data`}
          />
          <div className="flex gap-2">
            <button onClick={callSuggest} disabled={aiLoading || !cols.length} className={btnPr}>
              {aiLoading ? '✨ Thinking…' : '✨ AI Suggest'}
            </button>
            {suggestions.length > 1 && (
              <button onClick={runAllSuggestions} disabled={runningIdx !== null} className={btnSe}>
                Run All ({suggestions.length})
              </button>
            )}
          </div>
        </div>

        {suggestions.length > 0 && (
          <div className="mt-4 space-y-3">
            <div className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wider">AI Suggestions — click Run to build each table</div>
            {suggestions.map((s, i) => (
              <div key={i} className="border border-catalan-border rounded-lg p-4 bg-catalan-hover/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-catalan-text">{s.title}</div>
                    <div className="text-xs text-catalan-textMuted mt-1">{s.description}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {[
                        `Group: ${s.groupby_field}`,
                        s.secondary_groupby ? `× ${s.secondary_groupby}` : null,
                        `${s.aggregation || 'count'}${s.show_percent ? ' + %' : ''}`,
                        `Chart: ${s.chart_type || 'bar'}`,
                      ].filter(Boolean).map(tag => (
                        <span key={tag!} className="px-1.5 py-0.5 text-xs bg-catalan-primary/10 text-catalan-primary rounded">{tag}</span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => runSuggestion(s, i)}
                    disabled={runningIdx !== null}
                    className={`${btnPr} shrink-0`}
                  >
                    {runningIdx === i ? 'Running…' : 'Run'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Manual Section */}
      <div className={card}>
        <div className={sh}>Manual Table Builder</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
          <div>
            <label className="text-xs text-catalan-textMuted block mb-1">Group by *</label>
            <select className={`${sel} w-full`} value={groupby} onChange={e => setGroupby(e.target.value)}>
              {cols.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-catalan-textMuted block mb-1">Value field</label>
            <select className={`${sel} w-full`} value={valueField} onChange={e => setValueField(e.target.value)}>
              <option value="*">Count of records (*)</option>
              {numericCols.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-catalan-textMuted block mb-1">Aggregation</label>
            <select className={`${sel} w-full`} value={aggregation} onChange={e => setAggregation(e.target.value)}>
              <option value="count">Count</option>
              <option value="sum">Sum</option>
              <option value="mean">Mean (avg)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-catalan-textMuted block mb-1">Chart type</label>
            <select className={`${sel} w-full`} value={chartType} onChange={e => setChartType(e.target.value)}>
              <option value="bar">Bar</option>
              <option value="line">Line</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-catalan-textMuted block mb-1">Table title (optional)</label>
            <input className={`${inp} w-full`} value={manualTitle} onChange={e => setManualTitle(e.target.value)}
              placeholder="e.g. District-wise survey count" />
          </div>
        </div>
        <button onClick={runManual} disabled={manualRunning || !groupby} className={btnPr}>
          {manualRunning ? 'Running…' : 'Build Table'}
        </button>
      </div>

      {/* Saved tabulations */}
      {saved.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className={`${sh} mb-0`}>Saved Tables & Charts ({saved.length})</div>
            <div className="flex items-center gap-3">
              {lastRefreshedAt && (
                <span className="text-xs text-catalan-textMuted">
                  Data as of {lastRefreshedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} — auto-refreshes every 30 min
                </span>
              )}
              <button
                onClick={refreshTableData}
                disabled={isRefreshing}
                className={btnSe}
                title="Refresh table data with latest submissions"
              >
                {isRefreshing ? 'Refreshing…' : 'Refresh'}
              </button>
              <a href="/fg/writer" className={btnSe}>Open in Writer</a>
              <button
                onClick={async () => { if (confirm('Clear all saved tabulations?')) { await Promise.all(saved.map(t => deleteTabulation(programId, t.id))); await reload() } }}
                className="text-xs text-catalan-error hover:underline"
              >
                Clear all
              </button>
            </div>
          </div>
          {saved.map(tab => (
            <TabulationCard key={tab.id} tab={tab} programId={programId}
              onDelete={async () => { await deleteTabulation(programId, tab.id); await reload() }} />
          ))}
        </div>
      )}

      {saved.length === 0 && suggestions.length === 0 && (
        <div className="py-8 text-center text-catalan-textMuted text-sm">
          No tables yet. Use AI Suggest or build one manually above.
        </div>
      )}

      {/* Past AI Runs — History Panel */}
      <div className={card}>
        <button onClick={toggleHistory} className="flex items-center justify-between w-full">
          <div className={`${sh} mb-0`}>Past AI Runs</div>
          <span className="text-xs text-catalan-textMuted">{historyOpen ? '▲ Hide' : '▼ Show'}</span>
        </button>

        {historyOpen && (
          <div className="mt-3 space-y-2">
            {historyLoading && <p className="text-sm text-catalan-textMuted py-2">Loading…</p>}
            {!historyLoading && history.length === 0 && (
              <p className="text-sm text-catalan-textMuted py-2">No past runs found.</p>
            )}
            {!historyLoading && history.map(r => {
              const highMissingCount = Object.keys(r.cleaning_summary?.cols_high_missing ?? {}).length
              return (
                <div key={r.analysis_id} className="border border-catalan-border rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-catalan-text">
                          {new Date(r.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className={`px-1.5 py-0.5 text-xs rounded font-medium ${
                          r.source === 'ai' ? 'bg-catalan-primary/15 text-catalan-primary' : 'bg-catalan-hover text-catalan-textMuted'
                        }`}>{r.source === 'ai' ? 'AI' : 'Manual'}</span>
                        <span className={`px-1.5 py-0.5 text-xs rounded ${
                          r.status === 'done' ? 'bg-green-500/15 text-green-400' :
                          r.status === 'failed' ? 'bg-catalan-error/15 text-catalan-error' :
                          'bg-catalan-warning/15 text-catalan-warning'
                        }`}>{r.status}</span>
                      </div>
                      {r.objectives && (
                        <p className="text-xs text-catalan-textMuted mt-1 truncate" title={r.objectives}>{r.objectives}</p>
                      )}
                      <p className="text-xs text-catalan-textMuted mt-0.5">
                        {r.table_count} table{r.table_count !== 1 ? 's' : ''}
                        {r.cleaning_summary?.total != null && ` · ${r.cleaning_summary.total} submissions`}
                        {(r.cleaning_summary?.skipped ?? 0) > 0 && ` · ${r.cleaning_summary.skipped} skipped`}
                        {highMissingCount > 0 && ` · ${highMissingCount} col${highMissingCount !== 1 ? 's' : ''} >20% missing`}
                      </p>
                    </div>
                    {r.status === 'done' && r.table_count > 0 && (
                      <button
                        onClick={() => restoreRun(r.analysis_id)}
                        disabled={restoringId !== null}
                        className={`${btnSe} shrink-0`}
                      >
                        {restoringId === r.analysis_id ? 'Restoring…' : 'Restore'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Guardrail modal — shown when tables already exist */}
      <Modal
        isOpen={showGuardrailModal}
        onClose={() => setShowGuardrailModal(false)}
        title="AI Insights Already Generated"
        size="sm"
        footer={
          <>
            <button className={btnSe} onClick={() => setShowGuardrailModal(false)}>Use Existing</button>
            <button className={btnPr} onClick={() => { setShowGuardrailModal(false); setAutoError(''); setShowObjectivesModal(true) }}>
              Regenerate with AI
            </button>
          </>
        }
      >
        <p className="text-sm text-catalan-text">
          You already have <strong>{saved.length} table{saved.length !== 1 ? 's' : ''}</strong>
          {lastGeneratedAt && ` generated on ${new Date(lastGeneratedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`}.
        </p>
        <p className="text-xs text-catalan-textMuted mt-2">
          <strong>Use Existing</strong> keeps your current tables as-is.<br />
          <strong>Regenerate</strong> runs AI again and replaces all tables (uses 1 of your {runsRemaining} remaining run{runsRemaining !== 1 ? 's' : ''} today).
        </p>
      </Modal>

      {/* Objectives modal */}
      <Modal
        isOpen={showObjectivesModal}
        onClose={() => setShowObjectivesModal(false)}
        title="Study Objectives (Optional)"
        size="sm"
        footer={
          <>
            <button className={btnSe} onClick={() => { setShowObjectivesModal(false); triggerAutoGenerate('') }}>Skip</button>
            <button className={btnPr} onClick={handleObjectivesSubmit}>Generate Insights</button>
          </>
        }
      >
        <p className="text-sm text-catalan-textMuted mb-3">
          Share what you're trying to measure — AI will cross-verify its suggestions against your goals and flag any mismatches.
        </p>
        <textarea
          className={`${inp} w-full resize-none`}
          rows={4}
          value={autoObjectives}
          onChange={e => setAutoObjectives(e.target.value)}
          placeholder="e.g. Measure district-wise coverage and gender gaps in benefit delivery"
          autoFocus
        />
        {autoError && <p className="text-xs text-catalan-error mt-2">{autoError}</p>}
      </Modal>
    </div>
  )
}

// ── Panel Study tab ───────────────────────────────────────────────────────────

function PanelStudyTab({ programId }: { programId: string }) {
  const toast = useToast()
  const [waves, setWaves] = useState<Wave[]>([])
  const [attrition, setAttrition] = useState<AttritionData | null>(null)
  const [isPanelStudy, setIsPanelStudy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Record<string, { wave_number: string; wave_label: string; panel_key: string }>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [wRes, aRes] = await Promise.all([
        api.get(`/fg/programs/${programId}/waves`),
        api.get(`/fg/programs/${programId}/attrition`),
      ])
      setWaves(Array.isArray(wRes.data) ? wRes.data : [])
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
    toast.success(val ? 'Panel study enabled' : 'Disabled')
    await load()
  }

  const startEdit = (w: Wave) => setEditing(p => ({
    ...p, [w.questionnaire_id]: { wave_number: w.wave_number?.toString() ?? '', wave_label: w.wave_label ?? '', panel_key: w.panel_key ?? '' }
  }))

  const saveWave = async (qId: string) => {
    const e = editing[qId]; if (!e) return
    await api.put(`/fg/programs/${programId}/waves`, {
      questionnaire_id: qId,
      wave_number: parseInt(e.wave_number) || 1,
      wave_label: e.wave_label,
      panel_key: e.panel_key || null,
    })
    setEditing(p => { const n = { ...p }; delete n[qId]; return n })
    toast.success('Wave saved'); await load()
  }

  const clearWave = async (qId: string) => {
    await api.delete(`/fg/programs/${programId}/waves/${qId}`)
    toast.success('Wave cleared'); await load()
  }

  if (loading) return <div className="py-8 text-center text-catalan-textMuted text-sm">Loading…</div>

  return (
    <div className="space-y-5">
      {/* Toggle */}
      <div className={`${card} flex items-center justify-between`}>
        <div>
          <div className="text-sm font-semibold text-catalan-text">Panel Study Mode</div>
          <div className="text-xs text-catalan-textMuted mt-0.5">
            Track the same respondents across multiple waves (baseline → midline → endline). Submissions are linked by household ID.
          </div>
        </div>
        <button onClick={() => togglePanel(!isPanelStudy)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${isPanelStudy ? 'bg-catalan-primary' : 'bg-catalan-border'}`}>
          <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${isPanelStudy ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {/* Wave assignment */}
      <div className={card}>
        <div className={sh}>Questionnaire → Wave Assignment</div>
        <p className="text-xs text-catalan-textMuted mb-3">
          Assign a wave number and label to each questionnaire. The <strong>Panel Key</strong> is the field ID in the form that holds the household/respondent identifier — used to auto-link submissions across waves.
        </p>
        {waves.length === 0 ? (
          <p className="text-sm text-catalan-textMuted">No questionnaires found for this program.</p>
        ) : (
          <div className="space-y-2">
            {waves.map(w => {
              const e = editing[w.questionnaire_id]
              return (
                <div key={w.questionnaire_id} className="flex flex-col sm:flex-row sm:items-center gap-3 border border-catalan-border rounded-lg p-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-catalan-text truncate">{w.name}</div>
                    {!e && w.wave_number != null && (
                      <div className="text-xs text-catalan-textMuted">
                        Wave {w.wave_number} — {w.wave_label || '(no label)'}
                        {w.panel_key && <span className="ml-2">· Panel key: <code className="bg-catalan-hover px-1 rounded">{w.panel_key}</code></span>}
                      </div>
                    )}
                    {!e && w.wave_number == null && (
                      <div className="text-xs text-catalan-textMuted italic">Not assigned to a wave</div>
                    )}
                  </div>
                  {e ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input type="number" className={`${inp} w-16 text-center`} placeholder="Wave#" value={e.wave_number}
                        onChange={ev => setEditing(p => ({ ...p, [w.questionnaire_id]: { ...p[w.questionnaire_id], wave_number: ev.target.value } }))} />
                      <input className={`${inp} w-24`} placeholder="Label e.g. Baseline" value={e.wave_label}
                        onChange={ev => setEditing(p => ({ ...p, [w.questionnaire_id]: { ...p[w.questionnaire_id], wave_label: ev.target.value } }))} />
                      <input className={`${inp} w-32`} placeholder="Panel key field ID" value={e.panel_key}
                        onChange={ev => setEditing(p => ({ ...p, [w.questionnaire_id]: { ...p[w.questionnaire_id], panel_key: ev.target.value } }))} />
                      <button onClick={() => saveWave(w.questionnaire_id)} className={btnPr}>Save</button>
                      <button onClick={() => setEditing(p => { const n = { ...p }; delete n[w.questionnaire_id]; return n })} className={btnSe}>Cancel</button>
                    </div>
                  ) : (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => startEdit(w)} className={btnSe}>Edit Wave</button>
                      {w.wave_number != null && (
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
      {attrition?.is_panel_study && (attrition.waves?.length ?? 0) >= 2 && (
        <div className={card}>
          <div className={sh}>Attrition Report</div>

          {/* Wave summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {attrition.waves.map((w, i) => (
              <div key={i} className="border border-catalan-border rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-catalan-primary">{w.unique_respondents}</div>
                <div className="text-sm font-medium text-catalan-text">{w.wave_label}</div>
                <div className="text-xs text-catalan-textMuted">{w.total} total submissions</div>
              </div>
            ))}
          </div>

          {/* Transition table */}
          {attrition.transitions && attrition.transitions.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-catalan-border">
              <table className="w-full text-sm">
                <thead className="bg-catalan-bg border-b border-catalan-border">
                  <tr>
                    {['Transition', 'Retained', 'Attrition', 'New Entrants', 'Drop Rate'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-catalan-border">
                  {attrition.transitions.map((t, i) => (
                    <tr key={i} className="hover:bg-catalan-hover transition-colors">
                      <td className="px-4 py-3 font-medium text-catalan-text">{t.from_wave} → {t.to_wave}</td>
                      <td className="px-4 py-3 text-green-400 font-semibold">{t.retained}</td>
                      <td className="px-4 py-3 text-catalan-error font-semibold">{t.lost}</td>
                      <td className="px-4 py-3 text-catalan-primary font-semibold">{t.new_entrants}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                          t.attrition_rate_pct > 20 ? 'bg-catalan-error/15 text-catalan-error' :
                          t.attrition_rate_pct > 10 ? 'bg-catalan-warning/15 text-catalan-warning' :
                          'bg-green-500/15 text-green-400'
                        }`}>
                          {t.attrition_rate_pct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Lost IDs */}
          {attrition.transitions?.some(t => t.lost_ids?.length) && (
            <div className="mt-4">
              <div className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wider mb-2">Dropped Respondent IDs (for follow-up)</div>
              {attrition.transitions.map((t, i) => t.lost_ids?.length > 0 && (
                <div key={i} className="mb-2">
                  <div className="text-xs text-catalan-textMuted mb-1">{t.from_wave} → {t.to_wave}: {t.lost_ids.length} dropped</div>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {t.lost_ids.slice(0, 50).map(id => (
                      <span key={id} className="px-1.5 py-0.5 text-xs bg-catalan-error/10 border border-catalan-error/20 rounded font-mono text-catalan-error">{id}</span>
                    ))}
                    {t.lost_ids.length > 50 && <span className="text-xs text-catalan-textMuted">+{t.lost_ids.length - 50} more</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {attrition?.is_panel_study && (attrition.waves?.length ?? 0) < 2 && (
        <div className="py-6 text-center text-catalan-textMuted text-sm">
          Attrition report requires at least 2 waves with data. Assign waves to questionnaires above.
        </div>
      )}
    </div>
  )
}

// ── Program picker ─────────────────────────────────────────────────────────────

function ProgramPicker({ value, onChange }: { value: string; onChange: (id: string, name: string) => void }) {
  const [programs, setPrograms] = useState<Program[]>([])
  useEffect(() => {
    api.get('/programs/').then(r => setPrograms(Array.isArray(r.data) ? r.data : [])).catch(() => {})
  }, [])
  return (
    <select className={`${sel} min-w-[220px]`} value={value}
      onChange={e => {
        const p = programs.find(p => p.id === e.target.value)
        onChange(e.target.value, p?.name ?? '')
        setLastProgram(e.target.value)
      }}>
      <option value="">— Select a program —</option>
      {programs.map(p => (
        <option key={p.id} value={p.id}>{p.name}{p.scheme_name ? ` · ${p.scheme_name}` : ''}</option>
      ))}
    </select>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type AnalyzerTab = 'overview' | 'tabulator' | 'panel'
const TABS: { key: AnalyzerTab; label: string }[] = [
  { key: 'overview',  label: 'Overview' },
  { key: 'tabulator', label: 'Tabulator' },
  { key: 'panel',     label: 'Panel Study' },
]

export default function FgAnalyzer() {
  const user = getStoredUser()
  const [programId, setProgramId] = useState(getLastProgram())
  const [progName, setProgName] = useState('')
  const [tab, setTab] = useState<AnalyzerTab>('overview')
  const [data, setData] = useState<AnalyzerData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadAnalyzer = useCallback(async (id: string) => {
    if (!id) return
    setLoading(true); setError('')
    try {
      const res = await api.get(`/fg/programs/${id}/analyzer-data`)
      const d = res.data
      if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Unexpected response shape')
      // Ensure array fields are always arrays
      d.trend = Array.isArray(d.trend) ? d.trend : []
      d.enumerators = Array.isArray(d.enumerators) ? d.enumerators : []
      d.wave_counts = Array.isArray(d.wave_counts) ? d.wave_counts : []
      d.column_headers = Array.isArray(d.column_headers) ? d.column_headers : []
      d.sample_rows = Array.isArray(d.sample_rows) ? d.sample_rows : []
      setData(d)
      setProgName(d.program_name)
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to load analyzer data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (programId) loadAnalyzer(programId) }, [programId, loadAnalyzer])

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={getNavItems(user?.role ?? '')} role={user?.role} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav
          title="FG Analyzer"
          breadcrumbs={[{ label: 'FG Analyzer' }]}
          rightContent={
            <div className="flex items-center gap-3">
              <ProgramPicker value={programId} onChange={(id, name) => { setProgramId(id); setProgName(name) }} />
              {programId && <button onClick={() => loadAnalyzer(programId)} className={btnSe}>Refresh</button>}
            </div>
          }
        />
        <main className="flex-1 overflow-auto">
          <div className="max-w-5xl mx-auto p-6">
            {!programId && (
              <div className="flex flex-col items-center justify-center h-64 text-catalan-textMuted">
                <div className="text-5xl mb-4">🔬</div>
                <p className="text-sm font-medium">Select a program from the dropdown above to begin analysis</p>
              </div>
            )}

            {programId && loading && (
              <div className="flex items-center justify-center h-64 text-catalan-textMuted text-sm">Loading analyzer data…</div>
            )}

            {programId && error && (
              <div className="p-4 rounded-xl bg-catalan-error/10 border border-catalan-error/30 text-catalan-error text-sm">{error}</div>
            )}

            {/* Launch banner — always visible once a program is selected */}
            {programId && !loading && (
              <div className="mb-6 bg-catalan-surface border border-catalan-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1">
                  <div className="text-base font-semibold text-catalan-text mb-1">TableForge — Data Analyzer Wizard</div>
                  <p className="text-sm text-catalan-textMuted leading-relaxed">
                    Build cross-tabs, frequency tables, and statistical summaries from your program data. Export to Excel with one click, generate AI-powered table suggestions, and run panel-study attrition reports — all in the full-screen wizard.
                  </p>
                </div>
                <button
                  onClick={() => {
                    const token = localStorage.getItem('fp_token')
                    window.location.href = `${window.location.origin}/analyzer/?fg_url=${encodeURIComponent(window.location.origin)}&program_id=${programId}&token=${token}`
                  }}
                  className="shrink-0 px-5 py-2.5 bg-catalan-primary text-catalan-bg rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
                >
                  Open Analyzer Wizard →
                </button>
              </div>
            )}

            {programId && data && !loading && (
              <>
                <div className="flex gap-1 mb-6 border-b border-catalan-border">
                  {TABS.map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)}
                      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                        tab === t.key ? 'border-catalan-primary text-catalan-primary' : 'border-transparent text-catalan-textMuted hover:text-catalan-text'
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>

                {tab === 'overview'  && <OverviewTab data={data} />}
                {tab === 'tabulator' && <TabulatorTab programId={programId} cols={data.column_headers} sampleRows={data.sample_rows ?? []} />}
                {tab === 'panel'     && <PanelStudyTab programId={programId} />}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
