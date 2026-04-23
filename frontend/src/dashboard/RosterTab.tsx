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
  created_at: string | null
}

interface Form { id: string; title: string }
interface TeamMember { id: string; name: string; role: string }

const STATUS_COLORS: Record<string, string> = {
  pending:   'text-catalan-textMuted bg-catalan-textMuted/10',
  visited:   'text-catalan-primary bg-catalan-primary/10',
  completed: 'text-catalan-success bg-catalan-success/10',
  refused:   'text-catalan-error bg-catalan-error/10',
}

export default function RosterTab({ forms, team }: { forms: Form[]; team: TeamMember[] }) {
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

  const enumerators = team.filter(u => u.role === 'enumerator')

  const load = async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (filterForm) params.form_id = filterForm
      if (filterStatus) params.status = filterStatus
      const { data } = await api.get('/roster/', { params })
      setRoster(data)
    } catch {
      toast.error('Failed to load roster')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filterForm, filterStatus])

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
        ) : roster.length === 0 ? (
          <div className="text-sm text-catalan-textMuted text-center py-8">No respondents found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead>
                <tr className="border-b border-catalan-border">
                  {['Name', 'Phone', 'Form', 'Enumerator', 'Date', 'Status', 'Actions'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-xs font-medium text-catalan-textMuted uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roster.map(r => (
                  <tr key={r.id} className="border-b border-catalan-border hover:bg-catalan-hover transition-colors">
                    <td className="px-3 py-2 font-medium text-catalan-text">{r.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-catalan-textMuted">{r.phone ?? '—'}</td>
                    <td className="px-3 py-2 text-catalan-textMuted text-xs">{getFormTitle(r.form_id)}</td>
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
