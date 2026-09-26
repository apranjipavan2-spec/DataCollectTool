import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import api from '@/lib/api'
import { getNavItems } from '@/lib/navigation'

interface LoginRow {
  id: number; success: boolean; method: string
  user_name: string | null; phone: string | null; email: string | null; role: string | null
  tenant_id: string; tenant_name: string | null; ip: string | null; created_at: string | null
}
interface Summary { successful: number; failed: number; unique_users: number }

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'

const sel = 'bg-catalan-surface border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text'

export default function LoginActivity() {
  const [rows, setRows] = useState<LoginRow[]>([])
  const [summary, setSummary] = useState<Summary>({ successful: 0, failed: 0, unique_users: 0 })
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([])
  const [q, setQ] = useState('')
  const [outcome, setOutcome] = useState('all')
  const [tenant, setTenant] = useState('')
  const [days, setDays] = useState(7)
  const [sort, setSort] = useState('time')
  const [order, setOrder] = useState('desc')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/admin/monitor/platform-usage')
      .then(r => setOrgs(r.data.tenants.map((t: { tenant_id: string; tenant_name: string }) => ({ id: t.tenant_id, name: t.tenant_name }))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true); setError('')
      api.get('/admin/monitor/logins', {
        params: { q: q || undefined, outcome, tenant_id: tenant || undefined, days, sort, order },
      })
        .then(r => { setRows(r.data.rows); setSummary(r.data.summary) })
        .catch(() => setError('Failed to load login activity. Try refreshing.'))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(t)
  }, [q, outcome, tenant, days, sort, order])

  return (
    <div className="flex h-screen bg-catalan-bg overflow-hidden">
      <Sidebar items={getNavItems('master_admin')} role="master_admin" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav title="Login Activity" breadcrumbs={[{ label: 'Logins' }]} />
        <main className="flex-1 overflow-auto px-6 py-6 space-y-4">
          {error && (
            <div className="bg-catalan-error/10 border border-catalan-error/30 text-catalan-error text-sm rounded-xl px-4 py-3">{error}</div>
          )}

          <div className="grid grid-cols-3 gap-4">
            {[['Successful logins', summary.successful], ['Unique users', summary.unique_users], ['Failed attempts', summary.failed]].map(([label, v]) => (
              <div key={label as string} className="bg-catalan-surface border border-catalan-border rounded-xl px-4 py-3">
                <p className="text-[11px] text-catalan-textMuted uppercase tracking-wide font-semibold">{label}</p>
                <p className="text-xl font-bold text-catalan-text mt-1">{(v as number).toLocaleString()}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, phone, email, org…"
              className={`${sel} flex-1 min-w-[220px]`} />
            <select value={outcome} onChange={e => setOutcome(e.target.value)} className={sel}>
              <option value="all">All outcomes</option>
              <option value="success">Successful</option>
              <option value="failed">Failed</option>
            </select>
            <select value={tenant} onChange={e => setTenant(e.target.value)} className={sel}>
              <option value="">All organisations</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <select value={days} onChange={e => setDays(Number(e.target.value))} className={sel}>
              {[[1, 'Last 24 hours'], [7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last year']].map(([d, l]) =>
                <option key={d} value={d}>{l}</option>)}
            </select>
            <select value={sort} onChange={e => setSort(e.target.value)} className={sel}>
              <option value="time">Sort: Time</option>
              <option value="user">Sort: User</option>
              <option value="org">Sort: Organisation</option>
            </select>
            <button onClick={() => setOrder(o => (o === 'desc' ? 'asc' : 'desc'))} className={sel}>
              {order === 'desc' ? '↓ Desc' : '↑ Asc'}
            </button>
          </div>

          <div className="bg-catalan-surface border border-catalan-border rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-catalan-textMuted border-b border-catalan-border">
                  {['Time', 'User', 'Contact', 'Role', 'Organisation', 'Method', 'Result', 'IP'].map(h => (
                    <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-catalan-textMuted">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-catalan-textMuted">No login activity in this window.</td></tr>
                ) : rows.map(r => (
                  <tr key={r.id} className="border-b border-catalan-border last:border-0">
                    <td className="px-4 py-3 text-catalan-text whitespace-nowrap">{fmt(r.created_at)}</td>
                    <td className="px-4 py-3 font-medium text-catalan-text">{r.user_name || '—'}</td>
                    <td className="px-4 py-3 text-catalan-textMuted">{[r.phone, r.email].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-4 py-3 text-catalan-textMuted capitalize">{r.role?.replace('_', ' ') || '—'}</td>
                    <td className="px-4 py-3 text-catalan-text">{r.tenant_name || '—'}</td>
                    <td className="px-4 py-3 text-catalan-textMuted capitalize">{r.method}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.success ? 'bg-catalan-success/15 text-catalan-success' : 'bg-catalan-error/15 text-catalan-error'}`}>
                        {r.success ? 'Success' : 'Failed'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-catalan-textMuted whitespace-nowrap">{r.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </div>
  )
}
