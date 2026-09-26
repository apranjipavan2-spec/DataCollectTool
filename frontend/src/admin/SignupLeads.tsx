import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import api from '@/lib/api'
import { getNavItems } from '@/lib/navigation'

interface Lead {
  id: number; email: string; phone: string | null; name: string | null; org_name: string | null
  source: string; status: string; attempts: number; note: string | null; ip: string | null
  created_at: string | null; last_seen_at: string | null
}

const SOURCE_LABEL: Record<string, string> = {
  website_chat: 'Website chat', login_chat: 'Login chat', signup_form: 'Signup form',
}
const STATUS_BADGE: Record<string, string> = {
  lead:       'bg-catalan-border text-catalan-textMuted',
  attempted:  'bg-catalan-warning/15 text-catalan-warning',
  registered: 'bg-catalan-success/15 text-catalan-success',
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

export default function SignupLeads() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true); setError('')
      api.get('/admin/monitor/leads', { params: { q: q || undefined, status: status || undefined } })
        .then(r => setLeads(r.data))
        .catch(() => setError('Failed to load leads. Try refreshing.'))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(t)
  }, [q, status])

  const count = (s: string) => leads.filter(l => l.status === s).length

  return (
    <div className="flex h-screen bg-catalan-bg overflow-hidden">
      <Sidebar items={getNavItems('master_admin')} role="master_admin" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav title="Signup Leads" breadcrumbs={[{ label: 'Leads' }]} />
        <main className="flex-1 overflow-auto px-6 py-6 space-y-4">
          {error && (
            <div className="bg-catalan-error/10 border border-catalan-error/30 text-catalan-error text-sm rounded-xl px-4 py-3">{error}</div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[['Total', leads.length], ['Chat leads', count('lead')], ['Signup attempts', count('attempted')], ['Registered', count('registered')]].map(([label, v]) => (
              <div key={label as string} className="bg-catalan-surface border border-catalan-border rounded-xl px-4 py-3">
                <p className="text-[11px] text-catalan-textMuted uppercase tracking-wide font-semibold">{label}</p>
                <p className="text-xl font-bold text-catalan-text mt-1">{v}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <input
              value={q} onChange={e => setQ(e.target.value)} placeholder="Search email, phone, name, org…"
              className="flex-1 min-w-[220px] bg-catalan-surface border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text"
            />
            <select
              value={status} onChange={e => setStatus(e.target.value)}
              className="bg-catalan-surface border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text"
            >
              <option value="">All statuses</option>
              <option value="lead">Chat lead</option>
              <option value="attempted">Signup attempted</option>
              <option value="registered">Registered</option>
            </select>
          </div>

          <div className="bg-catalan-surface border border-catalan-border rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-catalan-textMuted border-b border-catalan-border">
                  {['Email', 'Phone', 'Name / Org', 'Source', 'Status', 'Tries', 'Last seen', 'First seen', 'Note'].map(h => (
                    <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-catalan-textMuted">Loading…</td></tr>
                ) : leads.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-catalan-textMuted">No leads yet.</td></tr>
                ) : leads.map(l => (
                  <tr key={l.id} className="border-b border-catalan-border last:border-0">
                    <td className="px-4 py-3 font-medium text-catalan-text">{l.email}</td>
                    <td className="px-4 py-3 text-catalan-text whitespace-nowrap">{l.phone || '—'}</td>
                    <td className="px-4 py-3 text-catalan-text">{[l.name, l.org_name].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-4 py-3 text-catalan-textMuted whitespace-nowrap">{SOURCE_LABEL[l.source] ?? l.source}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_BADGE[l.status] ?? STATUS_BADGE.lead}`}>{l.status}</span>
                    </td>
                    <td className="px-4 py-3 text-catalan-textMuted">{l.attempts}</td>
                    <td className="px-4 py-3 text-catalan-textMuted whitespace-nowrap">{fmt(l.last_seen_at)}</td>
                    <td className="px-4 py-3 text-catalan-textMuted whitespace-nowrap">{fmt(l.created_at)}</td>
                    <td className="px-4 py-3 text-catalan-textMuted max-w-[240px] truncate" title={l.note || ''}>{l.note || '—'}</td>
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
