import { useEffect, useState } from 'react'
import api, { getStoredUser, apiErrorMessage } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'
import { useToast } from '@/lib/ToastContext'
import EmojiIcon from '@/components/EmojiIcon'
import Select from '@/components/Select'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui'

interface RightsRequest {
  id: string
  request_type: string
  requester_name: string
  requester_contact: string
  nominee_name: string | null
  nominee_contact: string | null
  status: string
  identity_verified: boolean
  linked_submission_ids: string[]
  resolution_note: string | null
  sla_due_at: string
  outer_limit_at: string
  is_overdue: boolean
  is_past_outer_limit: boolean
  created_at: string
}

interface SearchMatch {
  id: string
  form_id: string
  form_title: string
  server_received_at: string | null
}

const REQUEST_TYPES = [
  { value: 'access', label: 'Access' },
  { value: 'correction', label: 'Correction' },
  { value: 'erasure', label: 'Erasure' },
  { value: 'portability', label: 'Portability' },
]

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-catalan-info/10 text-catalan-info',
  verifying: 'bg-amber-500/10 text-amber-500',
  in_progress: 'bg-catalan-primary/10 text-catalan-primary',
  closed: 'bg-catalan-success/10 text-catalan-success',
}

export default function DataRightsPage() {
  const user = getStoredUser()
  const toast = useToast()
  const [items, setItems] = useState<RightsRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [detail, setDetail] = useState<RightsRequest | null>(null)
  const [matches, setMatches] = useState<SearchMatch[] | null>(null)
  const [busy, setBusy] = useState(false)

  const [newType, setNewType] = useState('access')
  const [newName, setNewName] = useState('')
  const [newContact, setNewContact] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/data-rights/')
      setItems(data)
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Could not load requests'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const createRequest = async () => {
    if (!newName.trim() || !newContact.trim()) return
    setBusy(true)
    try {
      await api.post('/data-rights/', {
        request_type: newType, requester_name: newName.trim(), requester_contact: newContact.trim(),
      })
      toast.success('Request logged')
      setShowNew(false); setNewName(''); setNewContact(''); setNewType('access')
      load()
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Failed to log request'))
    } finally { setBusy(false) }
  }

  const openDetail = (r: RightsRequest) => { setDetail(r); setMatches(null) }

  const runSearch = async () => {
    if (!detail) return
    setBusy(true)
    try {
      const { data } = await api.post(`/data-rights/${detail.id}/search`, {})
      setMatches(data.matches)
      setDetail(d => d ? { ...d, linked_submission_ids: data.linked_submission_ids } : d)
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Search failed'))
    } finally { setBusy(false) }
  }

  const toggleVerified = async () => {
    if (!detail) return
    setBusy(true)
    try {
      const { data } = await api.patch(`/data-rights/${detail.id}`, { identity_verified: !detail.identity_verified })
      setDetail(data)
      setItems(prev => prev.map(x => x.id === data.id ? data : x))
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Update failed'))
    } finally { setBusy(false) }
  }

  const act = async (action: 'erase' | 'export') => {
    if (!detail) return
    if (action === 'erase' && !window.confirm(`Erase ${detail.linked_submission_ids.length} linked submission(s)? This cannot be undone.`)) return
    setBusy(true)
    try {
      const { data } = await api.post(`/data-rights/${detail.id}/act`, { action })
      if (action === 'export') {
        const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = `data-rights-export-${detail.id.slice(0, 8)}.json`
        a.click(); URL.revokeObjectURL(url)
        toast.success('Export downloaded')
      } else {
        toast.success(`Erased ${data.erased.length} submission(s)`)
      }
    } catch (err: any) {
      toast.error(apiErrorMessage(err, `${action === 'erase' ? 'Erasure' : 'Export'} failed`))
    } finally { setBusy(false) }
  }

  const closeRequest = async () => {
    if (!detail) return
    const note = window.prompt('Resolution note (optional):') ?? undefined
    setBusy(true)
    try {
      const { data } = await api.post(`/data-rights/${detail.id}/close`, { resolution_note: note })
      setItems(prev => prev.map(x => x.id === data.id ? data : x))
      setDetail(null)
      toast.success('Request closed')
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Close failed'))
    } finally { setBusy(false) }
  }

  const downloadCertificate = async () => {
    if (!detail) return
    setBusy(true)
    try {
      const res = await api.get(`/data-rights/${detail.id}/certificate`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a'); a.href = url
      a.download = `deletion_certificate_${detail.id.slice(0, 8)}.pdf`
      a.click(); URL.revokeObjectURL(url)
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Certificate download failed'))
    } finally { setBusy(false) }
  }

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleDateString() : '—'

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={getNavItems(user?.role ?? '')} role={user?.role} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav titleNode={<span className="text-catalan-text font-semibold text-base">Data Rights Requests</span>} />
        <main className="flex-1 overflow-auto p-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-catalan-textMuted max-w-2xl">
              Log and track DPDP data-principal rights requests (access, correction, erasure, portability).
              Aim to close within 30 days — 90 days is the outer limit.
            </p>
            <Button onClick={() => setShowNew(true)}>+ Log Request</Button>
          </div>

          {loading ? (
            <div className="text-sm text-catalan-textMuted animate-pulse">Loading…</div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-catalan-textMuted">
              <div className="text-4xl mb-3"><EmojiIcon e="📋" /></div>
              <div className="text-sm">No requests logged yet.</div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-catalan-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-catalan-border bg-catalan-surface text-catalan-textMuted text-xs uppercase tracking-wide">
                    <th className="text-left px-3 py-2 font-medium">Requester</th>
                    <th className="text-left px-3 py-2 font-medium">Type</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-left px-3 py-2 font-medium">SLA due</th>
                    <th className="text-left px-3 py-2 font-medium">Logged</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(r => (
                    <tr key={r.id} onClick={() => openDetail(r)} className="border-b border-catalan-border hover:bg-catalan-hover cursor-pointer">
                      <td className="px-3 py-2">
                        <div className="font-medium text-catalan-text">{r.requester_name}</div>
                        <div className="text-xs text-catalan-textMuted">{r.requester_contact}</div>
                      </td>
                      <td className="px-3 py-2 text-catalan-textMuted capitalize">{r.request_type}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${STATUS_STYLES[r.status] ?? ''}`}>{r.status.replace('_', ' ')}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${r.is_overdue ? 'bg-catalan-error/10 text-catalan-error' : 'bg-catalan-hover text-catalan-textMuted'}`}>
                          {fmt(r.sla_due_at)}{r.is_overdue ? ' — overdue' : ''}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-catalan-textMuted">{fmt(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>

      <Modal isOpen={showNew} onClose={() => setShowNew(false)} title="Log a Data Rights Request" size="sm"
        footer={<>
          <Button variant="secondary" onClick={() => setShowNew(false)}>Cancel</Button>
          <Button onClick={createRequest} disabled={busy || !newName.trim() || !newContact.trim()}>{busy ? 'Saving…' : 'Log Request'}</Button>
        </>}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-catalan-textMuted uppercase tracking-wider mb-1.5">Request Type</label>
            <Select value={newType} onChange={e => setNewType(e.target.value)}
              className="w-full bg-catalan-hover">
              {REQUEST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </div>
          <div>
            <label className="block text-xs font-medium text-catalan-textMuted uppercase tracking-wider mb-1.5">Requester Name</label>
            <input value={newName} onChange={e => setNewName(e.target.value)}
              className="w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text" />
          </div>
          <div>
            <label className="block text-xs font-medium text-catalan-textMuted uppercase tracking-wider mb-1.5">Phone or Email</label>
            <input value={newContact} onChange={e => setNewContact(e.target.value)}
              className="w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text" />
            <p className="text-xs text-catalan-textMuted mt-1">Used to search for their responses across your forms.</p>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={detail?.requester_name} size="lg"
        footer={detail?.status !== 'closed' ? <Button variant="secondary" onClick={closeRequest} disabled={busy}>Close Request</Button> : undefined}>
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${STATUS_STYLES[detail.status] ?? ''}`}>{detail.status.replace('_', ' ')}</span>
              <span className="text-xs text-catalan-textMuted capitalize">{detail.request_type} request</span>
              {detail.is_overdue && <span className="text-xs px-2 py-0.5 rounded-full bg-catalan-error/10 text-catalan-error">Overdue (SLA {fmt(detail.sla_due_at)})</span>}
              {detail.is_past_outer_limit && <span className="text-xs px-2 py-0.5 rounded-full bg-catalan-error/20 text-catalan-error font-semibold">Past 90-day outer limit</span>}
            </div>

            <div className="flex items-center justify-between p-3 bg-catalan-bg border border-catalan-border rounded-xl">
              <span className="text-sm text-catalan-text">Identity verified</span>
              <button onClick={toggleVerified} disabled={busy}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${detail.identity_verified ? 'bg-catalan-success' : 'bg-catalan-border'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${detail.identity_verified ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-catalan-text">Linked submissions ({detail.linked_submission_ids.length})</h4>
                <Button size="sm" variant="secondary" onClick={runSearch} disabled={busy}>{busy ? 'Searching…' : 'Search all forms'}</Button>
              </div>
              {matches && (
                <div className="text-xs text-catalan-textMuted mb-2">Found {matches.length} match(es) this search.</div>
              )}
              {detail.linked_submission_ids.length > 0 ? (
                <div className="flex gap-2 flex-wrap mb-3">
                  {detail.linked_submission_ids.map(id => (
                    <span key={id} className="text-xs font-mono bg-catalan-hover border border-catalan-border rounded px-2 py-1">{id.slice(0, 8)}…</span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-catalan-textMuted mb-3">No submissions linked yet — run a search or link manually via the dashboard.</p>
              )}
              {detail.linked_submission_ids.length > 0 && detail.status !== 'closed' && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => act('export')} disabled={busy}>Export (JSON)</Button>
                  <Button size="sm" variant="danger" onClick={() => act('erase')} disabled={busy}>Erase all linked</Button>
                </div>
              )}
            </div>

            {detail.resolution_note && (
              <div className="p-3 bg-catalan-bg border border-catalan-border rounded-xl">
                <div className="text-xs text-catalan-textMuted uppercase tracking-wider mb-1">Resolution note</div>
                <p className="text-sm text-catalan-text">{detail.resolution_note}</p>
              </div>
            )}

            {detail.status === 'closed' && (
              <Button size="sm" variant="secondary" onClick={downloadCertificate} disabled={busy}>
                <EmojiIcon e="📄" /> Download Deletion Certificate
              </Button>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
