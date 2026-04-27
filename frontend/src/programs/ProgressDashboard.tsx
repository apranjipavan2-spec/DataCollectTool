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

  const selectedProgData = programs.find(p => p.id === selectedProg)

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={getNavItems(user?.role ?? '')} role={user?.role} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav
          title="Progress"
          breadcrumbs={[{ label: 'Progress Dashboard' }]}
          rightContent={
            selectedProg ? (
              <div className="flex gap-2">
                <button onClick={() => { setSelectedProg(''); setData(null) }}
                  className="px-3 py-1.5 text-sm border border-catalan-border rounded-lg text-catalan-textMuted hover:bg-catalan-hover transition-colors">
                  ← All Programs
                </button>
                <button disabled={exporting === 'xlsx'} onClick={() => exportFile('xlsx')}
                  className="px-3 py-1.5 text-sm border border-catalan-border rounded-lg bg-catalan-surface text-catalan-text hover:bg-catalan-hover disabled:opacity-40 transition-colors">
                  {exporting === 'xlsx' ? 'Exporting…' : '⬇ Excel'}
                </button>
                <button disabled={exporting === 'pdf'} onClick={() => exportFile('pdf')}
                  className="px-3 py-1.5 text-sm border border-catalan-border rounded-lg bg-catalan-surface text-catalan-text hover:bg-catalan-hover disabled:opacity-40 transition-colors">
                  {exporting === 'pdf' ? 'Exporting…' : '⬇ PDF'}
                </button>
              </div>
            ) : null
          }
        />

        <main className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto p-6">

            {/* ── Program tile grid ── */}
            {!selectedProg && (
              <>
                {programs.length === 0 ? (
                  <div className="text-center py-16 text-catalan-textMuted">
                    <div className="text-4xl mb-3">📈</div>
                    <p className="font-medium text-catalan-text mb-1">No active programs</p>
                    <p className="text-sm">Create a program in the Programs page to start tracking progress.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {programs.map(p => (
                      <div
                        key={p.id}
                        className="bg-catalan-surface border border-catalan-border rounded-xl p-5 cursor-pointer hover:border-catalan-primary/60 hover:shadow-md transition-all group"
                        onClick={() => {
                          setSelectedProg(p.id)
                          setFilters({ participant_type_id: '', questionnaire_id: '', district: '', block: '', status: '' })
                        }}
                      >
                        <div className="flex items-start justify-between mb-1.5">
                          <div className="font-semibold text-catalan-text group-hover:text-catalan-primary transition-colors leading-tight">{p.name}</div>
                          <div className="flex gap-1 flex-shrink-0 ml-2">
                            {p.overdue > 0 && (
                              <span className="text-xs bg-catalan-error/10 text-catalan-error px-1.5 py-0.5 rounded-full font-medium">
                                {p.overdue} overdue
                              </span>
                            )}
                            {p.at_risk > 0 && (
                              <span className="text-xs bg-catalan-warning/10 text-catalan-warning px-1.5 py-0.5 rounded-full font-medium">
                                {p.at_risk} at risk
                              </span>
                            )}
                          </div>
                        </div>
                        {p.scheme_name && <div className="text-xs text-catalan-textMuted mb-3">{p.scheme_name}</div>}
                        <div className="flex justify-between text-xs text-catalan-textMuted mb-1.5">
                          <span>{p.total_collected.toLocaleString()} / {p.total_target.toLocaleString()} collected</span>
                          <span className={`font-bold ${p.pct >= 100 ? 'text-catalan-success' : p.pct >= 70 ? 'text-catalan-primary' : p.pct >= 30 ? 'text-catalan-warning' : 'text-catalan-error'}`}>
                            {p.pct}%
                          </span>
                        </div>
                        <ProgressBar pct={p.pct} />
                        <div className="mt-3 flex items-center justify-between text-xs">
                          <span className={`px-2 py-0.5 rounded-full font-medium ${p.status === 'active' ? 'bg-catalan-success/10 text-catalan-success' : 'bg-catalan-primary/10 text-catalan-primary'}`}>
                            {p.status}
                          </span>
                          <span className="text-catalan-primary group-hover:underline text-xs">View details →</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── Selected program detail ── */}
            {selectedProg && (
              <>
                {/* Program summary tile at top */}
                {selectedProgData && (
                  <div className="bg-catalan-surface border border-catalan-border rounded-xl p-5 mb-5">
                    <div className="flex items-start justify-between mb-1">
                      <div>
                        <h2 className="text-lg font-bold text-catalan-text">{selectedProgData.name}</h2>
                        {selectedProgData.scheme_name && <p className="text-sm text-catalan-textMuted">{selectedProgData.scheme_name}</p>}
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${selectedProgData.status === 'active' ? 'bg-catalan-success/10 text-catalan-success' : 'bg-catalan-primary/10 text-catalan-primary'}`}>
                        {selectedProgData.status}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-3">
                      <SummaryCard label="Target" value={selectedProgData.total_target.toLocaleString()} />
                      <SummaryCard label="Collected" value={selectedProgData.total_collected.toLocaleString()} color="text-catalan-primary" />
                      <SummaryCard label="Remaining" value={Math.max(0, selectedProgData.total_target - selectedProgData.total_collected).toLocaleString()} color="text-catalan-textMuted" />
                      <SummaryCard label="Complete" value={`${selectedProgData.pct}%`}
                        color={selectedProgData.pct >= 100 ? 'text-catalan-success' : 'text-catalan-primary'} />
                      <SummaryCard label="Overdue" value={selectedProgData.overdue}
                        color={selectedProgData.overdue > 0 ? 'text-catalan-error' : 'text-catalan-textMuted'} />
                      <SummaryCard label="At Risk" value={selectedProgData.at_risk}
                        color={selectedProgData.at_risk > 0 ? 'text-catalan-warning' : 'text-catalan-textMuted'} />
                    </div>
                    <div className="mt-3">
                      <ProgressBar pct={selectedProgData.pct} />
                    </div>
                  </div>
                )}

                {/* Filters */}
                <div className="bg-catalan-surface border border-catalan-border rounded-xl p-4 mb-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    <div>
                      <label className="text-xs text-catalan-textMuted font-medium">Participant Type</label>
                      <select className={`${inputCls} mt-0.5`} value={filters.participant_type_id}
                        onChange={e => setFilter('participant_type_id', e.target.value)}>
                        <option value="">— All —</option>
                        {ptypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-catalan-textMuted font-medium">Questionnaire</label>
                      <select className={`${inputCls} mt-0.5`} value={filters.questionnaire_id}
                        onChange={e => setFilter('questionnaire_id', e.target.value)}>
                        <option value="">— All —</option>
                        {questionnaires.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-catalan-textMuted font-medium">District</label>
                      <input className={`${inputCls} mt-0.5`} placeholder="Filter district…"
                        value={filters.district} onChange={e => setFilter('district', e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-catalan-textMuted font-medium">Block</label>
                      <input className={`${inputCls} mt-0.5`} placeholder="Filter block…"
                        value={filters.block} onChange={e => setFilter('block', e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-catalan-textMuted font-medium">Status</label>
                      <select className={`${inputCls} mt-0.5`} value={filters.status}
                        onChange={e => setFilter('status', e.target.value)}>
                        <option value="">— All —</option>
                        {['not_started', 'in_progress', 'at_risk', 'completed', 'overdue'].map(s => (
                          <option key={s} value={s}>{s.replace('_', ' ')}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Location-target detail table */}
                <div className="bg-catalan-surface border border-catalan-border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-catalan-border flex items-center gap-3">
                    <input
                      className="flex-1 border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text placeholder:text-catalan-textMuted focus:ring-2 focus:ring-catalan-primary outline-none"
                      placeholder="Search by district, block, village, questionnaire…"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                    <span className="text-xs text-catalan-textMuted whitespace-nowrap">
                      {loading ? 'Loading…' : `${rows.length} row(s)`}
                    </span>
                  </div>

                  {loading ? (
                    <div className="py-12 text-center text-catalan-textMuted">Loading location-level progress…</div>
                  ) : rows.length === 0 && data ? (
                    <div className="py-10 text-center text-catalan-textMuted">
                      <div className="text-3xl mb-3">📍</div>
                      <p className="font-medium text-catalan-text mb-1">No location targets set up</p>
                      <p className="text-sm max-w-md mx-auto">
                        This program doesn't have location targets configured yet.
                        Go to <strong>Programs</strong> → select this program → add questionnaires with location targets to see per-location progress here.
                      </p>
                      <p className="text-sm text-catalan-primary mt-2">
                        Overall progress is shown in the summary above.
                      </p>
                    </div>
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
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
