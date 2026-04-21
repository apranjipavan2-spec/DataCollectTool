import { useState, useEffect } from 'react'
import api, { getStoredUser } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'

interface Program { id: string; name: string; scheme_name: string; status: string; total_target: number; total_collected: number; pct: number; overdue: number; at_risk: number }
interface ProgressRow {
  target_id: string; questionnaire_name: string; participant_type_name: string
  state: string; district: string; block: string; village: string
  target: number; collected: number; remaining: number; pct: number
  deadline: string | null; days_remaining: number | null; status: string
}
interface ProgressData {
  program_name: string; scheme_name: string
  summary: { total_target: number; total_collected: number; remaining: number; pct: number; overdue: number; at_risk: number }
  rows: ProgressRow[]
}
interface ParticipantType { id: string; name: string }
interface Questionnaire { id: string; name: string }

const STATUS_BADGE: Record<string, string> = {
  completed:   'bg-catalan-success/15 text-catalan-success',
  in_progress: 'bg-catalan-primary/10 text-catalan-primary',
  not_started: 'bg-catalan-textMuted/10 text-catalan-textMuted',
  at_risk:     'bg-catalan-warning/15 text-catalan-warning',
  overdue:     'bg-catalan-error/10 text-catalan-error',
}
const STATUS_ROW: Record<string, string> = {
  completed:   'bg-catalan-success/5',
  in_progress: '',
  not_started: 'bg-catalan-bg',
  at_risk:     'bg-catalan-warning/5',
  overdue:     'bg-catalan-error/5',
}

const inputCls = 'w-full border border-catalan-border rounded-lg px-2 py-1.5 text-sm bg-catalan-bg text-catalan-text placeholder:text-catalan-textMuted focus:ring-2 focus:ring-catalan-primary outline-none disabled:opacity-40'

function SummaryCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-catalan-surface border border-catalan-border rounded-xl p-4">
      <div className={`text-2xl font-bold ${color ?? 'text-catalan-text'}`}>{value}</div>
      <div className="text-sm text-catalan-textMuted mt-0.5">{label}</div>
      {sub && <div className="text-xs text-catalan-textMuted/70 mt-0.5">{sub}</div>}
    </div>
  )
}

function ProgressBar({ pct, size = 'md' }: { pct: number; size?: 'sm' | 'md' }) {
  const h = size === 'sm' ? 'h-1' : 'h-1.5'
  const color = pct >= 100 ? 'bg-catalan-success' : pct >= 70 ? 'bg-catalan-primary' : pct >= 30 ? 'bg-catalan-warning' : 'bg-catalan-error'
  return (
    <div className={`w-full bg-catalan-border rounded-full ${h}`}>
      <div className={`${h} rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

export default function ProgressDashboard() {
  const user = getStoredUser()
  const [programs, setPrograms] = useState<Program[]>([])
  const [selectedProg, setSelectedProg] = useState('')
  const [data, setData] = useState<ProgressData | null>(null)
  const [ptypes, setPtypes] = useState<ParticipantType[]>([])
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>([])
  const [filters, setFilters] = useState({ participant_type_id: '', questionnaire_id: '', district: '', block: '', status: '' })
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null)
  const [sortKey, setSortKey] = useState<'district' | 'pct' | 'status' | 'remaining'>('district')
  const [sortAsc, setSortAsc] = useState(true)

  useEffect(() => {
    api.get('/programs/overview').then(r => setPrograms(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedProg) { setData(null); return }
    setLoading(true)
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
    api.get(`/programs/${selectedProg}/progress`, { params })
      .then(r => {
        setData(r.data)
        const rows: ProgressRow[] = r.data.rows
        const pts = new Map<string, string>()
        const qs = new Map<string, string>()
        rows.forEach((row: any) => {
          if (row.participant_type_id && row.participant_type_name) pts.set(row.participant_type_id, row.participant_type_name)
          if (row.questionnaire_id && row.questionnaire_name) qs.set(row.questionnaire_id, row.questionnaire_name)
        })
        setPtypes([...pts.entries()].map(([id, name]) => ({ id, name })))
        setQuestionnaires([...qs.entries()].map(([id, name]) => ({ id, name })))
      })
      .finally(() => setLoading(false))
  }, [selectedProg, filters])

  const setFilter = (k: keyof typeof filters, v: string) => setFilters(p => ({ ...p, [k]: v }))

  const exportFile = async (type: 'xlsx' | 'pdf') => {
    if (!selectedProg) return
    setExporting(type)
    const params = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)))
    try {
      const r = await api.get(`/programs/${selectedProg}/progress/${type}`, { params, responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a'); a.href = url
      a.download = `progress.${type === 'pdf' ? 'html' : 'xlsx'}`; a.click()
      URL.revokeObjectURL(url)
    } finally { setExporting(null) }
  }

  const toggleSort = (k: typeof sortKey) => {
    if (sortKey === k) setSortAsc(p => !p)
    else { setSortKey(k); setSortAsc(true) }
  }

  const rows = (data?.rows ?? [])
    .filter(r => !search || [r.district, r.block, r.village, r.questionnaire_name, r.participant_type_name]
      .join(' ').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const v = sortKey === 'pct' ? a.pct - b.pct
        : sortKey === 'remaining' ? a.remaining - b.remaining
        : sortKey === 'status' ? a.status.localeCompare(b.status)
        : a.district.localeCompare(b.district)
      return sortAsc ? v : -v
    })

  const Th = ({ k, label }: { k: typeof sortKey; label: string }) => (
    <th
      className="px-3 py-2.5 text-left text-xs font-semibold text-catalan-textMuted uppercase tracking-wide cursor-pointer hover:text-catalan-text transition-colors"
      onClick={() => toggleSort(k)}
    >
      {label} {sortKey === k ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  )

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={getNavItems(user?.role ?? '')} role={user?.role} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav
          title="Progress"
          breadcrumbs={[{ label: 'Progress Dashboard' }]}
          rightContent={
            <div className="flex gap-2">
              <button
                disabled={!selectedProg || exporting === 'xlsx'}
                onClick={() => exportFile('xlsx')}
                className="px-3 py-1.5 text-sm border border-catalan-border rounded-lg bg-catalan-surface text-catalan-text hover:bg-catalan-hover disabled:opacity-40 transition-colors"
              >
                {exporting === 'xlsx' ? 'Exporting…' : '⬇ Excel'}
              </button>
              <button
                disabled={!selectedProg || exporting === 'pdf'}
                onClick={() => exportFile('pdf')}
                className="px-3 py-1.5 text-sm border border-catalan-border rounded-lg bg-catalan-surface text-catalan-text hover:bg-catalan-hover disabled:opacity-40 transition-colors"
              >
                {exporting === 'pdf' ? 'Exporting…' : '⬇ PDF Report'}
              </button>
            </div>
          }
        />

        <main className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto p-6">

            {/* Overview cards — cross-program */}
            {!selectedProg && programs.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                {programs.map(p => (
                  <div
                    key={p.id}
                    className="bg-catalan-surface border border-catalan-border rounded-xl p-4 cursor-pointer hover:border-catalan-primary/50 transition-colors"
                    onClick={() => setSelectedProg(p.id)}
                  >
                    <div className="flex items-start justify-between mb-1">
                      <div className="font-semibold text-sm text-catalan-text">{p.name}</div>
                      {p.overdue > 0 && (
                        <span className="text-xs bg-catalan-error/10 text-catalan-error px-1.5 py-0.5 rounded">
                          {p.overdue} overdue
                        </span>
                      )}
                    </div>
                    {p.scheme_name && <div className="text-xs text-catalan-textMuted mb-2">{p.scheme_name}</div>}
                    <div className="flex justify-between text-xs text-catalan-textMuted mb-1">
                      <span>{p.total_collected} / {p.total_target} collected</span>
                      <span className="font-medium text-catalan-text">{p.pct}%</span>
                    </div>
                    <ProgressBar pct={p.pct} />
                  </div>
                ))}
              </div>
            )}

            {!selectedProg && programs.length === 0 && (
              <div className="text-center py-16 text-catalan-textMuted">
                <div className="text-4xl mb-3">📈</div>
                <p className="font-medium text-catalan-text mb-1">No programs yet</p>
                <p className="text-sm">Create a program in the Programs tab to start tracking progress.</p>
              </div>
            )}

            {/* Filter bar */}
            <div className="bg-catalan-surface border border-catalan-border rounded-xl p-4 mb-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="text-xs text-catalan-textMuted font-medium">Program</label>
                  <select
                    className={`${inputCls} mt-0.5`}
                    value={selectedProg}
                    onChange={e => {
                      setSelectedProg(e.target.value)
                      setFilters({ participant_type_id: '', questionnaire_id: '', district: '', block: '', status: '' })
                    }}
                  >
                    <option value="">— All Programs —</option>
                    {programs.map(p => (
                      <option key={p.id} value={p.id}>{p.name}{p.scheme_name ? ` (${p.scheme_name})` : ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-catalan-textMuted font-medium">Participant Type</label>
                  <select className={`${inputCls} mt-0.5`} value={filters.participant_type_id}
                    onChange={e => setFilter('participant_type_id', e.target.value)} disabled={!selectedProg}>
                    <option value="">— All —</option>
                    {ptypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-catalan-textMuted font-medium">Questionnaire</label>
                  <select className={`${inputCls} mt-0.5`} value={filters.questionnaire_id}
                    onChange={e => setFilter('questionnaire_id', e.target.value)} disabled={!selectedProg}>
                    <option value="">— All —</option>
                    {questionnaires.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-catalan-textMuted font-medium">District</label>
                  <input className={`${inputCls} mt-0.5`} placeholder="Filter district…"
                    value={filters.district} onChange={e => setFilter('district', e.target.value)} disabled={!selectedProg} />
                </div>
                <div>
                  <label className="text-xs text-catalan-textMuted font-medium">Block</label>
                  <input className={`${inputCls} mt-0.5`} placeholder="Filter block…"
                    value={filters.block} onChange={e => setFilter('block', e.target.value)} disabled={!selectedProg} />
                </div>
                <div>
                  <label className="text-xs text-catalan-textMuted font-medium">Status</label>
                  <select className={`${inputCls} mt-0.5`} value={filters.status}
                    onChange={e => setFilter('status', e.target.value)} disabled={!selectedProg}>
                    <option value="">— All —</option>
                    {['not_started', 'in_progress', 'at_risk', 'completed', 'overdue'].map(s => (
                      <option key={s} value={s}>{s.replace('_', ' ')}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Summary cards */}
            {data && (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-4">
                <SummaryCard label="Target" value={data.summary.total_target} />
                <SummaryCard label="Collected" value={data.summary.total_collected} color="text-catalan-primary" />
                <SummaryCard label="Remaining" value={data.summary.remaining} color="text-catalan-textMuted" />
                <SummaryCard label="Complete" value={`${data.summary.pct}%`}
                  color={data.summary.pct >= 100 ? 'text-catalan-success' : 'text-catalan-primary'} />
                <SummaryCard label="Overdue" value={data.summary.overdue}
                  color={data.summary.overdue > 0 ? 'text-catalan-error' : 'text-catalan-textMuted'} />
                <SummaryCard label="At Risk" value={data.summary.at_risk}
                  color={data.summary.at_risk > 0 ? 'text-catalan-warning' : 'text-catalan-textMuted'} />
              </div>
            )}

            {/* Search + table */}
            {selectedProg && (
              <div className="bg-catalan-surface border border-catalan-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-catalan-border">
                  <input
                    className="w-full border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text placeholder:text-catalan-textMuted focus:ring-2 focus:ring-catalan-primary outline-none"
                    placeholder="Search by district, block, village, questionnaire…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>

                {loading ? (
                  <div className="py-12 text-center text-catalan-textMuted">Loading progress…</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-catalan-bg border-b border-catalan-border">
                        <tr>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Questionnaire</th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Type</th>
                          <Th k="district" label="District" />
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Block</th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Village</th>
                          <Th k="remaining" label="Target" />
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Collected</th>
                          <Th k="pct" label="%" />
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Progress</th>
                          <Th k="status" label="Status" />
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Deadline</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-catalan-border">
                        {rows.map(r => (
                          <tr key={r.target_id} className={`hover:bg-catalan-hover transition-colors ${STATUS_ROW[r.status] ?? ''}`}>
                            <td className="px-3 py-2.5 font-medium text-catalan-text">{r.questionnaire_name}</td>
                            <td className="px-3 py-2.5 text-catalan-textMuted">{r.participant_type_name || '—'}</td>
                            <td className="px-3 py-2.5 text-catalan-text">{r.district}</td>
                            <td className="px-3 py-2.5 text-catalan-textMuted">{r.block || '—'}</td>
                            <td className="px-3 py-2.5 text-catalan-textMuted">{r.village || '—'}</td>
                            <td className="px-3 py-2.5 text-center font-medium text-catalan-text">{r.target}</td>
                            <td className="px-3 py-2.5 text-center text-catalan-primary font-medium">{r.collected}</td>
                            <td className="px-3 py-2.5 text-center font-bold text-catalan-text">{r.pct}%</td>
                            <td className="px-3 py-2.5 w-24"><ProgressBar pct={r.pct} size="sm" /></td>
                            <td className="px-3 py-2.5">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[r.status] ?? 'bg-catalan-textMuted/10 text-catalan-textMuted'}`}>
                                {r.status.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-xs">
                              {r.deadline ? (
                                <span className={
                                  r.days_remaining !== null && r.days_remaining < 0
                                    ? 'text-catalan-error font-medium'
                                    : r.days_remaining !== null && r.days_remaining <= 7
                                    ? 'text-catalan-warning'
                                    : 'text-catalan-textMuted'
                                }>
                                  {r.deadline}{' '}
                                  {r.days_remaining !== null && (
                                    <span>({r.days_remaining < 0 ? `${Math.abs(r.days_remaining)}d late` : `${r.days_remaining}d left`})</span>
                                  )}
                                </span>
                              ) : '—'}
                            </td>
                          </tr>
                        ))}
                        {rows.length === 0 && !loading && (
                          <tr>
                            <td colSpan={11} className="py-10 text-center text-catalan-textMuted">
                              {data ? 'No location targets match your filters' : 'Select a program to view progress'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {rows.length > 0 && (
                  <div className="px-4 py-2 border-t border-catalan-border text-xs text-catalan-textMuted">
                    {rows.length} location target(s) shown
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
