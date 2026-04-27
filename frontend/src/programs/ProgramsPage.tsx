import { useState, useEffect, useCallback } from 'react'
import api, { getStoredUser } from '@/lib/api'
import { getCached, setCached } from '@/lib/pageCache'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'
import { useToast } from '@/lib/ToastContext'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Location { id: string; state: string; district: string; block: string; village: string }
interface ParticipantType { id: string; name: string; description: string; sort_order: number }
interface LocationTarget { id: string; location_id: string; target_count: number; deadline: string | null }
interface Questionnaire {
  id: string; name: string; participant_type_id: string | null; participant_type_name: string
  form_id: string | null; form_title: string; total_target: number; status: string
  start_date: string | null; end_date: string | null; location_targets: LocationTarget[]
}
interface Program {
  id: string; name: string; scheme_name: string; description: string; status: string
  start_date: string | null; end_date: string | null
  total_target: number; total_collected: number; pct: number
  overdue?: number; at_risk?: number
}
interface ProgramDetail extends Program {
  participant_types: ParticipantType[]
  questionnaires: Questionnaire[]
}
interface ProgressRow {
  target_id: string; questionnaire_name: string; questionnaire_id?: string
  participant_type_name: string; participant_type_id?: string
  state: string; district: string; block: string; village: string
  target: number; collected: number; remaining: number; pct: number
  deadline: string | null; days_remaining: number | null; status: string
}
interface ProgressData {
  program_name: string; scheme_name: string
  summary: { total_target: number; total_collected: number; remaining: number; pct: number; overdue: number; at_risk: number }
  rows: ProgressRow[]
}
interface Form { id: string; title: string }

// ── Style constants ───────────────────────────────────────────────────────────

const inputCls = 'w-full border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text placeholder:text-catalan-textMuted focus:ring-2 focus:ring-catalan-primary outline-none disabled:opacity-40'
const inputSmCls = 'w-full border border-catalan-border rounded-lg px-2 py-1.5 text-sm bg-catalan-bg text-catalan-text placeholder:text-catalan-textMuted focus:ring-2 focus:ring-catalan-primary outline-none'
const btnPrimary = 'px-4 py-2 bg-catalan-primary text-catalan-bg rounded-lg text-sm font-medium hover:bg-catalan-primaryDark transition-colors disabled:opacity-40'
const btnSecondary = 'px-4 py-2 text-sm border border-catalan-border rounded-lg text-catalan-text hover:bg-catalan-hover transition-colors'
const btnDanger = 'px-3 py-1.5 text-sm border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition-colors'

const PROG_STATUS_CLS: Record<string, string> = {
  active:    'bg-green-100 text-green-700',
  planning:  'bg-blue-100 text-blue-700',
  completed: 'bg-gray-100 text-gray-600',
  archived:  'bg-red-100 text-red-500',
}
const PROG_ROW_CLS: Record<string, string> = {
  completed:   'bg-green-50/40',
  in_progress: '',
  not_started: 'bg-catalan-bg',
  at_risk:     'bg-amber-50/40',
  overdue:     'bg-red-50/40',
}
const PROG_BADGE_CLS: Record<string, string> = {
  completed:   'bg-green-100 text-green-700',
  in_progress: 'bg-blue-100 text-blue-700',
  not_started: 'bg-gray-100 text-gray-500',
  at_risk:     'bg-amber-100 text-amber-700',
  overdue:     'bg-red-100 text-red-600',
}

// ── Small shared components ───────────────────────────────────────────────────

function ProgressBar({ pct, size = 'md' }: { pct: number; size?: 'sm' | 'md' }) {
  const h = size === 'sm' ? 'h-1' : 'h-1.5'
  const color = pct >= 100 ? 'bg-green-500' : pct >= 70 ? 'bg-catalan-primary' : pct >= 30 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className={`w-full bg-catalan-border rounded-full ${h}`}>
      <div className={`${h} rounded-full ${color} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-catalan-bg border border-catalan-border rounded-xl p-3 text-center">
      <div className={`text-xl font-bold ${color ?? 'text-catalan-text'}`}>{value}</div>
      <div className="text-xs text-catalan-textMuted mt-0.5">{label}</div>
    </div>
  )
}

function Badge({ label, cls }: { label: string; cls: string }) {
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>
}

// ── Modals ────────────────────────────────────────────────────────────────────

function ProgramModal({ initial, onSave, onClose }: {
  initial?: Partial<Program>; onSave: (d: any) => Promise<void>; onClose: () => void
}) {
  const [d, setD] = useState({ name: '', scheme_name: '', description: '', status: 'active', start_date: '', end_date: '', ...initial })
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setD(p => ({ ...p, [k]: v }))
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-catalan-surface border border-catalan-border rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-catalan-text mb-4">{initial?.id ? 'Edit Program' : 'New Program'}</h2>
        <div className="space-y-3">
          <div><label className="text-sm font-medium text-catalan-text">Program Name *</label>
            <input className={`${inputCls} mt-1`} value={d.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Karnataka Road Survey 2024" /></div>
          <div><label className="text-sm font-medium text-catalan-text">Scheme / Yojana</label>
            <input className={`${inputCls} mt-1`} value={d.scheme_name} onChange={e => set('scheme_name', e.target.value)} placeholder="e.g. PMGSY, MGNREGS, NHM" /></div>
          <div><label className="text-sm font-medium text-catalan-text">Description</label>
            <textarea className={`${inputCls} mt-1`} rows={2} value={d.description} onChange={e => set('description', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-sm font-medium text-catalan-text">Start Date</label>
              <input type="date" className={`${inputCls} mt-1`} value={d.start_date || ''} onChange={e => set('start_date', e.target.value)} /></div>
            <div><label className="text-sm font-medium text-catalan-text">End Date</label>
              <input type="date" className={`${inputCls} mt-1`} value={d.end_date || ''} onChange={e => set('end_date', e.target.value)} /></div>
          </div>
          <div><label className="text-sm font-medium text-catalan-text">Status</label>
            <select className={`${inputCls} mt-1`} value={d.status} onChange={e => set('status', e.target.value)}>
              {['planning', 'active', 'completed', 'archived'].map(s => <option key={s} value={s}>{s}</option>)}
            </select></div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className={btnSecondary}>Cancel</button>
          <button disabled={!d.name || saving} onClick={async () => { setSaving(true); await onSave(d).finally(() => setSaving(false)) }} className={btnPrimary}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function LocationModal({ initial, onSave, onClose }: {
  initial?: Partial<Location>; onSave: (d: any) => Promise<void>; onClose: () => void
}) {
  const [d, setD] = useState({ state: '', district: '', block: '', village: '', ...initial })
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setD(p => ({ ...p, [k]: v }))
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-catalan-surface border border-catalan-border rounded-xl shadow-xl w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold text-catalan-text mb-4">{initial?.id ? 'Edit Location' : 'Add Location'}</h2>
        <div className="space-y-3">
          {[['state', 'State'], ['district', 'District *'], ['block', 'Block / Taluk'], ['village', 'Village / GP']].map(([k, label]) => (
            <div key={k}><label className="text-sm font-medium text-catalan-text">{label}</label>
              <input className={`${inputCls} mt-1`} value={(d as any)[k]} onChange={e => set(k, e.target.value)} /></div>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className={btnSecondary}>Cancel</button>
          <button disabled={!d.district || saving} onClick={async () => { setSaving(true); await onSave(d).finally(() => setSaving(false)) }} className={btnPrimary}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Setup sub-panel ───────────────────────────────────────────────────────────

function SetupPanel({ prog, locations, forms, onRefresh }: {
  prog: ProgramDetail; locations: Location[]; forms: Form[]; onRefresh: () => void
}) {
  const [addingType, setAddingType] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [addingQ, setAddingQ] = useState(false)
  const [newQ, setNewQ] = useState({ name: '', participant_type_id: '', form_id: '', total_target: 0, start_date: '', end_date: '' })
  const [expandedQ, setExpandedQ] = useState<string | null>(null)
  const [addingTarget, setAddingTarget] = useState<string | null>(null)
  const [newTarget, setNewTarget] = useState({ location_id: '', target_count: 0, deadline: '' })
  const locMap = Object.fromEntries(locations.map(l => [l.id, l]))

  const addType = async () => {
    if (!newTypeName.trim()) return
    await api.post(`/programs/${prog.id}/participant-types`, { name: newTypeName })
    setNewTypeName(''); setAddingType(false); onRefresh()
  }
  const delType = async (id: string) => {
    if (!confirm('Delete participant type?')) return
    await api.delete(`/programs/${prog.id}/participant-types/${id}`); onRefresh()
  }
  const addQuestionnaire = async () => {
    await api.post(`/programs/${prog.id}/questionnaires`, {
      ...newQ, total_target: Number(newQ.total_target),
      participant_type_id: newQ.participant_type_id || null,
      form_id: newQ.form_id || null,
      start_date: newQ.start_date || null, end_date: newQ.end_date || null,
    })
    setAddingQ(false); setNewQ({ name: '', participant_type_id: '', form_id: '', total_target: 0, start_date: '', end_date: '' }); onRefresh()
  }
  const delQ = async (id: string) => {
    if (!confirm('Delete questionnaire?')) return
    await api.delete(`/programs/${prog.id}/questionnaires/${id}`); onRefresh()
  }
  const addTarget = async (qId: string) => {
    await api.post(`/programs/${prog.id}/questionnaires/${qId}/targets`, {
      location_id: newTarget.location_id, target_count: Number(newTarget.target_count), deadline: newTarget.deadline || null,
    })
    setAddingTarget(null); setNewTarget({ location_id: '', target_count: 0, deadline: '' }); onRefresh()
  }
  const delTarget = async (qId: string, tId: string) => {
    await api.delete(`/programs/${prog.id}/questionnaires/${qId}/targets/${tId}`); onRefresh()
  }

  return (
    <div className="space-y-6">
      {/* Participant Types */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-xs text-catalan-textMuted uppercase tracking-wide">Participant Types</h3>
          <button onClick={() => setAddingType(true)} className="text-xs text-catalan-primary hover:underline">+ Add</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {prog.participant_types.map(t => (
            <span key={t.id} className="flex items-center gap-1 px-3 py-1 bg-catalan-primary/10 text-catalan-primary rounded-full text-sm">
              {t.name}
              <button onClick={() => delType(t.id)} className="text-catalan-primary/50 hover:text-red-500 ml-1 leading-none">×</button>
            </span>
          ))}
          {prog.participant_types.length === 0 && <span className="text-sm text-catalan-textMuted">No types yet</span>}
        </div>
        {addingType && (
          <div className="flex gap-2 mt-2">
            <input autoFocus className={`${inputSmCls} flex-1`} placeholder="e.g. Beneficiary, Household…"
              value={newTypeName} onChange={e => setNewTypeName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addType(); if (e.key === 'Escape') setAddingType(false) }} />
            <button onClick={addType} className="px-3 py-1.5 bg-catalan-primary text-catalan-bg text-sm rounded-lg">Add</button>
            <button onClick={() => setAddingType(false)} className={btnSecondary}>Cancel</button>
          </div>
        )}
      </div>

      {/* Questionnaires */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-xs text-catalan-textMuted uppercase tracking-wide">Questionnaires / Survey Forms</h3>
          <button onClick={() => setAddingQ(true)} className="text-xs text-catalan-primary hover:underline">+ Add</button>
        </div>
        {addingQ && (
          <div className="border border-catalan-border rounded-xl p-4 mb-3 bg-catalan-primary/5 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-catalan-textMuted">Name *</label>
                <input className={`${inputSmCls} mt-0.5`} value={newQ.name} onChange={e => setNewQ(p => ({ ...p, name: e.target.value }))} placeholder="Household Survey" /></div>
              <div><label className="text-xs font-medium text-catalan-textMuted">Participant Type</label>
                <select className={`${inputSmCls} mt-0.5`} value={newQ.participant_type_id} onChange={e => setNewQ(p => ({ ...p, participant_type_id: e.target.value }))}>
                  <option value="">— Any —</option>
                  {prog.participant_types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select></div>
              <div><label className="text-xs font-medium text-catalan-textMuted">Form / Questionnaire</label>
                <select className={`${inputSmCls} mt-0.5`} value={newQ.form_id} onChange={e => setNewQ(p => ({ ...p, form_id: e.target.value }))}>
                  <option value="">— None —</option>
                  {forms.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
                </select></div>
              <div><label className="text-xs font-medium text-catalan-textMuted">Total Sample Target</label>
                <input type="number" min={0} className={`${inputSmCls} mt-0.5`} value={newQ.total_target}
                  onChange={e => setNewQ(p => ({ ...p, total_target: +e.target.value }))} /></div>
              <div><label className="text-xs font-medium text-catalan-textMuted">Start Date</label>
                <input type="date" className={`${inputSmCls} mt-0.5`} value={newQ.start_date}
                  onChange={e => setNewQ(p => ({ ...p, start_date: e.target.value }))} /></div>
              <div><label className="text-xs font-medium text-catalan-textMuted">End Date</label>
                <input type="date" className={`${inputSmCls} mt-0.5`} value={newQ.end_date}
                  onChange={e => setNewQ(p => ({ ...p, end_date: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2">
              <button disabled={!newQ.name} onClick={addQuestionnaire} className={btnPrimary}>Add Questionnaire</button>
              <button onClick={() => setAddingQ(false)} className={btnSecondary}>Cancel</button>
            </div>
          </div>
        )}
        <div className="space-y-2">
          {prog.questionnaires.map(q => (
            <div key={q.id} className="border border-catalan-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-catalan-hover"
                onClick={() => setExpandedQ(expandedQ === q.id ? null : q.id)}>
                <div>
                  <div className="font-medium text-sm text-catalan-text">{q.name}</div>
                  <div className="text-xs text-catalan-textMuted mt-0.5 flex flex-wrap gap-x-3">
                    {q.participant_type_name && <span>👤 {q.participant_type_name}</span>}
                    {q.form_title && <span>📋 {q.form_title}</span>}
                    <span>Sample target: <strong>{q.total_target}</strong></span>
                    {q.location_targets.length > 0 && <span>{q.location_targets.length} location(s)</span>}
                    {(q.start_date || q.end_date) && <span>📅 {q.start_date ?? '…'} → {q.end_date ?? '…'}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge label={q.status} cls={PROG_BADGE_CLS[q.status] ?? 'bg-gray-100 text-gray-500'} />
                  <button onClick={e => { e.stopPropagation(); delQ(q.id) }} className="text-catalan-textMuted hover:text-red-500 text-lg leading-none">×</button>
                  <span className="text-catalan-textMuted text-xs">{expandedQ === q.id ? '▲' : '▼'}</span>
                </div>
              </div>
              {expandedQ === q.id && (
                <div className="px-4 pb-4 bg-catalan-bg border-t border-catalan-border">
                  <div className="flex items-center justify-between my-2">
                    <span className="text-xs font-medium text-catalan-textMuted uppercase tracking-wide">Location Targets</span>
                    <button onClick={() => setAddingTarget(q.id)} className="text-xs text-catalan-primary hover:underline">+ Add Location</button>
                  </div>
                  {addingTarget === q.id && (
                    <div className="flex gap-2 mb-2 flex-wrap">
                      <select className={`${inputSmCls} flex-1 min-w-48`} value={newTarget.location_id}
                        onChange={e => setNewTarget(p => ({ ...p, location_id: e.target.value }))}>
                        <option value="">— Select Location —</option>
                        {locations.map(l => <option key={l.id} value={l.id}>{[l.district, l.block, l.village].filter(Boolean).join(' › ')}</option>)}
                      </select>
                      <input type="number" min={0} className="border border-catalan-border rounded-lg px-2 py-1.5 text-sm bg-catalan-bg text-catalan-text w-24 outline-none focus:ring-2 focus:ring-catalan-primary"
                        placeholder="Target" value={newTarget.target_count} onChange={e => setNewTarget(p => ({ ...p, target_count: +e.target.value }))} />
                      <input type="date" className="border border-catalan-border rounded-lg px-2 py-1.5 text-sm bg-catalan-bg text-catalan-text outline-none focus:ring-2 focus:ring-catalan-primary"
                        value={newTarget.deadline} onChange={e => setNewTarget(p => ({ ...p, deadline: e.target.value }))} />
                      <button disabled={!newTarget.location_id} onClick={() => addTarget(q.id)} className={btnPrimary}>Add</button>
                      <button onClick={() => setAddingTarget(null)} className={btnSecondary}>✕</button>
                    </div>
                  )}
                  <div className="space-y-1">
                    {q.location_targets.map(t => {
                      const loc = locMap[t.location_id]
                      return (
                        <div key={t.id} className="flex items-center justify-between py-1.5 px-2 bg-catalan-surface rounded-lg border border-catalan-border text-sm">
                          <span className="text-catalan-text">{loc ? [loc.district, loc.block, loc.village].filter(Boolean).join(' › ') : t.location_id}</span>
                          <div className="flex items-center gap-3 text-catalan-textMuted text-xs">
                            <span>Target: <strong className="text-catalan-text">{t.target_count}</strong></span>
                            {t.deadline && <span>Due: {t.deadline}</span>}
                            <button onClick={() => delTarget(q.id, t.id)} className="text-catalan-textMuted hover:text-red-500 text-base leading-none">×</button>
                          </div>
                        </div>
                      )
                    })}
                    {q.location_targets.length === 0 && <p className="text-xs text-catalan-textMuted py-2">No location targets — add one to track per-location progress</p>}
                  </div>
                </div>
              )}
            </div>
          ))}
          {prog.questionnaires.length === 0 && <p className="text-sm text-catalan-textMuted">No questionnaires yet</p>}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ProgramsPage() {
  const user = getStoredUser()
  const toast = useToast()
  const token = localStorage.getItem('fp_token')

  const [topTab, setTopTab] = useState<'programs' | 'locations'>('programs')
  const [programs, setPrograms] = useState<Program[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [forms, setForms] = useState<Form[]>([])
  const [loading, setLoading] = useState(true)
  const [schemeFilter, setSchemeFilter] = useState('')

  // Program detail state
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<ProgramDetail | null>(null)
  const [progress, setProgress] = useState<ProgressData | null>(null)
  const [detailTab, setDetailTab] = useState<'progress' | 'setup'>('progress')
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [progressFilters, setProgressFilters] = useState({ participant_type_id: '', questionnaire_id: '', district: '', block: '', status: '' })
  const [progressSearch, setProgressSearch] = useState('')
  const [sortKey, setSortKey] = useState<'district' | 'pct' | 'status' | 'remaining'>('district')
  const [sortAsc, setSortAsc] = useState(true)
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null)

  // Modals
  const [showProgModal, setShowProgModal] = useState(false)
  const [editingProg, setEditingProg] = useState<Program | null>(null)
  const [showLocModal, setShowLocModal] = useState(false)
  const [editingLoc, setEditingLoc] = useState<Location | null>(null)

  // ── Data loading ────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    const cp = getCached<Program[]>('programs/overview')
    const cf = getCached<Form[]>('forms/list')
    if (cp) { setPrograms(cp); setLoading(false) }
    if (cf) setForms(cf)
    try {
      const [pr, lo, fo] = await Promise.all([
        api.get('/programs/overview').then(r => r.data),
        api.get('/programs/locations').then(r => r.data).catch(() => []),
        api.get('/forms/').then(r => r.data?.forms ?? r.data ?? []).catch(() => []),
      ])
      setPrograms(pr); setLocations(lo); setForms(fo)
      setCached('programs/overview', pr); setCached('forms/list', fo)
    } catch { } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const loadDetail = useCallback(async (id: string) => {
    if (!id) return
    setLoadingDetail(true)
    const params = Object.fromEntries(Object.entries(progressFilters).filter(([, v]) => v))
    try {
      const [det, prog] = await Promise.all([
        api.get(`/programs/${id}`).then(r => r.data),
        api.get(`/programs/${id}/progress`, { params }).then(r => r.data).catch(() => null),
      ])
      setDetail(det); setProgress(prog)
    } finally { setLoadingDetail(false) }
  }, [progressFilters])

  useEffect(() => { if (selectedId) loadDetail(selectedId) }, [selectedId, loadDetail])

  const selectProgram = (id: string) => {
    setSelectedId(id)
    setDetailTab('progress')
    setProgressFilters({ participant_type_id: '', questionnaire_id: '', district: '', block: '', status: '' })
    setProgressSearch('')
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  const saveProgram = async (d: any) => {
    if (editingProg?.id) await api.patch(`/programs/${editingProg.id}`, d)
    else await api.post('/programs/', d)
    setShowProgModal(false); setEditingProg(null)
    await load(); toast.success('Program saved')
  }

  const deleteProgram = async (id: string) => {
    if (!confirm('Delete this program and all its data?')) return
    await api.delete(`/programs/${id}`)
    setSelectedId(''); setDetail(null); setProgress(null)
    await load(); toast.success('Program deleted')
  }

  const saveLocation = async (d: any) => {
    if (editingLoc?.id) await api.patch(`/programs/locations/${editingLoc.id}`, d)
    else await api.post('/programs/locations', d)
    setShowLocModal(false); setEditingLoc(null); await load(); toast.success('Location saved')
  }

  const deleteLocation = async (id: string) => {
    if (!confirm('Delete location?')) return
    await api.delete(`/programs/locations/${id}`); await load()
  }

  const exportProgress = async (type: 'xlsx' | 'pdf') => {
    if (!selectedId) return
    setExporting(type)
    const params = new URLSearchParams(Object.fromEntries(Object.entries(progressFilters).filter(([, v]) => v)))
    try {
      const r = await api.get(`/programs/${selectedId}/progress/${type}`, { params, responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a'); a.href = url
      a.download = `progress.${type === 'pdf' ? 'html' : 'xlsx'}`; a.click()
      URL.revokeObjectURL(url)
    } finally { setExporting(null) }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const filtered = programs.filter(p =>
    !schemeFilter ||
    p.scheme_name?.toLowerCase().includes(schemeFilter.toLowerCase()) ||
    p.name.toLowerCase().includes(schemeFilter.toLowerCase())
  )

  const ptypes = [...new Map((progress?.rows ?? []).filter(r => (r as any).participant_type_id)
    .map(r => [(r as any).participant_type_id, r.participant_type_name])).entries()]
    .map(([id, name]) => ({ id, name }))
  const questionnaires = [...new Map((progress?.rows ?? []).filter(r => (r as any).questionnaire_id)
    .map(r => [(r as any).questionnaire_id, r.questionnaire_name])).entries()]
    .map(([id, name]) => ({ id, name }))

  const toggleSort = (k: typeof sortKey) => { if (sortKey === k) setSortAsc(p => !p); else { setSortKey(k); setSortAsc(true) } }

  const rows = (progress?.rows ?? [])
    .filter(r => !progressSearch || [r.district, r.block, r.village, r.questionnaire_name, r.participant_type_name]
      .join(' ').toLowerCase().includes(progressSearch.toLowerCase()))
    .sort((a, b) => {
      const v = sortKey === 'pct' ? a.pct - b.pct : sortKey === 'remaining' ? a.remaining - b.remaining
        : sortKey === 'status' ? a.status.localeCompare(b.status) : a.district.localeCompare(b.district)
      return sortAsc ? v : -v
    })

  const selectedProg = programs.find(p => p.id === selectedId)

  const Th = ({ k, label }: { k: typeof sortKey; label: string }) => (
    <th className="px-3 py-2.5 text-left text-xs font-semibold text-catalan-textMuted uppercase tracking-wide cursor-pointer hover:text-catalan-text"
      onClick={() => toggleSort(k)}>{label}{sortKey === k ? (sortAsc ? ' ↑' : ' ↓') : ''}</th>
  )

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={getNavItems(user?.role ?? '')} role={user?.role} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav title={selectedId && selectedProg ? selectedProg.name : 'Programs'}
          breadcrumbs={selectedId && selectedProg ? [{ label: 'Programs', onClick: () => { setSelectedId(''); setDetail(null) } }, { label: selectedProg.name }] : [{ label: 'Programs' }]}
          rightContent={
            <div className="flex gap-2 items-center">
              {selectedId ? (
                <>
                  <button onClick={() => { setSelectedId(''); setDetail(null); setProgress(null) }}
                    className="px-3 py-1.5 text-sm border border-catalan-border rounded-lg text-catalan-textMuted hover:bg-catalan-hover">
                    ← All Programs
                  </button>
                  {detail && user?.role && ['supervisor', 'org_admin', 'master_admin'].includes(user.role) && <>
                    <button onClick={() => { const t = token; window.location.href = `${window.location.origin}/analyzer/?fg_url=${encodeURIComponent(window.location.origin)}&program_id=${selectedId}&token=${t}` }}
                      className="px-3 py-1.5 text-sm bg-slate-800 text-white rounded-lg hover:bg-slate-700 active:scale-95 transition-all font-medium shadow-sm">
                      🔬 Analyzer
                    </button>
                    <button onClick={() => { const t = token; window.location.href = `${window.location.origin}/cleaner/?fg_url=${encodeURIComponent(window.location.origin)}&program_id=${selectedId}&token=${t}` }}
                      className="px-3 py-1.5 text-sm bg-slate-800 text-white rounded-lg hover:bg-slate-700 active:scale-95 transition-all font-medium shadow-sm">
                      🧹 Cleaner
                    </button>
                  </>}
                  {detailTab === 'progress' && <>
                    <button disabled={exporting === 'xlsx'} onClick={() => exportProgress('xlsx')}
                      className="px-3 py-1.5 text-sm border border-catalan-border rounded-lg bg-catalan-surface text-catalan-text hover:bg-catalan-hover disabled:opacity-40">
                      {exporting === 'xlsx' ? '…' : '⬇ Excel'}
                    </button>
                    <button disabled={exporting === 'pdf'} onClick={() => exportProgress('pdf')}
                      className="px-3 py-1.5 text-sm border border-catalan-border rounded-lg bg-catalan-surface text-catalan-text hover:bg-catalan-hover disabled:opacity-40">
                      {exporting === 'pdf' ? '…' : '⬇ PDF'}
                    </button>
                  </>}
                </>
              ) : (
                <button onClick={() => { setEditingProg(null); setShowProgModal(true) }}
                  className="px-4 py-1.5 bg-catalan-primary text-catalan-bg rounded-lg text-sm font-medium hover:bg-catalan-primaryDark">
                  + New Program
                </button>
              )}
            </div>
          }
        />

        <main className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto p-6">

            {/* Top-level tabs: Programs / Locations */}
            {!selectedId && (
              <div className="flex gap-1 mb-5 border-b border-catalan-border">
                {(['programs', 'locations'] as const).map(t => (
                  <button key={t} onClick={() => setTopTab(t)}
                    className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
                      topTab === t ? 'border-catalan-primary text-catalan-primary' : 'border-transparent text-catalan-textMuted hover:text-catalan-text'
                    }`}>{t}</button>
                ))}
              </div>
            )}

            {/* ── Program tile grid ── */}
            {topTab === 'programs' && !selectedId && (
              <>
                <input className={`${inputCls} mb-4 max-w-sm`} placeholder="Search by name or scheme…"
                  value={schemeFilter} onChange={e => setSchemeFilter(e.target.value)} />
                {loading ? (
                  <p className="text-center text-catalan-textMuted py-12">Loading…</p>
                ) : filtered.length === 0 ? (
                  <div className="text-center py-16 text-catalan-textMuted">
                    <div className="text-4xl mb-3">🗂️</div>
                    <p className="font-medium text-catalan-text mb-1">No programs yet</p>
                    <p className="text-sm">Create a program to start tracking field data collection.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filtered.map(p => (
                      <div key={p.id} onClick={() => selectProgram(p.id)}
                        className="bg-catalan-surface border border-catalan-border rounded-xl p-5 cursor-pointer hover:border-catalan-primary/60 hover:shadow-md transition-all group">
                        <div className="flex items-start justify-between mb-1">
                          <div className="font-semibold text-catalan-text group-hover:text-catalan-primary transition-colors leading-tight flex-1 min-w-0 pr-2">{p.name}</div>
                          <div className="flex gap-1 flex-shrink-0">
                            {(p.overdue ?? 0) > 0 && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">{p.overdue} overdue</span>}
                            {(p.at_risk ?? 0) > 0 && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{p.at_risk} at risk</span>}
                          </div>
                        </div>
                        {p.scheme_name && <div className="text-xs text-catalan-textMuted mb-1">{p.scheme_name}</div>}
                        {(p.start_date || p.end_date) && (
                          <div className="text-xs text-catalan-textMuted mb-2">📅 {p.start_date ?? '?'} → {p.end_date ?? 'ongoing'}</div>
                        )}
                        <div className="flex justify-between text-xs text-catalan-textMuted mb-1">
                          <span>{p.total_collected.toLocaleString()} / {p.total_target.toLocaleString()} collected</span>
                          <span className={`font-bold ${p.pct >= 100 ? 'text-green-600' : p.pct >= 70 ? 'text-catalan-primary' : p.pct >= 30 ? 'text-amber-600' : 'text-red-500'}`}>{p.pct}%</span>
                        </div>
                        <ProgressBar pct={p.pct} />
                        <div className="mt-3 flex items-center justify-between text-xs">
                          <Badge label={p.status} cls={PROG_STATUS_CLS[p.status] ?? 'bg-gray-100 text-gray-500'} />
                          <span className="text-catalan-primary group-hover:underline">View details →</span>
                        </div>
                        {((p as any).participant_type_count > 0 || (p as any).questionnaire_count > 0) && (
                          <div className="mt-2 flex gap-2 flex-wrap text-[10px] text-catalan-textMuted">
                            {(p as any).participant_type_count > 0 && <span className="bg-catalan-hover rounded px-1.5 py-0.5">👤 {(p as any).participant_type_count} type{(p as any).participant_type_count > 1 ? 's' : ''}</span>}
                            {(p as any).questionnaire_count > 0 && <span className="bg-catalan-hover rounded px-1.5 py-0.5">📋 {(p as any).questionnaire_count} questionnaire{(p as any).questionnaire_count > 1 ? 's' : ''}</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── Locations tab ── */}
            {topTab === 'locations' && !selectedId && (
              <div>
                <div className="flex justify-end mb-3">
                  <button onClick={() => { setEditingLoc(null); setShowLocModal(true) }} className={btnPrimary}>+ Add Location</button>
                </div>
                <div className="bg-catalan-surface border border-catalan-border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-catalan-bg border-b border-catalan-border">
                      <tr>{['State', 'District', 'Block / Taluk', 'Village / GP', ''].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-catalan-border">
                      {locations.map(l => (
                        <tr key={l.id} className="hover:bg-catalan-hover transition-colors">
                          <td className="px-4 py-3 text-catalan-textMuted">{l.state || '—'}</td>
                          <td className="px-4 py-3 font-medium text-catalan-text">{l.district}</td>
                          <td className="px-4 py-3 text-catalan-textMuted">{l.block || '—'}</td>
                          <td className="px-4 py-3 text-catalan-textMuted">{l.village || '—'}</td>
                          <td className="px-4 py-3 text-right">
                            <button onClick={() => { setEditingLoc(l); setShowLocModal(true) }} className="text-catalan-primary hover:underline mr-3 text-xs">Edit</button>
                            <button onClick={() => deleteLocation(l.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                          </td>
                        </tr>
                      ))}
                      {locations.length === 0 && (
                        <tr><td colSpan={5} className="px-4 py-8 text-center text-catalan-textMuted">No locations yet. Add State → District → Block → Village entries.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Program detail ── */}
            {selectedId && (
              <>
                {/* Header card */}
                {selectedProg && (
                  <div className="bg-catalan-surface border border-catalan-border rounded-xl p-5 mb-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-lg font-bold text-catalan-text">{selectedProg.name}</h2>
                          <Badge label={selectedProg.status} cls={PROG_STATUS_CLS[selectedProg.status] ?? 'bg-gray-100 text-gray-500'} />
                        </div>
                        {selectedProg.scheme_name && <p className="text-sm text-catalan-textMuted mt-0.5">{selectedProg.scheme_name}</p>}
                        {selectedProg.description && <p className="text-sm text-catalan-text mt-1">{selectedProg.description}</p>}
                        {(selectedProg.start_date || selectedProg.end_date) && (
                          <p className="text-xs text-catalan-textMuted mt-1">📅 {selectedProg.start_date ?? '?'} → {selectedProg.end_date ?? 'ongoing'}</p>
                        )}
                      </div>
                      <div className="flex gap-2 flex-shrink-0 ml-3">
                        <button onClick={() => { setEditingProg(selectedProg); setShowProgModal(true) }} className={btnSecondary}>Edit</button>
                        <button onClick={() => deleteProgram(selectedProg.id)} className={btnDanger}>Delete</button>
                      </div>
                    </div>
                    {/* Summary metrics */}
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
                      <SummaryCard label="Sample Target" value={selectedProg.total_target.toLocaleString()} />
                      <SummaryCard label="Collected" value={selectedProg.total_collected.toLocaleString()} color="text-catalan-primary" />
                      <SummaryCard label="Remaining" value={Math.max(0, selectedProg.total_target - selectedProg.total_collected).toLocaleString()} color="text-catalan-textMuted" />
                      <SummaryCard label="Complete" value={`${selectedProg.pct}%`} color={selectedProg.pct >= 100 ? 'text-green-600' : 'text-catalan-primary'} />
                      <SummaryCard label="Overdue" value={selectedProg.overdue ?? 0} color={(selectedProg.overdue ?? 0) > 0 ? 'text-red-600' : 'text-catalan-textMuted'} />
                      <SummaryCard label="At Risk" value={selectedProg.at_risk ?? 0} color={(selectedProg.at_risk ?? 0) > 0 ? 'text-amber-600' : 'text-catalan-textMuted'} />
                    </div>
                    <ProgressBar pct={selectedProg.pct} />
                  </div>
                )}

                {/* Detail sub-tabs */}
                <div className="flex gap-1 mb-4 border-b border-catalan-border">
                  {(['progress', 'setup'] as const).map(t => (
                    <button key={t} onClick={() => setDetailTab(t)}
                      className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
                        detailTab === t ? 'border-catalan-primary text-catalan-primary' : 'border-transparent text-catalan-textMuted hover:text-catalan-text'
                      }`}>{t === 'setup' ? '⚙️ Setup' : '📈 Progress'}</button>
                  ))}
                </div>

                {/* Progress tab */}
                {detailTab === 'progress' && (
                  <>
                    {/* Filters */}
                    <div className="bg-catalan-surface border border-catalan-border rounded-xl p-4 mb-4">
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                        <div><label className="text-xs text-catalan-textMuted font-medium">Participant Type</label>
                          <select className={`${inputCls} mt-0.5`} value={progressFilters.participant_type_id}
                            onChange={e => setProgressFilters(p => ({ ...p, participant_type_id: e.target.value }))}>
                            <option value="">— All —</option>
                            {ptypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select></div>
                        <div><label className="text-xs text-catalan-textMuted font-medium">Questionnaire</label>
                          <select className={`${inputCls} mt-0.5`} value={progressFilters.questionnaire_id}
                            onChange={e => setProgressFilters(p => ({ ...p, questionnaire_id: e.target.value }))}>
                            <option value="">— All —</option>
                            {questionnaires.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
                          </select></div>
                        <div><label className="text-xs text-catalan-textMuted font-medium">District</label>
                          <input list="district-opts" className={`${inputCls} mt-0.5`} placeholder="Search…" value={progressFilters.district}
                            onChange={e => setProgressFilters(p => ({ ...p, district: e.target.value }))} />
                          <datalist id="district-opts">
                            {[...new Set((progress?.rows ?? []).map(r => r.district).filter(Boolean))].sort().map(d => <option key={d} value={d} />)}
                          </datalist></div>
                        <div><label className="text-xs text-catalan-textMuted font-medium">Block</label>
                          <input list="block-opts" className={`${inputCls} mt-0.5`} placeholder="Search…" value={progressFilters.block}
                            onChange={e => setProgressFilters(p => ({ ...p, block: e.target.value }))} />
                          <datalist id="block-opts">
                            {[...new Set((progress?.rows ?? []).map(r => r.block).filter(Boolean))].sort().map(b => <option key={b} value={b} />)}
                          </datalist></div>
                        <div><label className="text-xs text-catalan-textMuted font-medium">Status</label>
                          <select className={`${inputCls} mt-0.5`} value={progressFilters.status}
                            onChange={e => setProgressFilters(p => ({ ...p, status: e.target.value }))}>
                            <option value="">— All —</option>
                            {['not_started', 'in_progress', 'at_risk', 'completed', 'overdue'].map(s => (
                              <option key={s} value={s}>{s.replace('_', ' ')}</option>
                            ))}
                          </select></div>
                      </div>
                    </div>

                    {/* Table */}
                    <div className="bg-catalan-surface border border-catalan-border rounded-xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-catalan-border flex items-center gap-3">
                        <input className="flex-1 border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text placeholder:text-catalan-textMuted focus:ring-2 focus:ring-catalan-primary outline-none"
                          placeholder="Search district, block, village, questionnaire…"
                          value={progressSearch} onChange={e => setProgressSearch(e.target.value)} />
                        <span className="text-xs text-catalan-textMuted whitespace-nowrap">{loadingDetail ? 'Loading…' : `${rows.length} row(s)`}</span>
                      </div>
                      {loadingDetail ? (
                        <div className="py-12 text-center text-catalan-textMuted">Loading progress…</div>
                      ) : rows.length === 0 && progress && detail && detail.questionnaires.length > 0 ? (
                        <div className="p-4">
                          <p className="text-xs text-catalan-textMuted mb-3 uppercase tracking-wider font-semibold">Questionnaire Progress</p>
                          <div className="space-y-3">
                            {detail.questionnaires.map(q => (
                              <div key={q.id} className="border border-catalan-border rounded-xl p-4 bg-catalan-surface">
                                <div className="flex items-center justify-between mb-2">
                                  <div>
                                    <span className="font-medium text-sm text-catalan-text">{q.name}</span>
                                    {q.participant_type_name && <span className="ml-2 text-xs text-catalan-textMuted">👤 {q.participant_type_name}</span>}
                                    {q.form_title && <span className="ml-2 text-xs text-catalan-textMuted">📋 {q.form_title}</span>}
                                  </div>
                                  <Badge label={q.status} cls={PROG_BADGE_CLS[q.status] ?? 'bg-gray-100 text-gray-500'} />
                                </div>
                                <div className="flex items-center gap-4 text-xs text-catalan-textMuted mb-1.5">
                                  <span>Target: <strong className="text-catalan-text">{q.total_target.toLocaleString()}</strong></span>
                                  {(q.start_date || q.end_date) && <span>📅 {q.start_date ?? '?'} → {q.end_date ?? 'ongoing'}</span>}
                                </div>
                                <ProgressBar pct={q.total_target > 0 ? 0 : 0} />
                                <p className="text-xs text-catalan-textMuted mt-2">Add location targets in ⚙️ Setup to track per-location progress.</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : rows.length === 0 && progress ? (
                        <div className="py-10 text-center text-catalan-textMuted">
                          <div className="text-3xl mb-3">📍</div>
                          <p className="font-medium text-catalan-text mb-1">No questionnaires configured yet</p>
                          <p className="text-sm max-w-md mx-auto">Switch to <strong>⚙️ Setup</strong> → add questionnaires and location targets to track progress.</p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-catalan-bg border-b border-catalan-border">
                              <tr>
                                <th className="px-3 py-2.5 text-left text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Questionnaire</th>
                                <th className="px-3 py-2.5 text-left text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Type</th>
                                <Th k="district" label="District" />
                                <th className="px-3 py-2.5 text-left text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Block</th>
                                <th className="px-3 py-2.5 text-left text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Village</th>
                                <Th k="remaining" label="Target" />
                                <th className="px-3 py-2.5 text-center text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Collected</th>
                                <Th k="pct" label="%" />
                                <th className="px-3 py-2.5 text-left text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Progress</th>
                                <Th k="status" label="Status" />
                                <th className="px-3 py-2.5 text-left text-xs font-semibold text-catalan-textMuted uppercase tracking-wide">Deadline</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-catalan-border">
                              {rows.map(r => (
                                <tr key={r.target_id} className={`hover:bg-catalan-hover transition-colors ${PROG_ROW_CLS[r.status] ?? ''}`}>
                                  <td className="px-3 py-2.5 font-medium text-catalan-text">{r.questionnaire_name}</td>
                                  <td className="px-3 py-2.5 text-catalan-textMuted">{r.participant_type_name || '—'}</td>
                                  <td className="px-3 py-2.5 text-catalan-text">{r.district}</td>
                                  <td className="px-3 py-2.5 text-catalan-textMuted">{r.block || '—'}</td>
                                  <td className="px-3 py-2.5 text-catalan-textMuted">{r.village || '—'}</td>
                                  <td className="px-3 py-2.5 text-center font-medium text-catalan-text">{r.target}</td>
                                  <td className="px-3 py-2.5 text-center text-catalan-primary font-medium">{r.collected}</td>
                                  <td className="px-3 py-2.5 text-center font-bold">{r.pct}%</td>
                                  <td className="px-3 py-2.5 w-24"><ProgressBar pct={r.pct} size="sm" /></td>
                                  <td className="px-3 py-2.5"><Badge label={r.status.replace('_', ' ')} cls={PROG_BADGE_CLS[r.status] ?? 'bg-gray-100 text-gray-500'} /></td>
                                  <td className="px-3 py-2.5 text-xs">
                                    {r.deadline ? (
                                      <span className={r.days_remaining !== null && r.days_remaining < 0 ? 'text-red-600 font-medium' : r.days_remaining !== null && r.days_remaining <= 7 ? 'text-amber-600' : 'text-catalan-textMuted'}>
                                        {r.deadline}{r.days_remaining !== null && <span> ({r.days_remaining < 0 ? `${Math.abs(r.days_remaining)}d late` : `${r.days_remaining}d left`})</span>}
                                      </span>
                                    ) : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Setup tab */}
                {detailTab === 'setup' && detail && (
                  <div className="bg-catalan-surface border border-catalan-border rounded-xl p-5">
                    <SetupPanel prog={detail} locations={locations} forms={forms}
                      onRefresh={() => loadDetail(selectedId)} />
                  </div>
                )}
                {detailTab === 'setup' && loadingDetail && !detail && (
                  <p className="text-center text-catalan-textMuted py-8">Loading…</p>
                )}
              </>
            )}

          </div>
        </main>
      </div>

      {showProgModal && <ProgramModal initial={editingProg ?? undefined} onSave={saveProgram} onClose={() => { setShowProgModal(false); setEditingProg(null) }} />}
      {showLocModal && <LocationModal initial={editingLoc ?? undefined} onSave={saveLocation} onClose={() => { setShowLocModal(false); setEditingLoc(null) }} />}
    </div>
  )
}
