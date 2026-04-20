import { useState, useEffect } from 'react'
import api, { getStoredUser } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import { getNavItems } from '@/lib/navigation'

interface Program { id: string; name: string; scheme_name: string; status: string; total_target: number; total_collected: number; pct: number; overdue: number; at_risk: number }
interface ProgressRow {
  target_id: string; questionnaire_name: string; participant_type_name: string
  state: string; district: string; block: string; village: string
  target: number; collected: number; remaining: number; pct: number
  deadline: string | null; days_remaining: number | null; status: string
}
interface ProgressData { program_name: string; scheme_name: string; summary: { total_target: number; total_collected: number; remaining: number; pct: number; overdue: number; at_risk: number }; rows: ProgressRow[] }
interface ParticipantType { id: string; name: string }
interface Questionnaire { id: string; name: string }

const STATUS_COLOR: Record<string, string> = {
  completed: 'bg-green-100 text-green-700', in_progress: 'bg-blue-100 text-blue-700',
  not_started: 'bg-gray-100 text-gray-500', at_risk: 'bg-yellow-100 text-yellow-700', overdue: 'bg-red-100 text-red-700',
}
const STATUS_ROW: Record<string, string> = {
  completed: 'bg-green-50', in_progress: '', not_started: 'bg-gray-50', at_risk: 'bg-yellow-50', overdue: 'bg-red-50',
}

function SummaryCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white border rounded-xl p-4">
      <div className={`text-2xl font-bold ${color ?? 'text-gray-900'}`}>{value}</div>
      <div className="text-sm text-gray-500 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function ProgressBar({ pct, size = 'md' }: { pct: number; size?: 'sm' | 'md' }) {
  const h = size === 'sm' ? 'h-1' : 'h-1.5'
  const color = pct >= 100 ? 'bg-green-500' : pct >= 70 ? 'bg-blue-500' : pct >= 30 ? 'bg-yellow-400' : 'bg-red-400'
  return <div className={`w-full bg-gray-100 rounded-full ${h}`}><div className={`${h} rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div>
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
        // Extract unique participant types and questionnaires for filter dropdowns
        const rows: ProgressRow[] = r.data.rows
        const pts = new Map<string, string>(); const qs = new Map<string, string>()
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

  const toggleSort = (k: typeof sortKey) => { if (sortKey === k) setSortAsc(p => !p); else { setSortKey(k); setSortAsc(true) } }

  const rows = (data?.rows ?? [])
    .filter(r => !search || [r.district, r.block, r.village, r.questionnaire_name, r.participant_type_name].join(' ').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const v = sortKey === 'pct' ? a.pct - b.pct : sortKey === 'remaining' ? a.remaining - b.remaining
        : sortKey === 'status' ? a.status.localeCompare(b.status) : a.district.localeCompare(b.district)
      return sortAsc ? v : -v
    })

  const Th = ({ k, label }: { k: typeof sortKey; label: string }) => (
    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:text-gray-900"
      onClick={() => toggleSort(k)}>
      {label} {sortKey === k ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  )

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar items={getNavItems(user?.role ?? '')} />
      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Progress Dashboard</h1>
              <p className="text-sm text-gray-500 mt-0.5">Track collection progress across programs, locations, and participant types</p>
            </div>
            <div className="flex gap-2">
              <button disabled={!selectedProg || exporting === 'xlsx'} onClick={() => exportFile('xlsx')}
                className="px-3 py-2 text-sm border rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40">
                {exporting === 'xlsx' ? 'Exporting…' : '⬇ Excel'}
              </button>
              <button disabled={!selectedProg || exporting === 'pdf'} onClick={() => exportFile('pdf')}
                className="px-3 py-2 text-sm border rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40">
                {exporting === 'pdf' ? 'Exporting…' : '⬇ PDF Report'}
              </button>
            </div>
          </div>

          {/* Overview cards — cross-program */}
          {!selectedProg && programs.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {programs.map(p => (
                <div key={p.id} className="bg-white border rounded-xl p-4 cursor-pointer hover:border-blue-400 transition-colors"
                  onClick={() => setSelectedProg(p.id)}>
                  <div className="flex items-start justify-between mb-1">
                    <div className="font-semibold text-sm">{p.name}</div>
                    {p.overdue > 0 && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">{p.overdue} overdue</span>}
                  </div>
                  {p.scheme_name && <div className="text-xs text-gray-400 mb-2">{p.scheme_name}</div>}
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{p.total_collected} / {p.total_target} collected</span>
                    <span className="font-medium">{p.pct}%</span>
                  </div>
                  <ProgressBar pct={p.pct} />
                </div>
              ))}
            </div>
          )}

          {/* Program selector + filters */}
          <div className="bg-white border rounded-xl p-4 mb-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <label className="text-xs text-gray-500 font-medium">Program</label>
                <select className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" value={selectedProg}
                  onChange={e => { setSelectedProg(e.target.value); setFilters({ participant_type_id: '', questionnaire_id: '', district: '', block: '', status: '' }) }}>
                  <option value="">— All Programs —</option>
                  {programs.map(p => <option key={p.id} value={p.id}>{p.name}{p.scheme_name ? ` (${p.scheme_name})` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium">Participant Type</label>
                <select className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" value={filters.participant_type_id}
                  onChange={e => setFilter('participant_type_id', e.target.value)} disabled={!selectedProg}>
                  <option value="">— All —</option>
                  {ptypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium">Questionnaire</label>
                <select className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" value={filters.questionnaire_id}
                  onChange={e => setFilter('questionnaire_id', e.target.value)} disabled={!selectedProg}>
                  <option value="">— All —</option>
                  {questionnaires.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium">District</label>
                <input className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" placeholder="Filter district…"
                  value={filters.district} onChange={e => setFilter('district', e.target.value)} disabled={!selectedProg} />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium">Block</label>
                <input className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" placeholder="Filter block…"
                  value={filters.block} onChange={e => setFilter('block', e.target.value)} disabled={!selectedProg} />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium">Status</label>
                <select className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" value={filters.status}
                  onChange={e => setFilter('status', e.target.value)} disabled={!selectedProg}>
                  <option value="">— All —</option>
                  {['not_started', 'in_progress', 'at_risk', 'completed', 'overdue'].map(s =>
                    <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Summary cards */}
          {data && (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-4">
              <SummaryCard label="Target" value={data.summary.total_target} />
              <SummaryCard label="Collected" value={data.summary.total_collected} color="text-blue-700" />
              <SummaryCard label="Remaining" value={data.summary.remaining} color="text-gray-500" />
              <SummaryCard label="Complete" value={`${data.summary.pct}%`} color={data.summary.pct >= 100 ? 'text-green-600' : 'text-blue-600'} />
              <SummaryCard label="Overdue" value={data.summary.overdue} color={data.summary.overdue > 0 ? 'text-red-600' : 'text-gray-400'} />
              <SummaryCard label="At Risk" value={data.summary.at_risk} color={data.summary.at_risk > 0 ? 'text-yellow-600' : 'text-gray-400'} />
            </div>
          )}

          {/* Search + table */}
          {selectedProg && (
            <div className="bg-white border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b">
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Search by district, block, village, questionnaire…"
                  value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              {loading ? (
                <div className="py-12 text-center text-gray-400">Loading progress…</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">Questionnaire</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">Type</th>
                        <Th k="district" label="District" />
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">Block</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">Village</th>
                        <Th k="remaining" label="Target" />
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">Collected</th>
                        <Th k="pct" label="%" />
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">Progress</th>
                        <Th k="status" label="Status" />
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">Deadline</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {rows.map(r => (
                        <tr key={r.target_id} className={`hover:bg-gray-50 ${STATUS_ROW[r.status] ?? ''}`}>
                          <td className="px-3 py-2.5 font-medium text-gray-800">{r.questionnaire_name}</td>
                          <td className="px-3 py-2.5 text-gray-500">{r.participant_type_name || '—'}</td>
                          <td className="px-3 py-2.5">{r.district}</td>
                          <td className="px-3 py-2.5 text-gray-500">{r.block || '—'}</td>
                          <td className="px-3 py-2.5 text-gray-500">{r.village || '—'}</td>
                          <td className="px-3 py-2.5 text-center font-medium">{r.target}</td>
                          <td className="px-3 py-2.5 text-center text-blue-700 font-medium">{r.collected}</td>
                          <td className="px-3 py-2.5 text-center font-bold">{r.pct}%</td>
                          <td className="px-3 py-2.5 w-24"><ProgressBar pct={r.pct} size="sm" /></td>
                          <td className="px-3 py-2.5">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[r.status] ?? ''}`}>
                              {r.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs">
                            {r.deadline ? (
                              <span className={r.days_remaining !== null && r.days_remaining < 0 ? 'text-red-600 font-medium' : r.days_remaining !== null && r.days_remaining <= 7 ? 'text-yellow-600' : 'text-gray-500'}>
                                {r.deadline} {r.days_remaining !== null && <span>({r.days_remaining < 0 ? `${Math.abs(r.days_remaining)}d late` : `${r.days_remaining}d left`})</span>}
                              </span>
                            ) : '—'}
                          </td>
                        </tr>
                      ))}
                      {rows.length === 0 && !loading && (
                        <tr><td colSpan={11} className="py-10 text-center text-gray-400">
                          {data ? 'No location targets match your filters' : 'Select a program to view progress'}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {rows.length > 0 && (
                <div className="px-4 py-2 border-t text-xs text-gray-400">{rows.length} location target(s) shown</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
