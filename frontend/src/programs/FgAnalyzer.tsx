import { useState, useEffect, useCallback, useRef } from 'react'
import api, { getStoredUser } from '@/lib/api'
import AiProgressBar from '@/components/AiProgressBar'
import type { AiJob } from '@/lib/useAiJob'
import type { ApiFieldOption, TabulationRow } from '@/types/api'
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

interface ColHeader { id: string; label: string; type: string; options: ApiFieldOption[] }
interface Program { id: string; name: string; scheme_name: string; status: string }
interface ProgramSummary {
  program_id: string; program_name: string; scheme: string
  total_submissions: number; approved: number; flagged: number; synced: number
  violations: number; backcheck_required: number; quality_score: number
  trend: { date: string; count: number }[]
  status_counts: Record<string, number>
  enumerators: { name: string; count: number }[]
  wave_counts: { name: string; wave_number: number | null; count: number }[]
  column_count: number
  date_range: { first: string | null; last: string | null }
}

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

function OverviewTab({ summary, fullData }: { summary: ProgramSummary; fullData: AnalyzerData | null }) {
  const d = fullData ?? summary
  const quality_score = fullData ? fullData.quality.quality_score : summary.quality_score
  const flagged = fullData ? fullData.quality.flagged : summary.flagged
  const violations = fullData ? fullData.quality.violations : summary.violations
  const trend = d.trend ?? []
  const status_counts = d.status_counts ?? {}
  const enumerators = d.enumerators ?? []
  const wave_counts = d.wave_counts ?? []
  const statusBars = Object.entries(status_counts).map(([k, v]) => ({ label: k, value: v as number }))
  const enumBars   = enumerators.slice(0, 15).map(e => ({ label: e.name, value: e.count }))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Submissions" value={d.total_submissions} />
        <StatCard label="Quality Score" value={`${quality_score}%`}
          color={quality_score >= 80 ? 'text-green-400' : quality_score >= 60 ? 'text-catalan-warning' : 'text-catalan-error'} />
        <StatCard label="Flagged" value={flagged} color="text-catalan-warning" />
        <StatCard label="QC Violations" value={violations} color="text-catalan-error" />
      </div>

      {trend.length > 0 && (
        <div className={card}>
          <div className={sh}>Submission Trend (Daily)</div>
          <LineChart data={trend} height={200} />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {statusBars.length > 0 && (
          <div className={card}>
            <div className={sh}>Status Breakdown</div>
            <BarChart data={statusBars} height={160} />
          </div>
        )}
        {enumBars.length > 0 && (
          <div className={card}>
            <div className={sh}>Enumerator Performance (Top 15)</div>
            <BarChart data={enumBars} height={Math.max(160, enumBars.length * 34 + 8)} />
          </div>
        )}
      </div>

      {wave_counts.length > 0 && (
        <div className={card}>
          <div className={sh}>Questionnaire / Wave Breakdown</div>
          <div className="divide-y divide-catalan-border">
            {wave_counts.map((w, i) => (
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
        <div className={sh}>Form Fields ({fullData ? fullData.column_headers.length : summary.column_count ?? 0})</div>
        {fullData ? (
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
            {fullData.column_headers.map(c => (
              <span key={c.id} title={`id: ${c.id} | type: ${c.type}`}
                className="px-2 py-0.5 text-xs bg-catalan-hover border border-catalan-border rounded text-catalan-textMuted">
                {c.label}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-catalan-textMuted">Load Column Data in the Tabulator tab to see field names.</p>
        )}
      </div>
    </div>
  )
}

// ── Tabulator tab ─────────────────────────────────────────────────────────────

interface AiSuggestion {
  title: string; groupby_field: string; value_field: string
  aggregation: string; chart_type: string; description: string
  show_percent?: boolean; secondary_groupby?: string
  column_labels?: Record<string, string>
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

function TabulationCard({ tab, onDelete, onUpdate, programId }: {
  tab: SavedTabulation; onDelete: () => void; onUpdate: (t: SavedTabulation) => Promise<void> | void; programId: string
}) {
  const toast = useToast()
  const [expanded, setExpanded] = useState(false)
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(tab.feedback ?? null)
  const barData = tab.rows.slice(0, 20).map(r => ({ label: r.group, value: r.value }))
  const subKeys = tab.sub_keys ?? []

  // Polish (AI rename) state
  const [showPolish, setShowPolish] = useState(false)
  const [polishing, setPolishing] = useState(false)
  const [editTitle, setEditTitle] = useState(tab.title)
  const [editSubtitle, setEditSubtitle] = useState(tab.description || '')
  const [editColLabels, setEditColLabels] = useState<Record<string, string>>(tab.column_labels || {})

  // Interpretation state
  const [showInterpret, setShowInterpret] = useState(!!tab.interpretation)
  const [interpreting, setInterpreting] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [focusPrompt, setFocusPrompt] = useState('')
  const [interpretation, setInterpretation] = useState(tab.interpretation || '')
  const [interpChanged, setInterpChanged] = useState(false)
  // Side-by-side compare state (set when re-generating over an existing interpretation)
  const [pendingInterpretation, setPendingInterpretation] = useState<string | null>(null)

  const colLabels: Record<string, string> = { ...tab.column_labels, ...editColLabels }
  const lbl = (k: string) => (k && colLabels[k]) || k || ''

  const submitFeedback = async (vote: 'up' | 'down') => {
    const next = feedback === vote ? null : vote
    setFeedback(next)
    try {
      await api.patch(`/fg/programs/${programId}/analysis/tabulations/${tab.id}/feedback`, { vote: next })
    } catch { setFeedback(feedback) }
  }

  const copyCSV = () => {
    const headers = tab.is_cross_tab
      ? [lbl(tab.groupby_field), ...subKeys.map(k => lbl(k)), 'Total', ...(tab.show_percent ? ['%'] : [])]
      : [lbl(tab.groupby_field), lbl(tab.value_field !== '*' ? tab.value_field : '*'), ...(tab.show_percent ? ['%'] : [])]
    const rowLines = tab.rows.map(r =>
      tab.is_cross_tab
        ? [`"${r.group}"`, ...subKeys.map(k => r[k] ?? 0), r.value, ...(tab.show_percent ? [r.pct ?? ''] : [])]
        : [`"${r.group}"`, r.value, ...(tab.show_percent ? [r.pct ?? ''] : [])]
    )
    navigator.clipboard.writeText([headers.join(','), ...rowLines.map(l => l.join(','))].join('\n'))
  }

  const runPolish = async () => {
    setPolishing(true)
    try {
      const res = await api.post(`/fg/programs/${programId}/tabulate/polish`, {
        title: tab.title, groupby_field: tab.groupby_field, value_field: tab.value_field,
        aggregation: tab.aggregation, rows: tab.rows.slice(0, 30),
        is_cross_tab: tab.is_cross_tab ?? false, sub_keys: subKeys,
      })
      if (res.data.title) setEditTitle(res.data.title)
      if (res.data.subtitle) setEditSubtitle(res.data.subtitle)
      if (res.data.column_labels) setEditColLabels(res.data.column_labels)
      setShowPolish(true)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'AI rename failed')
    } finally { setPolishing(false) }
  }

  const applyPolish = async () => {
    const updated: SavedTabulation = { ...tab, title: editTitle, description: editSubtitle, column_labels: editColLabels }
    onUpdate(updated)
    setShowPolish(false)
    toast.success('Table updated')
  }

  const runInterpret = async () => {
    setInterpreting(true)
    setPendingInterpretation(null)
    const isRefinement = !!interpretation.trim()
    try {
      const res = await api.post(`/fg/programs/${programId}/tabulate/interpret`, {
        title: tab.title, subtitle: tab.description || '',
        groupby_field: tab.groupby_field, value_field: tab.value_field,
        aggregation: tab.aggregation, rows: tab.rows,
        is_cross_tab: tab.is_cross_tab ?? false, sub_keys: subKeys,
        show_percent: tab.show_percent ?? false,
        column_labels: colLabels, focus_prompt: focusPrompt,
        previous_interpretation: isRefinement ? interpretation : '',
      })
      const text = res.data.interpretation || ''
      if (isRefinement) {
        // Show compare view — don't overwrite yet
        setPendingInterpretation(text)
      } else {
        // First-time generate — apply directly
        setInterpretation(text)
        setInterpChanged(false)
        onUpdate({ ...tab, interpretation: text })
      }
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Interpretation failed')
    } finally { setInterpreting(false) }
  }

  const applyPending = () => {
    if (!pendingInterpretation) return
    setInterpretation(pendingInterpretation)
    setPendingInterpretation(null)
    setInterpChanged(false)
    onUpdate({ ...tab, interpretation: pendingInterpretation })
    toast.success('Refined interpretation applied')
  }

  const discardPending = () => setPendingInterpretation(null)

  const saveInterpretation = useCallback(async () => {
    try {
      await onUpdate({ ...tab, interpretation })
      setInterpChanged(false)
    } catch {
      toast.error('Auto-save failed — changes not persisted')
    }
  }, [tab, interpretation, onUpdate, toast])

  // Auto-save interpretation 2s after user stops typing
  useEffect(() => {
    if (!interpChanged) return
    const timer = setTimeout(saveInterpretation, 2000)
    return () => clearTimeout(timer)
  }, [interpretation, interpChanged, saveInterpretation])

  return (
    <div className={`${card} space-y-3`}>
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-catalan-text">{tab.title || 'Untitled'}</div>
          <div className="text-xs text-catalan-textMuted mt-0.5">
            {tab.description || `${tab.groupby_field}${tab.secondary_groupby ? ` × ${tab.secondary_groupby}` : ''} → ${tab.aggregation}(${tab.value_field})`}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
          <button onClick={() => submitFeedback('up')}
            className={`px-2 py-1.5 text-sm rounded-lg border transition-colors ${feedback === 'up' ? 'border-green-500 text-green-400 bg-green-500/10' : 'border-catalan-border text-catalan-textMuted hover:text-catalan-text'}`}>👍</button>
          <button onClick={() => submitFeedback('down')}
            className={`px-2 py-1.5 text-sm rounded-lg border transition-colors ${feedback === 'down' ? 'border-catalan-error text-catalan-error bg-catalan-error/10' : 'border-catalan-border text-catalan-textMuted hover:text-catalan-text'}`}>👎</button>
          <button onClick={copyCSV} className={btnSe}>CSV</button>
          <button onClick={runPolish} disabled={polishing} className={btnSe}>
            {polishing ? '✨…' : '✨ Rename'}
          </button>
          <button onClick={() => setShowInterpret(s => !s)}
            className={`${btnSe} ${showInterpret ? 'border-catalan-primary/60 text-catalan-primary' : ''}`}>
            {interpretation ? '📝 Edit Interpretation' : '📝 Interpret'}
          </button>
          <button onClick={() => setExpanded(e => !e)} className={btnSe}>{expanded ? 'Hide' : 'Expand'}</button>
          <button onClick={onDelete} className="px-2 py-1.5 text-sm border border-catalan-error/30 text-catalan-error rounded-lg hover:bg-catalan-error/10">✕</button>
        </div>
      </div>

      {/* ── AI Rename panel ── */}
      {showPolish && (
        <div className="border border-catalan-primary/30 bg-catalan-primary/5 rounded-lg p-4 space-y-3">
          <div className="text-xs font-semibold text-catalan-primary uppercase tracking-wider">AI Rename — Review & Apply</div>
          <div>
            <label className="text-xs text-catalan-textMuted block mb-1">Title</label>
            <input className={`${inp} w-full`} value={editTitle} onChange={e => setEditTitle(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-catalan-textMuted block mb-1">Subtitle</label>
            <input className={`${inp} w-full`} value={editSubtitle} onChange={e => setEditSubtitle(e.target.value)} />
          </div>
          {Object.keys(editColLabels).length > 0 && (
            <div>
              <label className="text-xs text-catalan-textMuted block mb-2">Column Labels (raw → clean)</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Object.entries(editColLabels).map(([raw, clean]) => (
                  <div key={raw} className="flex items-center gap-2">
                    <span className="text-xs text-catalan-textMuted font-mono shrink-0 max-w-[110px] truncate" title={raw}>{raw}</span>
                    <span className="text-xs text-catalan-textMuted">→</span>
                    <input className={`${inp} flex-1 py-1 text-xs`} value={clean}
                      onChange={e => setEditColLabels(p => ({ ...p, [raw]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={applyPolish} className={btnPr}>Apply</button>
            <button onClick={() => setShowPolish(false)} className={btnSe}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Chart ── */}
      {!tab.is_cross_tab && <BarChart data={barData} height={Math.max(120, Math.min(barData.length * 30 + 8, 300))} />}

      {/* ── Expanded data table ── */}
      {expanded && (
        <div className="overflow-x-auto rounded-lg border border-catalan-border">
          <table className="w-full text-sm">
            <thead className="bg-catalan-bg border-b border-catalan-border">
              <tr>
                <th className="px-3 py-2 text-left text-xs text-catalan-textMuted font-semibold uppercase">{lbl(tab.groupby_field)}</th>
                {tab.is_cross_tab ? subKeys.map(k => (
                  <th key={k} className="px-3 py-2 text-right text-xs text-catalan-textMuted font-semibold uppercase">{lbl(k)}</th>
                )) : null}
                <th className="px-3 py-2 text-right text-xs text-catalan-textMuted font-semibold uppercase">
                  {tab.is_cross_tab ? 'Total' : lbl(tab.value_field !== '*' ? tab.value_field : '*')}
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

      {/* ── Interpretation panel ── */}
      {showInterpret && (
        <div className="border border-catalan-border rounded-lg p-4 space-y-3 bg-catalan-hover/20">
          <div className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wider">AI Interpretation</div>

          <div>
            <div className="text-xs text-catalan-textMuted mb-2">Focus template</div>
            <div className="flex flex-wrap gap-1.5">
              {INTERPRET_TEMPLATES.map(t => (
                <button key={t.key} onClick={() => {
                  setSelectedTemplate(t.key)
                  if (t.prompt) setFocusPrompt(t.prompt)
                }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                    selectedTemplate === t.key
                      ? 'bg-catalan-primary text-catalan-bg border-catalan-primary'
                      : 'bg-catalan-hover text-catalan-text border-catalan-border hover:border-catalan-primary/40'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs text-catalan-textMuted mb-1">What to focus on (edit freely)</div>
            <textarea
              className={`${inp} w-full resize-y text-xs`} rows={3}
              value={focusPrompt}
              onChange={e => { setFocusPrompt(e.target.value); setSelectedTemplate('custom') }}
              placeholder="e.g. Focus on the gap between the highest and lowest values. Explain what this implies for program targeting in underperforming groups."
            />
          </div>

          <button onClick={runInterpret} disabled={interpreting} className={btnPr}>
            {interpreting ? '✨ Generating…' : interpretation ? '✨ Refine & Compare' : '✨ Generate Interpretation'}
          </button>

          {/* Side-by-side compare when re-generating */}
          {pendingInterpretation && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-catalan-border" />
                <span className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wider">Review Refinement</span>
                <div className="h-px flex-1 bg-catalan-border" />
              </div>
              <p className="text-xs text-catalan-textMuted">The AI read your previous interpretation and produced a refined version. Review both and apply the one you prefer — or edit the refined version before applying.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wider">Previous</div>
                  <div className="border border-catalan-border rounded-lg p-3 bg-catalan-bg text-sm text-catalan-textMuted leading-relaxed overflow-y-auto max-h-64"
                    style={{ fontFamily: 'Georgia, serif' }}>
                    {interpretation}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-catalan-primary uppercase tracking-wider">Refined</div>
                  <textarea
                    className={`${inp} w-full resize-y text-sm leading-relaxed max-h-64`}
                    style={{ fontFamily: 'Georgia, serif' }}
                    rows={8}
                    value={pendingInterpretation}
                    onChange={e => setPendingInterpretation(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={applyPending} className={btnPr}>Apply Refined Version</button>
                <button onClick={discardPending} className={btnSe}>Keep Previous</button>
              </div>
            </div>
          )}

          {/* Editable current interpretation (when no pending compare) */}
          {!pendingInterpretation && interpretation && (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between">
                <div className="text-xs text-catalan-textMuted">Edit below — auto-saved</div>
                {interpChanged && <div className="text-xs text-catalan-textMuted animate-pulse">saving…</div>}
              </div>
              <textarea
                className={`${inp} w-full resize-y text-sm leading-relaxed`}
                style={{ fontFamily: 'Georgia, serif' }}
                rows={7}
                value={interpretation}
                onChange={e => { setInterpretation(e.target.value); setInterpChanged(true) }}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Stored interpretation display (collapsed mode) ── */}
      {!showInterpret && interpretation && (
        <div className="px-3 py-2.5 bg-catalan-hover/30 border border-catalan-border/60 rounded-lg">
          <div className="text-xs text-catalan-textMuted font-medium mb-1">Interpretation</div>
          <p className="text-sm text-catalan-text leading-relaxed" style={{ fontFamily: 'Georgia, serif' }}>
            {interpretation.length > 300 ? interpretation.slice(0, 300) + '…' : interpretation}
          </p>
        </div>
      )}

      <div className="text-xs text-catalan-textMuted">{tab.total} total records · saved {new Date(tab.created_at).toLocaleString()}</div>
    </div>
  )
}

const INTERPRET_TEMPLATES = [
  { key: '',            label: 'General Overview',        prompt: '' },
  { key: 'distribution', label: 'Distribution & Spread',  prompt: 'Describe how values are distributed. Where is the concentration? What is the spread between the highest and lowest? Is the distribution even or skewed?' },
  { key: 'top_bottom',  label: 'High vs Low Performers',  prompt: 'Identify the top 3 and bottom 3 groups. Quantify the gap. Explain what the gap implies for the program and whether it is expected or surprising.' },
  { key: 'comparative', label: 'Group Comparison',        prompt: 'Compare groups against each other and against the overall average. Which groups are above average, which are below? Quantify the differences and note patterns.' },
  { key: 'equity',      label: 'Equity & Disparity',      prompt: 'Assess whether outcomes or benefits are equitably distributed. Identify which groups are underserved, overrepresented, or left behind. Quantify the disparity.' },
  { key: 'longitudinal', label: 'Change Over Time',       prompt: 'Analyse change across time periods or waves. What improved, what worsened, what stagnated? Quantify the change. Identify turning points or inflections.' },
  { key: 'cross_tab',   label: 'Interaction Effect',      prompt: 'Analyse how the two variables interact. Are there conditional patterns — where one group responds differently to the other variable? Note asymmetries and exceptions.' },
  { key: 'concentration', label: 'Concentration Analysis', prompt: 'Is value concentrated in a few groups or evenly spread? What proportion of the total does the top group account for? Is there a Pareto-type concentration?' },
  { key: 'outlier',     label: 'Outlier & Anomaly',       prompt: 'Flag any values that are unexpectedly high, low, or inconsistent. What makes them outliers? Are they data quality issues or genuine programmatic differences?' },
  { key: 'program_perf', label: 'Program Performance',    prompt: 'Interpret the data as a measure of program progress. Is the program on track? Where is performance strong and where does it need attention? What does this imply for the next phase?' },
  { key: 'custom',      label: 'Custom…',                 prompt: '' },
]

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

  // Smart Builder state
  const [smartMode, setSmartMode] = useState<'columns' | 'query'>('columns')
  const [smartColIds, setSmartColIds] = useState<string[]>([])
  const [smartColSearch, setSmartColSearch] = useState('')
  const [smartQuery, setSmartQuery] = useState('')
  const [smartBuilding, setSmartBuilding] = useState(false)
  const [smartSuggestion, setSmartSuggestion] = useState<AiSuggestion | null>(null)
  const [smartRunning, setSmartRunning] = useState(false)

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

  const handleTabUpdate = useCallback(async (updated: SavedTabulation) => {
    setSaved(prev => prev.map(t => t.id === updated.id ? updated : t))
    await saveTabulation(programId, updated)
  }, [programId])

  const callSmartBuild = async () => {
    if (smartMode === 'columns' && smartColIds.length === 0) {
      toast.error('Select at least one column'); return
    }
    if (smartMode === 'query' && !smartQuery.trim()) {
      toast.error('Enter a question'); return
    }
    setSmartBuilding(true); setSmartSuggestion(null)
    try {
      const colMeta = cols.map(c => ({ id: c.id, label: c.label, type: c.type }))
      const res = await api.post(`/fg/programs/${programId}/tabulate/smart-build`, {
        column_ids: smartMode === 'columns' ? smartColIds : [],
        column_headers: smartMode === 'columns'
          ? colMeta.filter(c => smartColIds.includes(c.id))
          : colMeta,
        query: smartQuery,
      })
      setSmartSuggestion(res.data.suggestion)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Smart build failed')
    } finally { setSmartBuilding(false) }
  }

  const runSmartSuggestion = async () => {
    if (!smartSuggestion) return
    setSmartRunning(true)
    try {
      const res = await api.post(`/fg/programs/${programId}/tabulate/execute`, {
        groupby_field: smartSuggestion.groupby_field,
        value_field: smartSuggestion.value_field || '*',
        aggregation: smartSuggestion.aggregation || 'count',
        chart_type: smartSuggestion.chart_type || 'bar',
        title: smartSuggestion.title,
        show_percent: smartSuggestion.show_percent ?? false,
        secondary_groupby: smartSuggestion.secondary_groupby ?? '',
      })
      const tab: SavedTabulation = {
        id: crypto.randomUUID(),
        title: smartSuggestion.title,
        description: smartSuggestion.description,
        groupby_field: smartSuggestion.groupby_field,
        value_field: smartSuggestion.value_field || '*',
        aggregation: smartSuggestion.aggregation || 'count',
        chart_type: smartSuggestion.chart_type || 'bar',
        rows: res.data.rows,
        total: res.data.total,
        created_at: new Date().toISOString(),
        show_percent: res.data.show_percent,
        secondary_groupby: res.data.secondary_groupby,
        sub_keys: res.data.sub_keys,
        is_cross_tab: res.data.is_cross_tab,
        column_labels: smartSuggestion.column_labels || {},
      }
      await saveTabulation(programId, tab)
      await reload()
      setSmartSuggestion(null)
      toast.success(`"${smartSuggestion.title}" built and saved`)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Build failed')
    } finally { setSmartRunning(false) }
  }

  const toggleSmartCol = (id: string) =>
    setSmartColIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
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
          <AiProgressBar
            job={{ status: 'running', steps: [AI_MSGS[autoMsgIdx]], result: null, error: null } satisfies AiJob}
            label="AI Insights"
          />
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

      {/* ── Smart Builder ── */}
      <div className={card}>
        <div className="flex items-center justify-between mb-1">
          <div className={`${sh} mb-0`}>Smart Builder</div>
          <span className="text-xs text-catalan-textMuted">AI reads your actual data values, not just column names</span>
        </div>
        <p className="text-xs text-catalan-textMuted mb-3">
          Pick specific columns and AI will inspect their real values to design the best table structure —
          rows, columns, aggregation, and clean labels all in one step.
          Or just ask in plain English.
        </p>

        {/* Mode toggle */}
        <div className="flex gap-1 mb-4 bg-catalan-hover rounded-lg p-1 w-fit">
          {(['columns', 'query'] as const).map(mode => (
            <button key={mode} onClick={() => { setSmartMode(mode); setSmartSuggestion(null) }}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                smartMode === mode ? 'bg-catalan-surface text-catalan-text shadow-sm' : 'text-catalan-textMuted hover:text-catalan-text'
              }`}>
              {mode === 'columns' ? '📊 Column Picker' : '💬 Ask a Question'}
            </button>
          ))}
        </div>

        {smartMode === 'columns' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                className={`${inp} flex-1`}
                placeholder="Search columns…"
                value={smartColSearch}
                onChange={e => setSmartColSearch(e.target.value)}
              />
              {smartColIds.length > 0 && (
                <button onClick={() => setSmartColIds([])} className={btnSe}>Clear</button>
              )}
            </div>
            <div className="border border-catalan-border rounded-lg max-h-48 overflow-y-auto divide-y divide-catalan-border/50">
              {cols
                .filter(c => !smartColSearch || c.label.toLowerCase().includes(smartColSearch.toLowerCase()) || c.id.toLowerCase().includes(smartColSearch.toLowerCase()))
                .map(c => (
                  <label key={c.id}
                    className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                      smartColIds.includes(c.id) ? 'bg-catalan-primary/5' : 'hover:bg-catalan-hover'
                    }`}>
                    <input type="checkbox" className="w-4 h-4 rounded accent-catalan-primary"
                      checked={smartColIds.includes(c.id)}
                      onChange={() => toggleSmartCol(c.id)} />
                    <span className="text-sm text-catalan-text flex-1 truncate">{c.label}</span>
                    <span className="text-xs text-catalan-textMuted font-mono shrink-0">{c.type}</span>
                  </label>
                ))}
            </div>
            {smartColIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {smartColIds.map(id => {
                  const c = cols.find(x => x.id === id)
                  return (
                    <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-catalan-primary/10 text-catalan-primary border border-catalan-primary/20 rounded-full">
                      {c?.label ?? id}
                      <button onClick={() => toggleSmartCol(id)} className="hover:text-catalan-error">×</button>
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {smartMode === 'query' && (
          <div className="space-y-2">
            <textarea
              className={`${inp} w-full resize-none`} rows={3}
              value={smartQuery}
              onChange={e => setSmartQuery(e.target.value)}
              placeholder={`e.g. "What is the average age of beneficiaries in each district by gender?"\n"Show beneficiary occupation breakdown by district with row percentages"\n"Compare survey completion across enumerators"`}
            />
            <p className="text-xs text-catalan-textMuted">AI will identify the right columns, aggregation, and structure from your question.</p>
          </div>
        )}

        <button
          onClick={callSmartBuild}
          disabled={smartBuilding || !cols.length}
          className={`${btnPr} mt-4`}
        >
          {smartBuilding ? '✨ Analysing data…' : '✨ Smart Build'}
        </button>

        {/* Suggestion result */}
        {smartSuggestion && (
          <div className="mt-4 border border-catalan-primary/30 bg-catalan-primary/5 rounded-xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-catalan-text">{smartSuggestion.title}</div>
                <div className="text-xs text-catalan-textMuted mt-0.5">{smartSuggestion.description}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[
                    { label: `Rows: ${(smartSuggestion.column_labels?.[smartSuggestion.groupby_field] ?? smartSuggestion.groupby_field)}` },
                    smartSuggestion.secondary_groupby
                      ? { label: `Cols: ${(smartSuggestion.column_labels?.[smartSuggestion.secondary_groupby] ?? smartSuggestion.secondary_groupby)}` }
                      : null,
                    { label: `${smartSuggestion.aggregation}${smartSuggestion.show_percent ? ' + %' : ''}` },
                    { label: `Chart: ${smartSuggestion.chart_type}` },
                  ].filter(Boolean).map((tag, i) => (
                    <span key={i} className="px-2 py-0.5 text-xs bg-catalan-primary/10 text-catalan-primary rounded-full">{tag!.label}</span>
                  ))}
                  {Object.keys(smartSuggestion.column_labels || {}).length > 0 && (
                    <span className="px-2 py-0.5 text-xs bg-green-500/10 text-green-500 rounded-full">✓ Labels pre-cleaned</span>
                  )}
                </div>
              </div>
              <button onClick={() => setSmartSuggestion(null)} className="text-catalan-textMuted hover:text-catalan-text shrink-0">✕</button>
            </div>
            <div className="flex gap-2">
              <button onClick={runSmartSuggestion} disabled={smartRunning} className={btnPr}>
                {smartRunning ? 'Building…' : '▶ Build This Table'}
              </button>
              <button onClick={callSmartBuild} disabled={smartBuilding} className={btnSe}>↻ Try Again</button>
            </div>
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
          {aiLoading && (
            <AiProgressBar
              job={{ status: 'running', steps: ['Analyzing columns and designing tabulations…'], result: null, error: null } satisfies AiJob}
              label="AI Suggest"
            />
          )}
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
              onDelete={async () => { await deleteTabulation(programId, tab.id); await reload() }}
              onUpdate={handleTabUpdate} />
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

// ── Panel Study tab (attrition report only — configure waves in Programs → Setup) ──

function PanelStudyTab({ programId }: { programId: string }) {
  const [attrition, setAttrition] = useState<AttritionData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get(`/fg/programs/${programId}/attrition`)
      .then(r => setAttrition(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [programId])

  if (loading) return <div className="py-8 text-center text-catalan-textMuted text-sm">Loading…</div>

  if (!attrition?.is_panel_study) {
    return (
      <div className={`${card} text-center py-10`}>
        <div className="text-3xl mb-2">🔗</div>
        <div className="text-sm font-medium text-catalan-text mb-1">Panel Study not enabled</div>
        <div className="text-xs text-catalan-textMuted">Enable panel mode and assign waves in <strong>Programs → Setup</strong>.</div>
      </div>
    )
  }

  if ((attrition.waves?.length ?? 0) < 2) {
    return (
      <div className={`${card} text-center py-10`}>
        <div className="text-3xl mb-2">📊</div>
        <div className="text-sm font-medium text-catalan-text mb-1">Not enough waves yet</div>
        <div className="text-xs text-catalan-textMuted">Assign at least 2 waves with data in <strong>Programs → Setup</strong> to see the attrition report.</div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
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

    </div>
  )
}

// ── CSV Upload tab (org_admin only) ──────────────────────────────────────────

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return { headers: [], rows: [] }
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim())
  const rows = lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.replace(/^"|"$/g, '').trim())
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = vals[i] ?? '' })
    return obj
  })
  return { headers, rows }
}

function CsvTab() {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [fileName, setFileName] = useState('')
  const [groupby, setGroupby] = useState('')
  const [valueField, setValueField] = useState('*')
  const [aggregation, setAggregation] = useState('count')
  const [chartType, setChartType] = useState('bar')
  const [title, setTitle] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<any | null>(null)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = ev => {
      const { headers: h, rows: r } = parseCsv(ev.target?.result as string)
      setHeaders(h); setRows(r); setFileName(f.name)
      setGroupby(h[0] ?? ''); setValueField('*'); setResult(null)
    }
    reader.readAsText(f)
  }

  const runTable = async () => {
    if (!groupby || rows.length === 0) return
    setRunning(true)
    try {
      const res = await api.post('/fg/tabulate-csv', {
        rows, groupby_field: groupby,
        value_field: valueField || '*', aggregation,
        chart_type: chartType,
        title: title || `${groupby} breakdown`,
        show_percent: false,
      })
      setResult(res.data)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Tabulation failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className={card}>
        <div className={sh}>Upload CSV File</div>
        <p className="text-xs text-catalan-textMuted mb-3">
          Upload any CSV file to build cross-tabulation tables. Only visible to Org Admin.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => fileRef.current?.click()} className={btnPr}>
            Choose CSV
          </button>
          {fileName && <span className="text-sm text-catalan-textMuted">{fileName} · {rows.length} rows</span>}
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
        </div>
      </div>

      {headers.length > 0 && (
        <div className={card}>
          <div className={sh}>Build Table</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-xs text-catalan-textMuted block mb-1">Group by *</label>
              <select className={`${sel} w-full`} value={groupby} onChange={e => setGroupby(e.target.value)}>
                {headers.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-catalan-textMuted block mb-1">Value field</label>
              <select className={`${sel} w-full`} value={valueField} onChange={e => setValueField(e.target.value)}>
                <option value="*">Count of records (*)</option>
                {headers.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-catalan-textMuted block mb-1">Aggregation</label>
              <select className={`${sel} w-full`} value={aggregation} onChange={e => setAggregation(e.target.value)}>
                <option value="count">Count</option>
                <option value="sum">Sum</option>
                <option value="mean">Mean</option>
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
              <label className="text-xs text-catalan-textMuted block mb-1">Title (optional)</label>
              <input className={`${inp} w-full`} value={title} onChange={e => setTitle(e.target.value)}
                placeholder="e.g. District-wise count" />
            </div>
          </div>
          <button onClick={runTable} disabled={running || !groupby} className={btnPr}>
            {running ? 'Running…' : 'Build Table'}
          </button>
        </div>
      )}

      {result && (
        <div className={card}>
          <div className="font-semibold text-catalan-text mb-3">{result.title || 'Result'}</div>
          <BarChart data={result.rows.slice(0, 20).map((r: TabulationRow) => ({ label: r.group, value: r.value }))}
            height={Math.max(120, Math.min(result.rows.length * 30 + 8, 300))} />
          <div className="overflow-x-auto rounded-lg border border-catalan-border mt-4">
            <table className="w-full text-sm">
              <thead className="bg-catalan-bg border-b border-catalan-border">
                <tr>
                  <th className="px-3 py-2 text-left text-xs text-catalan-textMuted font-semibold uppercase">{result.groupby_field}</th>
                  <th className="px-3 py-2 text-right text-xs text-catalan-textMuted font-semibold uppercase">{result.aggregation}({result.value_field})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-catalan-border">
                {result.rows.map((r: TabulationRow, i: number) => (
                  <tr key={i} className="hover:bg-catalan-hover">
                    <td className="px-3 py-2 text-catalan-text">{r.group}</td>
                    <td className="px-3 py-2 text-right font-semibold text-catalan-primary">{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-catalan-textMuted mt-2">{result.total} total records</div>
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

type AnalyzerTab = 'tabulator' | 'panel' | 'csv'

export default function FgAnalyzer() {
  const user = getStoredUser()
  const toast = useToast()
  const isMasterAdmin = user?.role === 'master_admin'
  const TABS: { key: AnalyzerTab; label: string }[] = [
    { key: 'tabulator', label: 'Tabulator' },
    { key: 'panel',     label: 'Panel Study' },
    ...(isMasterAdmin ? [{ key: 'csv' as AnalyzerTab, label: 'CSV Upload' }] : []),
  ]
  const [programId, setProgramId] = useState(getLastProgram())
  const [tab, setTab] = useState<AnalyzerTab>('tabulator')
  const [summary, setSummary] = useState<ProgramSummary | null>(null)
  const [data, setData] = useState<AnalyzerData | null>(null)
  const [loading, setLoading] = useState(false)
  const [colDataLoading, setColDataLoading] = useState(false)
  const [error, setError] = useState('')

  // Fast summary load — no row fetching
  const loadSummary = useCallback(async (id: string) => {
    if (!id) return
    setLoading(true); setError(''); setSummary(null); setData(null)
    try {
      const res = await api.get(`/fg/programs/${id}/summary`)
      const d = res.data
      setSummary(d)
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to load program summary')
    } finally {
      setLoading(false)
    }
  }, [])

  // Full column data — only when user clicks "Load Column Data"
  const loadColumnData = useCallback(async (id: string) => {
    if (!id) return
    setColDataLoading(true)
    try {
      const res = await api.get(`/fg/programs/${id}/analyzer-data`)
      const d = res.data
      if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Unexpected response shape')
      d.trend = Array.isArray(d.trend) ? d.trend : []
      d.enumerators = Array.isArray(d.enumerators) ? d.enumerators : []
      d.wave_counts = Array.isArray(d.wave_counts) ? d.wave_counts : []
      d.column_headers = Array.isArray(d.column_headers) ? d.column_headers : []
      d.sample_rows = Array.isArray(d.sample_rows) ? d.sample_rows : []
      setData(d)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to load column data')
    } finally {
      setColDataLoading(false)
    }
  }, [toast])

  const [savedTabs, setSavedTabs] = useState<SavedTabulation[]>([])
  const loadSaved = useCallback(async (id: string) => {
    setSavedTabs(loadTabulationsCache(id))
    setSavedTabs(await loadTabulations(id))
  }, [])

  useEffect(() => { if (programId) loadSummary(programId) }, [programId, loadSummary])
  useEffect(() => { if (programId) loadSaved(programId) }, [programId, loadSaved])

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={getNavItems(user?.role ?? '')} role={user?.role} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav
          titleNode={
            <div className="flex items-center gap-2.5">
              <a href="/" className="flex items-center" title="Go to dashboard">
                <img src="/logo-wide.png" alt="FieldGovern" className="h-7 w-auto object-contain hover:opacity-80 transition-opacity" />
              </a>
              <span className="text-catalan-textMuted font-medium text-sm hidden sm:inline">·</span>
              <span className="text-catalan-text font-semibold text-base hidden sm:inline">Analyzer</span>
            </div>
          }
          rightContent={
            <div className="flex items-center gap-3">
              <ProgramPicker value={programId} onChange={(id) => { setProgramId(id) }} />
              {programId && <button onClick={() => loadSummary(programId)} className={btnSe}>Refresh</button>}
            </div>
          }
        />
        <main className="flex-1 overflow-auto">
          <div className="w-full p-6">
            {!programId && (
              <div className="flex flex-col items-center justify-center h-64 text-catalan-textMuted">
                <div className="text-5xl mb-4">🔬</div>
                <p className="text-sm font-medium">Select a program from the dropdown above to begin analysis</p>
              </div>
            )}

            {programId && loading && (
              <div className="flex items-center justify-center h-64 text-catalan-textMuted text-sm">Loading program summary…</div>
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

            {/* CSV Upload tab is always accessible for master_admin, no program required */}
            {isMasterAdmin && !programId && (
              <div className="flex gap-1 mb-6 border-b border-catalan-border">
                <button onClick={() => setTab('csv')}
                  className="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors border-catalan-primary text-catalan-primary">
                  CSV Upload
                </button>
              </div>
            )}
            {isMasterAdmin && !programId && <CsvTab />}

            {programId && summary && !loading && (
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

                {tab === 'tabulator' && (
                  data
                    ? <TabulatorTab programId={programId} cols={data.column_headers} sampleRows={data.sample_rows ?? []} />
                    : (
                      <div className="space-y-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <button
                            onClick={() => loadColumnData(programId)}
                            disabled={colDataLoading}
                            className={`${card} flex flex-col items-start gap-3 text-left hover:border-catalan-primary/50 hover:bg-catalan-primary/5 transition-all disabled:opacity-40 cursor-pointer`}
                          >
                            <div className="text-2xl">🤖</div>
                            <div>
                              <div className="text-sm font-semibold text-catalan-text mb-1">
                                {colDataLoading ? 'Loading…' : 'Build with AI'}
                              </div>
                              <p className="text-xs text-catalan-textMuted leading-relaxed">
                                Load your column data and let AI suggest cross-tabulations, run Smart Builder, and generate AI-powered insights from your program data.
                              </p>
                            </div>
                          </button>
                          <button
                            onClick={() => {
                              const token = localStorage.getItem('fp_token')
                              window.location.href = `${window.location.origin}/analyzer/?fg_url=${encodeURIComponent(window.location.origin)}&program_id=${programId}&token=${token}`
                            }}
                            className={`${card} flex flex-col items-start gap-3 text-left hover:border-catalan-primary/50 hover:bg-catalan-primary/5 transition-all cursor-pointer`}
                          >
                            <div className="text-2xl">✏️</div>
                            <div>
                              <div className="text-sm font-semibold text-catalan-text mb-1">Build Manually</div>
                              <p className="text-xs text-catalan-textMuted leading-relaxed">
                                Open the full Analyzer Wizard to build cross-tabs, frequency tables, and statistical summaries manually with complete control.
                              </p>
                            </div>
                          </button>
                        </div>

                        {savedTabs.length > 0 && (
                          <div>
                            <div className={sh}>Recent Tabulations</div>
                            <div className="space-y-4">
                              {savedTabs.map(t => (
                                <TabulationCard key={t.id} tab={t} programId={programId}
                                  onDelete={async () => { await deleteTabulation(programId, t.id); await loadSaved(programId) }}
                                  onUpdate={async (updated) => {
                                    setSavedTabs(prev => prev.map(x => x.id === updated.id ? updated : x))
                                    await saveTabulation(programId, updated)
                                  }}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                )}
                {tab === 'panel'     && <PanelStudyTab programId={programId} />}
                {tab === 'csv'       && <CsvTab />}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
