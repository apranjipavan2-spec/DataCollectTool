import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import api from '@/lib/api'
import { getNavItems } from '@/lib/navigation'

interface Cap { used: number; limit: number | null }

interface UsageTenant {
  tenant_id: string; tenant_name: string; plan: string; subscription_status: string
  total_submissions: number; submissions_this_month: number
  total_forms: number; active_forms: number
  total_users: number; org_admins: number; supervisors: number; enumerators: number
  ai_calls_today: number; ai_calls_this_month: number
  last_activity: string | null; created_at: string | null
  limits: {
    submissions: Cap; active_forms: Cap; storage_mb: Cap
    ai_reports: Cap; api_calls: Cap; ai_calls_per_day: Cap
    admins: Cap; supervisors: Cap; enumerators: Cap
  }
}
interface UsageData {
  tenants: UsageTenant[]
  platform_totals: {
    tenants: number; total_submissions: number; submissions_this_month: number
    total_users: number; total_forms: number; ai_calls_today: number
  }
}

interface FormRow {
  id: string; tenant_id: string; tenant_name: string; title: string
  status: string; field_count: number; submissions_count: number; created_at: string | null
}

const PLAN_BADGE: Record<string, string> = {
  enterprise:    'bg-catalan-primary/15 text-catalan-primary',
  professional:  'bg-catalan-success/15 text-catalan-success',
  pro:           'bg-catalan-success/15 text-catalan-success',
  growth:        'bg-catalan-primary/15 text-catalan-primary',
  starter:       'bg-catalan-warning/15 text-catalan-warning',
  trial:         'bg-catalan-warning/15 text-catalan-warning',
  free:          'bg-catalan-border text-catalan-textMuted',
}

const STATUS_BADGE: Record<string, string> = {
  active:   'bg-catalan-success/15 text-catalan-success',
  draft:    'bg-catalan-warning/15 text-catalan-warning',
  archived: 'bg-catalan-border text-catalan-textMuted',
}

function CapBar({ label, cap }: { label: string; cap: Cap }) {
  const unlimited = cap.limit === null
  const pct = unlimited || cap.limit === null ? 0 : cap.limit === 0 ? 100 : Math.min((cap.used / cap.limit) * 100, 100)
  const color = pct >= 100 ? 'bg-catalan-error' : pct >= 80 ? 'bg-catalan-warning' : 'bg-catalan-primary'
  return (
    <div>
      <div className="flex justify-between text-[11px] text-catalan-textMuted mb-0.5">
        <span>{label}</span>
        <span className="font-medium text-catalan-text">{cap.used}{unlimited ? '' : ` / ${cap.limit}`}</span>
      </div>
      {!unlimited && (
        <div className="w-full bg-catalan-border rounded-full h-1.5">
          <div className={`${color} h-1.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

export default function SuperAdminMonitor() {
  const [tab, setTab] = useState<'orgs' | 'forms'>('orgs')
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [forms, setForms] = useState<FormRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formFilterTenant, setFormFilterTenant] = useState('')

  const navItems = getNavItems('master_admin')

  useEffect(() => {
    setLoading(true)
    setError('')
    Promise.all([
      api.get('/admin/monitor/platform-usage'),
      api.get('/admin/monitor/forms'),
    ]).then(([us, fm]) => {
      setUsage(us.data)
      setForms(fm.data)
    }).catch(() => setError('Failed to load platform monitor data. Try refreshing.'))
      .finally(() => setLoading(false))
  }, [])

  const tenantOptions = Array.from(new Set(forms.map(f => f.tenant_name))).sort()
  const filteredForms = forms.filter(f => !formFilterTenant || f.tenant_name === formFilterTenant)

  const totals = usage?.platform_totals

  return (
    <div className="flex h-screen bg-catalan-bg overflow-hidden">
      <Sidebar items={navItems} role="master_admin" />

      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav title="Platform Monitor" breadcrumbs={[{ label: 'Monitor' }]} />

        <main className="flex-1 overflow-auto px-6 py-6 space-y-6">
          {error && (
            <div className="bg-catalan-error/10 border border-catalan-error/30 text-catalan-error text-sm rounded-xl px-4 py-3">{error}</div>
          )}

          {/* Summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Organisations', value: totals?.tenants ?? 0 },
              { label: 'Users',         value: totals?.total_users ?? 0 },
              { label: 'Forms',         value: totals?.total_forms ?? 0 },
              { label: 'Submissions',   value: totals?.total_submissions ?? 0 },
              { label: 'Subs This Month', value: totals?.submissions_this_month ?? 0 },
              { label: 'AI Calls Today', value: totals?.ai_calls_today ?? 0 },
            ].map(c => (
              <div key={c.label} className="bg-catalan-surface border border-catalan-border rounded-xl px-4 py-3">
                <p className="text-[11px] text-catalan-textMuted uppercase tracking-wide font-semibold">{c.label}</p>
                <p className="text-xl font-bold text-catalan-text mt-1">{c.value.toLocaleString()}</p>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-catalan-border">
            {([['orgs', 'By Organisation'], ['forms', 'By Form']] as const).map(([t, label]) => (
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
          ) : tab === 'orgs' ? (

            /* ── By Organisation ── */
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {usage?.tenants.map(org => (
                <div key={org.tenant_id} className="bg-catalan-surface border border-catalan-border rounded-xl p-5 space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-catalan-text">{org.tenant_name}</p>
                      <span className={`inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full capitalize ${PLAN_BADGE[org.plan] ?? PLAN_BADGE.free}`}>
                        {org.plan}
                      </span>
                    </div>
                    <div className="text-right shrink-0 text-xs text-catalan-textMuted">
                      {org.last_activity ? new Date(org.last_activity).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'No activity'}
                    </div>
                  </div>

                  {/* Team composition */}
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div className="bg-catalan-bg rounded-lg py-2">
                      <p className="font-bold text-catalan-text">{org.total_users}</p>
                      <p className="text-catalan-textMuted">Users</p>
                    </div>
                    <div className="bg-catalan-bg rounded-lg py-2">
                      <p className="font-bold text-catalan-text">{org.org_admins}</p>
                      <p className="text-catalan-textMuted">Admins</p>
                    </div>
                    <div className="bg-catalan-bg rounded-lg py-2">
                      <p className="font-bold text-catalan-text">{org.supervisors}</p>
                      <p className="text-catalan-textMuted">Supervisors</p>
                    </div>
                    <div className="bg-catalan-bg rounded-lg py-2">
                      <p className="font-bold text-catalan-text">{org.enumerators}</p>
                      <p className="text-catalan-textMuted">Enumerators</p>
                    </div>
                  </div>

                  {/* Activity */}
                  <div className="grid grid-cols-2 gap-2 text-xs text-catalan-textMuted">
                    <div><span className="font-semibold text-catalan-text">{org.total_submissions.toLocaleString()}</span> submissions total</div>
                    <div><span className="font-semibold text-catalan-text">{org.submissions_this_month.toLocaleString()}</span> this month</div>
                    <div><span className="font-semibold text-catalan-text">{org.active_forms}</span> / {org.total_forms} forms active</div>
                    <div><span className="font-semibold text-catalan-text">{org.ai_calls_today}</span> AI calls today</div>
                  </div>

                  {/* Plan limits */}
                  <div className="border-t border-catalan-border pt-3 space-y-2">
                    <CapBar label="Submissions / mo" cap={org.limits.submissions} />
                    <CapBar label="Active forms" cap={org.limits.active_forms} />
                    <CapBar label="Storage (MB)" cap={org.limits.storage_mb} />
                    <CapBar label="AI calls / day" cap={org.limits.ai_calls_per_day} />
                    <CapBar label="AI reports / mo" cap={org.limits.ai_reports} />
                    <CapBar label="API calls / mo" cap={org.limits.api_calls} />
                    <CapBar label="Admin seats" cap={org.limits.admins} />
                    <CapBar label="Supervisor seats" cap={org.limits.supervisors} />
                    <CapBar label="Enumerator seats" cap={org.limits.enumerators} />
                  </div>
                </div>
              ))}
              {(!usage || usage.tenants.length === 0) && (
                <p className="text-catalan-textMuted text-sm col-span-3">No organisations found.</p>
              )}
            </div>

          ) : (

            /* ── By Form ── */
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3 items-center">
                <select
                  value={formFilterTenant}
                  onChange={e => setFormFilterTenant(e.target.value)}
                  className="border border-catalan-border rounded-lg px-3 py-1.5 text-sm bg-catalan-bg text-catalan-text focus:ring-2 focus:ring-catalan-primary outline-none max-w-[220px] truncate"
                >
                  <option value="">All Organisations</option>
                  {tenantOptions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="text-xs text-catalan-textMuted">
                  {filteredForms.length} form{filteredForms.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="bg-catalan-surface border border-catalan-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-catalan-border bg-catalan-bg">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Organisation</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Form</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Status</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Fields</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Submissions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-catalan-border">
                      {filteredForms.map(f => (
                        <tr key={f.id} className="hover:bg-catalan-bg transition-colors">
                          <td className="px-4 py-3 text-catalan-textMuted whitespace-nowrap">{f.tenant_name}</td>
                          <td className="px-4 py-3 font-medium text-catalan-text">{f.title}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_BADGE[f.status] ?? STATUS_BADGE.draft}`}>
                              {f.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-catalan-text">{f.field_count}</td>
                          <td className="px-4 py-3 text-right text-catalan-text font-medium">{f.submissions_count.toLocaleString()}</td>
                        </tr>
                      ))}
                      {filteredForms.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-10 text-center text-catalan-textMuted text-sm">
                            No forms match the current filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
