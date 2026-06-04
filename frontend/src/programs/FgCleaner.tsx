import { useState, useEffect, useCallback } from 'react'
import api, { getStoredUser } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import EmojiIcon from '@/components/EmojiIcon'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'
import { getLastProgram, setLastProgram } from '@/lib/fgStorage'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Program { id: string; name: string; scheme_name: string }
interface CleanerItem {
  id: string; enumerator_name: string; form_title: string; status: string
  serial_no: number | null; received: string | null; issues: string[]; has_issues: boolean; household_id: string | null
}
interface CleanerData {
  total: number; page: number; page_size: number; items: CleanerItem[]
  quality_score: number; issue_summary: Record<string, number>
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const sel = 'border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text focus:ring-2 focus:ring-catalan-primary outline-none'
const btnSe = 'px-3 py-1.5 text-sm border border-catalan-border rounded-lg text-catalan-text hover:bg-catalan-hover transition-colors disabled:opacity-40'

const ISSUE_LABELS: Record<string, string> = {
  qc_violation:    'QC Violation',
  fast_completion: 'Fast (<2 min)',
  missing_required: 'Missing Required',
  no_gps:          'No GPS',
  flagged:         'Flagged',
  outlier:         'Outlier (>2σ)',
  clean:           'Clean',
}
const ISSUE_COLORS: Record<string, string> = {
  qc_violation:    'text-catalan-error bg-catalan-error/10 border-catalan-error/30',
  fast_completion: 'text-catalan-warning bg-catalan-warning/10 border-catalan-warning/30',
  missing_required: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  no_gps:          'text-blue-400 bg-blue-400/10 border-blue-400/30',
  flagged:         'text-catalan-error bg-catalan-error/15 border-catalan-error/40',
  outlier:         'text-purple-400 bg-purple-400/10 border-purple-400/30',
  clean:           'text-green-400 bg-green-400/10 border-green-400/30',
}

// ── Program picker ─────────────────────────────────────────────────────────────

function ProgramPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [programs, setPrograms] = useState<Program[]>([])
  useEffect(() => { api.get('/programs/').then(r => setPrograms(r.data)).catch(() => {}) }, [])
  return (
    <select className={`${sel} min-w-[220px]`} value={value}
      onChange={e => { onChange(e.target.value); setLastProgram(e.target.value) }}>
      <option value="">— Select a program —</option>
      {programs.map(p => (
        <option key={p.id} value={p.id}>{p.name}{p.scheme_name ? ` · ${p.scheme_name}` : ''}</option>
      ))}
    </select>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FgCleaner() {
  const user = getStoredUser()
  const [programId, setProgramId] = useState(getLastProgram())
  const [data, setData] = useState<CleanerData | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [issueType, setIssueType] = useState('all')

  const load = useCallback(async () => {
    if (!programId) return
    setLoading(true)
    try {
      const res = await api.get(`/fg/programs/${programId}/cleaner`, {
        params: { page, page_size: 50, issue_type: issueType },
      })
      setData(res.data)
    } finally {
      setLoading(false)
    }
  }, [programId, page, issueType])

  useEffect(() => { load() }, [load])

  const totalPages = data ? Math.ceil(data.total / 50) : 1
  const qualityScore = data?.quality_score ?? 0

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
              <span className="text-catalan-text font-semibold text-base hidden sm:inline">Cleaner</span>
            </div>
          }
          rightContent={
            <ProgramPicker value={programId} onChange={id => { setProgramId(id); setPage(1) }} />
          }
        />
        <main className="flex-1 overflow-auto">
          <div className="w-full p-6 space-y-5">

            {!programId && (
              <div className="flex flex-col items-center justify-center h-64 text-catalan-textMuted">
                <div className="text-5xl mb-4"><EmojiIcon e="🧹" /></div>
                <p className="text-sm font-medium">Select a program to review data quality</p>
              </div>
            )}

            {/* Launch banner */}
            {programId && (
              <div className="mb-5 bg-catalan-surface border border-catalan-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1">
                  <div className="text-base font-semibold text-catalan-text mb-1">DataCleaner — Data Cleaner Wizard</div>
                  <p className="text-sm text-catalan-textMuted leading-relaxed">
                    Deduplicate records, remap columns, fix inconsistencies, and export a clean dataset — all in the full-screen wizard. Use the quality view below for a quick scan, then launch the wizard for deep cleaning.
                  </p>
                </div>
                <button
                  onClick={() => {
                    const token = localStorage.getItem('fp_token')
                    window.location.href = `${window.location.origin}/cleaner/?fg_url=${encodeURIComponent(window.location.origin)}&program_id=${programId}&token=${token}`
                  }}
                  className="shrink-0 px-5 py-2.5 bg-catalan-primary text-catalan-bg rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
                >
                  Open Cleaner Wizard →
                </button>
              </div>
            )}

            {programId && (
              <>
                {/* Quality score banner */}
                {data && (
                  <div className="bg-catalan-surface border border-catalan-border rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <div className="text-sm text-catalan-textMuted">Overall Quality Score</div>
                      <div className={`text-3xl font-bold mt-0.5 ${
                        qualityScore >= 80 ? 'text-green-400' :
                        qualityScore >= 60 ? 'text-catalan-warning' : 'text-catalan-error'
                      }`}>{qualityScore}%</div>
                    </div>
                    <div className="text-sm text-catalan-textMuted">{data.total} records total</div>
                  </div>
                )}

                {/* Issue filter cards */}
                {data && (
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {Object.entries(data.issue_summary).map(([k, v]) => (
                      <button key={k} onClick={() => { setIssueType(k === issueType ? 'all' : k); setPage(1) }}
                        className={`rounded-xl p-3 text-center border transition-all ${
                          issueType === k ? 'ring-2 ring-catalan-primary border-catalan-primary' : 'border-catalan-border bg-catalan-surface hover:border-catalan-primary/40'
                        }`}>
                        <div className="text-xl font-bold text-catalan-primary">{v}</div>
                        <div className="text-xs text-catalan-textMuted mt-0.5 leading-tight">{ISSUE_LABELS[k] ?? k}</div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Filter row */}
                <div className="flex items-center gap-3">
                  <select className={sel} value={issueType} onChange={e => { setIssueType(e.target.value); setPage(1) }}>
                    <option value="all">All submissions</option>
                    <option value="issues_only">Issues only</option>
                    {Object.keys(ISSUE_LABELS).map(k => <option key={k} value={k}>{ISSUE_LABELS[k]}</option>)}
                  </select>
                  <button onClick={load} className={btnSe}>Refresh</button>
                </div>

                {/* Table */}
                <div className="bg-catalan-surface border border-catalan-border rounded-xl overflow-hidden">
                  {loading ? (
                    <div className="py-16 text-center text-catalan-textMuted text-sm">Loading…</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-catalan-bg border-b border-catalan-border">
                          <tr>
                            {['#', 'Enumerator', 'Form', 'Household ID', 'Status', 'Received', 'Issues'].map(h => (
                              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-catalan-textMuted uppercase tracking-wide whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-catalan-border">
                          {(data?.items ?? []).map(item => (
                            <tr key={item.id} className={`hover:bg-catalan-hover transition-colors ${item.has_issues ? '' : 'opacity-75'}`}>
                              <td className="px-4 py-3 text-catalan-textMuted font-mono text-xs whitespace-nowrap">{item.serial_no ?? '—'}</td>
                              <td className="px-4 py-3 font-medium text-catalan-text whitespace-nowrap">{item.enumerator_name}</td>
                              <td className="px-4 py-3 text-catalan-textMuted max-w-[140px] truncate" title={item.form_title}>{item.form_title}</td>
                              <td className="px-4 py-3 font-mono text-xs text-catalan-textMuted max-w-[120px] truncate" title={item.household_id ?? ''}>
                                {item.household_id || <span className="italic text-catalan-textMuted/60">—</span>}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                  item.status === 'approved' ? 'bg-green-500/15 text-green-400' :
                                  item.status === 'flagged'  ? 'bg-red-500/15 text-red-400' :
                                  'bg-catalan-textMuted/10 text-catalan-textMuted'
                                }`}>{item.status}</span>
                              </td>
                              <td className="px-4 py-3 text-catalan-textMuted text-xs whitespace-nowrap">
                                {item.received ? new Date(item.received).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-1">
                                  {item.issues.length === 0
                                    ? <span className="text-xs text-green-400 font-medium">Clean</span>
                                    : item.issues.map(iss => (
                                      <span key={iss} className={`px-1.5 py-0.5 rounded text-xs font-medium border ${ISSUE_COLORS[iss] ?? 'text-catalan-textMuted bg-catalan-hover border-catalan-border'}`}>
                                        {ISSUE_LABELS[iss] ?? iss}
                                      </span>
                                    ))
                                  }
                                </div>
                              </td>
                            </tr>
                          ))}
                          {(data?.items ?? []).length === 0 && !loading && (
                            <tr>
                              <td colSpan={7} className="px-4 py-12 text-center text-catalan-textMuted">
                                No records match the current filter
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-3">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1 || loading} className={btnSe}>← Prev</button>
                    <span className="text-sm text-catalan-textMuted">Page {page} of {totalPages}</span>
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages || loading} className={btnSe}>Next →</button>
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
