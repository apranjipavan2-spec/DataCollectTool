/**
 * Master Admin Panel — platform-wide view across all tenants.
 * Tabs: Overview · Tenants · Team Progress · Files
 */
import { useState, useEffect, useMemo } from 'react'
import api, { getStoredUser } from '@/lib/api'
import { getNavItems } from '@/lib/navigation'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { Button, Input, Modal, Alert } from '@/components/ui'

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

const PLAN_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  enterprise:   { bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/20', dot: 'bg-indigo-400' },
  professional: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', dot: 'bg-emerald-400' },
  starter:      { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', dot: 'bg-amber-400' },
  free:         { bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/20', dot: 'bg-gray-400' },
}

const STATUS_DOT: Record<string, string> = {
  approved: 'bg-emerald-400', synced: 'bg-blue-400',
  flagged: 'bg-amber-400', rejected: 'bg-rose-400',
}

function PlanBadge({ plan }: { plan: string }) {
  const c = PLAN_COLORS[plan] ?? PLAN_COLORS.free
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${c.bg} ${c.text} ${c.border} capitalize`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {plan}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs capitalize text-catalan-text">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[status] ?? 'bg-gray-400'}`} />
      {status}
    </span>
  )
}

function RoleBadge({ role }: { role: string }) {
  const cls = role === 'org_admin' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
    : role === 'supervisor' ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
    : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
  return <span className={`text-xs font-medium px-2.5 py-1 rounded-full border capitalize ${cls}`}>{role.replace('_', ' ')}</span>
}

function GlassCard({ children, className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-2xl p-5 backdrop-blur-sm ${className}`}
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
      }}
      {...props}>
      {children}
    </div>
  )
}

function StatCard({ label, sub, value, gradient, iconColor, icon }: {
  label: string; sub: string; value: number; gradient: string; iconColor: string; icon: React.ReactNode
}) {
  return (
    <div className="group rounded-2xl p-5 transition-all duration-300 hover:translate-y-[-2px] cursor-default relative overflow-hidden"
      style={{ background: gradient, border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
      <div className="absolute top-0 right-0 w-32 h-32 opacity-[0.03] transform translate-x-8 -translate-y-8">
        <svg viewBox="0 0 24 24" fill="currentColor" style={{ color: iconColor }}>{icon}</svg>
      </div>
      <div className="relative">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-sm font-medium text-catalan-textMuted">{label}</div>
            <div className="text-xs text-catalan-textMuted/60 mt-0.5">{sub}</div>
          </div>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110"
            style={{ background: `${iconColor}15`, boxShadow: `0 0 20px ${iconColor}10` }}>
            <svg className="w-5 h-5" style={{ color: iconColor }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {icon}
            </svg>
          </div>
        </div>
        <div className="text-3xl font-bold tracking-tight" style={{ color: iconColor }}>
          {value.toLocaleString()}
        </div>
      </div>
    </div>
  )
}

function TableHeader({ columns }: { columns: string[] }) {
  return (
    <thead>
      <tr className="border-b border-white/[0.06]">
        {columns.map(h => (
          <th key={h} className="text-left px-4 py-3 text-[11px] font-semibold text-catalan-textMuted uppercase tracking-widest">{h}</th>
        ))}
      </tr>
    </thead>
  )
}

function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-catalan-textMuted">
      <div className="text-5xl mb-4 opacity-40">{icon}</div>
      <p className="text-sm">{message}</p>
    </div>
  )
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

  useEffect(() => { loadTenants() }, [])

  useEffect(() => {
    if (tab === 'overview' && overview.length === 0) {
      setLoadingOverview(true)
      api.get('/admin/monitor/overview').then(r => setOverview(r.data)).catch(() => {}).finally(() => setLoadingOverview(false))
    }
  }, [tab])

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

  const TABS = [
    { key: 'overview' as const, label: 'Overview', icon: <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /> },
    { key: 'tenants' as const, label: 'Tenants', icon: <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /> },
    { key: 'progress' as const, label: 'Team Progress', icon: <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /> },
    { key: 'files' as const, label: 'Files', icon: <path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /> },
  ]

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={sidebarItems} role={user.role} />

      <div className="flex-1 flex flex-col overflow-auto">
        <TopNav title="Platform Admin" />

        <div className="flex-1 p-4 md:p-6 lg:p-8 space-y-6">
          {error && <Alert type="error" message={error} onClose={() => setError('')} />}

          {/* ── Welcome Header ── */}
          <div className="rounded-2xl p-6 relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(139,92,246,0.08) 50%, rgba(236,72,153,0.06) 100%)',
              border: '1px solid rgba(99,102,241,0.15)',
            }}>
            <div className="absolute inset-0 opacity-[0.03]"
              style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, #6366f1 1px, transparent 1px), radial-gradient(circle at 80% 20%, #8b5cf6 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
            <div className="relative flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-catalan-text tracking-tight">
                  {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'}, {user.name?.split(' ')[0] || 'Admin'}
                </h2>
                <p className="text-sm text-catalan-textMuted mt-1">
                  {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              </div>
              <div className="hidden md:flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold"
                style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)', color: '#34d399' }}>
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse" />
                {tenants.length} tenant{tenants.length !== 1 ? 's' : ''} active
              </div>
            </div>
          </div>

          {/* ── Platform Stats ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Tenants" sub="Active organizations" value={tenants.length}
              gradient="linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(99,102,241,0.02) 100%)"
              iconColor="#818cf8"
              icon={<path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />}
            />
            <StatCard
              label="Total Users" sub="Across all tenants" value={totals.users}
              gradient="linear-gradient(135deg, rgba(96,165,250,0.08) 0%, rgba(96,165,250,0.02) 100%)"
              iconColor="#60a5fa"
              icon={<path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />}
            />
            <StatCard
              label="Submissions" sub="All collected data" value={totals.submissions}
              gradient="linear-gradient(135deg, rgba(52,211,153,0.08) 0%, rgba(52,211,153,0.02) 100%)"
              iconColor="#34d399"
              icon={<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />}
            />
            <StatCard
              label="Forms" sub="Published questionnaires" value={totals.forms}
              gradient="linear-gradient(135deg, rgba(251,191,36,0.08) 0%, rgba(251,191,36,0.02) 100%)"
              iconColor="#fbbf24"
              icon={<path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />}
            />
          </div>

          {/* ── Tabs ── */}
          <div className="flex gap-1 rounded-2xl p-1.5 w-fit flex-wrap"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            {TABS.map(t => (
              <button key={t.key} onClick={() => { setTab(t.key); setSelectedTenant(null) }}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-300 ${
                  tab === t.key ? 'text-white shadow-lg' : 'text-catalan-textMuted hover:text-catalan-text hover:bg-white/[0.04]'
                }`}
                style={tab === t.key ? {
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
                } : undefined}>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  {t.icon}
                </svg>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── OVERVIEW TAB ── */}
          {tab === 'overview' && (
            <GlassCard>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-lg font-bold text-catalan-text">Platform Overview</h3>
                  <p className="text-xs text-catalan-textMuted mt-0.5">Progress by tenant organization</p>
                </div>
              </div>
              {loadingOverview ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                </div>
              ) : overview.length === 0 ? (
                <EmptyState icon="📊" message="No data available yet" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <TableHeader columns={['Tenant', 'Plan', 'Users', 'Programs', 'Target', 'Collected', 'Progress']} />
                    <tbody>
                      {overview.map((row, i) => (
                        <tr key={row.tenant_id} className={`border-b border-white/[0.04] transition-colors duration-150 hover:bg-white/[0.03] ${i % 2 === 0 ? '' : 'bg-white/[0.01]'}`}>
                          <td className="px-4 py-3 font-medium text-catalan-text">{row.tenant_name}</td>
                          <td className="px-4 py-3"><PlanBadge plan={row.plan_tier} /></td>
                          <td className="px-4 py-3 text-catalan-textMuted">{row.user_count}</td>
                          <td className="px-4 py-3 text-catalan-textMuted">{row.program_count}</td>
                          <td className="px-4 py-3 text-catalan-textMuted font-mono text-xs">{row.total_target.toLocaleString()}</td>
                          <td className="px-4 py-3 text-catalan-textMuted font-mono text-xs">{row.total_collected.toLocaleString()}</td>
                          <td className="px-4 py-3 w-44">
                            <div className="flex items-center gap-3">
                              <div className="flex-1 h-2 bg-white/[0.06] rounded-full overflow-hidden">
                                <div className="h-full rounded-full transition-all duration-500"
                                  style={{
                                    width: `${Math.min(row.pct, 100)}%`,
                                    background: row.pct >= 80 ? 'linear-gradient(90deg, #34d399, #10b981)' :
                                               row.pct >= 50 ? 'linear-gradient(90deg, #60a5fa, #3b82f6)' :
                                               'linear-gradient(90deg, #fbbf24, #f59e0b)',
                                  }} />
                              </div>
                              <span className="text-xs font-semibold text-catalan-textMuted w-10 text-right">{row.pct}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </GlassCard>
          )}

          {/* ── TENANTS TAB ── */}
          {tab === 'tenants' && !selectedTenant && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-sm text-catalan-textMuted">{tenants.length} tenant{tenants.length !== 1 ? 's' : ''} registered</p>
                <Button onClick={() => setShowCreateModal(true)}>+ New Tenant</Button>
              </div>
              {loadingTenants ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                </div>
              ) : tenants.length === 0 ? (
                <GlassCard>
                  <EmptyState icon="🏢" message="No tenants yet. Create one to get started." />
                </GlassCard>
              ) : (
                <GlassCard className="!p-0 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[700px]">
                      <TableHeader columns={['Organization', 'Plan', 'Status', 'Users', 'Submissions', 'Forms', 'Created', '']} />
                      <tbody>
                        {tenants.map((t, i) => (
                          <tr key={t.id} className={`border-b border-white/[0.04] transition-colors duration-150 hover:bg-white/[0.03] ${i % 2 === 0 ? '' : 'bg-white/[0.01]'}`}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                {t.logo_url ? (
                                  <img src={t.logo_url} alt="" className="w-9 h-9 rounded-lg object-cover ring-1 ring-white/10" />
                                ) : (
                                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold"
                                    style={{ background: `${t.primary_color}20`, color: t.primary_color }}>
                                    {t.name.charAt(0).toUpperCase()}
                                  </div>
                                )}
                                <div>
                                  <div className="font-semibold text-catalan-text">{t.name}</div>
                                  {t.app_name && t.app_name !== t.name && (
                                    <div className="text-xs text-catalan-textMuted">White-label: {t.app_name}</div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3"><PlanBadge plan={t.plan_tier} /></td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border capitalize ${
                                t.subscription_status === 'active'
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                  : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${t.subscription_status === 'active' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                                {t.subscription_status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center text-catalan-textMuted font-mono">{t.users_count}</td>
                            <td className="px-4 py-3 text-center text-catalan-textMuted font-mono">{t.submissions_count}</td>
                            <td className="px-4 py-3 text-center text-catalan-textMuted font-mono">{t.forms_count}</td>
                            <td className="px-4 py-3 text-catalan-textMuted text-xs whitespace-nowrap">{t.created_at?.slice(0, 10)}</td>
                            <td className="px-4 py-3">
                              <div className="flex gap-2">
                                <button onClick={() => openDrillDown(t)}
                                  className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all duration-200 hover:shadow-md"
                                  style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)' }}>
                                  View
                                </button>
                                <button onClick={() => openEditModal(t)}
                                  className="text-xs font-medium px-3 py-1.5 rounded-lg text-catalan-textMuted transition-all duration-200 hover:bg-white/[0.05]"
                                  style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                                  Edit
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </GlassCard>
              )}
            </div>
          )}

          {/* ── TENANT DRILL-DOWN ── */}
          {tab === 'tenants' && selectedTenant && (
            <div className="space-y-5">
              {/* Breadcrumb header */}
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => setSelectedTenant(null)}
                  className="flex items-center gap-1.5 text-sm text-catalan-textMuted hover:text-catalan-text transition-colors">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 19l-7-7 7-7" /></svg>
                  Back
                </button>
                <span className="text-catalan-textMuted/40">/</span>
                <div className="flex items-center gap-2">
                  {selectedTenant.logo_url ? (
                    <img src={selectedTenant.logo_url} alt="" className="w-6 h-6 rounded object-cover" />
                  ) : (
                    <div className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold"
                      style={{ background: `${selectedTenant.primary_color}20`, color: selectedTenant.primary_color }}>
                      {selectedTenant.name.charAt(0)}
                    </div>
                  )}
                  <span className="font-bold text-catalan-text">{selectedTenant.name}</span>
                  <PlanBadge plan={selectedTenant.plan_tier} />
                </div>
              </div>

              {/* Drill tabs */}
              <div className="flex gap-1 rounded-xl p-1 w-fit"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                {([['progress', 'Team Progress'], ['subs', 'Submissions'], ['users', 'Users']] as const).map(([t, label]) => (
                  <button key={t} onClick={() => setDrillTab(t)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
                      drillTab === t ? 'text-white shadow-sm' : 'text-catalan-textMuted hover:text-catalan-text hover:bg-white/[0.04]'
                    }`}
                    style={drillTab === t ? {
                      background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                      boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
                    } : undefined}>
                    {label}
                  </button>
                ))}
              </div>

              {loadingDrill && (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                </div>
              )}

              {/* Team Progress */}
              {!loadingDrill && drillTab === 'progress' && (
                <GlassCard>
                  <h3 className="text-base font-bold text-catalan-text mb-4">Enumerator Performance</h3>
                  {drillStats.length === 0 ? (
                    <EmptyState icon="📋" message="No submissions yet for this tenant" />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[600px]">
                        <TableHeader columns={['Enumerator', 'Total', 'Approved', 'Flagged', 'Rejected', 'Last Active']} />
                        <tbody>
                          {drillStats.map((s, i) => (
                            <tr key={s.id} className={`border-b border-white/[0.04] transition-colors duration-150 hover:bg-white/[0.03] ${i % 2 === 0 ? '' : 'bg-white/[0.01]'}`}>
                              <td className="px-4 py-3 font-medium text-catalan-text">{s.name}</td>
                              <td className="px-4 py-3 font-bold text-catalan-text font-mono">{s.total}</td>
                              <td className="px-4 py-3 font-mono" style={{ color: '#34d399' }}>{s.approved}</td>
                              <td className="px-4 py-3 font-mono" style={{ color: '#fbbf24' }}>{s.flagged}</td>
                              <td className="px-4 py-3 font-mono" style={{ color: '#f87171' }}>{s.rejected}</td>
                              <td className="px-4 py-3 text-catalan-textMuted text-xs">
                                {s.last_submission ? new Date(s.last_submission).toLocaleDateString() : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </GlassCard>
              )}

              {/* Submissions */}
              {!loadingDrill && drillTab === 'subs' && (
                <GlassCard>
                  <h3 className="text-base font-bold text-catalan-text mb-4">Recent Submissions</h3>
                  {drillSubs.length === 0 ? (
                    <EmptyState icon="📝" message="No submissions yet" />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[580px]">
                        <TableHeader columns={['#', 'Form', 'Enumerator', 'Status', 'Date']} />
                        <tbody>
                          {drillSubs.map((s, i) => (
                            <tr key={s.id} className={`border-b border-white/[0.04] transition-colors duration-150 hover:bg-white/[0.03] ${i % 2 === 0 ? '' : 'bg-white/[0.01]'}`}>
                              <td className="px-4 py-3 text-catalan-textMuted font-mono text-xs">{s.serial_no ?? '—'}</td>
                              <td className="px-4 py-3 text-catalan-text">{s.form_title}</td>
                              <td className="px-4 py-3 text-catalan-text">{s.enumerator_name}</td>
                              <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                              <td className="px-4 py-3 text-catalan-textMuted text-xs">{new Date(s.server_received_at).toLocaleDateString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </GlassCard>
              )}

              {/* Users */}
              {!loadingDrill && drillTab === 'users' && (
                <GlassCard>
                  <h3 className="text-base font-bold text-catalan-text mb-4">Users</h3>
                  {drillUsers.length === 0 ? (
                    <EmptyState icon="👥" message="No users yet" />
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {drillUsers.map(u => (
                        <div key={u.id} className="flex items-center justify-between p-4 rounded-xl transition-all duration-200 hover:bg-white/[0.03]"
                          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                              style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8' }}>
                              {u.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-catalan-text">{u.name}</p>
                              <p className="text-xs text-catalan-textMuted">{u.phone}{u.email ? ` · ${u.email}` : ''}</p>
                            </div>
                          </div>
                          <RoleBadge role={u.role} />
                        </div>
                      ))}
                    </div>
                  )}
                </GlassCard>
              )}
            </div>
          )}

          {/* ── TEAM PROGRESS TAB ── */}
          {tab === 'progress' && (
            <div className="space-y-4">
              <p className="text-sm text-catalan-textMuted">Click a tenant card to drill into detailed team progress.</p>
              {tenants.length === 0 ? (
                <GlassCard>
                  <EmptyState icon="📊" message="No tenants available yet" />
                </GlassCard>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {tenants.map(t => (
                    <div key={t.id}
                      className="group rounded-2xl p-5 cursor-pointer transition-all duration-300 hover:translate-y-[-2px] hover:shadow-xl relative overflow-hidden"
                      style={{
                        background: 'linear-gradient(135deg, rgba(99,102,241,0.06), rgba(139,92,246,0.03))',
                        border: '1px solid rgba(99,102,241,0.12)',
                      }}
                      onClick={() => openDrillDown(t)}>
                      <div className="absolute top-0 right-0 w-24 h-24 opacity-[0.04] transform translate-x-6 -translate-y-6 rounded-full"
                        style={{ background: t.primary_color }} />
                      <div className="relative">
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center gap-3">
                            {t.logo_url ? (
                              <img src={t.logo_url} alt="" className="w-10 h-10 rounded-lg object-cover ring-1 ring-white/10" />
                            ) : (
                              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold"
                                style={{ background: `${t.primary_color}20`, color: t.primary_color }}>
                                {t.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <p className="font-bold text-catalan-text">{t.name}</p>
                              <PlanBadge plan={t.plan_tier} />
                            </div>
                          </div>
                          <span className="text-xs font-medium px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                            style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8' }}>
                            View →
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { v: t.users_count, l: 'Users', c: '#60a5fa' },
                            { v: t.submissions_count, l: 'Submissions', c: '#34d399' },
                            { v: t.forms_count, l: 'Forms', c: '#fbbf24' },
                          ].map(m => (
                            <div key={m.l} className="text-center p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                              <div className="text-xl font-bold" style={{ color: m.c }}>{m.v}</div>
                              <div className="text-[10px] font-medium text-catalan-textMuted uppercase tracking-wider mt-0.5">{m.l}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── FILES TAB ── */}
          {tab === 'files' && (
            <div className="space-y-5">
              <GlassCard>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.1)' }}>
                    <svg className="w-5 h-5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-catalan-text">Upload New File</h3>
                    <p className="text-xs text-catalan-textMuted">Share files across tenant organizations</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="relative">
                    <input type="file" onChange={e => setUploadFile(e.target.files?.[0] || null)}
                      className="block w-full text-sm text-catalan-text file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-500/10 file:text-indigo-400 hover:file:bg-indigo-500/20 file:transition-colors file:cursor-pointer" />
                  </div>
                  <Input label="Description (optional)" value={fileDesc} onChange={e => setFileDesc(e.target.value)} placeholder="What is this file?" />
                  <div>
                    <label className="block text-sm font-medium text-catalan-text mb-2">Share with Tenants</label>
                    <div className="flex flex-wrap gap-2">
                      {tenants.map(t => (
                        <label key={t.id} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-all duration-200"
                          style={{
                            background: fileShareTenants.includes(t.id) ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${fileShareTenants.includes(t.id) ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.06)'}`,
                            color: fileShareTenants.includes(t.id) ? '#818cf8' : undefined,
                          }}>
                          <input type="checkbox" className="hidden" checked={fileShareTenants.includes(t.id)} onChange={e => {
                            if (e.target.checked) setFileShareTenants([...fileShareTenants, t.id])
                            else setFileShareTenants(fileShareTenants.filter(x => x !== t.id))
                          }} />
                          {t.name}
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-catalan-textMuted mt-1.5">Leave unchecked to keep file private</p>
                  </div>
                  <Button onClick={handleUploadFile} disabled={!uploadFile || uploading}>
                    {uploading ? 'Uploading...' : 'Upload File'}
                  </Button>
                </div>
              </GlassCard>

              <GlassCard>
                <h3 className="text-sm font-bold text-catalan-text mb-4">Uploaded Files</h3>
                {loadingFiles ? (
                  <div className="flex items-center justify-center py-10">
                    <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                  </div>
                ) : sharedFiles.length === 0 ? (
                  <EmptyState icon="📁" message="No files uploaded yet" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <TableHeader columns={['File', 'Size', 'Description', 'Shared With', 'Uploaded', 'Actions']} />
                      <tbody>
                        {sharedFiles.map((f, i) => (
                          <tr key={f.id} className={`border-b border-white/[0.04] transition-colors duration-150 hover:bg-white/[0.03] ${i % 2 === 0 ? '' : 'bg-white/[0.01]'}`}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs" style={{ background: 'rgba(99,102,241,0.1)' }}>
                                  <svg className="w-4 h-4 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                  </svg>
                                </div>
                                <span className="font-medium text-catalan-text">{f.filename}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-catalan-textMuted font-mono text-xs">{(f.size / 1024).toFixed(1)} KB</td>
                            <td className="px-4 py-3 text-catalan-textMuted text-xs">{f.description || '—'}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1">
                                {(f.shared_with || []).length === 0
                                  ? <span className="text-xs text-catalan-textMuted italic">Private</span>
                                  : (f.shared_with as string[]).map((tid: string) => {
                                    const tn = tenants.find(t => t.id === tid)
                                    return <span key={tid} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">{tn?.name || tid.slice(0, 8)}</span>
                                  })}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-catalan-textMuted text-xs">{f.created_at ? new Date(f.created_at).toLocaleDateString() : '—'}</td>
                            <td className="px-4 py-3">
                              <div className="flex gap-1.5">
                                <button onClick={async () => {
                                  const res = await api.get(`/shared-files/${f.id}/download`, { responseType: 'blob' })
                                  const url = URL.createObjectURL(res.data)
                                  const a = document.createElement('a'); a.href = url; a.download = f.filename; a.click()
                                  URL.revokeObjectURL(url)
                                }} className="text-[11px] font-medium px-2.5 py-1 rounded-lg transition-all duration-200 hover:bg-indigo-500/10 text-indigo-400">
                                  Download
                                </button>
                                <button onClick={() => handleDeleteFile(f.id)}
                                  className="text-[11px] font-medium px-2.5 py-1 rounded-lg transition-all duration-200 hover:bg-rose-500/10 text-rose-400">
                                  Delete
                                </button>
                                <button onClick={() => {
                                  const allIds = tenants.map(t => t.id)
                                  const current = f.shared_with || []
                                  handleUpdateSharing(f.id, current.length === allIds.length ? [] : allIds)
                                }} className="text-[11px] font-medium px-2.5 py-1 rounded-lg transition-all duration-200 hover:bg-sky-500/10 text-sky-400">
                                  {(f.shared_with || []).length === tenants.length ? 'Unshare' : 'Share All'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </GlassCard>
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
