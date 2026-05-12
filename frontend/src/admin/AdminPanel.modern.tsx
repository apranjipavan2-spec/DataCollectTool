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

          {/* Welcome Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-catalan-text">
                {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'}, {user.name?.split(' ')[0] || 'Admin'}
              </h2>
              <p className="text-sm text-catalan-textMuted mt-0.5">
                Platform Administration · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
                 style={{ background: 'rgba(137,180,250,0.1)', border: '1px solid rgba(137,180,250,0.2)', color: '#89b4fa' }}>
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse" />
              {tenants.length} tenant{tenants.length !== 1 ? 's' : ''} active
            </div>
          </div>

          {/* Platform stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              {
                label: 'Tenants', sub: 'Active organizations', value: tenants.length,
                gradient: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(99,102,241,0.05))',
                border: 'rgba(99,102,241,0.25)', color: '#818cf8',
                icon: <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />,
              },
              {
                label: 'Total Users', sub: 'Across all tenants', value: totals.users,
                gradient: 'linear-gradient(135deg, rgba(96,165,250,0.15), rgba(96,165,250,0.05))',
                border: 'rgba(96,165,250,0.25)', color: '#60a5fa',
                icon: <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />,
              },
              {
                label: 'Total Submissions', sub: 'All collected data', value: totals.submissions,
                gradient: 'linear-gradient(135deg, rgba(52,211,153,0.15), rgba(52,211,153,0.05))',
                border: 'rgba(52,211,153,0.25)', color: '#34d399',
                icon: <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />,
              },
              {
                label: 'Total Forms', sub: 'Published questionnaires', value: totals.forms,
                gradient: 'linear-gradient(135deg, rgba(251,191,36,0.15), rgba(251,191,36,0.05))',
                border: 'rgba(251,191,36,0.25)', color: '#fbbf24',
                icon: <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
              },
            ].map(card => (
              <div key={card.label}
                className="rounded-xl p-5 transition-all duration-200 hover:scale-[1.02] cursor-default"
                style={{ background: card.gradient, border: `1px solid ${card.border}` }}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-sm font-medium text-catalan-textMuted">{card.label}</div>
                    <div className="text-xs text-catalan-textMuted/70 mt-0.5">{card.sub}</div>
                  </div>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                       style={{ background: `${card.color}18` }}>
                    <svg className="w-5 h-5" style={{ color: card.color }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      {card.icon}
                    </svg>
                  </div>
                </div>
                <div className="text-3xl font-bold" style={{ color: card.color }}>{typeof card.value === 'number' ? card.value.toLocaleString() : card.value}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 rounded-xl p-1 w-fit flex-wrap"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            {(['overview', 'tenants', 'progress', 'files'] as const).map(t => (
              <button key={t} onClick={() => { setTab(t); setSelectedTenant(null) }}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${tab === t ? 'text-white shadow-sm' : 'text-catalan-textMuted hover:text-catalan-text hover:bg-catalan-hover'}`}
                style={tab === t ? {
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
                } : undefined}>
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
                        <tr key={row.tenant_id} className="border-b border-catalan-border hover:bg-catalan-hover transition-colors duration-150">
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
                          <tr key={t.id} className="border-b border-catalan-border hover:bg-catalan-hover transition-colors duration-150">
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
              <div className="flex gap-1 rounded-xl p-1 w-fit"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                {([['progress', 'Team Progress'], ['subs', 'Submissions'], ['users', 'Users']] as const).map(([t, label]) => (
                  <button key={t} onClick={() => setDrillTab(t)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${drillTab === t ? 'text-white shadow-sm' : 'text-catalan-textMuted hover:text-catalan-text hover:bg-catalan-hover'}`}
                    style={drillTab === t ? {
                      background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                      boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
                    } : undefined}>
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
                  <div key={t.id}
                    className="rounded-xl p-5 cursor-pointer transition-all duration-200 hover:scale-[1.02]"
                    style={{
                      background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.03))',
                      border: '1px solid rgba(99,102,241,0.15)',
                    }}
                    onClick={() => openDrillDown(t)}>
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="font-semibold text-catalan-text">{t.name}</p>
                        <span className={`text-xs px-2 py-0.5 rounded capitalize ${PLAN_STYLE[t.plan_tier] ?? ''}`}>{t.plan_tier}</span>
                      </div>
                      <span className="text-xs font-medium" style={{ color: '#818cf8' }}>View →</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div><div className="text-lg font-bold" style={{ color: '#60a5fa' }}>{t.users_count}</div><div className="text-xs text-catalan-textMuted">Users</div></div>
                      <div><div className="text-lg font-bold" style={{ color: '#34d399' }}>{t.submissions_count}</div><div className="text-xs text-catalan-textMuted">Submissions</div></div>
                      <div><div className="text-lg font-bold" style={{ color: '#fbbf24' }}>{t.forms_count}</div><div className="text-xs text-catalan-textMuted">Forms</div></div>
                    </div>
                  </div>
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
