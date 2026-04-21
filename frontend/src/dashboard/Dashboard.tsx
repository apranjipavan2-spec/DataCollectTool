import React, { useState, useEffect, useMemo } from 'react'
import api from '@/lib/api'
import BarChart from '@/components/charts/BarChart'
import LineChart from '@/components/charts/LineChart'

// ── Types ──────────────────────────────────────────────────────────────────
interface Form    { id: string; title: string; version: number; status: string; updated_at: string }
interface Sub     { id: string; form_id: string; enumerator_id: string; enumerator_name: string; status: string; server_received_at: string }
interface SubDetail {
  id: string; form_id: string; enumerator_id: string; enumerator_name: string;
  form_version: string; data_json: Record<string, unknown>; gps_open: any; gps_submit: any;
  status: string; flag_note: string | null; local_created_at: string; server_received_at: string
}
interface StatRow { name: string; enumerator_id: string; count: number }
interface TeamMember { id: string; name: string; phone: string; role: string }
interface Assignment { id: string; form_id: string; form_title: string; enumerator_id: string; enumerator_name: string; assigned_at: string }

// ── Shared styles ──────────────────────────────────────────────────────────
const theme = {
  bg:       '#11111b',
  surface:  '#1e1e2e',
  border:   '#2a2a3e',
  text:     '#cdd6f4',
  muted:    '#6c7086',
  accent:   '#89b4fa',
  green:    '#a6e3a1',
  red:      '#f38ba8',
  yellow:   '#f9e2af',
}

const card: React.CSSProperties = {
  background: theme.surface, border: `1px solid ${theme.border}`,
  borderRadius: 10, padding: 20,
}

const th: React.CSSProperties = {
  color: theme.muted, fontSize: 11, textTransform: 'uppercase',
  letterSpacing: 1, padding: '8px 12px', textAlign: 'left',
  borderBottom: `1px solid ${theme.border}`,
}

const td: React.CSSProperties = {
  color: theme.text, fontSize: 13, padding: '8px 12px',
  borderBottom: `1px solid ${theme.border}`,
}

const inputStyle: React.CSSProperties = {
  background: theme.surface, border: `1px solid ${theme.border}`,
  color: theme.text, borderRadius: 7, padding: '7px 12px', fontSize: 13,
}

// ── Status badge ──────────────────────────────────────────────────────────
function Badge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    synced: theme.accent,      // blue
    flagged: theme.yellow,     // yellow
    approved: theme.green,     // green
    rejected: theme.red,       // red
    active: theme.green,
  }
  const color = colorMap[status] ?? theme.muted
  return (
    <span style={{ background: color + '22', color, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 500 }}>
      {status}
    </span>
  )
}

function RoleBadge({ role }: { role: string }) {
  const color = role === 'org_admin' ? theme.accent : role === 'supervisor' ? theme.yellow : theme.green
  const label = role === 'org_admin' ? 'Admin' : role === 'supervisor' ? 'Supervisor' : 'Enumerator'
  return (
    <span style={{ background: color + '22', color, borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>
      {label}
    </span>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────
function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div style={card}>
      <div style={{ color: theme.muted, fontSize: 12, marginBottom: 6 }}>{label}</div>
      <div style={{ color: theme.accent, fontSize: 28, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ color: theme.muted, fontSize: 11, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

// ── Nav tab ───────────────────────────────────────────────────────────────
function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      background: 'none', border: 'none', cursor: 'pointer',
      color: active ? theme.accent : theme.muted,
      fontSize: 13, padding: '8px 16px',
      borderBottom: active ? `2px solid ${theme.accent}` : '2px solid transparent',
    }}>{label}</button>
  )
}

// ── Submission Detail Modal ───────────────────────────────────────────────
function DetailModal({ sub, forms, onClose, onFlag }: {
  sub: SubDetail; forms: Form[]; onClose: () => void;
  onFlag: (id: string, status: string, note: string) => Promise<void>
}) {
  const formTitle = forms.find(f => f.id === sub.form_id)?.title ?? 'Unknown Form'
  const [flagNote, setFlagNote] = useState(sub.flag_note ?? '')
  const [flagging, setFlagging] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const isFlagged = sub.status === 'flagged'
  const isReviewed = sub.status === 'approved' || sub.status === 'rejected'
  const canReview = sub.status === 'synced' || sub.status === 'flagged'

  const handleFlag = async () => {
    setFlagging(true)
    try {
      if (isFlagged) {
        await onFlag(sub.id, 'synced', '')
        sub.status = 'synced'; sub.flag_note = null
      } else {
        await onFlag(sub.id, 'flagged', flagNote)
        sub.status = 'flagged'; sub.flag_note = flagNote
      }
    } finally { setFlagging(false) }
  }

  const handleApprove = async () => {
    setReviewing(true)
    try {
      await onFlag(sub.id, 'approved', '')
      sub.status = 'approved'
    } finally { setReviewing(false) }
  }

  const handleReject = async () => {
    if (!showRejectInput) {
      setShowRejectInput(true)
      return
    }
    if (!rejectReason.trim()) return
    setReviewing(true)
    try {
      await onFlag(sub.id, 'rejected', rejectReason.trim())
      sub.status = 'rejected'; sub.flag_note = `Rejected: ${rejectReason.trim()}`
    } finally { setReviewing(false) }
  }

  // Status badge colors for the detail header
  const statusColor: Record<string, string> = {
    synced: theme.accent,
    flagged: theme.yellow,
    approved: theme.green,
    rejected: theme.red,
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 14,
        maxWidth: 600, width: '100%', maxHeight: '80vh', overflow: 'auto', padding: 0,
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ color: theme.text, fontWeight: 600, fontSize: 15 }}>Submission Detail</div>
            <div style={{ color: theme.muted, fontSize: 12, marginTop: 2 }}>{formTitle} · v{sub.form_version}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Badge status={sub.status} />
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: theme.muted, fontSize: 22, cursor: 'pointer', padding: '0 4px' }}>×</button>
          </div>
        </div>

        {/* Meta */}
        <div style={{ padding: '12px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, borderBottom: `1px solid ${theme.border}` }}>
          <MetaItem label="Enumerator" value={sub.enumerator_name} />
          <MetaItem label="Status" value={sub.status} />
          <MetaItem label="Collected" value={sub.local_created_at ? new Date(sub.local_created_at).toLocaleString() : '—'} />
          <MetaItem label="Received" value={new Date(sub.server_received_at).toLocaleString()} />
          {sub.gps_submit && (
            <MetaItem label="GPS" value={`${sub.gps_submit.lat?.toFixed(5)}, ${sub.gps_submit.lng?.toFixed(5)} (±${sub.gps_submit.accuracy}m)`} />
          )}
          <MetaItem label="ID" value={sub.id} mono />
        </div>

        {/* Supervisor Review Section */}
        <div style={{
          padding: '12px 20px', borderBottom: `1px solid ${theme.border}`,
          background: isReviewed
            ? (sub.status === 'approved' ? theme.green + '08' : theme.red + '08')
            : isFlagged ? theme.yellow + '08' : 'transparent',
        }}>
          <div style={{ color: theme.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Supervisor Review
          </div>

          {/* Show review result if already reviewed */}
          {isReviewed && sub.flag_note && (
            <div style={{
              color: statusColor[sub.status] ?? theme.muted,
              fontSize: 13, marginBottom: 8, padding: '8px 12px',
              background: (statusColor[sub.status] ?? theme.muted) + '11',
              borderRadius: 7, border: `1px solid ${(statusColor[sub.status] ?? theme.muted)}33`,
            }}>
              {sub.flag_note}
            </div>
          )}

          {/* Flag controls — only when not yet reviewed */}
          {canReview && (
            <>
              {!isFlagged && (
                <input
                  value={flagNote} onChange={e => setFlagNote(e.target.value)}
                  placeholder="Add a note (optional)…"
                  style={{ width: '100%', background: theme.surface, border: `1px solid ${theme.border}`, color: theme.text, borderRadius: 7, padding: '7px 12px', fontSize: 13, boxSizing: 'border-box', marginBottom: 8 }}
                />
              )}
              {isFlagged && sub.flag_note && (
                <div style={{ color: theme.yellow, fontSize: 13, marginBottom: 8 }}>
                  Flag note: {sub.flag_note}
                </div>
              )}

              {/* Reject reason input */}
              {showRejectInput && (
                <input
                  value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                  placeholder="Enter rejection reason (required)…"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Escape') setShowRejectInput(false) }}
                  style={{ width: '100%', background: theme.surface, border: `1px solid ${theme.red}55`, color: theme.text, borderRadius: 7, padding: '7px 12px', fontSize: 13, boxSizing: 'border-box', marginBottom: 8 }}
                />
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {/* Flag/Unflag button */}
                <button onClick={handleFlag} disabled={flagging || reviewing} style={{
                  background: isFlagged ? theme.green + '22' : theme.yellow + '22',
                  border: `1px solid ${isFlagged ? theme.green : theme.yellow}55`,
                  color: isFlagged ? theme.green : theme.yellow,
                  borderRadius: 7, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 500,
                }}>
                  {flagging ? '...' : isFlagged ? 'Unflag' : 'Flag for Review'}
                </button>

                {/* Approve button */}
                <button onClick={handleApprove} disabled={reviewing || flagging} style={{
                  background: theme.green + '22',
                  border: `1px solid ${theme.green}55`,
                  color: theme.green,
                  borderRadius: 7, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 500,
                }}>
                  {reviewing ? '...' : 'Approve'}
                </button>

                {/* Reject button */}
                <button onClick={handleReject} disabled={(reviewing && showRejectInput) || flagging} style={{
                  background: theme.red + '22',
                  border: `1px solid ${theme.red}55`,
                  color: theme.red,
                  borderRadius: 7, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 500,
                }}>
                  {reviewing ? '...' : showRejectInput ? 'Confirm Reject' : 'Reject'}
                </button>

                {showRejectInput && (
                  <button onClick={() => { setShowRejectInput(false); setRejectReason('') }} style={{
                    background: 'none', border: `1px solid ${theme.border}`,
                    color: theme.muted, borderRadius: 7, padding: '6px 14px', fontSize: 12, cursor: 'pointer',
                  }}>
                    Cancel
                  </button>
                )}
              </div>
            </>
          )}

          {/* If already reviewed, no action buttons */}
          {isReviewed && (
            <div style={{ color: theme.muted, fontSize: 12, marginTop: 4 }}>
              This submission has been {sub.status}. No further review actions available.
            </div>
          )}
        </div>

        {/* Data fields */}
        <div style={{ padding: '12px 20px' }}>
          <div style={{ color: theme.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Response Data</div>
          {Object.entries(sub.data_json).map(([key, val]) => (
            <div key={key} style={{ marginBottom: 10, borderBottom: `1px solid ${theme.border}`, paddingBottom: 8 }}>
              <div style={{ color: theme.muted, fontSize: 11, marginBottom: 2 }}>{key}</div>
              <div style={{ color: theme.text, fontSize: 14 }}>
                {renderFieldValue(val)}
              </div>
            </div>
          ))}
          {Object.keys(sub.data_json).length === 0 && (
            <div style={{ color: theme.muted, fontSize: 13, textAlign: 'center', padding: 20 }}>No data</div>
          )}
        </div>
      </div>
    </div>
  )
}

function MetaItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ color: theme.muted, fontSize: 11 }}>{label}</div>
      <div style={{ color: theme.text, fontSize: 13, fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>{value}</div>
    </div>
  )
}

/** Render a field value — handle media references, arrays, objects. */
function renderFieldValue(val: unknown): React.ReactNode {
  if (val === null || val === undefined) return <span style={{ color: theme.muted }}>—</span>
  if (typeof val === 'string') {
    if (val.startsWith('media://')) {
      return <span style={{ color: theme.accent }}>📎 Media uploaded</span>
    }
    if (val === '__photo_pending__') {
      return <span style={{ color: theme.yellow }}>📷 Photo pending upload</span>
    }
    if (val === '__audio_pending__') {
      return <span style={{ color: theme.yellow }}>🎙️ Audio pending upload</span>
    }
    if (val.startsWith('data:image/')) {
      return <img src={val} alt="photo" style={{ maxWidth: 200, borderRadius: 8, marginTop: 4 }} />
    }
    return val
  }
  if (Array.isArray(val)) return val.join(', ')
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

// ── Assign Modal ──────────────────────────────────────────────────────────
function AssignModal({ form, team, assignments, onAssign, onUnassign, onClose }: {
  form: Form
  team: TeamMember[]
  assignments: Assignment[]
  onAssign: (enumeratorId: string) => Promise<void>
  onUnassign: (assignmentId: string) => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState('')
  const assignedIds = new Set(assignments.map(a => a.enumerator_id))
  const unassigned = team.filter(u => !assignedIds.has(u.id))

  const handleAssign = async (enumeratorId: string) => {
    setBusy(enumeratorId)
    try { await onAssign(enumeratorId) } catch { /* ignore */ }
    finally { setBusy('') }
  }

  const handleUnassign = async (assignment: Assignment) => {
    setBusy(assignment.enumerator_id)
    try { await onUnassign(assignment.id) } catch { /* ignore */ }
    finally { setBusy('') }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 14,
        maxWidth: 480, width: '100%', maxHeight: '80vh', overflow: 'auto',
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ color: theme.text, fontWeight: 600, fontSize: 15 }}>Assign Enumerators</div>
            <div style={{ color: theme.muted, fontSize: 12, marginTop: 2 }}>{form.title}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: theme.muted, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        {/* Assigned list */}
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${theme.border}` }}>
          <div style={{ color: theme.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Assigned ({assignments.length})
          </div>
          {assignments.length === 0 && <div style={{ color: theme.muted, fontSize: 13 }}>No enumerators assigned yet</div>}
          {assignments.map(a => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${theme.border}` }}>
              <div>
                <span style={{ color: theme.text, fontSize: 13 }}>{a.enumerator_name}</span>
              </div>
              <button onClick={() => handleUnassign(a)} disabled={busy === a.enumerator_id} style={{
                background: 'none', border: `1px solid ${theme.red}33`, color: theme.red,
                borderRadius: 5, padding: '2px 8px', fontSize: 11, cursor: 'pointer',
              }}>
                {busy === a.enumerator_id ? '…' : 'Remove'}
              </button>
            </div>
          ))}
        </div>

        {/* Unassigned list */}
        <div style={{ padding: '12px 20px' }}>
          <div style={{ color: theme.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Available ({unassigned.length})
          </div>
          {unassigned.length === 0 && <div style={{ color: theme.muted, fontSize: 13 }}>All enumerators are assigned</div>}
          {unassigned.map(u => (
            <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${theme.border}` }}>
              <div>
                <span style={{ color: theme.text, fontSize: 13 }}>{u.name}</span>
                <span style={{ color: theme.muted, fontSize: 11, marginLeft: 8 }}>{u.phone}</span>
              </div>
              <button onClick={() => handleAssign(u.id)} disabled={busy === u.id} style={{
                background: theme.green + '22', border: `1px solid ${theme.green}55`, color: theme.green,
                borderRadius: 5, padding: '2px 8px', fontSize: 11, cursor: 'pointer',
              }}>
                {busy === u.id ? '…' : '+ Assign'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Version History Modal ─────────────────────────────────────────────────
interface FormVersionEntry { id: string; form_id: string; version: number; created_at: string }
interface FormVersionDetail extends FormVersionEntry { json_schema: Record<string, unknown> }

function VersionHistoryModal({ form, onClose }: { form: Form; onClose: () => void }) {
  const [versions, setVersions] = useState<FormVersionEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedVersion, setSelectedVersion] = useState<FormVersionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    api.get<FormVersionEntry[]>(`/forms/${form.id}/versions`)
      .then(r => setVersions(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [form.id])

  const viewSchema = async (version: number) => {
    setDetailLoading(true)
    try {
      const { data } = await api.get<FormVersionDetail>(`/forms/${form.id}/versions/${version}`)
      setSelectedVersion(data)
    } catch { /* ignore */ }
    finally { setDetailLoading(false) }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 14,
        maxWidth: 600, width: '100%', maxHeight: '80vh', overflow: 'auto',
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ color: theme.text, fontWeight: 600, fontSize: 15 }}>Version History</div>
            <div style={{ color: theme.muted, fontSize: 12, marginTop: 2 }}>{form.title} — current v{form.version}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: theme.muted, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        {/* Version list */}
        <div style={{ padding: '12px 20px' }}>
          {loading && <div style={{ color: theme.muted, fontSize: 13, padding: 20, textAlign: 'center' }}>Loading...</div>}
          {!loading && versions.length === 0 && (
            <div style={{ color: theme.muted, fontSize: 13, padding: 20, textAlign: 'center' }}>No version history available</div>
          )}
          {!loading && versions.map(v => (
            <div key={v.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 0', borderBottom: `1px solid ${theme.border}`,
            }}>
              <div>
                <span style={{ color: theme.text, fontSize: 13, fontWeight: v.version === form.version ? 600 : 400 }}>
                  v{v.version}
                  {v.version === form.version && (
                    <span style={{ color: theme.green, fontSize: 11, marginLeft: 8 }}>current</span>
                  )}
                </span>
                <div style={{ color: theme.muted, fontSize: 11, marginTop: 2 }}>
                  {new Date(v.created_at).toLocaleString()}
                </div>
              </div>
              <button onClick={() => viewSchema(v.version)} disabled={detailLoading} style={{
                background: theme.accent + '22', border: `1px solid ${theme.accent}55`, color: theme.accent,
                borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: 'pointer',
              }}>
                View Schema
              </button>
            </div>
          ))}
        </div>

        {/* Schema detail */}
        {selectedVersion && (
          <div style={{ padding: '12px 20px', borderTop: `1px solid ${theme.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ color: theme.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
                Schema — v{selectedVersion.version}
              </div>
              <button onClick={() => setSelectedVersion(null)} style={{
                background: 'none', border: 'none', color: theme.muted, fontSize: 11, cursor: 'pointer',
              }}>
                Close
              </button>
            </div>
            <pre style={{
              background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 8,
              padding: 12, fontSize: 11, color: theme.text, overflow: 'auto', maxHeight: 300,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {JSON.stringify(selectedVersion.json_schema, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────
export default function Dashboard() {
  const [tab, setTab] = useState<'overview' | 'data' | 'forms' | 'team' | 'schedules'>('overview')
  const [forms, setForms] = useState<Form[]>([])
  const [subs, setSubs] = useState<Sub[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedForm, setSelectedForm] = useState<string>('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [exportingCsv, setExportingCsv] = useState(false)
  const [detailSub, setDetailSub] = useState<SubDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  // Team management
  const [team, setTeam] = useState<TeamMember[]>([])
  const [showAddUser, setShowAddUser] = useState(false)
  const [newUser, setNewUser] = useState({ phone: '', name: '', role: 'enumerator', password: '' })
  const [teamMsg, setTeamMsg] = useState('')
  const [teamLoading, setTeamLoading] = useState(false)
  const [showCsvImport, setShowCsvImport] = useState(false)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvUploading, setCsvUploading] = useState(false)
  const [csvResult, setCsvResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null)
  // Form assignments
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [assignForm, setAssignForm] = useState<Form | null>(null)  // form being assigned
  // Schedules
  const [schedules, setSchedules] = useState<any[]>([])
  const [showAddSchedule, setShowAddSchedule] = useState(false)
  const [newSchedule, setNewSchedule] = useState({ form_id: '', enumerator_id: '', start_date: '', end_date: '', location: '', target_count: 0, notes: '' })

  useEffect(() => {
    Promise.allSettled([
      api.get<Form[]>('/forms/').then(r => setForms(r.data)),
      api.get<{ items: Sub[]; total: number }>('/submissions/?page_size=200').then(r => setSubs(r.data.items)),
      api.get<{ items: TeamMember[]; total: number }>('/users/?page_size=200').then(r => setTeam(r.data.items)),
      api.get<Assignment[]>('/assignments/').then(r => setAssignments(r.data)),
      api.get('/schedules/').then(r => setSchedules(r.data)),
    ]).finally(() => setLoading(false))
  }, [])

  const filteredSubs = subs.filter(s => {
    if (selectedForm && s.form_id !== selectedForm) return false
    if (search && !s.id.includes(search) && !s.enumerator_name.toLowerCase().includes(search.toLowerCase()) && !s.enumerator_id.includes(search)) return false
    if (dateFrom && s.server_received_at < dateFrom) return false
    if (dateTo && s.server_received_at.slice(0, 10) > dateTo) return false
    return true
  })

  // Per-enumerator counts — now with names
  const byEnumerator: StatRow[] = Object.entries(
    subs.reduce<Record<string, { name: string; count: number }>>((acc, s) => {
      if (!acc[s.enumerator_id]) acc[s.enumerator_id] = { name: s.enumerator_name, count: 0 }
      acc[s.enumerator_id].count++
      return acc
    }, {})
  ).map(([enumerator_id, v]) => ({ enumerator_id, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count)

  // Daily submission counts for line chart
  const dailyCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of subs) {
      const day = s.server_received_at?.slice(0, 10)
      if (day) counts[day] = (counts[day] ?? 0) + 1
    }
    return Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }))
  }, [subs])

  // Bar chart data from byEnumerator
  const enumeratorBarData = useMemo(
    () => byEnumerator.slice(0, 10).map(r => ({ label: r.name, value: r.count })),
    [byEnumerator],
  )

  const handleExport = async () => {
    if (!selectedForm) return
    setExportingCsv(true)
    try {
      const res = await api.get(`/export/${selectedForm}/csv`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a'); a.href = url; a.download = 'export.csv'; a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExportingCsv(false)
    }
  }

  const openDetail = async (submissionId: string) => {
    setDetailLoading(true)
    try {
      const { data } = await api.get<SubDetail>(`/submissions/${submissionId}`)
      setDetailSub(data)
    } catch { /* ignore */ }
    finally { setDetailLoading(false) }
  }

  return (
    <div style={{ background: theme.bg, minHeight: '100vh', color: theme.text, fontFamily: 'system-ui, sans-serif' }}>

      {/* Detail modal */}
      {detailSub && <DetailModal sub={detailSub} forms={forms} onClose={() => setDetailSub(null)}
        onFlag={async (id, status, note) => {
          await api.patch(`/submissions/${id}`, { status, flag_note: note })
          // Update local state
          setSubs(prev => prev.map(s => s.id === id ? { ...s, status } : s))
          setDetailSub(d => d ? { ...d, status, flag_note: note || null } : null)
        }}
      />}

      {/* Sub-header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', borderBottom: `1px solid ${theme.border}` }}>
        <span style={{ color: theme.muted, fontSize: 13 }}>Admin Dashboard</span>
        <a href="/builder" style={{ background: '#1e66f5', color: '#fff', borderRadius: 7, padding: '7px 14px', fontSize: 13, textDecoration: 'none', fontWeight: 500 }}>
          + New Form
        </a>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: `1px solid ${theme.border}`, padding: '0 24px' }}>
        {(['overview', 'data', 'forms', 'team', 'schedules'] as const).map(t => (
          <Tab key={t} label={t.charAt(0).toUpperCase() + t.slice(1)} active={tab === t} onClick={() => setTab(t)} />
        ))}
      </div>

      <div style={{ padding: 24 }}>
        {loading && <div style={{ color: theme.muted, textAlign: 'center', paddingTop: 60 }}>Loading…</div>}

        {/* ── OVERVIEW ── */}
        {!loading && tab === 'overview' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 16 }}>
              <StatCard label="Total Submissions" value={subs.length} />
              <StatCard label="Active Forms" value={forms.filter(f => f.status === 'active').length} />
              <StatCard label="Synced" value={subs.filter(s => s.status === 'synced').length} sub="pending review" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
              <StatCard label="Flagged" value={subs.filter(s => s.status === 'flagged').length} sub="needs review" />
              <StatCard label="Approved" value={subs.filter(s => s.status === 'approved').length} sub="reviewed" />
              <StatCard label="Rejected" value={subs.filter(s => s.status === 'rejected').length} sub="reviewed" />
            </div>

            {/* ── Charts Grid ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              <div style={card}>
                <h3 style={{ color: theme.text, margin: '0 0 12px', fontSize: 14 }}>Submissions Over Time</h3>
                <LineChart data={dailyCounts} height={220} />
              </div>
              <div style={card}>
                <h3 style={{ color: theme.text, margin: '0 0 12px', fontSize: 14 }}>Top Enumerators</h3>
                <BarChart data={enumeratorBarData} height={220} />
              </div>
            </div>

            <div style={card}>
              <h3 style={{ color: theme.text, margin: '0 0 16px', fontSize: 14 }}>Submissions by Enumerator</h3>
              {byEnumerator.length === 0
                ? <div style={{ color: theme.muted, fontSize: 13 }}>No submissions yet</div>
                : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr><th style={th}>Enumerator</th><th style={th}>Submissions</th><th style={th}>Share</th></tr>
                    </thead>
                    <tbody>
                      {byEnumerator.map(row => (
                        <tr key={row.enumerator_id}>
                          <td style={td}>
                            <div>{row.name}</div>
                            <div style={{ color: theme.muted, fontSize: 10, fontFamily: 'monospace' }}>{row.enumerator_id.slice(0, 8)}…</div>
                          </td>
                          <td style={td}>{row.count}</td>
                          <td style={td}>
                            <div style={{ background: theme.border, borderRadius: 4, height: 6, width: 120 }}>
                              <div style={{ background: theme.accent, borderRadius: 4, height: 6, width: `${(row.count / subs.length) * 120}px` }} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
          </div>
        )}

        {/* ── DATA VIEWER ── */}
        {!loading && tab === 'data' && (
          <div>
            {/* Filters row */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={selectedForm} onChange={e => setSelectedForm(e.target.value)} style={inputStyle}>
                <option value="">All forms</option>
                {forms.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
              </select>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or ID…"
                style={{ ...inputStyle, flex: 1, minWidth: 140 }}
              />
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                style={inputStyle} title="From date" />
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                style={inputStyle} title="To date" />
              {(dateFrom || dateTo) && (
                <button onClick={() => { setDateFrom(''); setDateTo('') }}
                  style={{ ...inputStyle, cursor: 'pointer', color: theme.muted, border: 'none', padding: '7px 10px' }}>
                  × Clear dates
                </button>
              )}
              <button
                onClick={handleExport}
                disabled={!selectedForm || exportingCsv}
                style={{ background: selectedForm ? '#1e66f5' : theme.border, border: 'none', color: '#fff', borderRadius: 7, padding: '7px 16px', cursor: selectedForm ? 'pointer' : 'default', fontSize: 13 }}
              >
                {exportingCsv ? 'Exporting…' : '↓ Export CSV'}
              </button>
            </div>

            <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>ID</th>
                    <th style={th}>Form</th>
                    <th style={th}>Enumerator</th>
                    <th style={th}>Status</th>
                    <th style={th}>Received</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSubs.length === 0
                    ? <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: theme.muted, padding: 40 }}>No submissions found</td></tr>
                    : filteredSubs.map(s => (
                      <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(s.id)}>
                        <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{s.id.slice(0, 8)}…</td>
                        <td style={td}>{forms.find(f => f.id === s.form_id)?.title ?? s.form_id.slice(0, 8)}</td>
                        <td style={td}>{s.enumerator_name}</td>
                        <td style={td}><Badge status={s.status} /></td>
                        <td style={{ ...td, color: theme.muted }}>{new Date(s.server_received_at).toLocaleString()}</td>
                        <td style={{ ...td, color: theme.accent, fontSize: 12 }}>View →</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div style={{ color: theme.muted, fontSize: 12, marginTop: 8 }}>
              {filteredSubs.length} submission{filteredSubs.length !== 1 ? 's' : ''}
              {detailLoading && ' · Loading detail…'}
            </div>
          </div>
        )}

        {/* ── FORMS ── */}
        {!loading && tab === 'forms' && (
          <div>
            {/* Assignment modal */}
            {assignForm && (
              <AssignModal
                form={assignForm}
                team={team.filter(u => u.role === 'enumerator')}
                assignments={assignments.filter(a => a.form_id === assignForm.id)}
                onAssign={async (enumeratorId) => {
                  const { data } = await api.post('/assignments/', { form_id: assignForm.id, enumerator_id: enumeratorId })
                  const user = team.find(u => u.id === enumeratorId)
                  setAssignments(a => [...a, {
                    id: data.id, form_id: assignForm.id, form_title: assignForm.title,
                    enumerator_id: enumeratorId, enumerator_name: user?.name ?? 'Unknown',
                    assigned_at: new Date().toISOString(),
                  }])
                }}
                onUnassign={async (assignmentId) => {
                  await api.delete(`/assignments/${assignmentId}`)
                  setAssignments(a => a.filter(x => x.id !== assignmentId))
                }}
                onClose={() => setAssignForm(null)}
              />
            )}

            <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Title</th>
                    <th style={th}>Version</th>
                    <th style={th}>Status</th>
                    <th style={th}>Assigned To</th>
                    <th style={th}>Last Updated</th>
                    <th style={th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {forms.length === 0
                    ? <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: theme.muted, padding: 40 }}>No forms yet — <a href="/builder" style={{ color: theme.accent }}>create one</a></td></tr>
                    : forms.map(f => {
                      const formAssignments = assignments.filter(a => a.form_id === f.id)
                      return (
                        <tr key={f.id}>
                          <td style={td}>{f.title}</td>
                          <td style={{ ...td, color: theme.muted }}>v{f.version}</td>
                          <td style={td}><Badge status={f.status} /></td>
                          <td style={td}>
                            {formAssignments.length === 0
                              ? <span style={{ color: theme.muted, fontSize: 12 }}>None</span>
                              : <span style={{ fontSize: 12 }}>
                                  {formAssignments.slice(0, 2).map(a => a.enumerator_name).join(', ')}
                                  {formAssignments.length > 2 && <span style={{ color: theme.muted }}> +{formAssignments.length - 2}</span>}
                                </span>
                            }
                          </td>
                          <td style={{ ...td, color: theme.muted }}>{f.updated_at ? new Date(f.updated_at).toLocaleDateString() : '—'}</td>
                          <td style={td}>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <a href="/builder" style={{ color: theme.accent, fontSize: 12 }}>Edit</a>
                              <button onClick={() => setAssignForm(f)} style={{
                                background: 'none', border: 'none', color: theme.green, fontSize: 12, cursor: 'pointer', padding: 0,
                              }}>Assign</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TEAM ── */}
        {!loading && tab === 'team' && (
          <div>
            {/* Header + Add / Import buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ color: theme.muted, fontSize: 13 }}>{team.length} team member{team.length !== 1 ? 's' : ''}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setShowCsvImport(!showCsvImport); setShowAddUser(false); setCsvResult(null); setCsvFile(null) }} style={{
                  background: showCsvImport ? theme.border : '#40a02b', border: 'none', color: '#fff',
                  borderRadius: 7, padding: '7px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500,
                }}>
                  {showCsvImport ? 'Cancel Import' : 'Import CSV'}
                </button>
                <button onClick={() => { setShowAddUser(!showAddUser); setShowCsvImport(false) }} style={{
                  background: showAddUser ? theme.border : '#1e66f5', border: 'none', color: '#fff',
                  borderRadius: 7, padding: '7px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500,
                }}>
                  {showAddUser ? 'Cancel' : '+ Add User'}
                </button>
              </div>
            </div>

            {/* CSV Import panel */}
            {showCsvImport && (
              <div style={{ ...card, marginBottom: 16, padding: 16 }}>
                <div style={{ color: theme.muted, fontSize: 12, marginBottom: 10 }}>
                  CSV format: <code>phone, name, role, password</code> (password is optional, defaults to &quot;fieldgovern123&quot;)
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={e => { setCsvFile(e.target.files?.[0] ?? null); setCsvResult(null) }}
                    style={{ fontSize: 13 }}
                  />
                  <button
                    disabled={!csvFile || csvUploading}
                    onClick={async () => {
                      if (!csvFile) return
                      setCsvUploading(true); setCsvResult(null); setTeamMsg('')
                      try {
                        const fd = new FormData()
                        fd.append('file', csvFile)
                        const { data } = await api.post<{ created: number; skipped: number; errors: string[] }>('/users/bulk-import', fd, {
                          headers: { 'Content-Type': 'multipart/form-data' },
                        })
                        setCsvResult(data)
                        if (data.created > 0) {
                          const res = await api.get<{ items: TeamMember[]; total: number }>('/users/?page_size=200')
                          setTeam(res.data.items)
                          setTeamMsg(`Imported ${data.created} user${data.created !== 1 ? 's' : ''}`)
                          setTimeout(() => setTeamMsg(''), 4000)
                        }
                      } catch (err: any) {
                        setCsvResult({ created: 0, skipped: 0, errors: [err.response?.data?.detail ?? 'Upload failed'] })
                      } finally { setCsvUploading(false) }
                    }}
                    style={{
                      background: csvFile ? '#1e66f5' : theme.border, border: 'none', color: '#fff',
                      borderRadius: 7, padding: '7px 16px', fontSize: 13, cursor: csvFile ? 'pointer' : 'default', fontWeight: 500,
                    }}
                  >
                    {csvUploading ? 'Uploading...' : 'Upload & Import'}
                  </button>
                </div>
                {csvResult && (
                  <div style={{ marginTop: 12, fontSize: 13 }}>
                    <div style={{ display: 'flex', gap: 16, marginBottom: csvResult.errors.length ? 8 : 0 }}>
                      <span style={{ color: '#40a02b', fontWeight: 600 }}>Created: {csvResult.created}</span>
                      <span style={{ color: theme.muted }}>Skipped (existing): {csvResult.skipped}</span>
                      {csvResult.errors.length > 0 && (
                        <span style={{ color: theme.red, fontWeight: 600 }}>Errors: {csvResult.errors.length}</span>
                      )}
                    </div>
                    {csvResult.errors.length > 0 && (
                      <div style={{ background: `${theme.red}11`, borderRadius: 6, padding: 10, maxHeight: 120, overflowY: 'auto', fontSize: 12, color: theme.red }}>
                        {csvResult.errors.map((e, i) => <div key={i}>{e}</div>)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Add user form */}
            {showAddUser && (
              <div style={{ ...card, marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ color: theme.muted, fontSize: 11, marginBottom: 4 }}>Phone</div>
                  <input value={newUser.phone} onChange={e => setNewUser(u => ({ ...u, phone: e.target.value }))}
                    placeholder="+91..." style={inputStyle} />
                </div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ color: theme.muted, fontSize: 11, marginBottom: 4 }}>Name</div>
                  <input value={newUser.name} onChange={e => setNewUser(u => ({ ...u, name: e.target.value }))}
                    placeholder="Full name" style={inputStyle} />
                </div>
                <div style={{ minWidth: 130 }}>
                  <div style={{ color: theme.muted, fontSize: 11, marginBottom: 4 }}>Role</div>
                  <select value={newUser.role} onChange={e => setNewUser(u => ({ ...u, role: e.target.value }))} style={inputStyle}>
                    <option value="enumerator">Enumerator</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="org_admin">Org Admin</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ color: theme.muted, fontSize: 11, marginBottom: 4 }}>Password</div>
                  <input type="password" value={newUser.password} onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))}
                    placeholder="Set password" style={inputStyle} />
                </div>
                <button onClick={async () => {
                  if (!newUser.phone || !newUser.name) { setTeamMsg('Phone and name required'); return }
                  if (!newUser.password) { setTeamMsg('Password is required'); return }
                  setTeamLoading(true); setTeamMsg('')
                  try {
                    const { data } = await api.post<TeamMember>('/users/', newUser)
                    setTeam(t => [...t, { ...data, name: newUser.name, phone: newUser.phone, role: newUser.role }])
                    setNewUser({ phone: '', name: '', role: 'enumerator', password: '' })
                    setShowAddUser(false)
                    setTeamMsg(`Added ${newUser.name}`)
                    setTimeout(() => setTeamMsg(''), 3000)
                  } catch (err: any) {
                    setTeamMsg(err.response?.data?.detail ?? 'Failed to add user')
                  } finally { setTeamLoading(false) }
                }} disabled={teamLoading} style={{
                  background: '#a6e3a1', border: 'none', color: '#11111b', borderRadius: 7,
                  padding: '8px 18px', fontSize: 13, cursor: 'pointer', fontWeight: 600,
                }}>
                  {teamLoading ? 'Adding…' : 'Add'}
                </button>
              </div>
            )}

            {teamMsg && <div style={{ color: theme.accent, fontSize: 13, marginBottom: 12 }}>{teamMsg}</div>}

            {/* Team table */}
            <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Name</th>
                    <th style={th}>Phone</th>
                    <th style={th}>Role</th>
                    <th style={th}>Submissions</th>
                    <th style={th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {team.length === 0
                    ? <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: theme.muted, padding: 40 }}>No team members yet — add one above</td></tr>
                    : team.map(u => {
                      const subCount = subs.filter(s => s.enumerator_id === u.id).length
                      return (
                        <tr key={u.id}>
                          <td style={td}>
                            <div style={{ fontWeight: 500 }}>{u.name}</div>
                            <div style={{ color: theme.muted, fontSize: 10, fontFamily: 'monospace' }}>{u.id.slice(0, 8)}…</div>
                          </td>
                          <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{u.phone}</td>
                          <td style={td}><RoleBadge role={u.role} /></td>
                          <td style={td}>{subCount}</td>
                          <td style={td}>
                            <button onClick={async () => {
                              if (!confirm(`Deactivate ${u.name}? They will no longer be able to log in.`)) return
                              try {
                                await api.delete(`/users/${u.id}`)
                                setTeam(t => t.filter(m => m.id !== u.id))
                                setTeamMsg(`${u.name} deactivated`)
                                setTimeout(() => setTeamMsg(''), 3000)
                              } catch { setTeamMsg('Failed to deactivate') }
                            }} style={{
                              background: 'none', border: `1px solid ${theme.red}33`, color: theme.red,
                              borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: 'pointer',
                            }}>
                              Deactivate
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── SCHEDULES ── */}
        {!loading && tab === 'schedules' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Collection Schedules</div>
              <button onClick={() => setShowAddSchedule(!showAddSchedule)} style={{
                background: '#1e66f5', border: 'none', color: '#fff', borderRadius: 7,
                padding: '7px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500,
              }}>
                {showAddSchedule ? 'Cancel' : '+ New Schedule'}
              </button>
            </div>

            {/* Add schedule form */}
            {showAddSchedule && (
              <div style={{ ...card, marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={{ color: theme.muted, fontSize: 11, display: 'block', marginBottom: 4 }}>Form</label>
                    <select
                      value={newSchedule.form_id}
                      onChange={e => setNewSchedule(s => ({ ...s, form_id: e.target.value }))}
                      style={{ ...inputStyle, width: '100%' }}
                    >
                      <option value="">Select form…</option>
                      {forms.filter(f => f.status === 'active').map(f => (
                        <option key={f.id} value={f.id}>{f.title}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ color: theme.muted, fontSize: 11, display: 'block', marginBottom: 4 }}>Enumerator</label>
                    <select
                      value={newSchedule.enumerator_id}
                      onChange={e => setNewSchedule(s => ({ ...s, enumerator_id: e.target.value }))}
                      style={{ ...inputStyle, width: '100%' }}
                    >
                      <option value="">Select enumerator…</option>
                      {team.filter(u => u.role === 'enumerator').map(u => (
                        <option key={u.id} value={u.id}>{u.name} ({u.phone})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ color: theme.muted, fontSize: 11, display: 'block', marginBottom: 4 }}>Start Date</label>
                    <input type="date" value={newSchedule.start_date}
                      onChange={e => setNewSchedule(s => ({ ...s, start_date: e.target.value }))}
                      style={{ ...inputStyle, width: '100%' }} />
                  </div>
                  <div>
                    <label style={{ color: theme.muted, fontSize: 11, display: 'block', marginBottom: 4 }}>End Date</label>
                    <input type="date" value={newSchedule.end_date}
                      onChange={e => setNewSchedule(s => ({ ...s, end_date: e.target.value }))}
                      style={{ ...inputStyle, width: '100%' }} />
                  </div>
                  <div>
                    <label style={{ color: theme.muted, fontSize: 11, display: 'block', marginBottom: 4 }}>Location</label>
                    <input type="text" placeholder="Village/Ward/Block"
                      value={newSchedule.location}
                      onChange={e => setNewSchedule(s => ({ ...s, location: e.target.value }))}
                      style={{ ...inputStyle, width: '100%' }} />
                  </div>
                  <div>
                    <label style={{ color: theme.muted, fontSize: 11, display: 'block', marginBottom: 4 }}>Target Count</label>
                    <input type="number" placeholder="0" min={0}
                      value={newSchedule.target_count || ''}
                      onChange={e => setNewSchedule(s => ({ ...s, target_count: parseInt(e.target.value) || 0 }))}
                      style={{ ...inputStyle, width: '100%' }} />
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ color: theme.muted, fontSize: 11, display: 'block', marginBottom: 4 }}>Notes</label>
                  <textarea
                    placeholder="Instructions for the enumerator…"
                    value={newSchedule.notes}
                    onChange={e => setNewSchedule(s => ({ ...s, notes: e.target.value }))}
                    style={{ ...inputStyle, width: '100%', minHeight: 60, resize: 'vertical' }}
                  />
                </div>
                <button
                  disabled={!newSchedule.form_id || !newSchedule.enumerator_id || !newSchedule.start_date || !newSchedule.end_date}
                  onClick={async () => {
                    try {
                      await api.post('/schedules/', newSchedule)
                      const refreshed = await api.get('/schedules/')
                      setSchedules(refreshed.data)
                      setShowAddSchedule(false)
                      setNewSchedule({ form_id: '', enumerator_id: '', start_date: '', end_date: '', location: '', target_count: 0, notes: '' })
                    } catch (e: any) {
                      alert(e.response?.data?.detail || 'Failed to create schedule')
                    }
                  }}
                  style={{
                    background: '#1e66f5', border: 'none', color: '#fff', borderRadius: 7,
                    padding: '8px 20px', fontSize: 13, cursor: 'pointer', fontWeight: 500,
                    opacity: (!newSchedule.form_id || !newSchedule.enumerator_id || !newSchedule.start_date || !newSchedule.end_date) ? 0.5 : 1,
                  }}
                >
                  Create Schedule
                </button>
              </div>
            )}

            {/* Schedule list */}
            {schedules.length === 0 && !showAddSchedule && (
              <div style={{ color: theme.muted, textAlign: 'center', paddingTop: 40 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
                <div>No schedules yet. Create one to assign collection tasks.</div>
              </div>
            )}

            {schedules.length > 0 && (
              <div style={card}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Form</th>
                      <th style={th}>Enumerator</th>
                      <th style={th}>Dates</th>
                      <th style={th}>Location</th>
                      <th style={th}>Target</th>
                      <th style={th}>Status</th>
                      <th style={th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((s: any) => {
                      const statusColor: Record<string, string> = {
                        upcoming: theme.accent,
                        active: theme.green,
                        completed: theme.muted,
                        cancelled: theme.red,
                      }
                      const color = statusColor[s.status] ?? theme.muted
                      const progress = subs.filter(sub =>
                        sub.form_id === s.form_id &&
                        sub.enumerator_id === s.enumerator_id &&
                        sub.server_received_at?.slice(0, 10) >= s.start_date &&
                        sub.server_received_at?.slice(0, 10) <= s.end_date
                      ).length

                      return (
                        <tr key={s.id}>
                          <td style={td}>{s.form_title}</td>
                          <td style={td}>{s.enumerator_name}</td>
                          <td style={{ ...td, fontSize: 12, whiteSpace: 'nowrap' }}>
                            {s.start_date} → {s.end_date}
                          </td>
                          <td style={td}>{s.location || '—'}</td>
                          <td style={td}>
                            {s.target_count > 0 ? (
                              <span>
                                <span style={{ color: progress >= s.target_count ? theme.green : theme.text, fontWeight: 600 }}>
                                  {progress}
                                </span>
                                <span style={{ color: theme.muted }}>/{s.target_count}</span>
                              </span>
                            ) : '—'}
                          </td>
                          <td style={td}>
                            <span style={{ background: color + '22', color, borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>
                              {s.status}
                            </span>
                          </td>
                          <td style={td}>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {s.status !== 'completed' && s.status !== 'cancelled' && (
                                <button onClick={async () => {
                                  await api.patch(`/schedules/${s.id}`, { status: 'completed' })
                                  setSchedules(prev => prev.map((x: any) => x.id === s.id ? { ...x, status: 'completed' } : x))
                                }} style={{
                                  background: 'none', border: `1px solid ${theme.green}44`, color: theme.green,
                                  borderRadius: 5, padding: '2px 8px', fontSize: 11, cursor: 'pointer',
                                }}>
                                  Complete
                                </button>
                              )}
                              {s.status !== 'cancelled' && (
                                <button onClick={async () => {
                                  if (!confirm('Cancel this schedule?')) return
                                  await api.delete(`/schedules/${s.id}`)
                                  setSchedules(prev => prev.filter((x: any) => x.id !== s.id))
                                }} style={{
                                  background: 'none', border: `1px solid ${theme.red}33`, color: theme.red,
                                  borderRadius: 5, padding: '2px 8px', fontSize: 11, cursor: 'pointer',
                                }}>
                                  Cancel
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
