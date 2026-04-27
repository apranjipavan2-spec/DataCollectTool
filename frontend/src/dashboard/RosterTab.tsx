import React, { useState, useEffect } from 'react'
import api from '@/lib/api'
import { Button, Card } from '@/components/ui'
import { useToast } from '@/lib/ToastContext'

interface RosterEntry {
  id: string
  form_id: string
  name: string
  phone: string | null
  address: string | null
  target_enumerator_id: string | null
  status: string
  scheduled_date: string | null
  notes: string | null
  location_id: string | null
  location_name: string | null
  created_at: string | null
}

interface Form { id: string; title: string }
interface TeamMember { id: string; name: string; role: string }

interface LocationOption {
  id: string
  name: string
  type: string
  parent_id: string | null
}

interface LocationNode {
  id: string
  name: string
  type: string
  parent_id: string | null
  children: LocationNode[]
}

const STATUS_COLORS: Record<string, string> = {
  pending:   'text-catalan-textMuted bg-catalan-textMuted/10',
  visited:   'text-catalan-primary bg-catalan-primary/10',
  completed: 'text-catalan-success bg-catalan-success/10',
  refused:   'text-catalan-error bg-catalan-error/10',
}

export default function RosterTab({ forms: rawForms, team: rawTeam }: { forms: Form[]; team: TeamMember[] }) {
  const forms = Array.isArray(rawForms) ? rawForms : []
  const team = Array.isArray(rawTeam) ? rawTeam : []
  const toast = useToast()
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [filterForm, setFilterForm] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newEntry, setNewEntry] = useState({
    form_id: '', name: '', phone: '', address: '',
    target_enumerator_id: '', scheduled_date: '', notes: '',
  })
  const [csvFormId, setCsvFormId] = useState('')
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvUploading, setCsvUploading] = useState(false)
  const [csvResult, setCsvResult] = useState<string>('')
  const [filterDistrict, setFilterDistrict] = useState('')
  const [filterTaluka, setFilterTaluka] = useState('')
  const [districts, setDistricts] = useState<LocationOption[]>([])
  const [talukas, setTalukas] = useState<LocationOption[]>([])
  const [locationTree, setLocationTree] = useState<LocationNode[]>([])
  const [showTree, setShowTree] = useState(false)

  const enumerators = team.filter(u => u.role === 'enumerator')

  useEffect(() => {
    api.get('/locations?type=district').then(({ data }) => setDistricts(data)).catch(() => {})
    api.get('/locations/tree').then(({ data }) => setLocationTree(data)).catch(() => {})
  }, [])

  const handleDistrictFilter = async (districtId: string) => {
    setFilterDistrict(districtId)
    setFilterTaluka('')
    setTalukas([])
    if (districtId) {
      try {
        const { data } = await api.get(`/locations?parent_id=${districtId}`)
        setTalukas(data)
      } catch {}
    }
  }

  const handleCsvUpload = async () => {
    if (!csvFormId) { toast.warning('Select a form first'); return }
    if (!csvFile) { toast.warning('Select a file first'); return }
    setCsvUploading(true)
    setCsvResult('')
    try {
      const fd = new FormData()
      fd.append('file', csvFile)
      const { data } = await api.post(`/roster/upload-csv?form_id=${csvFormId}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const msg = `Created ${data.created} beneficiaries, skipped ${data.skipped}${data.errors?.length ? `, ${data.errors.length} error(s)` : ''}`
      setCsvResult(msg)
      toast.success(msg)
      setCsvFile(null)
      load()
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Upload failed')
    } finally {
      setCsvUploading(false)
    }
  }

  const handleTemplateDownload = () => {
    const csv = 'name,phone,address,district,taluka,village,enumerator_phone,scheduled_date,notes\nJohn Doe,+910000000000,123 Main St,Pune,Haveli,Lohegaon,,2026-05-01,\n'
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'beneficiary_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const load = async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (filterForm) params.form_id = filterForm
      if (filterStatus) params.status = filterStatus
      const { data } = await api.get('/roster/', { params })
      setRoster(Array.isArray(data) ? data : (data?.items ?? data?.results ?? []))
    } catch {
      toast.error('Failed to load roster')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filterForm, filterStatus])

  const filteredRoster = roster.filter(r => {
    if (filterTaluka && r.location_id !== filterTaluka) return false
    if (!filterTaluka && filterDistrict) {
      return talukas.length === 0 || talukas.some(t => t.id === r.location_id)
    }
    return true
  })

  const handleAdd = async () => {
    if (!newEntry.form_id || !newEntry.name) {
      toast.warning('Form and name are required')
      return
    }
    setSaving(true)
    try {
      const { data } = await api.post('/roster/', {
        ...newEntry,
        target_enumerator_id: newEntry.target_enumerator_id || undefined,
        scheduled_date: newEntry.scheduled_date || undefined,
      })
      setRoster(r => [data, ...r])
      setNewEntry({ form_id: '', name: '', phone: '', address: '', target_enumerator_id: '', scheduled_date: '', notes: '' })
      setShowAddForm(false)
      toast.success('Respondent added')
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Failed to add respondent')
    } finally {
      setSaving(false)
    }
  }

  const handleStatusChange = async (id: string, status: string) => {
    try {
      const { data } = await api.patch(`/roster/${id}`, { status })
      setRoster(r => r.map(x => x.id === id ? data : x))
    } catch {
      toast.error('Failed to update status')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this respondent?')) return
    try {
      await api.delete(`/roster/${id}`)
      setRoster(r => r.filter(x => x.id !== id))
      toast.success('Deleted')
    } catch {
      toast.error('Failed to delete')
    }
  }

  const getEnumeratorName = (id: string | null) => {
    if (!id) return '—'
    return team.find(u => u.id === id)?.name ?? id.slice(0, 8) + '…'
  }

  const getFormTitle = (id: string) => forms.find(f => f.id === id)?.title ?? '—'

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-6 p-4 bg-catalan-hover rounded-lg border border-catalan-border space-y-3">
          <h3 className="text-sm font-semibold text-catalan-text">📂 Upload Beneficiary CSV</h3>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-catalan-textMuted block mb-1">Form *</label>
              <select
                value={csvFormId}
                onChange={e => setCsvFormId(e.target.value)}
                className="bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
              >
                <option value="">Select form…</option>
                {forms.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-catalan-textMuted block mb-1">File (.csv or .xlsx)</label>
              <input
                type="file"
                accept=".csv,.xlsx"
                onChange={e => setCsvFile(e.target.files?.[0] ?? null)}
                className="text-sm text-catalan-text file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-catalan-primary/10 file:text-catalan-primary file:text-xs file:font-medium hover:file:bg-catalan-primary/20 cursor-pointer"
              />
            </div>
            <Button variant="primary" size="sm" onClick={handleCsvUpload} disabled={csvUploading}>
              {csvUploading ? 'Uploading…' : 'Upload'}
            </Button>
            <button
              onClick={handleTemplateDownload}
              className="text-xs px-3 py-2 rounded-lg border border-catalan-border text-catalan-textMuted hover:text-catalan-primary hover:border-catalan-primary/50 transition-colors"
            >
              ⬇ CSV Template
            </button>
          </div>
          {csvResult && (
            <p className="text-xs text-catalan-success">{csvResult}</p>
          )}
        </div>

        {districts.length > 0 && (
          <div className="mb-4 p-3 bg-catalan-hover rounded-lg border border-catalan-border">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex items-center gap-2 text-xs font-medium text-catalan-textMuted">
                📍 Location
              </div>
              <div>
                <select
                  value={filterDistrict}
                  onChange={e => handleDistrictFilter(e.target.value)}
                  className="bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                >
                  <option value="">All Districts</option>
                  {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              {talukas.length > 0 && (
                <div>
                  <select
                    value={filterTaluka}
                    onChange={e => setFilterTaluka(e.target.value)}
                    className="bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                  >
                    <option value="">All Talukas</option>
                    {talukas.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}
              <button
                onClick={() => setShowTree(v => !v)}
                className="text-xs px-3 py-2 rounded-lg border border-catalan-border text-catalan-textMuted hover:text-catalan-primary hover:border-catalan-primary/50 transition-colors"
              >
                {showTree ? 'Hide Tree' : 'Location Tree'}
              </button>
            </div>
            {showTree && locationTree.length > 0 && (
              <div className="mt-3 pt-3 border-t border-catalan-border space-y-1">
                {locationTree.map(district => (
                  <div key={district.id}>
                    <div className="text-xs font-semibold text-catalan-text">📍 {district.name}</div>
                    {district.children.map(taluka => (
                      <div key={taluka.id} className="ml-4">
                        <div className="text-xs text-catalan-textMuted">↳ {taluka.name}</div>
                        {taluka.children.map(village => (
                          <div key={village.id} className="ml-4 text-xs text-catalan-textMuted/70">· {village.name}</div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-3 items-end mb-4">
          <div>
            <label className="text-xs text-catalan-textMuted block mb-1">Form</label>
            <select
              value={filterForm}
              onChange={e => setFilterForm(e.target.value)}
              className="bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
            >
              <option value="">All forms</option>
              {forms.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-catalan-textMuted block mb-1">Status</label>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
            >
              <option value="">All statuses</option>
              {['pending', 'visited', 'completed', 'refused'].map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
          <Button variant="primary" size="sm" onClick={() => setShowAddForm(v => !v)} className="ml-auto">
            {showAddForm ? 'Cancel' : '+ Add Respondent'}
          </Button>
        </div>

        {showAddForm && (
          <div className="mb-6 p-4 bg-catalan-hover rounded-lg border border-catalan-border space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-catalan-textMuted block mb-1">Form *</label>
                <select
                  value={newEntry.form_id}
                  onChange={e => setNewEntry(n => ({ ...n, form_id: e.target.value }))}
                  className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                >
                  <option value="">Select form…</option>
                  {forms.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-catalan-textMuted block mb-1">Name *</label>
                <input
                  value={newEntry.name}
                  onChange={e => setNewEntry(n => ({ ...n, name: e.target.value }))}
                  placeholder="Respondent name"
                  className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                />
              </div>
              <div>
                <label className="text-xs text-catalan-textMuted block mb-1">Phone</label>
                <input
                  value={newEntry.phone}
                  onChange={e => setNewEntry(n => ({ ...n, phone: e.target.value }))}
                  placeholder="+91…"
                  className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                />
              </div>
              <div>
                <label className="text-xs text-catalan-textMuted block mb-1">Assign Enumerator</label>
                <select
                  value={newEntry.target_enumerator_id}
                  onChange={e => setNewEntry(n => ({ ...n, target_enumerator_id: e.target.value }))}
                  className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                >
                  <option value="">— Unassigned —</option>
                  {enumerators.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-catalan-textMuted block mb-1">Scheduled Date</label>
                <input
                  type="date"
                  value={newEntry.scheduled_date}
                  onChange={e => setNewEntry(n => ({ ...n, scheduled_date: e.target.value }))}
                  className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                />
              </div>
              <div>
                <label className="text-xs text-catalan-textMuted block mb-1">Address</label>
                <input
                  value={newEntry.address}
                  onChange={e => setNewEntry(n => ({ ...n, address: e.target.value }))}
                  placeholder="Village / area"
                  className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text focus:outline-none focus:border-catalan-primary"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="primary" size="sm" onClick={handleAdd} disabled={saving}>
                {saving ? 'Saving…' : 'Add Respondent'}
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-catalan-textMuted py-8 text-center">Loading…</div>
        ) : filteredRoster.length === 0 ? (
          <div className="text-sm text-catalan-textMuted text-center py-8">No respondents found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead>
                <tr className="border-b border-catalan-border">
                  {['Name', 'Phone', 'Form', 'Location', 'Enumerator', 'Date', 'Status', 'Actions'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-xs font-medium text-catalan-textMuted uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRoster.map(r => (
                  <tr key={r.id} className="border-b border-catalan-border hover:bg-catalan-hover transition-colors">
                    <td className="px-3 py-2 font-medium text-catalan-text">{r.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-catalan-textMuted">{r.phone ?? '—'}</td>
                    <td className="px-3 py-2 text-catalan-textMuted text-xs">{getFormTitle(r.form_id)}</td>
                    <td className="px-3 py-2 text-catalan-textMuted text-xs">{r.location_name ?? '—'}</td>
                    <td className="px-3 py-2 text-catalan-textMuted text-xs">{getEnumeratorName(r.target_enumerator_id)}</td>
                    <td className="px-3 py-2 text-catalan-textMuted text-xs">{r.scheduled_date ?? '—'}</td>
                    <td className="px-3 py-2">
                      <select
                        value={r.status}
                        onChange={e => handleStatusChange(r.id, e.target.value)}
                        className={`text-xs px-2 py-1 rounded font-medium border-0 focus:outline-none cursor-pointer ${STATUS_COLORS[r.status] ?? 'text-catalan-textMuted'}`}
                      >
                        {['pending', 'visited', 'completed', 'refused'].map(s => (
                          <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => handleDelete(r.id)}
                        className="text-xs px-2 py-1 rounded border border-catalan-error/30 text-catalan-error hover:bg-catalan-error/10 transition-colors"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
