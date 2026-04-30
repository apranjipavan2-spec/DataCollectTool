import { useState, useEffect, useCallback } from 'react'
import api from '@/lib/api'
import { getStoredUser } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'
import { useToast } from '@/lib/ToastContext'

interface PaymentRequest {
  id: string
  order_ref: string
  tenant_id: string
  org_name: string
  plan_name: string
  billing_cycle: string
  amount_inr: number
  utr_number: string | null
  status: 'pending' | 'confirmed' | 'rejected'
  confirmed_at: string | null
  rejection_reason: string | null
  created_at: string
}

const card  = 'bg-catalan-surface border border-catalan-border rounded-xl p-5'
const btnPr = 'px-4 py-2 bg-catalan-primary text-catalan-bg rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40'
const btnSe = 'px-3 py-1.5 text-sm border border-catalan-border rounded-lg text-catalan-text hover:bg-catalan-hover transition-colors'
const btnDa = 'px-4 py-2 bg-catalan-error text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40'

const CYCLE_LABEL: Record<string, string> = {
  monthly: 'Monthly', '6month': '6-Month', annual: 'Annual', '3year': '3-Year'
}

export default function AdminPayments() {
  const user  = getStoredUser()
  const toast = useToast()

  const [filter,   setFilter]   = useState<'pending' | 'confirmed' | 'rejected' | 'all'>('pending')
  const [requests, setRequests] = useState<PaymentRequest[]>([])
  const [loading,  setLoading]  = useState(false)
  const [acting,   setActing]   = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = filter !== 'all' ? `?status=${filter}` : ''
      const res = await api.get(`/billing/admin/requests${params}`)
      setRequests(res.data)
    } catch {
      toast.error('Failed to load payment requests')
    } finally {
      setLoading(false)
    }
  }, [filter, toast])

  useEffect(() => { load() }, [load])

  const confirm = async (id: string) => {
    setActing(id)
    try {
      await api.patch(`/billing/admin/requests/${id}/confirm`)
      toast.success('Payment confirmed — subscription activated')
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to confirm')
    } finally { setActing(null) }
  }

  const reject = async () => {
    if (!rejectId || !rejectReason.trim()) return
    setActing(rejectId)
    try {
      await api.patch(`/billing/admin/requests/${rejectId}/reject`, { reason: rejectReason })
      toast.success('Request rejected')
      setRejectId(null); setRejectReason('')
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to reject')
    } finally { setActing(null) }
  }

  const statusBadge = (s: string) => {
    const cls = s === 'confirmed' ? 'bg-green-500/10 text-green-500 border-green-500/20'
      : s === 'rejected'  ? 'bg-catalan-error/10 text-catalan-error border-catalan-error/20'
      : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
    return (
      <span className={`px-2 py-0.5 text-xs font-medium border rounded-full ${cls}`}>
        {s.charAt(0).toUpperCase() + s.slice(1)}
      </span>
    )
  }

  const pending = requests.filter(r => r.status === 'pending').length

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={getNavItems(user?.role ?? '')} role={user?.role} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav titleNode={
          <div className="flex items-center gap-2">
            <span className="text-catalan-text font-semibold text-base">Payment Requests</span>
            {pending > 0 && (
              <span className="px-2 py-0.5 text-xs bg-amber-500 text-white rounded-full font-bold">{pending}</span>
            )}
          </div>
        } />
        <main className="flex-1 overflow-auto p-6">

          {/* Filter tabs */}
          <div className="flex gap-1 mb-6 border-b border-catalan-border">
            {(['pending', 'confirmed', 'rejected', 'all'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
                  filter === f ? 'border-catalan-primary text-catalan-primary' : 'border-transparent text-catalan-textMuted hover:text-catalan-text'
                }`}>
                {f}
              </button>
            ))}
            <button onClick={load} className={`${btnSe} ml-auto mb-1`}>↻ Refresh</button>
          </div>

          {loading && <div className="text-catalan-textMuted text-sm text-center py-12">Loading…</div>}

          {!loading && requests.length === 0 && (
            <div className="text-center py-20 text-catalan-textMuted">
              <div className="text-4xl mb-3">📭</div>
              <p className="text-sm">No {filter !== 'all' ? filter : ''} payment requests</p>
            </div>
          )}

          <div className="space-y-4">
            {requests.map(r => (
              <div key={r.id} className={card}>
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-base font-bold text-catalan-text">{r.org_name}</span>
                      {statusBadge(r.status)}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-sm">
                      <div><span className="text-catalan-textMuted text-xs">Order Ref</span><div className="font-mono text-catalan-primary font-semibold">{r.order_ref}</div></div>
                      <div><span className="text-catalan-textMuted text-xs">Plan</span><div className="text-catalan-text">{r.plan_name}</div></div>
                      <div><span className="text-catalan-textMuted text-xs">Cycle</span><div className="text-catalan-text">{CYCLE_LABEL[r.billing_cycle] || r.billing_cycle}</div></div>
                      <div><span className="text-catalan-textMuted text-xs">Amount</span><div className="text-catalan-text font-bold">₹{r.amount_inr.toLocaleString('en-IN')}</div></div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm">
                      <div>
                        <span className="text-catalan-textMuted text-xs">UTR / Txn Ref</span>
                        <div className={`font-mono text-sm ${r.utr_number ? 'text-catalan-text' : 'text-catalan-textMuted italic'}`}>
                          {r.utr_number || 'Not submitted yet'}
                        </div>
                      </div>
                      <div><span className="text-catalan-textMuted text-xs">Requested</span><div className="text-catalan-text">{new Date(r.created_at).toLocaleString()}</div></div>
                      {r.confirmed_at && <div><span className="text-catalan-textMuted text-xs">Actioned</span><div className="text-catalan-text">{new Date(r.confirmed_at).toLocaleString()}</div></div>}
                    </div>
                    {r.rejection_reason && (
                      <div className="text-xs text-catalan-error bg-catalan-error/10 border border-catalan-error/20 rounded-lg px-3 py-2">
                        Rejection reason: {r.rejection_reason}
                      </div>
                    )}
                  </div>

                  {r.status === 'pending' && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => confirm(r.id)}
                        disabled={acting === r.id}
                        className={btnPr}
                      >
                        {acting === r.id ? 'Confirming…' : '✓ Confirm & Activate'}
                      </button>
                      <button
                        onClick={() => { setRejectId(r.id); setRejectReason('') }}
                        disabled={acting === r.id}
                        className={btnDa}
                      >
                        ✕ Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>

      {/* Reject modal */}
      {rejectId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`${card} w-full max-w-md`}>
            <h3 className="text-base font-bold text-catalan-text mb-4">Reject Payment Request</h3>
            <p className="text-sm text-catalan-textMuted mb-3">
              Provide a reason — this will be visible to the organization.
            </p>
            <textarea
              className="w-full border border-catalan-border rounded-lg px-3 py-2 text-sm bg-catalan-bg text-catalan-text resize-none outline-none focus:ring-2 focus:ring-catalan-primary"
              rows={3}
              placeholder="e.g. UTR not found in bank records. Please resubmit with correct reference."
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
            />
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setRejectId(null)} className={btnSe}>Cancel</button>
              <button
                onClick={reject}
                disabled={!rejectReason.trim() || acting === rejectId}
                className={btnDa}
              >
                {acting === rejectId ? 'Rejecting…' : 'Reject Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
