/**
 * Results links — read-only, totals-only pages a form's results can be shared on
 * with outsiders (donors, partners). Backend: routes/dashboard_shares.py.
 */
import { useEffect, useState } from 'react'
import api, { apiErrorMessage } from '@/lib/api'
import { useToast } from '@/lib/ToastContext'
import { Button } from '@/components/ui'

interface Share {
  id: string
  label: string | null
  url: string
  expires_at: string | null
  revoked: boolean
  view_count: number
}

const EXPIRY_OPTIONS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
  { days: 0, label: 'Never' },
]

export default function ResultsShareSection({ formId }: { formId: string }) {
  const toast = useToast()
  const [shares, setShares] = useState<Share[]>([])
  const [label, setLabel] = useState('')
  const [days, setDays] = useState(90)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/dashboard-shares', { params: { form_id: formId } })
      .then(r => setShares(r.data))
      .catch(err => toast.error(apiErrorMessage(err, 'Could not load results links')))
  }, [formId, toast])

  async function create() {
    setBusy(true)
    try {
      const expires_at = days ? new Date(Date.now() + days * 86_400_000).toISOString() : null
      const { data } = await api.post('/dashboard-shares', { form_id: formId, label: label || null, expires_at })
      setShares(prev => [data, ...prev])
      setLabel('')
      navigator.clipboard?.writeText(window.location.origin + data.url)
      toast.success('Results link created and copied')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not create link'))
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    try {
      const { data } = await api.delete(`/dashboard-shares/${id}`)
      setShares(prev => prev.map(s => (s.id === id ? data : s)))
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not revoke link'))
    }
  }

  const active = shares.filter(s => !s.revoked && !(s.expires_at && new Date(s.expires_at) < new Date()))

  return (
    <div className="space-y-3 pt-4 border-t border-catalan-border">
      <div>
        <h3 className="text-sm font-semibold text-catalan-text">Share results (totals only)</h3>
        <p className="text-xs text-catalan-textMuted mt-1">
          A read-only page with counts and charts. No names, phone numbers, free-text answers or individual
          submissions. Any number under 5 is shown as &quot;&lt;5&quot;.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[140px] text-xs text-catalan-textMuted">
          Who is it for?
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="e.g. Donor Q3 review"
            maxLength={200}
            className="mt-1 w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text"
          />
        </label>
        <label className="text-xs text-catalan-textMuted">
          Expires
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="mt-1 block bg-catalan-hover border border-catalan-border rounded-lg px-2 py-2 text-sm text-catalan-text"
          >
            {EXPIRY_OPTIONS.map(o => <option key={o.days} value={o.days}>{o.label}</option>)}
          </select>
        </label>
        <Button variant="primary" size="sm" onClick={create} disabled={busy}>
          {busy ? 'Creating…' : 'Create link'}
        </Button>
      </div>
      {active.length > 0 && (
        <ul className="space-y-2">
          {active.map(s => (
            <li key={s.id} className="flex items-center gap-2 text-xs">
              <span className="flex-1 truncate text-catalan-text" title={window.location.origin + s.url}>
                {s.label || 'Results link'} · {s.view_count} views
                {s.expires_at ? ` · until ${new Date(s.expires_at).toLocaleDateString('en-IN')}` : ''}
              </span>
              <button
                onClick={() => { navigator.clipboard.writeText(window.location.origin + s.url); toast.success('Link copied!') }}
                className="px-2 py-1 rounded border border-catalan-primary/40 text-catalan-primary hover:bg-catalan-primary/10"
              >
                Copy
              </button>
              <button
                onClick={() => revoke(s.id)}
                className="px-2 py-1 rounded border border-catalan-border text-catalan-textMuted hover:text-catalan-error"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
