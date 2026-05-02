/**
 * Master Admin Panel — platform-wide view across all tenants.
 * Tabs: Overview · Tenants · Team Progress
 * Tenant isolation: all drill-down endpoints require master_admin JWT;
 * data is fetched per tenant_id — no tenant ever sees another tenant's data.
 */
import { useState, useEffect, useMemo } from 'react'
import api, { getStoredUser } from '@/lib/api'
import { getNavItems } from '@/lib/navigation'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { Button, Card, Input, Modal, Alert } from '@/components/ui'

// ── Types ───────────────────────────────────────────────────────────────────

interface TenantRow {
  id: string; name: string; app_name: string; logo_url: string
  primary_color: string; plan_tier: string; subscription_status: string
  users_count: number; submissions_count: number; forms_count: number
  created_at: string
}

interface TenantOverview {
  tenant_id: string; tenant_name: string; plan_tier: string
  user_count: number; program_count: number; questionnaire_count: number
  total_target: number; total_collected: number; pct: number
}

interface EnumStat {
  id: string; name: string; total: number; approved: number
  flagged: number; rejected: number; synced: number; last_submission: string | null
}

interface DrillSub {
  id: string; serial_no: number | null; form_title: string
  enumerator_name: string; status: string; server_received_at: string
}

interface DrillUser {
  id: string; name: string; phone: string; role: string; email: string | null
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const PLAN_STYLE: Record<string, string> = {
  enterprise:   'bg-blue-50 text-blue-700 border border-blue-200',
  professional: 'bg-green-50 text-green-700 border border-green-200',
  starter:      'bg-yellow-50 text-yellow-700 border border-yellow-200',
}

const STATUS_DOT: Record<string, string> = {
  approved: 'bg-green-400', synced: 'bg-blue-400',
  flagged: 'bg-yellow-400', rejected: 'bg-red-400',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs capitalize">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[status] ?? 'bg-gray-400'}`} />
      {status}
    </span>
  )
}

function RoleBadge({ role }: { role: string }) {
  const cls = role === 'org_admin' ? 'bg-purple-50 text-purple-700 border border-purple-200'
    : role === 'supervisor' ? 'bg-sky-50 text-sky-700 border border-sky-200'
    : 'bg-gray-50 text-gray-600 border border-gray-200'
  return <span className={`text-xs px-2 py-0.5 rounded capitalize ${cls}`}>{role.replace('_', ' ')}</span>
}

// ── Main component ───────────────────────────────────────────────────────────

export default function AdminPanel() {
  const user = getStoredUser() || { name: '', role: '' }
  const sidebarItems = getNavItems(user.role)

  const [tab, setTab] = useState<'overview' | 'tenants' | 'progress' | 'files'>('overview')
  const [error, setError] = useState('')

  // ── Tenants ──
  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [loadingTenants, setLoadingTenants] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingTenant, setEditingTenant] = useState<TenantRow | null>(null)
  const [formData, setFormData] = useState({ name: '', app_name: '', plan_tier: 'starter', primary_color: '#89b4fa', logo_url: '', admin_phone: '', admin_name: '', admin_password: '' })

  // ── Platform overview ──
  const [overview, setOverview] = useState<TenantOverview[]>([])
  const [loadingOverview, setLoadingOverview] = useState(false)

  // ── Drill-down: selected tenant ──
  const [selectedTenant, setSelectedTenant] = useState<TenantRow | null>(null)
  const [drillTab, setDrillTab] = useState<'subs' | 'users' | 'progress'>('progress')
  const [drillSubs, setDrillSubs] = useState<DrillSub[]>([])
  const [drillUsers, setDrillUsers] = useState<DrillUser[]>([])
  const [drillStats, setDrillStats] = useState<EnumStat[]>([])
  const [loadingDrill, setLoadingDrill] = useState(false)

  // ── Shared Files ──
  const [sharedFiles, setSharedFiles] = useState<any[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [fileDesc, setFileDesc] = useState('')
  const [fileShareTenants, setFileShareTenants] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)

  const totals = useMemo(() => ({
    users: tenants.reduce((s, t) => s + t.users_count, 0),
    submissions: tenants.reduce((s, t) => s + t.submissions_count, 0),
    forms: tenants.reduce((s, t) => s + t.forms_count, 0),
  }), [tenants])

  // Load tenants on mount
  useEffect(() => {
    loadTenants()
  }, [])

  // Load overview when tab is opened
  useEffect(() => {
    if (tab === 'overview' && overview.length === 0) {
      setLoadingOverview(true)
      api.get('/admin/monitor/overview').then(r => setOverview(r.data)).catch(() => {}).finally(() => setLoadingOverview(false))
    }
  }, [tab])

  // Load drill-down data when tenant is selected
  useEffect(() => {
    if (!selectedTenant) return
    setLoadingDrill(true)
    const id = selectedTenant.id
    Promise.allSettled([
      api.get(`/admin/monitor/tenant/${id}/enumerator-stats`).then(r => setDrillStats(r.data)),
      api.get(`/admin/monitor/tenant/${id}/submissions`).then(r => setDrillSubs(r.data.items ?? [])),
      api.get(`/admin/monitor/tenant/${id}/users`).then(r => setDrillUsers(r.data)),
    ]).finally(() => setLoadingDrill(false))
  }, [selectedTenant])

  const loadTenants = async () => {
    setLoadingTenants(true)
    try {
      const { data } = await api.get('/tenants/')
      setTenants(data)
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to load tenants')
    } finally {
      setLoadingTenants(false)
    }
  }

  const createTenant = async () => {
    try {
      await api.post('/tenants/', formData)
      await loadTenants()
      setShowCreateModal(false)
      setFormData({ name: '', app_name: '', plan_tier: 'starter', primary_color: '#89b4fa', logo_url: '', admin_phone: '', admin_name: '', admin_password: '' })
    } catch (e: any) { setError(e.response?.data?.detail || 'Failed to create tenant') }
  }

  const updateTenant = async () => {
    if (!editingTenant) return
    try {
      await api.patch(`/tenants/${editingTenant.id}`, { name: formData.name, app_name: formData.app_name, primary_color: formData.primary_color, logo_url: formData.logo_url, plan_tier: formData.plan_tier })
      await loadTenants()
      setShowEditModal(false); setEditingTenant(null)
    } catch (e: any) { setError(e.response?.data?.detail || 'Failed to update tenant') }
  }

  const openEditModal = (t: TenantRow) => {
    setEditingTenant(t)
    setFormData({ name: t.name, app_name: t.app_name, plan_tier: t.plan_tier, primary_color: t.primary_color, logo_url: t.logo_url, admin_phone: '', admin_name: '', admin_password: '' })
    setShowEditModal(true)
  }

  const openDrillDown = (t: TenantRow) => {
    setSelectedTenant(t)
    setDrillTab('progress')
    setDrillSubs([]); setDrillUsers([]); setDrillStats([])
    setTab('tenants')
  }

  // ── Shared Files ──
  const loadSharedFiles = async () => {
    setLoadingFiles(true)
    try {
      const { data } = await api.get('/shared-files/')
      setSharedFiles(data)
    } catch { /* ignore */ }
    finally { setLoadingFiles(false) }
  }

  useEffect(() => {
    if (tab === 'files') loadSharedFiles()
  }, [tab])

  const handleUploadFile = async () => {
    if (!uploadFile) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', uploadFile)
      fd.append('description', fileDesc)
      fd.append('shared_with_tenants', fileShareTenants.join(','))
      await api.post('/shared-files/', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setUploadFile(null); setFileDesc(''); setFileShareTenants([])
      await loadSharedFiles()
    } catch (e: any) { setError(e.response?.data?.detail || 'Upload failed') }
    finally { setUploading(false) }
  }

  const handleDeleteFile = async (id: string) => {
    if (!confirm('Delete this file?')) return
    try {
      await api.delete(`/shared-files/${id}`)
      await loadSharedFiles()
    } catch (e: any) { setError(e.response?.data?.detail || 'Delete failed') }
  }

  const handleUpdateSharing = async (id: string, tenantIds: string[]) => {
    try {
      await api.patch(`/shared-files/${id}/share`, tenantIds)
      await loadSharedFiles()
    } catch (e: any) { setError(e.response?.data?.detail || 'Update failed') }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={sidebarItems} role={user.role} />

      <div className="flex-1 flex flex-col overflow-auto">
        <TopNav title="Platform Admin" />

        <div className="flex-1 p-4 md:p-6 space-y-5">
          {error && <Alert type="error" message={error} onClose={() => setError('')} />}

          {/* Platform stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="border-l-4 border-l-catalan-primary">
              <div className="text-xs text-catalan-textMuted mb-1">Tenants</div>
              <div className="text-3xl font-bold text-catalan-primary">{tenants.length}</div>
            </Card>
            <Card className="border-l-4 border-l-catalan-info">
              <div className="text-xs text-catalan-textMuted mb-1">Total Users</div>
              <div className="text-3xl font-bold text-catalan-info">{totals.users}</div>
            </Card>
            <Card className="border-l-4 border-l-catalan-success">
              <div className="text-xs text-catalan-textMuted mb-1">Total Submissions</div>
              <div className="text-3xl font-bold text-catalan-success">{totals.submissions}</div>
            </Card>
            <Card className="border-l-4 border-l-catalan-warning">
              <div className="text-xs text-catalan-textMuted mb-1">Total Forms</div>
              <div className="text-3xl font-bold text-catalan-warning">{totals.forms}</div>
            </Card>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-catalan-surface rounded-lg p-1 w-fit">
            {(['overview', 'tenants', 'progress', 'files'] as const).map(t => (
              <button key={t} onClick={() => { setTab(t); setSelectedTenant(null) }}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all capitalize ${tab === t ? 'bg-catalan-primary text-white shadow-sm' : 'text-catalan-textMuted hover:text-catalan-text hover:bg-catalan-hover'}`}>
                {t === 'overview' ? 'Overview' : t === 'tenants' ? 'Tenants' : t === 'progress' ? 'Team Progress' : 'Files'}
              </button>
            ))}
          </div>

          {/* ── OVERVIEW TAB ── */}
          {tab === 'overview' && (
            <Card title="Platform Overview — Progress by Tenant">
              {loadingOverview ? (
                <p className="text-catalan-textMuted text-sm py-6 text-center">Loading…</p>
              ) : overview.length === 0 ? (
                <p className="text-catalan-textMuted text-sm py-6 text-center">No data yet</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead>
                      <tr className="border-b border-catalan-border">
                        {['Tenant', 'Plan', 'Users', 'Programs', 'Target', 'Collected', 'Progress'].map(h => (
                          <th key={h} className="text-left px-3 py-2 text-xs font-medium text-catalan-textMuted uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {overview.map(row => (
                        <tr key={row.tenant_id} className="border-b border-catalan-border hover:bg-catalan-hover">
                          <td className="px-3 py-2 font-medium text-catalan-text">{row.tenant_name}</td>
                          <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded capitalize ${PLAN_STYLE[row.plan_tier] ?? ''}`}>{row.plan_tier}</span></td>
                          <td className="px-3 py-2 text-catalan-textMuted">{row.user_count}</td>
                          <td className="px-3 py-2 text-catalan-textMuted">{row.program_count}</td>
                          <td className="px-3 py-2 text-catalan-textMuted">{row.total_target.toLocaleString()}</td>
                          <td className="px-3 py-2 text-catalan-textMuted">{row.total_collected.toLocaleString()}</td>
                          <td className="px-3 py-2 w-36">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-catalan-hover rounded-full overflow-hidden">
                                <div className="h-full bg-catalan-primary rounded-full transition-all" style={{ width: `${Math.min(row.pct, 100)}%` }} />
                              </div>
                              <span className="text-xs text-catalan-textMuted w-9 text-right">{row.pct}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {/* ── TENANTS TAB ── */}
          {tab === 'tenants' && !selectedTenant && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-sm text-catalan-textMuted">{tenants.length} tenant{tenants.length !== 1 ? 's' : ''}</p>
                <Button onClick={() => setShowCreateModal(true)}>+ New Tenant</Button>
              </div>
              {loadingTenants ? (
                <p className="text-catalan-textMuted text-center py-10">Loading…</p>
              ) : (
                <Card>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[700px]">
                      <thead>
                        <tr className="border-b border-catalan-border">
                          {['Organization', 'Plan', 'Users', 'Submissions', 'Forms', ''].map(h => (
                            <th key={h} className="text-left px-3 py-2 text-xs font-medium text-catalan-textMuted uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tenants.map(t => (
                          <tr key={t.id} className="border-b border-catalan-border hover:bg-catalan-hover">
                            <td className="px-3 py-2 font-medium text-catalan-text">{t.name}</td>
                            <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded capitalize ${PLAN_STYLE[t.plan_tier] ?? ''}`}>{t.plan_tier}</span></td>
                            <td className="px-3 py-2 text-catalan-textMuted">{t.users_count}</td>
                            <td className="px-3 py-2 text-catalan-textMuted">{t.submissions_count}</td>
                            <td className="px-3 py-2 text-catalan-textMuted">{t.forms_count}</td>
                            <td className="px-3 py-2">
                              <div className="flex gap-2">
                                <button onClick={() => openDrillDown(t)} className="text-xs text-catalan-primary hover:underline">View →</button>
                                <button onClick={() => openEditModal(t)} className="text-xs text-catalan-textMuted hover:text-catalan-text">Edit</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* ── TENANT DRILL-DOWN ── */}
          {tab === 'tenants' && selectedTenant && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setSelectedTenant(null)} className="text-catalan-textMuted hover:text-catalan-text text-sm">← Back to Tenants</button>
                <span className="text-catalan-textMuted">/</span>
                <span className="font-semibold text-catalan-text">{selectedTenant.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded capitalize ${PLAN_STYLE[selectedTenant.plan_tier] ?? ''}`}>{selectedTenant.plan_tier}</span>
              </div>

              {/* Drill tabs */}
              <div className="flex gap-1 bg-catalan-surface rounded-lg p-1 w-fit">
                {([['progress', 'Team Progress'], ['subs', 'Submissions'], ['users', 'Users']] as const).map(([t, label]) => (
                  <button key={t} onClick={() => setDrillTab(t)}
                    className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${drillTab === t ? 'bg-catalan-primary text-white shadow-sm' : 'text-catalan-textMuted hover:text-catalan-text hover:bg-catalan-hover'}`}>
                    {label}
                  </button>
                ))}
              </div>

              {loadingDrill && <p className="text-catalan-textMuted text-sm py-6 text-center">Loading…</p>}

              {/* Team Progress */}
              {!loadingDrill && drillTab === 'progress' && (
                <Card title={`Enumerator Performance — ${selectedTenant.name}`}>
                  {drillStats.length === 0 ? (
                    <p className="text-catalan-textMuted text-sm py-6 text-center">No submissions yet for this tenant</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[600px]">
                        <thead>
                          <tr className="border-b border-catalan-border bg-catalan-primary/10">
                            {['Enumerator', 'Total', 'Approved', 'Flagged', 'Rejected', 'Last Active'].map(h => (
                              <th key={h} className="text-left px-3 py-2 text-xs font-medium text-catalan-textMuted uppercase">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {drillStats.map((s, i) => (
                            <tr key={s.id} className={`border-b border-catalan-border ${i % 2 === 0 ? '' : 'bg-catalan-hover/40'}`}>
                              <td className="px-3 py-2 font-medium text-catalan-text">{s.name}</td>
                              <td className="px-3 py-2 font-bold text-catalan-text">{s.total}</td>
                              <td className="px-3 py-2 text-green-600">{s.approved}</td>
                              <td className="px-3 py-2 text-yellow-600">{s.flagged}</td>
                              <td className="px-3 py-2 text-red-500">{s.rejected}</td>
                              <td className="px-3 py-2 text-catalan-textMuted text-xs">
                                {s.last_submission ? new Date(s.last_submission).toLocaleDateString() : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              )}

              {/* Submissions */}
              {!loadingDrill && drillTab === 'subs' && (
                <Card title={`Recent Submissions — ${selectedTenant.name}`}>
                  {drillSubs.length === 0 ? (
                    <p className="text-catalan-textMuted text-sm py-6 text-center">No submissions yet</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[580px]">
                        <thead>
                          <tr className="border-b border-catalan-border">
                            {['#', 'Form', 'Enumerator', 'Status', 'Date'].map(h => (
                              <th key={h} className="text-left px-3 py-2 text-xs font-medium text-catalan-textMuted uppercase">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {drillSubs.map(s => (
                            <tr key={s.id} className="border-b border-catalan-border hover:bg-catalan-hover">
                              <td className="px-3 py-2 text-catalan-textMuted font-mono text-xs">{s.serial_no ?? '—'}</td>
                              <td className="px-3 py-2 text-catalan-text">{s.form_title}</td>
                              <td className="px-3 py-2 text-catalan-text">{s.enumerator_name}</td>
                              <td className="px-3 py-2"><StatusBadge status={s.status} /></td>
                              <td className="px-3 py-2 text-catalan-textMuted text-xs">{new Date(s.server_received_at).toLocaleDateString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              )}

              {/* Users */}
              {!loadingDrill && drillTab === 'users' && (
                <Card title={`Users — ${selectedTenant.name}`}>
                  {drillUsers.length === 0 ? (
                    <p className="text-catalan-textMuted text-sm py-6 text-center">No users yet</p>
                  ) : (
                    <div className="space-y-2">
                      {drillUsers.map(u => (
                        <div key={u.id} className="flex items-center justify-between p-3 bg-catalan-hover rounded border border-catalan-border">
                          <div>
                            <p className="text-sm font-medium text-catalan-text">{u.name}</p>
                            <p className="text-xs text-catalan-textMuted">{u.phone}{u.email ? ` · ${u.email}` : ''}</p>
                          </div>
                          <RoleBadge role={u.role} />
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              )}
            </div>
          )}

          {/* ── TEAM PROGRESS TAB (cross-tenant summary) ── */}
          {tab === 'progress' && (
            <div className="space-y-4">
              <p className="text-sm text-catalan-textMuted">Click <strong>View →</strong> on any tenant in the Tenants tab to see their detailed team progress.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {tenants.map(t => (
                  <Card key={t.id} className="cursor-pointer hover:border-catalan-primary/50 transition-colors" onClick={() => openDrillDown(t)}>
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="font-semibold text-catalan-text">{t.name}</p>
                        <span className={`text-xs px-2 py-0.5 rounded capitalize ${PLAN_STYLE[t.plan_tier] ?? ''}`}>{t.plan_tier}</span>
                      </div>
                      <span className="text-catalan-primary text-xs font-medium">View →</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div><div className="text-lg font-bold text-catalan-text">{t.users_count}</div><div className="text-xs text-catalan-textMuted">Users</div></div>
                      <div><div className="text-lg font-bold text-catalan-text">{t.submissions_count}</div><div className="text-xs text-catalan-textMuted">Submissions</div></div>
                      <div><div className="text-lg font-bold text-catalan-text">{t.forms_count}</div><div className="text-xs text-catalan-textMuted">Forms</div></div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* ── Files Tab ── */}
          {tab === 'files' && (
            <div className="space-y-5">
              {/* Upload Section */}
              <Card>
                <h3 className="text-sm font-semibold text-catalan-text mb-3">Upload New File</h3>
                <div className="space-y-3">
                  <input type="file" onChange={e => setUploadFile(e.target.files?.[0] || null)} className="block w-full text-sm text-catalan-text file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-catalan-primary file:text-white hover:file:opacity-80" />
                  <Input label="Description (optional)" value={fileDesc} onChange={e => setFileDesc(e.target.value)} placeholder="What is this file?" />
                  <div>
                    <label className="block text-sm font-medium text-catalan-text mb-2">Share with Tenants</label>
                    <div className="flex flex-wrap gap-2">
                      {tenants.map(t => (
                        <label key={t.id} className="flex items-center gap-1.5 text-xs bg-catalan-hover px-2 py-1 rounded cursor-pointer">
                          <input type="checkbox" checked={fileShareTenants.includes(t.id)} onChange={e => {
                            if (e.target.checked) setFileShareTenants([...fileShareTenants, t.id])
                            else setFileShareTenants(fileShareTenants.filter(x => x !== t.id))
                          }} />
                          {t.name}
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-catalan-textMuted mt-1">Leave unchecked to keep file private (only you can see it)</p>
                  </div>
                  <Button onClick={handleUploadFile} disabled={!uploadFile || uploading}>
                    {uploading ? 'Uploading...' : 'Upload File'}
                  </Button>
                </div>
              </Card>

              {/* File List */}
              <Card>
                <h3 className="text-sm font-semibold text-catalan-text mb-3">Uploaded Files</h3>
                {loadingFiles ? <p className="text-sm text-catalan-textMuted">Loading...</p> : sharedFiles.length === 0 ? (
                  <p className="text-sm text-catalan-textMuted">No files uploaded yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-catalan-border text-left text-catalan-textMuted">
                          <th className="pb-2 pr-4">File</th>
                          <th className="pb-2 pr-4">Size</th>
                          <th className="pb-2 pr-4">Description</th>
                          <th className="pb-2 pr-4">Shared With</th>
                          <th className="pb-2 pr-4">Uploaded</th>
                          <th className="pb-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sharedFiles.map(f => (
                          <tr key={f.id} className="border-b border-catalan-border/50">
                            <td className="py-2 pr-4 font-medium text-catalan-text">{f.filename}</td>
                            <td className="py-2 pr-4 text-catalan-textMuted">{(f.size / 1024).toFixed(1)} KB</td>
                            <td className="py-2 pr-4 text-catalan-textMuted">{f.description || '—'}</td>
                            <td className="py-2 pr-4">
                              <div className="flex flex-wrap gap-1">
                                {(f.shared_with || []).length === 0 ? <span className="text-xs text-catalan-textMuted">Private</span> : (f.shared_with as string[]).map((tid: string) => {
                                  const tn = tenants.find(t => t.id === tid)
                                  return <span key={tid} className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{tn?.name || tid.slice(0, 8)}</span>
                                })}
                              </div>
                            </td>
                            <td className="py-2 pr-4 text-catalan-textMuted text-xs">{f.created_at ? new Date(f.created_at).toLocaleDateString() : '—'}</td>
                            <td className="py-2">
                              <div className="flex gap-2">
                                <button onClick={async () => {
                                  const res = await api.get(`/shared-files/${f.id}/download`, { responseType: 'blob' })
                                  const url = URL.createObjectURL(res.data)
                                  const a = document.createElement('a'); a.href = url; a.download = f.filename; a.click()
                                  URL.revokeObjectURL(url)
                                }} className="text-xs text-catalan-primary hover:underline">Download</button>
                                <button onClick={() => handleDeleteFile(f.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                                <button onClick={() => {
                                  const allIds = tenants.map(t => t.id)
                                  const current = f.shared_with || []
                                  const newIds = current.length === allIds.length ? [] : allIds
                                  handleUpdateSharing(f.id, newIds)
                                }} className="text-xs text-blue-500 hover:underline">
                                  {(f.shared_with || []).length === tenants.length ? 'Unshare All' : 'Share All'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Create Tenant Modal */}
      {showCreateModal && (
        <Modal isOpen onClose={() => setShowCreateModal(false)} title="Create New Tenant"
          footer={<div className="flex gap-3"><Button variant="secondary" onClick={() => setShowCreateModal(false)}>Cancel</Button><Button onClick={createTenant}>Create</Button></div>}>
          <div className="space-y-4">
            <Input label="Organization Name" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g., Health Ministry" />
            <Input label="App Name" value={formData.app_name} onChange={e => setFormData({...formData, app_name: e.target.value})} placeholder="e.g., FieldGovern Health" />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-catalan-text mb-2">Plan Tier</label>
                <select value={formData.plan_tier} onChange={e => setFormData({...formData, plan_tier: e.target.value})} className="w-full bg-catalan-hover border border-catalan-border text-catalan-text rounded px-3 py-2 text-sm">
                  <option value="starter">Starter</option><option value="professional">Professional</option><option value="enterprise">Enterprise</option>
                </select>
              </div>
              <Input label="Primary Color" type="color" value={formData.primary_color} onChange={e => setFormData({...formData, primary_color: e.target.value})} />
            </div>
            <Input label="Admin Phone" type="tel" value={formData.admin_phone} onChange={e => setFormData({...formData, admin_phone: e.target.value})} placeholder="+919999999999" />
            <Input label="Admin Name" value={formData.admin_name} onChange={e => setFormData({...formData, admin_name: e.target.value})} />
            <Input label="Admin Password" type="password" value={formData.admin_password} onChange={e => setFormData({...formData, admin_password: e.target.value})} />
          </div>
        </Modal>
      )}

      {/* Edit Tenant Modal */}
      {showEditModal && editingTenant && (
        <Modal isOpen onClose={() => { setShowEditModal(false); setEditingTenant(null) }} title={`Edit: ${editingTenant.name}`}
          footer={<div className="flex gap-3"><Button variant="secondary" onClick={() => { setShowEditModal(false); setEditingTenant(null) }}>Cancel</Button><Button onClick={updateTenant}>Save</Button></div>}>
          <div className="space-y-4">
            <Input label="Organization Name" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
            <Input label="App Name" value={formData.app_name} onChange={e => setFormData({...formData, app_name: e.target.value})} />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-catalan-text mb-2">Plan Tier</label>
                <select value={formData.plan_tier} onChange={e => setFormData({...formData, plan_tier: e.target.value})} className="w-full bg-catalan-hover border border-catalan-border text-catalan-text rounded px-3 py-2 text-sm">
                  <option value="starter">Starter</option><option value="professional">Professional</option><option value="enterprise">Enterprise</option>
                </select>
              </div>
              <Input label="Primary Color" type="color" value={formData.primary_color} onChange={e => setFormData({...formData, primary_color: e.target.value})} />
            </div>
            <Input label="Logo URL" value={formData.logo_url} onChange={e => setFormData({...formData, logo_url: e.target.value})} placeholder="https://…" />
          </div>
        </Modal>
      )}
    </div>
  )
}
