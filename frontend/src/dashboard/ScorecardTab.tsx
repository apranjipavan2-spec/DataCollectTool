import { useState, useEffect } from 'react'
import api from '@/lib/api'

interface EnumScore {
  enumerator_id: string; name: string
  total: number; approved: number; flagged: number; rejected: number
  violations: number; backcheck_required: number; backcheck_completed: number
  accuracy_rate: number | null; backcheck_pass_rate: number | null
  submissions_per_day: number
  first_submission: string | null; last_submission: string | null
}

interface Form { id: string; title: string }

function pct(v: number | null) {
  if (v === null) return <span className="text-catalan-textMuted text-xs">—</span>
  const color = v >= 80 ? 'text-green-500' : v >= 60 ? 'text-amber-500' : 'text-red-500'
  return <span className={`font-semibold ${color}`}>{v}%</span>
}

function rate(v: number) {
  return <span className="font-semibold text-catalan-primary">{v}</span>
}

export default function ScorecardTab({ forms }: { forms: Form[] }) {
  const [scores, setScores]     = useState<EnumScore[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [formId, setFormId]     = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [sortKey, setSortKey]   = useState<keyof EnumScore>('total')
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('desc')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const params: Record<string, string> = {}
      if (formId)   params.form_id   = formId
      if (dateFrom) params.date_from = dateFrom
      if (dateTo)   params.date_to   = dateTo
      const { data } = await api.get<EnumScore[]>('/submissions/enumerator-scorecard', { params })
      setScores(data)
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to load scorecard')
    } finally {
      setLoading(false) }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSort = (key: keyof EnumScore) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted = [...scores].sort((a, b) => {
    const av = a[sortKey] ?? -1
    const bv = b[sortKey] ?? -1
    return sortDir === 'asc' ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1)
  })

  const card = 'bg-catalan-surface border border-catalan-border rounded-xl p-5'
  const th   = 'text-left px-3 py-2.5 text-xs font-semibold text-catalan-textMuted uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-catalan-text select-none'
  const inp  = 'border border-catalan-border rounded-lg px-3 py-1.5 text-sm bg-catalan-bg text-catalan-text focus:ring-2 focus:ring-catalan-primary outline-none'

  const avgAccuracy = scores.filter(s => s.accuracy_rate !== null)
  const avgAcc = avgAccuracy.length
    ? Math.round(avgAccuracy.reduce((s, e) => s + (e.accuracy_rate ?? 0), 0) / avgAccuracy.length)
    : null
  const avgBcArr = scores.filter(s => s.backcheck_pass_rate !== null)
  const avgBc = avgBcArr.length
    ? Math.round(avgBcArr.reduce((s, e) => s + (e.backcheck_pass_rate ?? 0), 0) / avgBcArr.length)
    : null
  const totalSubs = scores.reduce((s, e) => s + e.total, 0)
  const avgRate = scores.length
    ? Math.round(scores.reduce((s, e) => s + e.submissions_per_day, 0) / scores.length * 10) / 10
    : 0

  return (
    <div className="space-y-6">

      {/* Filters */}
      <div className={`${card} flex flex-wrap gap-3 items-end`}>
        <div>
          <div className="text-xs text-catalan-textMuted mb-1">Form</div>
          <select value={formId} onChange={e => setFormId(e.target.value)} className={inp}>
            <option value="">All forms</option>
            {forms.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
          </select>
        </div>
        <div>
          <div className="text-xs text-catalan-textMuted mb-1">From</div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inp} />
        </div>
        <div>
          <div className="text-xs text-catalan-textMuted mb-1">To</div>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={inp} />
        </div>
        <button onClick={load} disabled={loading}
          className="px-4 py-1.5 bg-catalan-primary text-catalan-bg rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40">
          {loading ? 'Loading…' : 'Apply'}
        </button>
      </div>

      {/* Summary KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className={card}>
          <div className="text-2xl font-bold text-catalan-primary">{scores.length}</div>
          <div className="text-sm text-catalan-textMuted mt-0.5">Enumerators</div>
        </div>
        <div className={card}>
          <div className="text-2xl font-bold text-catalan-primary">{totalSubs.toLocaleString()}</div>
          <div className="text-sm text-catalan-textMuted mt-0.5">Total Submissions</div>
        </div>
        <div className={card}>
          <div className={`text-2xl font-bold ${avgAcc === null ? 'text-catalan-textMuted' : avgAcc >= 80 ? 'text-green-500' : avgAcc >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
            {avgAcc !== null ? `${avgAcc}%` : '—'}
          </div>
          <div className="text-sm text-catalan-textMuted mt-0.5">Avg Accuracy Rate</div>
        </div>
        <div className={card}>
          <div className="text-2xl font-bold text-catalan-primary">{avgRate}</div>
          <div className="text-sm text-catalan-textMuted mt-0.5">Avg Submissions / Day</div>
        </div>
      </div>

      {/* Scorecard table */}
      <div className={card}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-semibold text-catalan-text">Enumerator Performance Scorecard</div>
          {avgBc !== null && (
            <div className="text-xs text-catalan-textMuted">
              Avg backcheck pass rate: <span className={`font-semibold ${avgBc >= 80 ? 'text-green-500' : 'text-amber-500'}`}>{avgBc}%</span>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-catalan-error py-4">{error}</p>}

        {!loading && !error && scores.length === 0 && (
          <p className="text-sm text-catalan-textMuted text-center py-8">No submission data found for the selected filters.</p>
        )}

        {loading && <p className="text-sm text-catalan-textMuted text-center py-8">Loading scorecard…</p>}

        {!loading && sorted.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="border-b border-catalan-border">
                  {([
                    { key: 'name',                  label: 'Enumerator'       },
                    { key: 'total',                 label: 'Total'            },
                    { key: 'submissions_per_day',   label: 'Subs / Day'       },
                    { key: 'accuracy_rate',         label: 'Accuracy %'       },
                    { key: 'approved',              label: 'Approved'         },
                    { key: 'flagged',               label: 'Flagged'          },
                    { key: 'rejected',              label: 'Rejected'         },
                    { key: 'violations',            label: 'Violations'       },
                    { key: 'backcheck_pass_rate',   label: 'BC Pass %'        },
                    { key: 'last_submission',       label: 'Last Active'      },
                  ] as { key: keyof EnumScore; label: string }[]).map(({ key, label }) => (
                    <th key={key} className={th} onClick={() => toggleSort(key)}>
                      {label} {sortKey === key ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(e => (
                  <tr key={e.enumerator_id} className="border-b border-catalan-border hover:bg-catalan-hover">
                    <td className="px-3 py-3 font-medium text-catalan-text">{e.name}</td>
                    <td className="px-3 py-3 font-bold text-catalan-primary">{e.total}</td>
                    <td className="px-3 py-3">{rate(e.submissions_per_day)}</td>
                    <td className="px-3 py-3">{pct(e.accuracy_rate)}</td>
                    <td className="px-3 py-3 text-green-500">{e.approved || '—'}</td>
                    <td className="px-3 py-3 text-amber-500">{e.flagged || '—'}</td>
                    <td className="px-3 py-3 text-red-500">{e.rejected || '—'}</td>
                    <td className="px-3 py-3 text-catalan-textMuted">{e.violations || '—'}</td>
                    <td className="px-3 py-3">{pct(e.backcheck_pass_rate)}</td>
                    <td className="px-3 py-3 text-catalan-textMuted text-xs whitespace-nowrap">
                      {e.last_submission ? new Date(e.last_submission).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-catalan-textMuted mt-3">
          Accuracy % = approved / (approved + flagged + rejected).
          BC Pass % = backchecks completed / backchecks required.
          Subs/day = total / active days.
        </p>
      </div>
    </div>
  )
}
