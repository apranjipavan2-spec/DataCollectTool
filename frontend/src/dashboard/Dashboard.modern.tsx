import React, { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react'
import InfoButton from '@/help/InfoButton'
import NewFormWizard from '@/builder/NewFormWizard'
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
  serial_no: number | null
  server_received_at: string
}

interface SubDetail extends Submission {
  form_version: string
  serial_no: number | null
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
  sub, forms, onClose, onFlag, isEnumerator = false,
}: {
  sub: SubDetail
  forms: Form[]
  onClose: () => void
  onFlag: (id: string, status: string, note: string) => Promise<void>
  isEnumerator?: boolean
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
            <p className="text-xs text-catalan-textMuted mt-0.5">{formTitle} · v{sub.form_version}{sub.serial_no ? ` · #${sub.serial_no}` : ''}</p>
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

        {/* Supervisor Review — hidden for enumerators */}
        {!isEnumerator && <div className={`px-5 py-3 border-b border-catalan-border ${isReviewed && sub.status === 'approved' ? 'bg-catalan-success/5' : isReviewed ? 'bg-catalan-error/5' : isFlagged ? 'bg-catalan-warning/5' : ''}`}>
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
        </div>}

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
  const [assigningAll, setAssigningAll] = useState(false)
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

  const handleAssignAll = async () => {
    if (unassigned.length === 0) return
    setAssigningAll(true)
    for (const u of unassigned) {
      try { await onAssign(u.id) } catch {}
    }
    setAssigningAll(false)
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
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-catalan-textMuted uppercase tracking-wider">
              Available ({unassigned.length})
            </h4>
            {unassigned.length > 1 && (
              <button
                onClick={handleAssignAll}
                disabled={assigningAll || !!busy}
                className="text-xs px-2.5 py-1 rounded border border-catalan-success/30 text-catalan-success hover:bg-catalan-success/10 disabled:opacity-50 transition-colors"
              >
                {assigningAll ? 'Assigning…' : 'Assign All'}
              </button>
            )}
          </div>
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
  const [tab, setTab] = useState<'overview' | 'submissions' | 'forms' | 'team' | 'integrations'>('overview')
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

  // Usage tracking
  interface UsageData {
    plan_tier: string
    limits: Record<string, number>
    usage: Record<string, number>
  }
  const [usageData, setUsageData] = useState<UsageData | null>(null)

  // Sheets export
  const [exportingSheets, setExportingSheets] = useState(false)
  const [sheetsConfigured, setSheetsConfigured] = useState<boolean | null>(null)

  // Digest
  const [sendingDigest, setSendingDigest] = useState(false)

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  // Excel export
  const [exportingXlsx, setExportingXlsx] = useState(false)

  // Org settings
  const [allowEnumeratorEdit, setAllowEnumeratorEdit] = useState(true)
  const [savingEnumEdit, setSavingEnumEdit] = useState(false)
  const [myTenantId, setMyTenantId] = useState('')

  // Duplicates view
  const [showDuplicates, setShowDuplicates] = useState(false)
  interface DuplicateGroup {
    enumerator_name: string; form_title: string; day: string; count: number; submission_ids: string[]
  }
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([])
  const [loadingDuplicates, setLoadingDuplicates] = useState(false)

  // Form templates
  const [formsSubTab, setFormsSubTab] = useState<'my-forms' | 'templates'>('my-forms')
  interface Template { slug: string; title: string; description: string; category: string; icon: string; field_count: number }
  const [templates, setTemplates] = useState<Template[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [cloningSlug, setCloningSlug] = useState<string | null>(null)

  // Schedules
  interface ScheduleItem {
    id: string; form_id: string; form_title: string
    enumerator_id: string; enumerator_name: string
    start_date: string; end_date: string; location: string
    target_count: number; notes: string; status: string
  }
  const [schedules, setSchedules] = useState<ScheduleItem[]>([])
  const [loadingSchedules, setLoadingSchedules] = useState(false)
  const [showScheduleForm, setShowScheduleForm] = useState(false)
  const [newSchedule, setNewSchedule] = useState({
    form_id: '', enumerator_id: '', start_date: '', end_date: '',
    location: '', target_count: 0, notes: '',
    program_questionnaire_id: '', location_id: '',
  })
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [scheduleQuestionnaires, setScheduleQuestionnaires] = useState<{ id: string; name: string; program_name: string }[]>([])
  const [scheduleLocations, setScheduleLocations] = useState<{ id: string; district: string; block: string; village: string }[]>([])

  // Integrations — Webhooks
  interface WebhookItem {
    id: string; name: string; url: string; events: string[]
    is_active: boolean; created_at: string; secret: string | null
  }
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([])
  const [loadingWebhooks, setLoadingWebhooks] = useState(false)
  const [showWebhookForm, setShowWebhookForm] = useState(false)
  const [newWebhook, setNewWebhook] = useState({ name: '', url: '', secret: '', events: [] as string[] })
  const [savingWebhook, setSavingWebhook] = useState(false)
  const [testingWebhook, setTestingWebhook] = useState('')
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; status_code: number | null } | null>(null)

  const WEBHOOK_EVENTS = [
    'submission.created', 'submission.synced', 'submission.flagged',
    'submission.approved', 'submission.rejected',
  ]

  // Integrations — API Keys
  interface ApiKeyItem { id: string; name: string; created_at: string; last_used_at: string | null; is_active: boolean }
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([])
  const [loadingApiKeys, setLoadingApiKeys] = useState(false)
  const [showApiKeyForm, setShowApiKeyForm] = useState(false)
  const [showNewFormWizard, setShowNewFormWizard] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [creatingKey, setCreatingKey] = useState(false)
  const [newKeyPlaintext, setNewKeyPlaintext] = useState('')

  // Plan limit banner
  const [planLimitMsg, setPlanLimitMsg] = useState('')

  const user = getStoredUser() || { name: '', role: '' }
  const isEnumerator = user.role === 'enumerator'
  const sidebarItems = getNavItems(user.role)

  // Listen for 402 plan-limit events fired by api.ts interceptor
  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail?.message ?? 'Plan limit reached. Upgrade to continue.'
      setPlanLimitMsg(msg)
      toast.warning(msg)
    }
    window.addEventListener('fieldpulse:plan-limit', handler)
    return () => window.removeEventListener('fieldpulse:plan-limit', handler)
  }, [toast])

  useEffect(() => {
    const calls: Promise<unknown>[] = [
      api.get('/forms/').then(r => setForms(r.data.forms ?? r.data ?? [])),
      api.get('/submissions/?page_size=200').then(r => setSubmissions(r.data.items ?? r.data.submissions ?? [])),
      api.get('/tenants/branding').then(r => { if (r.data.id) setMyTenantId(r.data.id); if (typeof r.data.allow_enumerator_edit === 'boolean') setAllowEnumeratorEdit(r.data.allow_enumerator_edit) }).catch(() => {}),
    ]
    if (!isEnumerator) {
      calls.push(
        api.get('/users/?page_size=200').then(r => setTeam(r.data.items ?? r.data.users ?? [])),
        api.get('/assignments/').then(r => setAssignments(r.data ?? [])),
        api.get('/tenants/me/usage').then(r => setUsageData(r.data)).catch(() => {}),
        api.get('/export/sheets/status').then(r => setSheetsConfigured(r.data.configured)).catch(() => setSheetsConfigured(false)),
      )
    }
    Promise.allSettled(calls).then(results => {
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

  const handleExportXlsx = async () => {
    if (!filterForm) { toast.warning('Select a form to export'); return }
    setExportingXlsx(true)
    try {
      const params: Record<string, string> = {}
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      const res = await api.get(`/export/${filterForm}/xlsx`, { responseType: 'blob', params })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a'); a.href = url
      a.download = `export_${new Date().toISOString().slice(0,10)}.xlsx`
      a.click(); URL.revokeObjectURL(url)
      toast.success('Excel file downloaded')
    } catch {
      toast.error('Excel export failed')
    } finally {
      setExportingXlsx(false)
    }
  }

  const handleLoadDuplicates = async () => {
    setLoadingDuplicates(true)
    try {
      const params: Record<string, string> = {}
      if (filterForm) params.form_id = filterForm
      const { data } = await api.get('/submissions/potential-duplicates', { params })
      setDuplicates(data)
    } catch {
      toast.error('Failed to load duplicates')
    } finally {
      setLoadingDuplicates(false)
    }
  }

  const handleLoadTemplates = async () => {
    if (templates.length > 0) return // already loaded
    setLoadingTemplates(true)
    try {
      const { data } = await api.get('/templates/')
      setTemplates(data)
    } catch {
      toast.error('Failed to load templates')
    } finally {
      setLoadingTemplates(false)
    }
  }

  const handleCloneTemplate = async (slug: string, title: string) => {
    setCloningSlug(slug)
    try {
      const { data } = await api.post(`/templates/${slug}/clone`)
      toast.success(`"${title}" added to your forms`)
      setForms(prev => [...prev, { id: data.id, title: data.title, version: data.version, status: data.status, updated_at: new Date().toISOString() }])
      setFormsSubTab('my-forms')
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Clone failed')
    } finally {
      setCloningSlug(null)
    }
  }

  const handleExportSheets = async () => {
    if (!filterForm) { toast.warning('Select a form to export to Sheets'); return }
    setExportingSheets(true)
    try {
      const params: Record<string, string> = {}
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      const { data } = await api.post(`/export/${filterForm}/sheets`, null, { params })
      toast.success(`Exported ${data.rows} rows to Google Sheets`)
      window.open(data.url, '_blank', 'noopener')
    } catch (err: any) {
      const detail = err.response?.data?.detail ?? 'Sheets export failed'
      toast.error(detail)
    } finally {
      setExportingSheets(false)
    }
  }

  const handleSendDigest = async () => {
    setSendingDigest(true)
    try {
      const { data } = await api.post('/reports/digest')
      toast.success(`Digest sent to ${data.sent} recipient${data.sent !== 1 ? 's' : ''}${data.skipped > 0 ? ` (${data.skipped} skipped — no email set)` : ''}`)
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Failed to send digest')
    } finally {
      setSendingDigest(false)
    }
  }

  const handleBulkAction = async (status: string) => {
    if (selectedIds.size === 0) return
    const label = status.charAt(0).toUpperCase() + status.slice(1)
    if (!confirm(`${label} ${selectedIds.size} submission${selectedIds.size > 1 ? 's' : ''}?`)) return
    setBulkBusy(true)
    try {
      const { data } = await api.post('/submissions/bulk', {
        ids: Array.from(selectedIds),
        status,
      })
      toast.success(`${label}d ${data.updated} submission${data.updated !== 1 ? 's' : ''}`)
      // Refresh updated rows in local state
      setSubmissions(prev => prev.map(s =>
        selectedIds.has(s.id) ? { ...s, status } : s
      ))
      setSelectedIds(new Set())
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? `Bulk ${label.toLowerCase()} failed`)
    } finally {
      setBulkBusy(false)
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

  const loadSchedules = async () => {
    setLoadingSchedules(true)
    try {
      const [schRes, locRes] = await Promise.all([
        api.get('/schedules/'),
        api.get('/programs/locations').catch(() => ({ data: [] })),
      ])
      setSchedules(schRes.data ?? [])
      setScheduleLocations(locRes.data ?? [])
      // Load questionnaires from all active programs
      const progs = await api.get('/programs/?status=active').catch(() => ({ data: [] }))
      const qList: { id: string; name: string; program_name: string }[] = []
      for (const p of (progs.data ?? []).slice(0, 20)) {
        try {
          const { data } = await api.get(`/programs/${p.id}`)
          for (const q of (data.questionnaires ?? [])) {
            qList.push({ id: q.id, name: q.name, program_name: p.name })
          }
        } catch { }
      }
      setScheduleQuestionnaires(qList)
    } catch { toast.error('Failed to load schedules') }
    finally { setLoadingSchedules(false) }
  }

  const handleCreateSchedule = async () => {
    if (!newSchedule.form_id || !newSchedule.enumerator_id || !newSchedule.start_date || !newSchedule.end_date) {
      toast.warning('Form, enumerator, start date, and end date are required')
      return
    }
    setSavingSchedule(true)
    try {
      const { data } = await api.post('/schedules/', newSchedule)
      toast.success('Schedule created')
      setShowScheduleForm(false)
      setNewSchedule({ form_id: '', enumerator_id: '', start_date: '', end_date: '', location: '', target_count: 0, notes: '', program_questionnaire_id: '', location_id: '' })
      loadSchedules()
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Failed to create schedule')
    } finally { setSavingSchedule(false) }
  }

  const handleDeleteSchedule = async (id: string) => {
    if (!confirm('Cancel this schedule?')) return
    try {
      await api.delete(`/schedules/${id}`)
      setSchedules(s => s.filter(x => x.id !== id))
      toast.success('Schedule cancelled')
    } catch { toast.error('Failed to cancel schedule') }
  }

  const loadWebhooks = async () => {
    setLoadingWebhooks(true)
    try { const { data } = await api.get('/webhooks/'); setWebhooks(data.items ?? []) }
    catch { toast.error('Failed to load webhooks') }
    finally { setLoadingWebhooks(false) }
  }

  const loadApiKeys = async () => {
    setLoadingApiKeys(true)
    try { const { data } = await api.get('/api-keys/'); setApiKeys(data ?? []) }
    catch { toast.error('Failed to load API keys') }
    finally { setLoadingApiKeys(false) }
  }

  const handleCreateWebhook = async () => {
    if (!newWebhook.name || !newWebhook.url) { toast.warning('Name and URL are required'); return }
    setSavingWebhook(true)
    try {
      const { data } = await api.post('/webhooks/', {
        name: newWebhook.name, url: newWebhook.url,
        secret: newWebhook.secret || undefined,
        events: newWebhook.events, is_active: true,
      })
      setWebhooks(w => [data, ...w])
      setNewWebhook({ name: '', url: '', secret: '', events: [] })
      setShowWebhookForm(false)
      toast.success('Webhook created')
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Failed to create webhook')
    } finally { setSavingWebhook(false) }
  }

  const handleDeleteWebhook = async (id: string) => {
    if (!confirm('Delete this webhook?')) return
    try {
      await api.delete(`/webhooks/${id}`)
      setWebhooks(w => w.filter(x => x.id !== id))
      toast.success('Webhook deleted')
    } catch { toast.error('Failed to delete webhook') }
  }

  const handleTestWebhook = async (id: string) => {
    setTestingWebhook(id)
    setTestResult(null)
    try {
      const { data } = await api.post(`/webhooks/${id}/test`)
      setTestResult({ id, success: data.success, status_code: data.status_code })
      toast[data.success ? 'success' : 'error'](`Test ${data.success ? 'succeeded' : 'failed'}: HTTP ${data.status_code ?? 'error'}`)
    } catch { toast.error('Test request failed') }
    finally { setTestingWebhook('') }
  }

  const handleCreateApiKey = async () => {
    if (!newKeyName.trim()) { toast.warning('Key name is required'); return }
    setCreatingKey(true)
    try {
      const { data } = await api.post('/api-keys/', { name: newKeyName.trim() })
      setApiKeys(k => [{ ...data }, ...k])
      setNewKeyPlaintext(data.key)
      setNewKeyName('')
      setShowApiKeyForm(false)
      toast.success('API key created — copy it now, it won\'t be shown again')
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Failed to create API key')
    } finally { setCreatingKey(false) }
  }

  const handleRevokeApiKey = async (id: string, name: string) => {
    if (!confirm(`Revoke API key "${name}"? It will stop working immediately.`)) return
    try {
      await api.delete(`/api-keys/${id}`)
      setApiKeys(k => k.filter(x => x.id !== id))
      toast.success('API key revoked')
    } catch { toast.error('Failed to revoke key') }
  }

  return (
    <div className="flex h-screen bg-catalan-bg">
      {/* New form wizard */}
      {showNewFormWizard && <NewFormWizard onClose={() => setShowNewFormWizard(false)} />}

      {/* Submission detail modal */}
      {detailSub && (
        <SubmissionDetailModal
          sub={detailSub}
          forms={forms}
          isEnumerator={user.role === 'enumerator'}
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

      {/* Sidebar — desktop only */}
      <Sidebar items={sidebarItems} role={user.role} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-auto">
        <TopNav title="Dashboard" />

        <div className="flex-1 p-3 sm:p-6 space-y-4 sm:space-y-6 pb-20 md:pb-6">
          {error && (
            <Alert type="warning" message={error} onClose={() => setError('')} />
          )}
          {planLimitMsg && (
            <div className="flex items-start gap-3 px-4 py-3 bg-catalan-error/10 border border-catalan-error/30 rounded-lg text-sm">
              <span className="text-catalan-error font-medium">Plan limit reached</span>
              <span className="text-catalan-textMuted flex-1">{planLimitMsg}</span>
              <button onClick={() => setPlanLimitMsg('')} className="text-catalan-textMuted hover:text-catalan-text text-lg leading-none">×</button>
            </div>
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
          {!loading && <><div className="hidden sm:flex gap-1 bg-catalan-surface rounded-lg p-1 w-fit flex-wrap">
            {(isEnumerator
              ? (['overview', 'submissions', 'forms'] as const)
              : (['overview', 'submissions', 'forms', 'team', 'integrations'] as const)
            ).map(t => (
              <button
                key={t}
                onClick={() => {
                  setTab(t)
                  if (t === 'integrations') { loadWebhooks(); loadApiKeys() }
                  if (t === 'team') loadSchedules()
                }}
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
                      <button onClick={() => setShowNewFormWizard(true)} className="text-xs text-catalan-primary hover:underline mt-1 inline-block">
                        Create your first form →
                      </button>
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

              {/* Usage + Quick Actions */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Plan Usage */}
                {usageData && (
                  <Card title={`Plan Usage — ${usageData.plan_tier.charAt(0).toUpperCase() + usageData.plan_tier.slice(1)}`}>
                    <div className="space-y-4">
                      {[
                        {
                          label: 'Submissions this month',
                          used: usageData.usage.submissions_this_month,
                          limit: usageData.limits.submissions_per_month,
                        },
                        {
                          label: 'Active users',
                          used: usageData.usage.users,
                          limit: usageData.limits.users,
                        },
                        {
                          label: 'Forms',
                          used: usageData.usage.forms,
                          limit: usageData.limits.forms,
                        },
                      ].map(({ label, used, limit }) => {
                        const pct = limit < 0 ? 0 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100))
                        const isUnlimited = limit < 0
                        const isOver80 = pct >= 80
                        const barColor = pct >= 100 ? 'bg-catalan-error' : pct >= 80 ? 'bg-catalan-warning' : 'bg-catalan-primary'
                        return (
                          <div key={label}>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-sm text-catalan-textMuted">{label}</span>
                              <span className={`text-sm font-medium ${isOver80 && !isUnlimited ? 'text-catalan-warning' : 'text-catalan-text'}`}>
                                {used.toLocaleString()}{isUnlimited ? '' : ` / ${limit.toLocaleString()}`}
                                {isUnlimited && <span className="text-xs text-catalan-textMuted ml-1">unlimited</span>}
                              </span>
                            </div>
                            {!isUnlimited && (
                              <div className="h-1.5 bg-catalan-hover rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </Card>
                )}

                {/* Quick Actions — hidden for enumerators */}
                {!isEnumerator && <Card title="Quick Actions">
                  <div className="space-y-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleSendDigest}
                      disabled={sendingDigest}
                      className="w-full justify-start"
                    >
                      {sendingDigest ? 'Sending…' : '📧 Send Daily Digest Now'}
                    </Button>
                    <p className="text-xs text-catalan-textMuted pl-1">
                      Emails yesterday's summary to all supervisors &amp; admins with email set.
                    </p>
                  </div>
                </Card>}
              </div>
            </div>
          )}

          {/* ── SUBMISSIONS ── */}
          {tab === 'submissions' && (
            <div className="space-y-4">
              {/* Filter bar */}
              <Card data-help-id="filter-bar">
                {/* Row 1: Search + Form — always visible */}
                <div className="flex gap-3 items-end mb-3">
                  <InfoButton topicId="filter-submissions" className="mb-0.5" />
                  <div className="flex-1 min-w-0">
                    <label className="text-xs text-catalan-textMuted block mb-1">Search</label>
                    <input
                      value={search}
                      onChange={e => { setSearch(e.target.value); setSubPage(1) }}
                      placeholder="Name or ID…"
                      className="w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text placeholder-catalan-textMuted focus:outline-none focus:border-catalan-primary"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
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
                </div>
                {/* Row 2: Dates + actions — wrap naturally */}
                <div className="flex flex-wrap gap-2 items-center">
                  <div className="flex gap-2 items-end">
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
                  </div>
                  {!isEnumerator && <div className="flex gap-2 flex-wrap ml-auto items-center" data-help-id="export-btn">
                    <InfoButton topicId="export-data" />
                    <Button variant="secondary" size="sm" onClick={handleExport} disabled={exportingCsv}>
                      {exportingCsv ? 'Exporting…' : '↓ CSV'}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={handleExportXlsx} disabled={exportingXlsx} title="Download as Excel (.xlsx)">
                      {exportingXlsx ? 'Creating…' : '↓ Excel'}
                    </Button>
                    {sheetsConfigured === false ? (
                      <button
                        title="Google Drive not connected — run scripts/gdrive_auth.py on the server"
                        className="text-xs px-3 py-1.5 rounded border border-catalan-border text-catalan-textMuted opacity-60 cursor-not-allowed"
                        disabled
                      >
                        ↗ Sheets
                      </button>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={handleExportSheets} disabled={exportingSheets || sheetsConfigured === null} title="Export to Google Sheets">
                        {exportingSheets ? 'Creating…' : '↗ Sheets'}
                      </Button>
                    )}
                    <Button
                      variant={showDuplicates ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => { const next = !showDuplicates; setShowDuplicates(next); if (next) handleLoadDuplicates() }}
                      title="Show potential duplicate submissions"
                    >
                      ⚠ Dupes
                    </Button>
                  </div>}
                </div>
              </Card>

              {/* Duplicates panel */}
              {showDuplicates && (
                <Card title="Potential Duplicate Submissions">
                  {loadingDuplicates ? (
                    <div className="text-sm text-catalan-textMuted py-4 text-center">Loading…</div>
                  ) : duplicates.length === 0 ? (
                    <div className="text-sm text-catalan-success py-4 text-center">No potential duplicates found</div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-catalan-textMuted mb-3">
                        Groups where the same enumerator submitted the same form more than once on the same day.
                      </p>
                      {duplicates.map((group, i) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-catalan-hover rounded border border-catalan-warning/30">
                          <div>
                            <span className="text-sm font-medium text-catalan-text">{group.enumerator_name}</span>
                            <span className="text-xs text-catalan-textMuted mx-2">·</span>
                            <span className="text-sm text-catalan-textMuted">{group.form_title}</span>
                            <span className="text-xs text-catalan-textMuted mx-2">·</span>
                            <span className="text-xs text-catalan-textMuted">{group.day}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-bold text-catalan-warning bg-catalan-warning/10 px-2 py-0.5 rounded">
                              {group.count}×
                            </span>
                            <button
                              className="text-xs text-catalan-primary hover:underline"
                              onClick={() => {
                                setShowDuplicates(false)
                                setSelectedIds(new Set(group.submission_ids))
                                setTab('submissions')
                              }}
                            >
                              View all →
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              )}

              {/* Bulk action bar */}
              {selectedIds.size > 0 && !isEnumerator && (
                <div className="flex items-center gap-3 px-4 py-2.5 bg-catalan-primary/10 border border-catalan-primary/30 rounded-lg">
                  <span className="text-sm font-medium text-catalan-primary">
                    {selectedIds.size} selected
                  </span>
                  <div className="flex gap-2 ml-auto">
                    <Button size="sm" variant="secondary" onClick={() => handleBulkAction('approved')} disabled={bulkBusy}>
                      Approve all
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => handleBulkAction('rejected')} disabled={bulkBusy}>
                      Reject all
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => handleBulkAction('flagged')} disabled={bulkBusy}>
                      Flag all
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} disabled={bulkBusy}>
                      Clear
                    </Button>
                  </div>
                </div>
              )}

              {/* Submissions — desktop table + mobile cards */}
              <Card>
                {detailLoading && (
                  <div className="text-xs text-catalan-textMuted mb-2">Loading detail…</div>
                )}

                {/* ── Desktop table ── */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead>
                      <tr className="border-b border-catalan-border">
                        {!isEnumerator && <th className="px-3 py-2 w-10">
                          <label className="flex items-center justify-center w-10 h-10 cursor-pointer -my-2">
                            <input
                              type="checkbox"
                              checked={paginatedSubs.length > 0 && paginatedSubs.every(s => selectedIds.has(s.id))}
                              onChange={e => {
                                setSelectedIds(prev => {
                                  const next = new Set(prev)
                                  if (e.target.checked) paginatedSubs.forEach(s => next.add(s.id))
                                  else paginatedSubs.forEach(s => next.delete(s.id))
                                  return next
                                })
                              }}
                              className="accent-catalan-primary cursor-pointer w-4 h-4"
                            />
                          </label>
                        </th>}
                        {[
                          { key: 'serial_no',             label: '#',          sortable: true },
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
                          <td colSpan={isEnumerator ? 7 : 8} className="text-center py-10 text-catalan-textMuted text-sm">
                            {submissions.length === 0 ? 'No submissions yet' : 'No submissions match your filters'}
                          </td>
                        </tr>
                      ) : (
                        paginatedSubs.map(sub => (
                          <tr
                            key={sub.id}
                            className={`border-b border-catalan-border hover:bg-catalan-hover transition-colors ${selectedIds.has(sub.id) ? 'bg-catalan-primary/5' : ''}`}
                          >
                            {!isEnumerator && <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                              <label className="flex items-center justify-center w-10 h-10 cursor-pointer -my-2 -mx-1">
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(sub.id)}
                                  onChange={e => {
                                    setSelectedIds(prev => {
                                      const next = new Set(prev)
                                      if (e.target.checked) next.add(sub.id)
                                      else next.delete(sub.id)
                                      return next
                                    })
                                  }}
                                  className="accent-catalan-primary cursor-pointer w-4 h-4"
                                />
                              </label>
                            </td>}
                            <td className="px-3 py-2 font-mono text-xs text-catalan-textMuted cursor-pointer" onClick={() => openDetail(sub.id)}>{sub.serial_no ?? '—'}</td>
                            <td className="px-3 py-2 font-mono text-xs text-catalan-textMuted cursor-pointer" onClick={() => openDetail(sub.id)}>{sub.id.slice(0, 8)}…</td>
                            <td className="px-3 py-2 text-catalan-text cursor-pointer" onClick={() => openDetail(sub.id)}>{forms.find(f => f.id === sub.form_id)?.title ?? sub.form_id.slice(0, 8)}</td>
                            <td className="px-3 py-2 text-catalan-text cursor-pointer" onClick={() => openDetail(sub.id)}>{sub.enumerator_name}</td>
                            <td className="px-3 py-2 cursor-pointer" onClick={() => openDetail(sub.id)}><StatusBadge status={sub.status} /></td>
                            <td className="px-3 py-2 text-catalan-textMuted text-xs cursor-pointer" onClick={() => openDetail(sub.id)}>{new Date(sub.server_received_at).toLocaleString()}</td>
                            <td className="px-3 py-2 text-catalan-primary text-xs cursor-pointer" onClick={() => openDetail(sub.id)}>View →</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* ── Mobile card list ── */}
                <div className="sm:hidden">
                  {filteredSubs.length === 0 ? (
                    <p className="text-center py-10 text-catalan-textMuted text-sm">
                      {submissions.length === 0 ? 'No submissions yet' : 'No submissions match your filters'}
                    </p>
                  ) : (
                    <div className="divide-y divide-catalan-border">
                      {paginatedSubs.map(sub => (
                        <div
                          key={sub.id}
                          className={`flex items-center gap-3 py-3 px-1 ${selectedIds.has(sub.id) ? 'bg-catalan-primary/5' : ''}`}
                        >
                          {/* Large touch checkbox — hidden for enumerators */}
                          {!isEnumerator && <label className="flex-shrink-0 w-11 h-11 flex items-center justify-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(sub.id)}
                              onChange={e => {
                                setSelectedIds(prev => {
                                  const next = new Set(prev)
                                  if (e.target.checked) next.add(sub.id)
                                  else next.delete(sub.id)
                                  return next
                                })
                              }}
                              className="accent-catalan-primary w-5 h-5"
                            />
                          </label>}
                          <button className="flex-1 min-w-0 text-left" onClick={() => openDetail(sub.id)}>
                            <div className="flex items-center justify-between gap-2 mb-0.5">
                              <span className="font-medium text-catalan-text text-sm truncate">
                                {forms.find(f => f.id === sub.form_id)?.title ?? 'Unknown form'}
                              </span>
                              <StatusBadge status={sub.status} />
                            </div>
                            <div className="text-xs text-catalan-textMuted">
                              {sub.enumerator_name} · {new Date(sub.server_received_at).toLocaleDateString()}
                            </div>
                          </button>
                          <button onClick={() => openDetail(sub.id)} className="flex-shrink-0 text-catalan-primary text-lg px-2">→</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <Pagination
                  page={subPage}
                  pageSize={SUB_PAGE_SIZE}
                  total={filteredSubs.length}
                  onChange={p => { setSubPage(p); setSelectedIds(new Set()) }}
                />
              </Card>
            </div>
          )}

          {/* ── FORMS ── */}
          {tab === 'forms' && (
            <div className="space-y-4">
            {/* Sub-tab bar */}
            <div className="flex gap-2 items-center">
              <div className="flex gap-1 bg-catalan-surface rounded-lg p-1">
                {(isEnumerator ? ['my-forms'] : ['my-forms', 'templates'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => { setFormsSubTab(t); if (t === 'templates') handleLoadTemplates() }}
                    className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
                      formsSubTab === t
                        ? 'bg-catalan-primary text-catalan-bg shadow-sm'
                        : 'text-catalan-textMuted hover:text-catalan-text hover:bg-catalan-hover'
                    }`}
                  >
                    {t === 'my-forms' ? `My Forms (${forms.length})` : '📚 Template Library'}
                  </button>
                ))}
              </div>
              {formsSubTab === 'my-forms' && !isEnumerator && (
                <Button variant="primary" size="sm" onClick={() => setShowNewFormWizard(true)}>
                  + New Form
                </Button>
              )}
            </div>

            {/* Templates sub-tab */}
            {formsSubTab === 'templates' && (
              <div>
                <p className="text-sm text-catalan-textMuted mb-4">
                  Ready-made form templates. Click "Use Template" to add an editable copy to your forms.
                </p>
                {loadingTemplates ? (
                  <div className="text-center py-12 text-catalan-textMuted">Loading templates…</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {templates.map(tpl => (
                      <Card key={tpl.slug}>
                        <div className="flex items-start gap-3">
                          <span className="text-3xl">{tpl.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-semibold text-catalan-text text-sm">{tpl.title}</h3>
                              <span className="text-xs px-1.5 py-0.5 rounded bg-catalan-primary/10 text-catalan-primary">{tpl.category}</span>
                            </div>
                            <p className="text-xs text-catalan-textMuted mb-3 leading-relaxed">{tpl.description}</p>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-catalan-textMuted">{tpl.field_count} fields</span>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleCloneTemplate(tpl.slug, tpl.title)}
                                disabled={cloningSlug === tpl.slug}
                              >
                                {cloningSlug === tpl.slug ? 'Adding…' : '+ Use Template'}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* My Forms sub-tab */}
            {formsSubTab === 'my-forms' && (
            <Card>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-medium text-catalan-text">{forms.length} form{forms.length !== 1 ? 's' : ''}</h3>
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
                          No forms yet — <button onClick={() => setShowNewFormWizard(true)} className="text-catalan-primary hover:underline">create one</button>
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
                              {isEnumerator ? (
                                <span className="text-xs text-catalan-textMuted">Read-only</span>
                              ) : (
                              <div className="flex gap-3">
                                <a href={`/builder?id=${form.id}`} className="text-xs text-catalan-primary hover:underline">Edit</a>
                                {form.version > 1 && (
                                  <a href={`/builder?id=${form.id}&tab=versions`} className="text-xs text-catalan-warning hover:underline">
                                    v{form.version}
                                  </a>
                                )}
                                <span className="inline-flex items-center gap-1" data-help-id="assign-form-btn">
                                  <InfoButton topicId="assign-forms" />
                                  <button
                                    onClick={() => setAssignForm(form)}
                                    className="text-xs text-catalan-success hover:underline"
                                  >
                                    Assign
                                  </button>
                                </span>
                              </div>
                              )}
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
            </div>
          )}

          {/* ── INTEGRATIONS ── */}
          {tab === 'integrations' && (
            <div className="space-y-6">

              {/* ── API Keys ── */}
              <Card title="API Keys">
                <p className="text-sm text-catalan-textMuted mb-4">
                  Use API keys for server-to-server access. Keys are shown only once — store them securely.
                </p>

                {/* New key reveal */}
                {newKeyPlaintext && (
                  <div className="mb-4 p-4 bg-catalan-success/10 border border-catalan-success/30 rounded-lg">
                    <div className="text-xs font-medium text-catalan-success mb-2">New API key — copy it now:</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-catalan-bg px-3 py-2 rounded text-sm font-mono text-catalan-text break-all">{newKeyPlaintext}</code>
                      <button
                        onClick={() => { navigator.clipboard.writeText(newKeyPlaintext); toast.success('Copied!') }}
                        className="text-xs px-3 py-2 rounded border border-catalan-success/40 text-catalan-success hover:bg-catalan-success/10 flex-shrink-0"
                      >
                        Copy
                      </button>
                    </div>
                    <button onClick={() => setNewKeyPlaintext('')} className="text-xs text-catalan-textMuted mt-2 hover:text-catalan-text">
                      ✓ I've saved it — dismiss
                    </button>
                  </div>
                )}

                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm text-catalan-textMuted">{apiKeys.length} key{apiKeys.length !== 1 ? 's' : ''}</span>
                  <Button variant="primary" size="sm" onClick={() => setShowApiKeyForm(v => !v)}>
                    {showApiKeyForm ? 'Cancel' : '+ New Key'}
                  </Button>
                </div>

                {showApiKeyForm && (
                  <div className="flex gap-2 mb-4">
                    <input
                      value={newKeyName}
                      onChange={e => setNewKeyName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleCreateApiKey() }}
                      placeholder="Key name (e.g. Production Server)"
                      className="flex-1 bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text placeholder-catalan-textMuted focus:outline-none focus:border-catalan-primary"
                      autoFocus
                    />
                    <Button variant="primary" size="sm" onClick={handleCreateApiKey} disabled={creatingKey}>
                      {creatingKey ? 'Creating…' : 'Create'}
                    </Button>
                  </div>
                )}

                {loadingApiKeys ? (
                  <div className="text-sm text-catalan-textMuted py-4 text-center">Loading…</div>
                ) : apiKeys.length === 0 ? (
                  <p className="text-sm text-catalan-textMuted text-center py-6">No API keys yet</p>
                ) : (
                  <div className="space-y-2">
                    {apiKeys.map(k => (
                      <div key={k.id} className="flex items-center justify-between p-3 bg-catalan-hover rounded-lg border border-catalan-border">
                        <div className="min-w-0">
                          <div className="font-medium text-catalan-text text-sm">{k.name}</div>
                          <div className="text-xs text-catalan-textMuted mt-0.5">
                            Created {new Date(k.created_at).toLocaleDateString()}
                            {k.last_used_at && <> · Last used {new Date(k.last_used_at).toLocaleDateString()}</>}
                          </div>
                        </div>
                        <button
                          onClick={() => handleRevokeApiKey(k.id, k.name)}
                          className="text-xs px-2.5 py-1.5 rounded border border-catalan-error/30 text-catalan-error hover:bg-catalan-error/10 transition-colors flex-shrink-0 ml-3"
                        >
                          Revoke
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* ── Org Settings ── */}
              {user?.role && ['org_admin', 'master_admin'].includes(user.role) && (
                <Card title="Organisation Settings">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-catalan-text">Allow enumerators to edit their submissions</div>
                      <div className="text-xs text-catalan-textMuted mt-0.5">
                        When enabled, enumerators can edit data in their own previously submitted records. Supervisors and admins can always edit.
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        const next = !allowEnumeratorEdit
                        setSavingEnumEdit(true)
                        try {
                          await api.patch(`/tenants/${myTenantId}`, { allow_enumerator_edit: next })
                          setAllowEnumeratorEdit(next)
                          toast.success(next ? 'Enumerator editing enabled' : 'Enumerator editing disabled')
                        } catch {
                          toast.error('Failed to save setting')
                        } finally {
                          setSavingEnumEdit(false)
                        }
                      }}
                      disabled={savingEnumEdit || !myTenantId}
                      className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 ${allowEnumeratorEdit ? 'bg-catalan-primary' : 'bg-catalan-border'}`}
                      title={allowEnumeratorEdit ? 'Click to disable' : 'Click to enable'}
                    >
                      <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${allowEnumeratorEdit ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                  </div>
                </Card>
              )}

              {/* ── Webhooks ── */}
              <Card title="Webhooks">
                <p className="text-sm text-catalan-textMuted mb-4">
                  FieldPulse will POST a JSON payload to your URL when the selected events occur.
                </p>

                <div className="flex justify-between items-center mb-4">
                  <span className="text-sm text-catalan-textMuted">{webhooks.length} webhook{webhooks.length !== 1 ? 's' : ''}</span>
                  <Button variant="primary" size="sm" onClick={() => setShowWebhookForm(v => !v)}>
                    {showWebhookForm ? 'Cancel' : '+ New Webhook'}
                  </Button>
                </div>

                {showWebhookForm && (
                  <div className="mb-6 p-4 bg-catalan-hover rounded-lg border border-catalan-border space-y-3">
                    <div>
                      <label className="text-xs text-catalan-textMuted block mb-1">Name</label>
                      <input
                        value={newWebhook.name}
                        onChange={e => setNewWebhook(w => ({ ...w, name: e.target.value }))}
                        placeholder="e.g. Zapier Trigger"
                        className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-catalan-textMuted block mb-1">URL</label>
                      <input
                        value={newWebhook.url}
                        onChange={e => setNewWebhook(w => ({ ...w, url: e.target.value }))}
                        placeholder="https://hooks.zapier.com/…"
                        className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-catalan-textMuted block mb-1">Secret (optional — used to sign payloads)</label>
                      <input
                        type="password"
                        value={newWebhook.secret}
                        onChange={e => setNewWebhook(w => ({ ...w, secret: e.target.value }))}
                        placeholder="Leave blank to skip signing"
                        className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-catalan-textMuted block mb-2">Events</label>
                      <div className="flex flex-wrap gap-2">
                        {WEBHOOK_EVENTS.map(ev => (
                          <label key={ev} className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={newWebhook.events.includes(ev)}
                              onChange={e => setNewWebhook(w => ({
                                ...w,
                                events: e.target.checked
                                  ? [...w.events, ev]
                                  : w.events.filter(x => x !== ev),
                              }))}
                              className="accent-catalan-primary"
                            />
                            <code className="text-catalan-textMuted">{ev}</code>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button variant="primary" size="sm" onClick={handleCreateWebhook} disabled={savingWebhook}>
                        {savingWebhook ? 'Creating…' : 'Create Webhook'}
                      </Button>
                    </div>
                  </div>
                )}

                {loadingWebhooks ? (
                  <div className="text-sm text-catalan-textMuted py-4 text-center">Loading…</div>
                ) : webhooks.length === 0 ? (
                  <p className="text-sm text-catalan-textMuted text-center py-6">No webhooks yet</p>
                ) : (
                  <div className="space-y-3">
                    {webhooks.map(wh => (
                      <div key={wh.id} className="p-4 bg-catalan-hover rounded-lg border border-catalan-border">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-catalan-text text-sm">{wh.name}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${wh.is_active ? 'text-catalan-success bg-catalan-success/10' : 'text-catalan-textMuted bg-catalan-hover'}`}>
                                {wh.is_active ? 'active' : 'inactive'}
                              </span>
                            </div>
                            <code className="text-xs text-catalan-textMuted truncate block">{wh.url}</code>
                            {wh.events.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {wh.events.map(ev => (
                                  <code key={ev} className="text-xs bg-catalan-surface px-1.5 py-0.5 rounded text-catalan-textMuted">{ev}</code>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            <button
                              onClick={() => handleTestWebhook(wh.id)}
                              disabled={testingWebhook === wh.id}
                              className="text-xs px-2.5 py-1.5 rounded border border-catalan-border text-catalan-textMuted hover:text-catalan-primary hover:border-catalan-primary/50 transition-colors disabled:opacity-50"
                            >
                              {testingWebhook === wh.id ? '…' : 'Test'}
                            </button>
                            <button
                              onClick={() => handleDeleteWebhook(wh.id)}
                              className="text-xs px-2.5 py-1.5 rounded border border-catalan-error/30 text-catalan-error hover:bg-catalan-error/10 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        {testResult?.id === wh.id && (
                          <div className={`mt-2 text-xs px-2.5 py-1.5 rounded ${testResult.success ? 'bg-catalan-success/10 text-catalan-success' : 'bg-catalan-error/10 text-catalan-error'}`}>
                            {testResult.success ? `✓ Test succeeded (HTTP ${testResult.status_code})` : `⚠ Test failed (HTTP ${testResult.status_code ?? 'error'})`}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
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
                  <div className="flex items-center gap-2" data-help-id="add-user-btn">
                    <InfoButton topicId="add-user" />
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => { setShowAddUser(v => !v); setShowCsvImport(false) }}
                    >
                      {showAddUser ? 'Cancel' : '+ Add User'}
                    </Button>
                  </div>
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

              {/* ── Schedules ── */}
              <Card title="Field Schedules">
                <div className="flex justify-between items-center mb-4">
                  <p className="text-sm text-catalan-textMuted">
                    Assign enumerators to forms with date ranges and targets.
                  </p>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setShowScheduleForm(v => !v)}
                  >
                    {showScheduleForm ? 'Cancel' : '+ New Schedule'}
                  </Button>
                </div>

                {showScheduleForm && (
                  <div className="mb-6 p-4 bg-catalan-hover rounded-lg border border-catalan-border space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-catalan-textMuted block mb-1">Form *</label>
                        <select
                          value={newSchedule.form_id}
                          onChange={e => setNewSchedule(s => ({ ...s, form_id: e.target.value }))}
                          className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                        >
                          <option value="">Select form…</option>
                          {forms.filter(f => f.status !== 'archived').map(f => (
                            <option key={f.id} value={f.id}>{f.title}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-catalan-textMuted block mb-1">Enumerator *</label>
                        <select
                          value={newSchedule.enumerator_id}
                          onChange={e => setNewSchedule(s => ({ ...s, enumerator_id: e.target.value }))}
                          className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                        >
                          <option value="">Select enumerator…</option>
                          {team.filter(u => u.role === 'enumerator').map(u => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-catalan-textMuted block mb-1">Start Date *</label>
                        <input
                          type="date"
                          value={newSchedule.start_date}
                          onChange={e => setNewSchedule(s => ({ ...s, start_date: e.target.value }))}
                          className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-catalan-textMuted block mb-1">End Date *</label>
                        <input
                          type="date"
                          value={newSchedule.end_date}
                          onChange={e => setNewSchedule(s => ({ ...s, end_date: e.target.value }))}
                          className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-catalan-textMuted block mb-1">Location</label>
                        <input
                          value={newSchedule.location}
                          onChange={e => setNewSchedule(s => ({ ...s, location: e.target.value }))}
                          placeholder="Village / district…"
                          className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-catalan-textMuted block mb-1">Target Count</label>
                        <input
                          type="number"
                          min={0}
                          value={newSchedule.target_count || ''}
                          onChange={e => setNewSchedule(s => ({ ...s, target_count: parseInt(e.target.value) || 0 }))}
                          placeholder="0"
                          className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                        />
                      </div>
                    </div>
                      {scheduleQuestionnaires.length > 0 && (
                        <div>
                          <label className="text-xs text-catalan-textMuted block mb-1">Link to Program Questionnaire <span className="text-catalan-textMuted">(optional)</span></label>
                          <select value={newSchedule.program_questionnaire_id}
                            onChange={e => setNewSchedule(s => ({ ...s, program_questionnaire_id: e.target.value }))}
                            className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary">
                            <option value="">— None —</option>
                            {scheduleQuestionnaires.map(q => <option key={q.id} value={q.id}>{q.program_name} › {q.name}</option>)}
                          </select>
                        </div>
                      )}
                      {scheduleLocations.length > 0 && (
                        <div>
                          <label className="text-xs text-catalan-textMuted block mb-1">Collection Location <span className="text-catalan-textMuted">(optional)</span></label>
                          <select value={newSchedule.location_id}
                            onChange={e => setNewSchedule(s => ({ ...s, location_id: e.target.value }))}
                            className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary">
                            <option value="">— None —</option>
                            {scheduleLocations.map(l => <option key={l.id} value={l.id}>{[l.district, l.block, l.village].filter(Boolean).join(' › ')}</option>)}
                          </select>
                        </div>
                      )}
                    <div>
                      <label className="text-xs text-catalan-textMuted block mb-1">Notes</label>
                      <textarea
                        value={newSchedule.notes}
                        onChange={e => setNewSchedule(s => ({ ...s, notes: e.target.value }))}
                        rows={2}
                        placeholder="Any special instructions…"
                        className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary resize-none"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button variant="primary" size="sm" onClick={handleCreateSchedule} disabled={savingSchedule}>
                        {savingSchedule ? 'Saving…' : 'Create Schedule'}
                      </Button>
                    </div>
                  </div>
                )}

                {loadingSchedules ? (
                  <div className="text-sm text-catalan-textMuted py-6 text-center">Loading…</div>
                ) : schedules.length === 0 ? (
                  <p className="text-sm text-catalan-textMuted text-center py-6">No schedules yet</p>
                ) : (
                  <div className="space-y-2">
                    {schedules.map(sc => (
                      <div key={sc.id} className="flex items-start justify-between gap-3 p-3 bg-catalan-hover rounded-lg border border-catalan-border">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <span className="font-medium text-catalan-text text-sm">{sc.form_title}</span>
                            <span className="text-catalan-textMuted text-xs">→</span>
                            <span className="text-catalan-text text-sm">{sc.enumerator_name}</span>
                            <StatusBadge status={sc.status} />
                          </div>
                          <div className="text-xs text-catalan-textMuted flex flex-wrap gap-3">
                            <span>📅 {sc.start_date} – {sc.end_date}</span>
                            {sc.location && <span>📍 {sc.location}</span>}
                            {sc.target_count > 0 && <span>🎯 {sc.target_count} target</span>}
                          </div>
                          {sc.notes && (
                            <p className="text-xs text-catalan-textMuted mt-1 italic">{sc.notes}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteSchedule(sc.id)}
                          className="text-xs px-2.5 py-1.5 rounded border border-catalan-error/30 text-catalan-error hover:bg-catalan-error/10 transition-colors flex-shrink-0"
                        >
                          Cancel
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}
          </>}
        </div>
      </div>

      {/* ── Mobile bottom nav (sm and below) ── */}
      {!loading && (
        <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-catalan-surface border-t border-catalan-border z-40 flex">
          {([
            { key: 'overview',      label: 'Overview',  icon: '◻' },
            { key: 'submissions',   label: 'Data',      icon: '📋' },
            { key: 'forms',         label: 'Forms',     icon: '📝' },
            { key: 'team',          label: 'Team',      icon: '👥' },
            { key: 'integrations',  label: 'Connect',   icon: '🔗' },
          ] as const).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => {
                setTab(key)
                if (key === 'integrations') { loadWebhooks(); loadApiKeys() }
                if (key === 'team') loadSchedules()
              }}
              className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] text-[10px] font-medium transition-colors ${
                tab === key
                  ? 'text-catalan-primary'
                  : 'text-catalan-textMuted hover:text-catalan-text'
              }`}
            >
              <span className="text-base leading-none">{icon}</span>
              <span>{label}</span>
              {key === 'submissions' && stats.flagged > 0 && tab !== 'submissions' && (
                <span className="absolute top-1.5 right-1/4 translate-x-2 w-4 h-4 text-[10px] font-bold bg-catalan-warning text-catalan-bg rounded-full flex items-center justify-center leading-none">
                  {stats.flagged > 9 ? '9+' : stats.flagged}
                </span>
              )}
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}
