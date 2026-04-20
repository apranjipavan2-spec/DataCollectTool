import { useState, useEffect, useCallback } from 'react'
import api, { getStoredUser } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import { getNavItems } from '@/lib/navigation'
import { useToast } from '@/lib/ToastContext'

// ── Types ────────────────────────────────────────────────────────────────────

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
  start_date: string | null; end_date: string | null; total_target: number; total_collected: number; pct: number
}
interface ProgramDetail extends Program {
  participant_types: ParticipantType[]
  questionnaires: Questionnaire[]
}
interface Form { id: string; title: string }

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-700', planning: 'bg-blue-100 text-blue-700',
  completed: 'bg-gray-100 text-gray-600', archived: 'bg-red-100 text-red-500',
}

function Badge({ s }: { s: string }) {
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[s] ?? 'bg-gray-100 text-gray-600'}`}>{s}</span>
}

function ProgressBar({ pct }: { pct: number }) {
  const color = pct >= 100 ? 'bg-green-500' : pct >= 70 ? 'bg-blue-500' : pct >= 30 ? 'bg-yellow-400' : 'bg-red-400'
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
      <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

// ── Modal: Program form ───────────────────────────────────────────────────────

function ProgramModal({ initial, onSave, onClose }: {
  initial?: Partial<Program>; onSave: (d: any) => Promise<void>; onClose: () => void
}) {
  const [d, setD] = useState({ name: '', scheme_name: '', description: '', status: 'active', start_date: '', end_date: '', ...initial })
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setD(p => ({ ...p, [k]: v }))

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-4">{initial?.id ? 'Edit Program' : 'New Program'}</h2>
        <div className="space-y-3">
          <div><label className="text-sm font-medium">Program Name *</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm mt-1" value={d.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Karnataka Road Survey 2024" /></div>
          <div><label className="text-sm font-medium">Scheme</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm mt-1" value={d.scheme_name} onChange={e => set('scheme_name', e.target.value)} placeholder="e.g. PMGSY, MGNREGS" /></div>
          <div><label className="text-sm font-medium">Description</label>
            <textarea className="w-full border rounded-lg px-3 py-2 text-sm mt-1" rows={2} value={d.description} onChange={e => set('description', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-sm font-medium">Start Date</label>
              <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm mt-1" value={d.start_date || ''} onChange={e => set('start_date', e.target.value)} /></div>
            <div><label className="text-sm font-medium">End Date</label>
              <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm mt-1" value={d.end_date || ''} onChange={e => set('end_date', e.target.value)} /></div>
          </div>
          <div><label className="text-sm font-medium">Status</label>
            <select className="w-full border rounded-lg px-3 py-2 text-sm mt-1" value={d.status} onChange={e => set('status', e.target.value)}>
              {['planning', 'active', 'completed', 'archived'].map(s => <option key={s} value={s}>{s}</option>)}
            </select></div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
          <button disabled={!d.name || saving} onClick={async () => { setSaving(true); await onSave(d).finally(() => setSaving(false)) }}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal: Location form ──────────────────────────────────────────────────────

function LocationModal({ initial, onSave, onClose }: {
  initial?: Partial<Location>; onSave: (d: any) => Promise<void>; onClose: () => void
}) {
  const [d, setD] = useState({ state: '', district: '', block: '', village: '', ...initial })
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setD(p => ({ ...p, [k]: v }))
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold mb-4">{initial?.id ? 'Edit Location' : 'Add Location'}</h2>
        <div className="space-y-3">
          {[['state', 'State'], ['district', 'District *'], ['block', 'Block / Taluk'], ['village', 'Village / GP']].map(([k, label]) => (
            <div key={k}><label className="text-sm font-medium">{label}</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm mt-1" value={(d as any)[k]} onChange={e => set(k, e.target.value)} /></div>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
          <button disabled={!d.district || saving} onClick={async () => { setSaving(true); await onSave(d).finally(() => setSaving(false)) }}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Program Detail Panel ──────────────────────────────────────────────────────

function ProgramDetail({ prog, locations, forms, onRefresh }: {
  prog: ProgramDetail; locations: Location[]; forms: Form[]
  onRefresh: () => void
}) {
  const [addingType, setAddingType] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [addingQ, setAddingQ] = useState(false)
  const [newQ, setNewQ] = useState({ name: '', participant_type_id: '', form_id: '', total_target: 0, start_date: '', end_date: '' })
  const [expandedQ, setExpandedQ] = useState<string | null>(null)
  const [addingTarget, setAddingTarget] = useState<string | null>(null)
  const [newTarget, setNewTarget] = useState({ location_id: '', target_count: 0, deadline: '' })

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
      ...newQ,
      total_target: Number(newQ.total_target),
      participant_type_id: newQ.participant_type_id || null,
      form_id: newQ.form_id || null,
      start_date: newQ.start_date || null,
      end_date: newQ.end_date || null,
    })
    setAddingQ(false); setNewQ({ name: '', participant_type_id: '', form_id: '', total_target: 0, start_date: '', end_date: '' }); onRefresh()
  }

  const delQ = async (id: string) => {
    if (!confirm('Delete questionnaire?')) return
    await api.delete(`/programs/${prog.id}/questionnaires/${id}`); onRefresh()
  }

  const addTarget = async (qId: string) => {
    await api.post(`/programs/${prog.id}/questionnaires/${qId}/targets`, {
      location_id: newTarget.location_id,
      target_count: Number(newTarget.target_count),
      deadline: newTarget.deadline || null,
    })
    setAddingTarget(null); setNewTarget({ location_id: '', target_count: 0, deadline: '' }); onRefresh()
  }

  const delTarget = async (qId: string, tId: string) => {
    await api.delete(`/programs/${prog.id}/questionnaires/${qId}/targets/${tId}`); onRefresh()
  }

  const locMap = Object.fromEntries(locations.map(l => [l.id, l]))

  return (
    <div className="space-y-6">
      {/* Participant Types */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm text-gray-700 uppercase tracking-wide">Participant Types</h3>
          <button onClick={() => setAddingType(true)} className="text-xs text-blue-600 hover:underline">+ Add</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {prog.participant_types.map(t => (
            <span key={t.id} className="flex items-center gap-1 px-3 py-1 bg-blue-50 text-blue-800 rounded-full text-sm">
              {t.name}
              <button onClick={() => delType(t.id)} className="text-blue-400 hover:text-red-500 ml-1">×</button>
            </span>
          ))}
          {prog.participant_types.length === 0 && <span className="text-sm text-gray-400">No types yet</span>}
        </div>
        {addingType && (
          <div className="flex gap-2 mt-2">
            <input autoFocus className="border rounded-lg px-3 py-1.5 text-sm flex-1"
              placeholder="e.g. Beneficiary, Non-Beneficiary…" value={newTypeName}
              onChange={e => setNewTypeName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addType(); if (e.key === 'Escape') setAddingType(false) }} />
            <button onClick={addType} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg">Add</button>
            <button onClick={() => setAddingType(false)} className="px-3 py-1.5 border text-sm rounded-lg">Cancel</button>
          </div>
        )}
      </div>

      {/* Questionnaires */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm text-gray-700 uppercase tracking-wide">Questionnaires</h3>
          <button onClick={() => setAddingQ(true)} className="text-xs text-blue-600 hover:underline">+ Add</button>
        </div>

        {addingQ && (
          <div className="border rounded-xl p-4 mb-3 bg-blue-50 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-medium text-gray-600">Name *</label>
                <input className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" value={newQ.name}
                  onChange={e => setNewQ(p => ({ ...p, name: e.target.value }))} placeholder="Household Survey" /></div>
              <div><label className="text-xs font-medium text-gray-600">Participant Type</label>
                <select className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" value={newQ.participant_type_id}
                  onChange={e => setNewQ(p => ({ ...p, participant_type_id: e.target.value }))}>
                  <option value="">— Any —</option>
                  {prog.participant_types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select></div>
              <div><label className="text-xs font-medium text-gray-600">Form / Questionnaire</label>
                <select className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" value={newQ.form_id}
                  onChange={e => setNewQ(p => ({ ...p, form_id: e.target.value }))}>
                  <option value="">— None —</option>
                  {forms.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
                </select></div>
              <div><label className="text-xs font-medium text-gray-600">Total Target</label>
                <input type="number" min={0} className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5"
                  value={newQ.total_target} onChange={e => setNewQ(p => ({ ...p, total_target: +e.target.value }))} /></div>
              <div><label className="text-xs font-medium text-gray-600">Start Date</label>
                <input type="date" className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" value={newQ.start_date}
                  onChange={e => setNewQ(p => ({ ...p, start_date: e.target.value }))} /></div>
              <div><label className="text-xs font-medium text-gray-600">End Date</label>
                <input type="date" className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" value={newQ.end_date}
                  onChange={e => setNewQ(p => ({ ...p, end_date: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2">
              <button disabled={!newQ.name} onClick={addQuestionnaire} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg disabled:opacity-50">Add</button>
              <button onClick={() => setAddingQ(false)} className="px-3 py-1.5 border text-sm rounded-lg bg-white">Cancel</button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {prog.questionnaires.map(q => (
            <div key={q.id} className="border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50"
                onClick={() => setExpandedQ(expandedQ === q.id ? null : q.id)}>
                <div>
                  <div className="font-medium text-sm">{q.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {q.participant_type_name && <span className="mr-2">👤 {q.participant_type_name}</span>}
                    {q.form_title && <span className="mr-2">📋 {q.form_title}</span>}
                    <span>Target: {q.total_target}</span>
                    {q.location_targets.length > 0 && <span className="ml-2">· {q.location_targets.length} location(s)</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge s={q.status} />
                  <button onClick={e => { e.stopPropagation(); delQ(q.id) }} className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                  <span className="text-gray-400 text-sm">{expandedQ === q.id ? '▲' : '▼'}</span>
                </div>
              </div>

              {expandedQ === q.id && (
                <div className="px-4 pb-4 bg-gray-50 border-t">
                  <div className="flex items-center justify-between my-2">
                    <span className="text-xs font-medium text-gray-600 uppercase">Location Targets</span>
                    <button onClick={() => setAddingTarget(q.id)} className="text-xs text-blue-600 hover:underline">+ Add Location</button>
                  </div>

                  {addingTarget === q.id && (
                    <div className="flex gap-2 mb-2 flex-wrap">
                      <select className="border rounded-lg px-2 py-1.5 text-sm flex-1 min-w-48"
                        value={newTarget.location_id} onChange={e => setNewTarget(p => ({ ...p, location_id: e.target.value }))}>
                        <option value="">— Select Location —</option>
                        {locations.map(l => <option key={l.id} value={l.id}>{[l.district, l.block, l.village].filter(Boolean).join(' › ')}</option>)}
                      </select>
                      <input type="number" min={0} className="border rounded-lg px-2 py-1.5 text-sm w-24"
                        placeholder="Target" value={newTarget.target_count}
                        onChange={e => setNewTarget(p => ({ ...p, target_count: +e.target.value }))} />
                      <input type="date" className="border rounded-lg px-2 py-1.5 text-sm"
                        value={newTarget.deadline} onChange={e => setNewTarget(p => ({ ...p, deadline: e.target.value }))} />
                      <button disabled={!newTarget.location_id} onClick={() => addTarget(q.id)} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg disabled:opacity-50">Add</button>
                      <button onClick={() => setAddingTarget(null)} className="px-3 py-1.5 border text-sm rounded-lg bg-white">✕</button>
                    </div>
                  )}

                  <div className="space-y-1">
                    {q.location_targets.map(t => {
                      const loc = locMap[t.location_id]
                      return (
                        <div key={t.id} className="flex items-center justify-between py-1.5 px-2 bg-white rounded-lg border text-sm">
                          <span className="text-gray-700">{loc ? [loc.district, loc.block, loc.village].filter(Boolean).join(' › ') : t.location_id}</span>
                          <div className="flex items-center gap-3 text-gray-500 text-xs">
                            <span>Target: <strong>{t.target_count}</strong></span>
                            {t.deadline && <span>Due: {t.deadline}</span>}
                            <button onClick={() => delTarget(q.id, t.id)} className="text-gray-300 hover:text-red-500 text-base leading-none">×</button>
                          </div>
                        </div>
                      )
                    })}
                    {q.location_targets.length === 0 && <p className="text-xs text-gray-400 py-2">No location targets set</p>}
                  </div>
                </div>
              )}
            </div>
          ))}
          {prog.questionnaires.length === 0 && <p className="text-sm text-gray-400">No questionnaires yet</p>}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ProgramsPage() {
  const user = getStoredUser()
  const toast = useToast()
  const [tab, setTab] = useState<'programs' | 'locations'>('programs')
  const [programs, setPrograms] = useState<Program[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [forms, setForms] = useState<Form[]>([])
  const [selectedProg, setSelectedProg] = useState<ProgramDetail | null>(null)
  const [showProgModal, setShowProgModal] = useState(false)
  const [editingProg, setEditingProg] = useState<Program | null>(null)
  const [showLocModal, setShowLocModal] = useState(false)
  const [editingLoc, setEditingLoc] = useState<Location | null>(null)
  const [loading, setLoading] = useState(true)
  const [schemeFilter, setSchemeFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pr, lo, fo] = await Promise.all([
        api.get('/programs/').then(r => r.data),
        api.get('/programs/locations').then(r => r.data),
        api.get('/forms/').then(r => r.data),
      ])
      setPrograms(pr); setLocations(lo); setForms(fo)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const loadDetail = async (id: string) => {
    const { data } = await api.get(`/programs/${id}`)
    setSelectedProg(data)
  }

  const saveProgram = async (d: any) => {
    if (editingProg?.id) {
      await api.patch(`/programs/${editingProg.id}`, d)
    } else {
      await api.post('/programs/', d)
    }
    setShowProgModal(false); setEditingProg(null); await load()
    toast.success('Program saved')
  }

  const deleteProgram = async (id: string) => {
    if (!confirm('Delete this program and all its data?')) return
    await api.delete(`/programs/${id}`)
    setSelectedProg(null); await load()
    toast.success('Program deleted')
  }

  const saveLocation = async (d: any) => {
    if (editingLoc?.id) await api.patch(`/programs/locations/${editingLoc.id}`, d)
    else await api.post('/programs/locations', d)
    setShowLocModal(false); setEditingLoc(null); await load()
    toast.success('Location saved')
  }

  const deleteLocation = async (id: string) => {
    if (!confirm('Delete location?')) return
    await api.delete(`/programs/locations/${id}`); await load()
  }

  const filtered = programs.filter(p => !schemeFilter || p.scheme_name.toLowerCase().includes(schemeFilter.toLowerCase()) || p.name.toLowerCase().includes(schemeFilter.toLowerCase()))

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar items={getNavItems(user?.role ?? '')} />
      <div className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Programs</h1>
              <p className="text-sm text-gray-500 mt-0.5">Manage research programs, participant types, and collection targets</p>
            </div>
            <button onClick={() => { setEditingProg(null); setShowProgModal(true) }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              + New Program
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-6 border-b">
            {(['programs', 'locations'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${tab === t ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {t}
              </button>
            ))}
          </div>

          {tab === 'programs' && (
            <div className="flex gap-6">
              {/* Program list */}
              <div className="w-80 shrink-0 space-y-2">
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Search by name or scheme…"
                  value={schemeFilter} onChange={e => setSchemeFilter(e.target.value)} />
                {loading ? <p className="text-sm text-gray-400 py-4 text-center">Loading…</p> : filtered.map(p => (
                  <div key={p.id}
                    className={`border rounded-xl p-3 cursor-pointer transition-all hover:border-blue-300 ${selectedProg?.id === p.id ? 'border-blue-500 bg-blue-50' : 'bg-white'}`}
                    onClick={() => loadDetail(p.id)}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{p.name}</div>
                        {p.scheme_name && <div className="text-xs text-gray-500 truncate">{p.scheme_name}</div>}
                      </div>
                      <Badge s={p.status} />
                    </div>
                    <div className="mt-2 text-xs text-gray-500">{p.total_collected}/{p.total_target} collected</div>
                    <ProgressBar pct={p.pct} />
                  </div>
                ))}
                {!loading && filtered.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No programs yet</p>}
              </div>

              {/* Program detail */}
              <div className="flex-1 bg-white border rounded-xl p-5">
                {selectedProg ? (
                  <>
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h2 className="text-lg font-bold">{selectedProg.name}</h2>
                        {selectedProg.scheme_name && <p className="text-sm text-gray-500">Scheme: {selectedProg.scheme_name}</p>}
                        {selectedProg.description && <p className="text-sm text-gray-600 mt-1">{selectedProg.description}</p>}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => { setEditingProg(selectedProg); setShowProgModal(true) }}
                          className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">Edit</button>
                        <button onClick={() => deleteProgram(selectedProg.id)}
                          className="px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50">Delete</button>
                      </div>
                    </div>
                    <ProgramDetail prog={selectedProg} locations={locations} forms={forms}
                      onRefresh={() => loadDetail(selectedProg.id)} />
                  </>
                ) : (
                  <div className="flex items-center justify-center h-64 text-gray-400">
                    <div className="text-center">
                      <div className="text-4xl mb-2">📊</div>
                      <p>Select a program to manage its details</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'locations' && (
            <div>
              <div className="flex justify-end mb-3">
                <button onClick={() => { setEditingLoc(null); setShowLocModal(true) }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">+ Add Location</button>
              </div>
              <div className="bg-white border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>{['State', 'District', 'Block / Taluk', 'Village / GP', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {locations.map(l => (
                      <tr key={l.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-500">{l.state || '—'}</td>
                        <td className="px-4 py-3 font-medium">{l.district}</td>
                        <td className="px-4 py-3 text-gray-600">{l.block || '—'}</td>
                        <td className="px-4 py-3 text-gray-600">{l.village || '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => { setEditingLoc(l); setShowLocModal(true) }} className="text-blue-500 hover:underline mr-3 text-xs">Edit</button>
                          <button onClick={() => deleteLocation(l.id)} className="text-red-400 hover:text-red-600 text-xs">Delete</button>
                        </td>
                      </tr>
                    ))}
                    {locations.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No locations yet. Add State → District → Block → Village entries.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {showProgModal && <ProgramModal initial={editingProg ?? undefined} onSave={saveProgram} onClose={() => { setShowProgModal(false); setEditingProg(null) }} />}
      {showLocModal && <LocationModal initial={editingLoc ?? undefined} onSave={saveLocation} onClose={() => { setShowLocModal(false); setEditingLoc(null) }} />}
    </div>
  )
}
