import React, { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react'
import api, { getStoredUser } from '@/lib/api'
import { getNavItems } from '@/lib/navigation'
import { useToast } from '@/lib/ToastContext'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { Card, Button, Modal, Loading, Alert, Pagination, DashboardSkeleton } from '@/components/ui'
import BarChart from '@/components/charts/BarChart'
import LineChart from '@/components/charts/LineChart'
import AuditLog from '@/components/AuditLog'

const MiniMap = lazy(() => import('@/renderer/fields/MiniMap'))

// ── Types ──────────────────────────────────────────────────────────────────

interface Form {
  id: string
  title: string
  version: number
  status: string
  updated_at: string
}

interface Submission {
  id: string
  form_id: string
  enumerator_id: string
  enumerator_name: string
  status: string
  server_received_at: string
}

interface SubDetail extends Submission {
  form_version: string
  data_json: Record<string, unknown>
  gps_open: { lat: number; lng: number; accuracy: number } | null
  gps_submit: { lat: number; lng: number; accuracy: number } | null
  flag_note: string | null
  local_created_at: string
}

interface TeamMember {
  id: string
  name: string
  phone: string
  role: string
}

interface Assignment {
  id: string
  form_id: string
  form_title: string
  enumerator_id: string
  enumerator_name: string
  assigned_at: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  synced: 'text-catalan-primary bg-catalan-primary/10',
  flagged: 'text-catalan-warning bg-catalan-warning/10',
  approved: 'text-catalan-success bg-catalan-success/10',
  rejected: 'text-catalan-error bg-catalan-error/10',
  active: 'text-catalan-success bg-catalan-success/10',
  draft: 'text-catalan-textMuted bg-catalan-textMuted/10',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[status] ?? 'text-catalan-textMuted bg-catalan-textMuted/10'}`}>
      {status}
    </span>
  )
}

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    org_admin: { label: 'Admin', cls: 'text-catalan-primary bg-catalan-primary/10' },
    supervisor: { label: 'Supervisor', cls: 'text-catalan-warning bg-catalan-warning/10' },
    enumerator: { label: 'Enumerator', cls: 'text-catalan-success bg-catalan-success/10' },
  }
  const { label, cls } = map[role] ?? { label: role, cls: 'text-catalan-textMuted bg-catalan-textMuted/10' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

function renderFieldValue(val: unknown): React.ReactNode {
  if (val === null || val === undefined) return <span className="text-catalan-textMuted">—</span>
  if (typeof val === 'string') {
    if (val.startsWith('media://')) return <span className="text-catalan-primary">📎 Media uploaded</span>
    if (val === '__photo_pending__') return <span className="text-catalan-warning">📷 Photo pending upload</span>
    if (val === '__audio_pending__') return <span className="text-catalan-warning">🎙️ Audio pending upload</span>
    if (val.startsWith('data:image/')) return <img src={val} alt="photo" className="max-w-[200px] rounded-lg mt-1" />
    return val
  }
  if (Array.isArray(val)) return val.join(', ')
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

// ── Submission Detail Modal ────────────────────────────────────────────────

function SubmissionDetailModal({
  sub, forms, onClose, onFlag,
}: {
  sub: SubDetail
  forms: Form[]
  onClose: () => void
  onFlag: (id: string, status: string, note: string) => Promise<void>
}) {
  const formTitle = forms.find(f => f.id === sub.form_id)?.title ?? 'Unknown Form'
  const [flagNote, setFlagNote] = useState(sub.flag_note ?? '')
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [busy, setBusy] = useState(false)

  const isFlagged = sub.status === 'flagged'
  const isReviewed = sub.status === 'approved' || sub.status === 'rejected'
  const canReview = sub.status === 'synced' || sub.status === 'flagged'

  const handleFlag = async () => {
    setBusy(true)
    try {
      if (isFlagged) {
        await onFlag(sub.id, 'synced', '')
      } else {
        await onFlag(sub.id, 'flagged', flagNote)
      }
    } finally { setBusy(false) }
  }

  const handleApprove = async () => {
    setBusy(true)
    try { await onFlag(sub.id, 'approved', '') } finally { setBusy(false) }
  }

  const handleReject = async () => {
    if (!showRejectInput) { setShowRejectInput(true); return }
    if (!rejectReason.trim()) return
    setBusy(true)
    try { await onFlag(sub.id, 'rejected', rejectReason.trim()) } finally { setBusy(false) }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-catalan-bg border border-catalan-border rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-catalan-border flex justify-between items-start">
          <div>
            <h2 className="text-base font-semibold text-catalan-text">Submission Detail</h2>
            <p className="text-xs text-catalan-textMuted mt-0.5">{formTitle} · v{sub.form_version}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={sub.status} />
            <button onClick={onClose} className="text-catalan-textMuted hover:text-catalan-text text-2xl leading-none ml-2">×</button>
          </div>
        </div>

        {/* Meta grid */}
        <div className="px-5 py-3 grid grid-cols-2 gap-3 border-b border-catalan-border text-sm">
          {[
            ['Enumerator', sub.enumerator_name],
            ['Status', sub.status],
            ['Collected', sub.local_created_at ? new Date(sub.local_created_at).toLocaleString() : '—'],
            ['Received', new Date(sub.server_received_at).toLocaleString()],
          ].map(([label, val]) => (
            <div key={label}>
              <div className="text-xs text-catalan-textMuted mb-0.5">{label}</div>
              <div className="text-catalan-text">{val}</div>
            </div>
          ))}
          {sub.gps_submit && (
            <div className="col-span-2">
              <div className="text-xs text-catalan-textMuted mb-0.5">GPS</div>
              <div className="text-catalan-text text-xs font-mono">
                {sub.gps_submit.lat.toFixed(5)}, {sub.gps_submit.lng.toFixed(5)} (±{sub.gps_submit.accuracy}m)
              </div>
              <Suspense fallback={<div className="mt-2 h-[200px] bg-catalan-surface rounded-lg animate-pulse" />}>
                <MiniMap lat={sub.gps_submit.lat} lng={sub.gps_submit.lng} accuracy={sub.gps_submit.accuracy} />
              </Suspense>
            </div>
          )}
          <div className="col-span-2">
            <div className="text-xs text-catalan-textMuted mb-0.5">ID</div>
            <div className="text-catalan-text font-mono text-xs break-all">{sub.id}</div>
          </div>
        </div>

        {/* Supervisor Review */}
        <div className={`px-5 py-3 border-b border-catalan-border ${isReviewed && sub.status === 'approved' ? 'bg-catalan-success/5' : isReviewed ? 'bg-catalan-error/5' : isFlagged ? 'bg-catalan-warning/5' : ''}`}>
          <div className="text-xs font-medium text-catalan-textMuted uppercase tracking-wider mb-2">Supervisor Review</div>

          {isReviewed && sub.flag_note && (
            <div className={`text-sm p-2 rounded mb-2 ${sub.status === 'approved' ? 'text-catalan-success bg-catalan-success/10' : 'text-catalan-error bg-catalan-error/10'}`}>
              {sub.flag_note}
            </div>
          )}

          {isReviewed && (
            <p className="text-xs text-catalan-textMuted">This submission has been {sub.status}. No further actions available.</p>
          )}

          {canReview && (
            <div className="space-y-2">
              {!isFlagged && (
                <input
                  value={flagNote}
                  onChange={e => setFlagNote(e.target.value)}
                  placeholder="Add a flag note (optional)…"
                  className="w-full bg-catalan-surface border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text placeholder-catalan-textMuted focus:outline-none focus:border-catalan-primary"
                />
              )}
              {isFlagged && sub.flag_note && (
                <p className="text-sm text-catalan-warning">Flag note: {sub.flag_note}</p>
              )}
              {showRejectInput && (
                <input
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="Rejection reason (required)…"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Escape') { setShowRejectInput(false) } }}
                  className="w-full bg-catalan-surface border border-catalan-error/50 rounded-lg px-3 py-2 text-sm text-catalan-text placeholder-catalan-textMuted focus:outline-none focus:border-catalan-error"
                />
              )}
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={handleFlag}
                  disabled={busy}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isFlagged ? 'bg-catalan-success/20 text-catalan-success border border-catalan-success/30' : 'bg-catalan-warning/20 text-catalan-warning border border-catalan-warning/30'} disabled:opacity-50`}
                >
                  {busy ? '…' : isFlagged ? 'Unflag' : 'Flag for Review'}
                </button>
                <button
                  onClick={handleApprove}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-catalan-success/20 text-catalan-success border border-catalan-success/30 disabled:opacity-50 transition-colors"
                >
                  {busy ? '…' : 'Approve'}
                </button>
                <button
                  onClick={handleReject}
                  disabled={busy && showRejectInput}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-catalan-error/20 text-catalan-error border border-catalan-error/30 disabled:opacity-50 transition-colors"
                >
                  {busy ? '…' : showRejectInput ? 'Confirm Reject' : 'Reject'}
                </button>
                {showRejectInput && (
                  <button
                    onClick={() => { setShowRejectInput(false); setRejectReason('') }}
                    className="px-3 py-1.5 rounded-lg text-xs text-catalan-textMuted border border-catalan-border"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Response Data */}
        <div className="px-5 py-3">
          <div className="text-xs font-medium text-catalan-textMuted uppercase tracking-wider mb-3">Response Data</div>
          {Object.keys(sub.data_json).length === 0 ? (
            <p className="text-sm text-catalan-textMuted text-center py-4">No data</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(sub.data_json).map(([key, val]) => (
                <div key={key} className="border-b border-catalan-border pb-2">
                  <div className="text-xs text-catalan-textMuted mb-1">{key}</div>
                  <div className="text-sm text-catalan-text">{renderFieldValue(val)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Audit Trail */}
        <div className="px-5 py-3 border-t border-catalan-border">
          <div className="text-xs font-medium text-catalan-textMuted uppercase tracking-wider mb-2">Audit Trail</div>
          <AuditLog submissionId={sub.id} />
        </div>
      </div>
    </div>
  )
}

// ── Assign Modal ───────────────────────────────────────────────────────────

function AssignModal({
  form, team, assignments, onAssign, onUnassign, onClose,
}: {
  form: Form
  team: TeamMember[]
  assignments: Assignment[]
  onAssign: (enumeratorId: string) => Promise<void>
  onUnassign: (assignmentId: string) => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState('')
  const assignedIds = new Set(assignments.map(a => a.enumerator_id))
  const unassigned = team.filter(u => u.role === 'enumerator' && !assignedIds.has(u.id))

  const handleAssign = async (enumeratorId: string) => {
    setBusy(enumeratorId)
    try { await onAssign(enumeratorId) } catch {} finally { setBusy('') }
  }

  const handleUnassign = async (assignment: Assignment) => {
    setBusy(assignment.enumerator_id)
    try { await onUnassign(assignment.id) } catch {} finally { setBusy('') }
  }

  return (
    <Modal isOpen onClose={onClose} title={`Assign Enumerators — ${form.title}`} size="md">
      <div className="space-y-4">
        <div>
          <h4 className="text-xs font-medium text-catalan-textMuted uppercase tracking-wider mb-2">
            Assigned ({assignments.length})
          </h4>
          {assignments.length === 0 ? (
            <p className="text-sm text-catalan-textMuted">No enumerators assigned yet</p>
          ) : (
            <div className="space-y-1">
              {assignments.map(a => (
                <div key={a.id} className="flex justify-between items-center py-1.5 border-b border-catalan-border">
                  <span className="text-sm text-catalan-text">{a.enumerator_name}</span>
                  <button
                    onClick={() => handleUnassign(a)}
                    disabled={busy === a.enumerator_id}
                    className="text-xs px-2 py-1 rounded border border-catalan-error/30 text-catalan-error hover:bg-catalan-error/10 disabled:opacity-50"
                  >
                    {busy === a.enumerator_id ? '…' : 'Remove'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h4 className="text-xs font-medium text-catalan-textMuted uppercase tracking-wider mb-2">
            Available ({unassigned.length})
          </h4>
          {unassigned.length === 0 ? (
            <p className="text-sm text-catalan-textMuted">All enumerators assigned</p>
          ) : (
            <div className="space-y-1">
              {unassigned.map(u => (
                <div key={u.id} className="flex justify-between items-center py-1.5 border-b border-catalan-border">
                  <div>
                    <span className="text-sm text-catalan-text">{u.name}</span>
                    <span className="text-xs text-catalan-textMuted ml-2">{u.phone}</span>
                  </div>
                  <button
                    onClick={() => handleAssign(u.id)}
                    disabled={busy === u.id}
                    className="text-xs px-2 py-1 rounded border border-catalan-success/30 text-catalan-success hover:bg-catalan-success/10 disabled:opacity-50"
                  >
                    {busy === u.id ? '…' : '+ Assign'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────

const SUB_PAGE_SIZE  = 25
const TEAM_PAGE_SIZE = 20

export default function Dashboard() {
  const toast = useToast()
  const [tab, setTab] = useState<'overview' | 'submissions' | 'forms' | 'team'>('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Data
  const [forms, setForms] = useState<Form[]>([])
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])

  // Submission filters
  const [search, setSearch] = useState('')
  const [filterForm, setFilterForm] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [exportingCsv, setExportingCsv] = useState(false)

  // Submission pagination + sort
  const [subPage, setSubPage] = useState(1)
  const [subSortKey, setSubSortKey] = useState<keyof Submission | null>('server_received_at')
  const [subSortDir, setSubSortDir] = useState<'asc' | 'desc'>('desc')

  // Team sort + pagination
  const [teamPage, setTeamPage] = useState(1)
  const [teamSortKey, setTeamSortKey] = useState<keyof TeamMember | null>('name')
  const [teamSortDir, setTeamSortDir] = useState<'asc' | 'desc'>('asc')

  // Submission detail
  const [detailSub, setDetailSub] = useState<SubDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Forms modal
  const [assignForm, setAssignForm] = useState<Form | null>(null)

  // Team management
  const [showAddUser, setShowAddUser] = useState(false)
  const [newUser, setNewUser] = useState({ phone: '', name: '', role: 'enumerator', password: '' })
  const [addingUser, setAddingUser] = useState(false)
  const [showCsvImport, setShowCsvImport] = useState(false)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvUploading, setCsvUploading] = useState(false)
  const [csvResult, setCsvResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null)
  const csvInputRef = useRef<HTMLInputElement>(null)

  const user = getStoredUser() || { name: '', role: '' }
  const sidebarItems = getNavItems(user.role)

  useEffect(() => {
    Promise.allSettled([
      api.get('/forms/').then(r => setForms(r.data.forms ?? r.data ?? [])),
      api.get('/submissions/?page_size=200').then(r => setSubmissions(r.data.items ?? r.data.submissions ?? [])),
      api.get('/users/?page_size=200').then(r => setTeam(r.data.items ?? r.data.users ?? [])),
      api.get('/assignments/').then(r => setAssignments(r.data ?? [])),
    ]).then(results => {
      const failed = results.filter(r => r.status === 'rejected')
      if (failed.length > 0) setError('Some data failed to load')
    }).finally(() => setLoading(false))
  }, [])

  // Filtered submissions
  const filteredSubs = useMemo(() => submissions.filter(s => {
    if (filterForm && s.form_id !== filterForm) return false
    if (search && !s.enumerator_name.toLowerCase().includes(search.toLowerCase()) && !s.id.includes(search)) return false
    if (dateFrom && s.server_received_at < dateFrom) return false
    if (dateTo && s.server_received_at.slice(0, 10) > dateTo) return false
    return true
  }), [submissions, filterForm, search, dateFrom, dateTo])

  // Sorted submissions
  const sortedSubs = useMemo(() => {
    if (!subSortKey) return filteredSubs
    return [...filteredSubs].sort((a, b) => {
      const av = a[subSortKey] ?? ''
      const bv = b[subSortKey] ?? ''
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
      return subSortDir === 'asc' ? cmp : -cmp
    })
  }, [filteredSubs, subSortKey, subSortDir])

  // Paginated submissions
  const paginatedSubs = useMemo(() => {
    const start = (subPage - 1) * SUB_PAGE_SIZE
    return sortedSubs.slice(start, start + SUB_PAGE_SIZE)
  }, [sortedSubs, subPage])

  // Sorted team
  const sortedTeam = useMemo(() => {
    if (!teamSortKey) return team
    return [...team].sort((a, b) => {
      const av = a[teamSortKey] ?? ''
      const bv = b[teamSortKey] ?? ''
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
      return teamSortDir === 'asc' ? cmp : -cmp
    })
  }, [team, teamSortKey, teamSortDir])

  // Paginated team
  const paginatedTeam = useMemo(() => {
    const start = (teamPage - 1) * TEAM_PAGE_SIZE
    return sortedTeam.slice(start, start + TEAM_PAGE_SIZE)
  }, [sortedTeam, teamPage])

  // Sort handlers (toggle dir if same key, else set new key asc)
  const handleSubSort = (key: string) => {
    if (subSortKey === key) setSubSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSubSortKey(key as keyof Submission); setSubSortDir('asc') }
    setSubPage(1)
  }

  const handleTeamSort = (key: string) => {
    if (teamSortKey === key) setTeamSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setTeamSortKey(key as keyof TeamMember); setTeamSortDir('asc') }
    setTeamPage(1)
  }

  // Charts data
  const dailyCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of submissions) {
      const day = s.server_received_at?.slice(0, 10)
      if (day) counts[day] = (counts[day] ?? 0) + 1
    }
    return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }))
  }, [submissions])

  const enumeratorBarData = useMemo(() => {
    const counts: Record<string, { name: string; count: number }> = {}
    for (const s of submissions) {
      if (!counts[s.enumerator_id]) counts[s.enumerator_id] = { name: s.enumerator_name, count: 0 }
      counts[s.enumerator_id].count++
    }
    return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 10).map(r => ({ label: r.name, value: r.count }))
  }, [submissions])

  const stats = useMemo(() => ({
    totalSubs: submissions.length,
    totalForms: forms.length,
    teamSize: team.length,
    flagged: submissions.filter(s => s.status === 'flagged').length,
  }), [submissions, forms, team])

  const openDetail = async (id: string) => {
    setDetailLoading(true)
    try {
      const { data } = await api.get<SubDetail>(`/submissions/${id}`)
      setDetailSub(data)
    } catch {
      toast.error('Failed to load submission detail')
    } finally {
      setDetailLoading(false)
    }
  }

  const handleExport = async () => {
    if (!filterForm) { toast.warning('Select a form to export'); return }
    setExportingCsv(true)
    try {
      const res = await api.get(`/export/${filterForm}/csv`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url; a.download = 'export.csv'; a.click()
      URL.revokeObjectURL(url)
      toast.success('CSV exported successfully')
    } catch {
      toast.error('Export failed')
    } finally {
      setExportingCsv(false)
    }
  }

  const handleAddUser = async () => {
    if (!newUser.phone || !newUser.name) { toast.warning('Phone and name are required'); return }
    if (!newUser.password) { toast.warning('Password is required'); return }
    setAddingUser(true)
    try {
      const { data } = await api.post<TeamMember>('/users/', newUser)
      setTeam(t => [...t, { ...data, name: newUser.name, phone: newUser.phone, role: newUser.role }])
      setNewUser({ phone: '', name: '', role: 'enumerator', password: '' })
      setShowAddUser(false)
      toast.success(`${newUser.name} added to the team`)
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Failed to add user')
    } finally {
      setAddingUser(false)
    }
  }

  const handleDeactivate = async (member: TeamMember) => {
    if (!confirm(`Deactivate ${member.name}? They will no longer be able to log in.`)) return
    try {
      await api.delete(`/users/${member.id}`)
      setTeam(t => t.filter(m => m.id !== member.id))
      toast.success(`${member.name} deactivated`)
    } catch {
      toast.error('Failed to deactivate user')
    }
  }

  const handleCsvImport = async () => {
    if (!csvFile) return
    setCsvUploading(true)
    setCsvResult(null)
    try {
      const fd = new FormData()
      fd.append('file', csvFile)
      const { data } = await api.post<{ created: number; skipped: number; errors: string[] }>('/users/bulk-import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setCsvResult(data)
      if (data.created > 0) {
        const res = await api.get('/users/?page_size=200')
        setTeam(res.data.items ?? res.data.users ?? [])
        toast.success(`Imported ${data.created} user${data.created !== 1 ? 's' : ''}`)
      }
      if (data.errors.length > 0) toast.warning(`${data.errors.length} row${data.errors.length !== 1 ? 's' : ''} had errors`)
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Upload failed')
    } finally {
      setCsvUploading(false)
    }
  }

  return (
    <div className="flex h-screen bg-catalan-bg">
      {/* Submission detail modal */}
      {detailSub && (
        <SubmissionDetailModal
          sub={detailSub}
          forms={forms}
          onClose={() => setDetailSub(null)}
          onFlag={async (id, status, note) => {
            await api.patch(`/submissions/${id}`, { status, flag_note: note })
            setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status } : s))
            setDetailSub(d => d ? { ...d, status, flag_note: note || null } : null)
            toast.success(`Submission ${status}`)
          }}
        />
      )}

      {/* Assign modal */}
      {assignForm && (
        <AssignModal
          form={assignForm}
          team={team}
          assignments={assignments.filter(a => a.form_id === assignForm.id)}
          onAssign={async (enumeratorId) => {
            const { data } = await api.post('/assignments/', { form_id: assignForm.id, enumerator_id: enumeratorId })
            const member = team.find(u => u.id === enumeratorId)
            setAssignments(a => [...a, {
              id: data.id, form_id: assignForm.id, form_title: assignForm.title,
              enumerator_id: enumeratorId, enumerator_name: member?.name ?? 'Unknown',
              assigned_at: new Date().toISOString(),
            }])
            toast.success(`Assigned ${member?.name ?? 'enumerator'} to ${assignForm.title}`)
          }}
          onUnassign={async (assignmentId) => {
            const a = assignments.find(x => x.id === assignmentId)
            await api.delete(`/assignments/${assignmentId}`)
            setAssignments(prev => prev.filter(x => x.id !== assignmentId))
            if (a) toast.info(`Removed ${a.enumerator_name} from assignment`)
          }}
          onClose={() => setAssignForm(null)}
        />
      )}

      {/* Sidebar */}
      <Sidebar items={sidebarItems} role={user.role} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-auto">
        <TopNav title="Dashboard" />

        <div className="flex-1 p-6 space-y-6">
          {error && (
            <Alert type="warning" message={error} onClose={() => setError('')} />
          )}

          {/* ── Loading skeleton ── */}
          {loading && <DashboardSkeleton />}

          {/* Stat Cards */}
          {!loading && <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-l-4 border-l-catalan-primary">
              <div className="text-sm font-medium text-catalan-textMuted mb-1">Total Submissions</div>
              <div className="text-xs text-catalan-textMuted/70 mb-3">All synced field data</div>
              <div className="text-4xl font-bold text-catalan-primary">{stats.totalSubs}</div>
            </Card>
            <Card className="border-l-4 border-l-catalan-success">
              <div className="text-sm font-medium text-catalan-textMuted mb-1">Active Forms</div>
              <div className="text-xs text-catalan-textMuted/70 mb-3">Published and collecting</div>
              <div className="text-4xl font-bold text-catalan-success">{stats.totalForms}</div>
            </Card>
            <Card className="border-l-4 border-l-catalan-info">
              <div className="text-sm font-medium text-catalan-textMuted mb-1">Team Members</div>
              <div className="text-xs text-catalan-textMuted/70 mb-3">Enumerators & supervisors</div>
              <div className="text-4xl font-bold text-catalan-info">{stats.teamSize}</div>
            </Card>
            <Card className="border-l-4 border-l-catalan-warning">
              <div className="text-sm font-medium text-catalan-textMuted mb-1">Flagged</div>
              <div className="text-xs text-catalan-textMuted/70 mb-3">Requiring manual review</div>
              <div className="text-4xl font-bold text-catalan-warning">{stats.flagged}</div>
            </Card>
          </div>}

          {/* Tabs + Content (hidden while loading) */}
          {!loading && <><div className="flex gap-1 bg-catalan-surface rounded-lg p-1 w-fit">
            {(['overview', 'submissions', 'forms', 'team'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
                  tab === t
                    ? 'bg-catalan-primary text-catalan-bg shadow-sm'
                    : 'text-catalan-textMuted hover:text-catalan-text hover:bg-catalan-hover'
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {/* ── OVERVIEW ── */}
          {tab === 'overview' && (
            <div className="space-y-6">
              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card title="Submissions Over Time">
                  {dailyCounts.length === 0
                    ? <p className="text-sm text-catalan-textMuted text-center py-8">No data yet</p>
                    : <LineChart data={dailyCounts} height={220} />
                  }
                </Card>
                <Card title="Top Enumerators">
                  {enumeratorBarData.length === 0
                    ? <p className="text-sm text-catalan-textMuted text-center py-8">No data yet</p>
                    : <BarChart data={enumeratorBarData} height={220} />
                  }
                </Card>
              </div>

              {/* Recent submissions + forms status */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card title="Recent Submissions">
                  {submissions.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="text-4xl mb-2">📋</div>
                      <p className="text-sm text-catalan-textMuted">No submissions yet</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {submissions.slice(0, 5).map(sub => (
                        <div
                          key={sub.id}
                          onClick={() => openDetail(sub.id)}
                          className="flex justify-between items-start p-3 bg-catalan-hover rounded border border-catalan-border cursor-pointer hover:border-catalan-primary/50 transition-colors"
                        >
                          <div>
                            <p className="text-sm font-medium text-catalan-text">{sub.enumerator_name}</p>
                            <p className="text-xs text-catalan-textMuted mt-0.5">
                              {new Date(sub.server_received_at).toLocaleDateString()}
                            </p>
                          </div>
                          <StatusBadge status={sub.status} />
                        </div>
                      ))}
                      {submissions.length > 5 && (
                        <button
                          onClick={() => setTab('submissions')}
                          className="text-xs text-catalan-primary hover:underline mt-1"
                        >
                          View all {submissions.length} submissions →
                        </button>
                      )}
                    </div>
                  )}
                </Card>

                <Card title="Forms Status">
                  {forms.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="text-4xl mb-2">📝</div>
                      <p className="text-sm text-catalan-textMuted">No forms yet</p>
                      <a href="/builder" className="text-xs text-catalan-primary hover:underline mt-1 inline-block">
                        Create your first form →
                      </a>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {forms.slice(0, 5).map(form => (
                        <div key={form.id} className="flex justify-between items-center p-3 bg-catalan-hover rounded border border-catalan-border">
                          <div>
                            <p className="text-sm font-medium text-catalan-text">{form.title}</p>
                            <p className="text-xs text-catalan-textMuted mt-0.5">v{form.version}</p>
                          </div>
                          <StatusBadge status={form.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* ── SUBMISSIONS ── */}
          {tab === 'submissions' && (
            <div className="space-y-4">
              {/* Filter bar */}
              <Card>
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-[160px]">
                    <label className="text-xs text-catalan-textMuted block mb-1">Search</label>
                    <input
                      value={search}
                      onChange={e => { setSearch(e.target.value); setSubPage(1) }}
                      placeholder="Name or ID…"
                      className="w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text placeholder-catalan-textMuted focus:outline-none focus:border-catalan-primary"
                    />
                  </div>
                  <div className="min-w-[160px]">
                    <label className="text-xs text-catalan-textMuted block mb-1">Form</label>
                    <select
                      value={filterForm}
                      onChange={e => setFilterForm(e.target.value)}
                      className="w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                    >
                      <option value="">All forms</option>
                      {forms.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-catalan-textMuted block mb-1">From</label>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={e => setDateFrom(e.target.value)}
                      className="bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-catalan-textMuted block mb-1">To</label>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={e => setDateTo(e.target.value)}
                      className="bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                    />
                  </div>
                  {(dateFrom || dateTo || search || filterForm) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setSearch(''); setFilterForm(''); setDateFrom(''); setDateTo(''); setSubPage(1) }}
                    >
                      Clear
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleExport}
                    disabled={exportingCsv}
                  >
                    {exportingCsv ? 'Exporting…' : '↓ Export CSV'}
                  </Button>
                </div>
              </Card>

              {/* Submissions table */}
              <Card>
                {detailLoading && (
                  <div className="text-xs text-catalan-textMuted mb-2">Loading detail…</div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-catalan-border">
                        {[
                          { key: 'id',                    label: 'ID' },
                          { key: 'form_id',               label: 'Form' },
                          { key: 'enumerator_name',       label: 'Enumerator', sortable: true },
                          { key: 'status',                label: 'Status',     sortable: true },
                          { key: 'server_received_at',    label: 'Received',   sortable: true },
                          { key: '_view',                 label: '' },
                        ].map(col => (
                          <th
                            key={col.key}
                            onClick={col.sortable ? () => handleSubSort(col.key) : undefined}
                            className={`text-left px-3 py-2 text-xs font-medium text-catalan-textMuted uppercase tracking-wider select-none ${col.sortable ? 'cursor-pointer hover:text-catalan-text transition-colors' : ''}`}
                          >
                            {col.label}
                            {col.sortable && (
                              <span className={`ml-1 ${subSortKey === col.key ? 'text-catalan-primary' : 'opacity-30'}`}>
                                {subSortKey === col.key ? (subSortDir === 'asc' ? '↑' : '↓') : '↕'}
                              </span>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSubs.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center py-10 text-catalan-textMuted text-sm">
                            {submissions.length === 0 ? 'No submissions yet' : 'No submissions match your filters'}
                          </td>
                        </tr>
                      ) : (
                        paginatedSubs.map(sub => (
                          <tr
                            key={sub.id}
                            onClick={() => openDetail(sub.id)}
                            className="border-b border-catalan-border hover:bg-catalan-hover cursor-pointer transition-colors"
                          >
                            <td className="px-3 py-2 font-mono text-xs text-catalan-textMuted">{sub.id.slice(0, 8)}…</td>
                            <td className="px-3 py-2 text-catalan-text">{forms.find(f => f.id === sub.form_id)?.title ?? sub.form_id.slice(0, 8)}</td>
                            <td className="px-3 py-2 text-catalan-text">{sub.enumerator_name}</td>
                            <td className="px-3 py-2"><StatusBadge status={sub.status} /></td>
                            <td className="px-3 py-2 text-catalan-textMuted text-xs">{new Date(sub.server_received_at).toLocaleString()}</td>
                            <td className="px-3 py-2 text-catalan-primary text-xs">View →</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={subPage}
                  pageSize={SUB_PAGE_SIZE}
                  total={filteredSubs.length}
                  onChange={p => setSubPage(p)}
                />
              </Card>
            </div>
          )}

          {/* ── FORMS ── */}
          {tab === 'forms' && (
            <Card>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-medium text-catalan-text">{forms.length} form{forms.length !== 1 ? 's' : ''}</h3>
                <Button variant="primary" size="sm" onClick={() => window.location.href = '/builder'}>
                  + New Form
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-catalan-border">
                      <th className="text-left px-3 py-2 text-xs font-medium text-catalan-textMuted uppercase tracking-wider">Title</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-catalan-textMuted uppercase tracking-wider">Version</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-catalan-textMuted uppercase tracking-wider">Status</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-catalan-textMuted uppercase tracking-wider">Assigned To</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-catalan-textMuted uppercase tracking-wider">Updated</th>
                      <th className="px-3 py-2 text-xs font-medium text-catalan-textMuted uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forms.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-10 text-catalan-textMuted text-sm">
                          No forms yet — <a href="/builder" className="text-catalan-primary hover:underline">create one</a>
                        </td>
                      </tr>
                    ) : (
                      forms.map(form => {
                        const formAssignments = assignments.filter(a => a.form_id === form.id)
                        return (
                          <tr key={form.id} className="border-b border-catalan-border hover:bg-catalan-hover transition-colors">
                            <td className="px-3 py-2 font-medium text-catalan-text">{form.title}</td>
                            <td className="px-3 py-2 text-catalan-textMuted">v{form.version}</td>
                            <td className="px-3 py-2"><StatusBadge status={form.status} /></td>
                            <td className="px-3 py-2 text-catalan-textMuted text-xs">
                              {formAssignments.length === 0
                                ? 'None'
                                : <>
                                    {formAssignments.slice(0, 2).map(a => a.enumerator_name).join(', ')}
                                    {formAssignments.length > 2 && <span className="text-catalan-textMuted"> +{formAssignments.length - 2}</span>}
                                  </>
                              }
                            </td>
                            <td className="px-3 py-2 text-catalan-textMuted text-xs">
                              {form.updated_at ? new Date(form.updated_at).toLocaleDateString() : '—'}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex gap-3">
                                <a href={`/builder?id=${form.id}`} className="text-xs text-catalan-primary hover:underline">Edit</a>
                                {form.version > 1 && (
                                  <a href={`/builder?id=${form.id}&tab=versions`} className="text-xs text-catalan-warning hover:underline">
                                    v{form.version}
                                  </a>
                                )}
                                <button
                                  onClick={() => setAssignForm(form)}
                                  className="text-xs text-catalan-success hover:underline"
                                >
                                  Assign
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* ── TEAM ── */}
          {tab === 'team' && (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex justify-between items-center">
                <span className="text-sm text-catalan-textMuted">{team.length} team member{team.length !== 1 ? 's' : ''}</span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => { setShowCsvImport(v => !v); setShowAddUser(false); setCsvResult(null) }}
                  >
                    {showCsvImport ? 'Cancel Import' : 'Import CSV'}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => { setShowAddUser(v => !v); setShowCsvImport(false) }}
                  >
                    {showAddUser ? 'Cancel' : '+ Add User'}
                  </Button>
                </div>
              </div>

              {/* CSV Import panel */}
              {showCsvImport && (
                <Card>
                  <p className="text-xs text-catalan-textMuted mb-3">
                    CSV format: <code className="bg-catalan-hover px-1 rounded">phone, name, role, password</code>
                    {' '}(password optional — defaults to &quot;fieldpulse123&quot;)
                  </p>
                  <div className="flex gap-3 items-center flex-wrap">
                    <input
                      ref={csvInputRef}
                      type="file"
                      accept=".csv"
                      onChange={e => { setCsvFile(e.target.files?.[0] ?? null); setCsvResult(null) }}
                      className="text-sm text-catalan-text"
                    />
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleCsvImport}
                      disabled={!csvFile || csvUploading}
                    >
                      {csvUploading ? 'Uploading…' : 'Upload & Import'}
                    </Button>
                  </div>
                  {csvResult && (
                    <div className="mt-3 space-y-2">
                      <div className="flex gap-4 text-sm">
                        <span className="text-catalan-success font-medium">Created: {csvResult.created}</span>
                        <span className="text-catalan-textMuted">Skipped: {csvResult.skipped}</span>
                        {csvResult.errors.length > 0 && (
                          <span className="text-catalan-error font-medium">Errors: {csvResult.errors.length}</span>
                        )}
                      </div>
                      {csvResult.errors.length > 0 && (
                        <div className="bg-catalan-error/10 rounded-lg p-3 max-h-28 overflow-y-auto">
                          {csvResult.errors.map((e, i) => (
                            <div key={i} className="text-xs text-catalan-error">{e}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              )}

              {/* Add user form */}
              {showAddUser && (
                <Card>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="text-xs text-catalan-textMuted block mb-1">Phone</label>
                      <input
                        value={newUser.phone}
                        onChange={e => setNewUser(u => ({ ...u, phone: e.target.value }))}
                        placeholder="+91…"
                        className="w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-catalan-textMuted block mb-1">Full Name</label>
                      <input
                        value={newUser.name}
                        onChange={e => setNewUser(u => ({ ...u, name: e.target.value }))}
                        placeholder="Full name"
                        className="w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-catalan-textMuted block mb-1">Role</label>
                      <select
                        value={newUser.role}
                        onChange={e => setNewUser(u => ({ ...u, role: e.target.value }))}
                        className="w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                      >
                        <option value="enumerator">Enumerator</option>
                        <option value="supervisor">Supervisor</option>
                        <option value="org_admin">Org Admin</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-catalan-textMuted block mb-1">Password</label>
                      <input
                        type="password"
                        value={newUser.password}
                        onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))}
                        placeholder="Set password"
                        onKeyDown={e => { if (e.key === 'Enter') handleAddUser() }}
                        className="w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button variant="primary" size="sm" onClick={handleAddUser} disabled={addingUser}>
                      {addingUser ? 'Adding…' : 'Add User'}
                    </Button>
                  </div>
                </Card>
              )}

              {/* Team table */}
              <Card>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-catalan-border">
                        {[
                          { key: 'name',  label: 'Name',        sortable: true },
                          { key: 'phone', label: 'Phone',       sortable: false },
                          { key: 'role',  label: 'Role',        sortable: true },
                          { key: '_subs', label: 'Submissions', sortable: false },
                          { key: '_act',  label: 'Actions',     sortable: false },
                        ].map(col => (
                          <th
                            key={col.key}
                            onClick={col.sortable ? () => handleTeamSort(col.key) : undefined}
                            className={`text-left px-3 py-2 text-xs font-medium text-catalan-textMuted uppercase tracking-wider select-none ${col.sortable ? 'cursor-pointer hover:text-catalan-text transition-colors' : ''}`}
                          >
                            {col.label}
                            {col.sortable && (
                              <span className={`ml-1 ${teamSortKey === col.key ? 'text-catalan-primary' : 'opacity-30'}`}>
                                {teamSortKey === col.key ? (teamSortDir === 'asc' ? '↑' : '↓') : '↕'}
                              </span>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {team.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="text-center py-10 text-catalan-textMuted text-sm">
                            No team members yet — add one above
                          </td>
                        </tr>
                      ) : (
                        paginatedTeam.map(member => {
                          const subCount = submissions.filter(s => s.enumerator_id === member.id).length
                          return (
                            <tr key={member.id} className="border-b border-catalan-border hover:bg-catalan-hover transition-colors">
                              <td className="px-3 py-2">
                                <div className="font-medium text-catalan-text">{member.name}</div>
                                <div className="text-xs font-mono text-catalan-textMuted">{member.id.slice(0, 8)}…</div>
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-catalan-text">{member.phone}</td>
                              <td className="px-3 py-2"><RoleBadge role={member.role} /></td>
                              <td className="px-3 py-2 text-catalan-text">{subCount}</td>
                              <td className="px-3 py-2">
                                <button
                                  onClick={() => handleDeactivate(member)}
                                  className="text-xs px-2 py-1 rounded border border-catalan-error/30 text-catalan-error hover:bg-catalan-error/10 transition-colors"
                                >
                                  Deactivate
                                </button>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={teamPage}
                  pageSize={TEAM_PAGE_SIZE}
                  total={team.length}
                  onChange={p => setTeamPage(p)}
                />
              </Card>
            </div>
          )}
          </>}
        </div>
      </div>
    </div>
  )
}
