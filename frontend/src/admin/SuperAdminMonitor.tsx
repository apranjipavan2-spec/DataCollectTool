import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import api from '@/lib/api'
import { getNavItems } from '@/lib/navigation'

interface TenantOverview {
  tenant_id: string
  tenant_name: string
  plan_tier: string
  user_count: number
  program_count: number
  questionnaire_count: number
  total_target: number
  total_collected: number
  pct: number
}

interface UsageTenant {
  tenant_id: string; tenant_name: string; plan: string
  total_submissions: number; submissions_this_month: number
  total_users: number; total_forms: number; last_activity: string | null
}
interface UsageData {
  tenants: UsageTenant[]
  platform_totals: { total_submissions: number; total_users: number; total_forms: number; active_tenants: number }
}

interface ProgramRow {
  id: string
  tenant_id: string
  tenant_name: string
  name: string
  scheme_name: string
  status: string
  start_date: string | null
  end_date: string | null
  questionnaire_count: number
  total_target: number
  total_collected: number
  pct: number
}

const PLAN_BADGE: Record<string, string> = {
  enterprise:    'bg-catalan-primary/15 text-catalan-primary',
  professional:  'bg-catalan-success/15 text-catalan-success',
  starter:       'bg-catalan-warning/15 text-catalan-warning',
  free:          'bg-catalan-border text-catalan-textMuted',
}

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-catalan-success/15 text-catalan-success',
  planning:  'bg-catalan-warning/15 text-catalan-warning',
  completed: 'bg-catalan-primary/15 text-catalan-primary',
  archived:  'bg-catalan-border text-catalan-textMuted',
}

function ProgressBar({ pct }: { pct: number }) {
  const capped = Math.min(pct, 100)
  const color = pct >= 100 ? 'bg-catalan-success' : pct >= 60 ? 'bg-catalan-primary' : pct >= 30 ? 'bg-catalan-warning' : 'bg-catalan-error'
  return (
    <div className="w-full bg-catalan-border rounded-full h-1.5 mt-1">
      <div className={`${color} h-1.5 rounded-full transition-all`} style={{ width: `${capped}%` }} />
    </div>
  )
}

export default function SuperAdminMonitor() {
  const [tab, setTab] = useState<'overview' | 'programs' | 'usage'>('overview')
  const [overview, setOverview] = useState<TenantOverview[]>([])
  const [programs, setPrograms] = useState<ProgramRow[]>([])
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterTenant, setFilterTenant] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const navItems = getNavItems('master_admin')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.get('/admin/monitor/overview'),
      api.get('/admin/monitor/programs'),
      api.get('/platform-usage').catch(() => ({ data: null })),
    ]).then(([ov, pg, us]) => {
      setOverview(ov.data)
      setPrograms(pg.data)
      if (us.data) setUsage(us.data)
    }).finally(() => setLoading(false))
  }, [])

  const tenantOptions = Array.from(new Set(programs.map(p => p.tenant_name))).sort()

  const filteredPrograms = programs.filter(p => {
    if (filterTenant && p.tenant_name !== filterTenant) return false
    if (filterStatus && p.status !== filterStatus) return false
    return true
  })

  const totalOrgs     = overview.length
  const totalPrograms = overview.reduce((s, t) => s + t.program_count, 0)
  const totalCollected = overview.reduce((s, t) => s + t.total_collected, 0)
  const totalTarget   = overview.reduce((s, t) => s + t.total_target, 0)

  return (
    <div className="flex h-screen bg-catalan-bg overflow-hidden">
      <Sidebar items={navItems} role="master_admin" />

      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav title="Platform Monitor" breadcrumbs={[{ label: 'Monitor' }]} />

        <main className="flex-1 overflow-auto px-6 py-6 space-y-6">

          {/* Summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Organisations',  value: totalOrgs },
              { label: 'Programs',       value: totalPrograms },
              { label: 'Total Target',   value: totalTarget },
              { label: 'Total Collected',value: totalCollected },
            ].map(c => (
              <div key={c.label} className="bg-catalan-surface border border-catalan-border rounded-xl px-5 py-4">
                <p className="text-xs text-catalan-textMuted uppercase tracking-wide font-semibold">{c.label}</p>
                <p className="text-2xl font-bold text-catalan-text mt-1">{c.value.toLocaleString()}</p>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-catalan-border">
            {([['overview', 'By Organisation'], ['programs', 'All Programs'], ['usage', 'Usage']] as const).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  tab === t
                    ? 'border-catalan-primary text-catalan-primary'
                    : 'border-transparent text-catalan-textMuted hover:text-catalan-text'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-24 text-catalan-textMuted text-sm">
              Loading platform data…
            </div>
          ) : tab === 'overview' ? (

            /* ── Overview tab ── */
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {overview.map(org => (
                <div key={org.tenant_id} className="bg-catalan-surface border border-catalan-border rounded-xl p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-catalan-text">{org.tenant_name}</p>
                      <span className={`inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full capitalize ${PLAN_BADGE[org.plan_tier] ?? PLAN_BADGE.free}`}>
                        {org.plan_tier}
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xl font-bold text-catalan-text">{org.pct}%</p>
                      <p className="text-xs text-catalan-textMuted">collected</p>
                    </div>
                  </div>

                  <ProgressBar pct={org.pct} />

                  <div className="grid grid-cols-2 gap-2 text-xs text-catalan-textMuted pt-1">
                    <div><span className="font-semibold text-catalan-text">{org.user_count}</span> users</div>
                    <div><span className="font-semibold text-catalan-text">{org.program_count}</span> programs</div>
                    <div><span className="font-semibold text-catalan-text">{org.total_collected.toLocaleString()}</span> collected</div>
                    <div><span className="font-semibold text-catalan-text">{org.total_target.toLocaleString()}</span> target</div>
                  </div>
                </div>
              ))}
              {overview.length === 0 && (
                <p className="text-catalan-textMuted text-sm col-span-3">No organisations found.</p>
              )}
            </div>

          ) : (

            /* ── Usage tab ── */
            tab === 'usage' ? (
            <div className="space-y-4">
              {usage ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                      { label: 'Total Submissions', value: usage.platform_totals.total_submissions },
                      { label: 'Total Users',        value: usage.platform_totals.total_users },
                      { label: 'Total Forms',        value: usage.platform_totals.total_forms },
                      { label: 'Active Tenants',     value: usage.platform_totals.active_tenants },
                    ].map(c => (
                      <div key={c.label} className="bg-catalan-surface border border-catalan-border rounded-xl px-5 py-4">
                        <p className="text-xs text-catalan-textMuted uppercase tracking-wide font-semibold">{c.label}</p>
                        <p className="text-2xl font-bold text-catalan-text mt-1">{c.value.toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                  <div className="bg-catalan-surface border border-catalan-border rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-catalan-border bg-catalan-bg">
                            <th className="text-left px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Organisation</th>
                            <th className="text-left px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Plan</th>
                            <th className="text-right px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Submissions</th>
                            <th className="text-right px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">This Month</th>
                            <th className="text-right px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Users</th>
                            <th className="text-right px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Forms</th>
                            <th className="text-left px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Last Activity</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-catalan-border">
                          {usage.tenants.map(t => (
                            <tr key={t.tenant_id} className="hover:bg-catalan-bg transition-colors">
                              <td className="px-4 py-3 font-medium text-catalan-text">{t.tenant_name}</td>
                              <td className="px-4 py-3">
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${PLAN_BADGE[t.plan] ?? PLAN_BADGE.free}`}>{t.plan}</span>
                              </td>
                              <td className="px-4 py-3 text-right text-catalan-text">{t.total_submissions.toLocaleString()}</td>
                              <td className="px-4 py-3 text-right text-catalan-text">{t.submissions_this_month.toLocaleString()}</td>
                              <td className="px-4 py-3 text-right text-catalan-text">{t.total_users}</td>
                              <td className="px-4 py-3 text-right text-catalan-text">{t.total_forms}</td>
                              <td className="px-4 py-3 text-catalan-textMuted text-xs">
                                {t.last_activity ? new Date(t.last_activity).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-catalan-textMuted text-sm">Usage data not available.</p>
              )}
            </div>
          ) : (

            /* ── Programs tab ── */
            <div className="space-y-4">
              {/* Filters */}
              <div className="flex flex-wrap gap-3">
                <select
                  value={filterTenant}
                  onChange={e => setFilterTenant(e.target.value)}
                  className="border border-catalan-border rounded-lg px-3 py-1.5 text-sm bg-catalan-bg text-catalan-text focus:ring-2 focus:ring-catalan-primary outline-none"
                >
                  <option value="">All Organisations</option>
                  {tenantOptions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  className="border border-catalan-border rounded-lg px-3 py-1.5 text-sm bg-catalan-bg text-catalan-text focus:ring-2 focus:ring-catalan-primary outline-none"
                >
                  <option value="">All Statuses</option>
                  {['active', 'planning', 'completed', 'archived'].map(s => (
                    <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
                <span className="text-xs text-catalan-textMuted self-center">
                  {filteredPrograms.length} program{filteredPrograms.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Table */}
              <div className="bg-catalan-surface border border-catalan-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-catalan-border bg-catalan-bg">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Organisation</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Program / Scheme</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Status</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Target</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Collected</th>
                        <th className="px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wide w-36">Progress</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-catalan-border">
                      {filteredPrograms.map(p => (
                        <tr key={p.id} className="hover:bg-catalan-bg transition-colors">
                          <td className="px-4 py-3 text-catalan-textMuted whitespace-nowrap">{p.tenant_name}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-catalan-text">{p.name}</p>
                            {p.scheme_name && (
                              <p className="text-xs text-catalan-textMuted mt-0.5">{p.scheme_name}</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_BADGE[p.status] ?? STATUS_BADGE.active}`}>
                              {p.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-catalan-text font-medium">{p.total_target.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-catalan-text font-medium">{p.total_collected.toLocaleString()}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="flex-1">
                                <ProgressBar pct={p.pct} />
                              </div>
                              <span className="text-xs text-catalan-textMuted w-10 text-right shrink-0">{p.pct}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filteredPrograms.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-10 text-center text-catalan-textMuted text-sm">
                            No programs match the current filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))}
        </main>
      </div>
    </div>
  )
}
