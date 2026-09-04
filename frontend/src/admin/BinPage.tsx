import { useEffect, useState } from 'react'
import api, { getStoredUser, apiErrorMessage } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'
import { useToast } from '@/lib/ToastContext'
import EmojiIcon from '@/components/EmojiIcon'

interface BinItem {
  entity_type: string
  entity_label: string
  id: string
  label: string
  deleted_at: string | null
  purge_at: string | null
  days_left: number | null
}

export default function BinPage() {
  const user = getStoredUser()
  const toast = useToast()
  const [items, setItems] = useState<BinItem[]>([])
  const [loading, setLoading] = useState(true)
  const [retentionDays, setRetentionDays] = useState(360)
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/bin')
      setItems(data.items)
      setRetentionDays(data.retention_days ?? 360)
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Could not load the bin'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const restore = async (it: BinItem) => {
    setBusy(it.id)
    try {
      await api.post(`/bin/${it.entity_type}/${it.id}/restore`)
      setItems(prev => prev.filter(x => x.id !== it.id))
      toast.success(`Restored ${it.entity_label.toLowerCase()} "${it.label}"`)
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Restore failed'))
    } finally {
      setBusy(null)
    }
  }

  const purge = async (it: BinItem) => {
    if (!window.confirm(`Permanently delete "${it.label}"? This cannot be undone.`)) return
    setBusy(it.id)
    try {
      await api.delete(`/bin/${it.entity_type}/${it.id}`)
      setItems(prev => prev.filter(x => x.id !== it.id))
      toast.success(`Permanently deleted "${it.label}"`)
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Delete failed'))
    } finally {
      setBusy(null)
    }
  }

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleDateString() : '—'

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={getNavItems(user?.role ?? '')} role={user?.role} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav titleNode={<span className="text-catalan-text font-semibold text-base">Recycle Bin</span>} />
        <main className="flex-1 overflow-auto p-6 space-y-4">
          <p className="text-sm text-catalan-textMuted">
            Deleted items are kept here for <span className="font-semibold text-catalan-text">{retentionDays} days</span>,
            then permanently removed. Restore anything before then.
          </p>

          {loading ? (
            <div className="text-sm text-catalan-textMuted animate-pulse">Loading…</div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-catalan-textMuted">
              <div className="text-4xl mb-3"><EmojiIcon e="🗑️" /></div>
              <div className="text-sm">The bin is empty — nothing has been deleted.</div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-catalan-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-catalan-border bg-catalan-surface text-catalan-textMuted text-xs uppercase tracking-wide">
                    <th className="text-left px-3 py-2 font-medium">Item</th>
                    <th className="text-left px-3 py-2 font-medium">Type</th>
                    <th className="text-left px-3 py-2 font-medium">Deleted</th>
                    <th className="text-left px-3 py-2 font-medium">Days left</th>
                    <th className="text-right px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => (
                    <tr key={`${it.entity_type}:${it.id}`} className="border-b border-catalan-border hover:bg-catalan-hover">
                      <td className="px-3 py-2 font-medium text-catalan-text">{it.label}</td>
                      <td className="px-3 py-2 text-catalan-textMuted">{it.entity_label}</td>
                      <td className="px-3 py-2 text-catalan-textMuted">{fmt(it.deleted_at)}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          (it.days_left ?? 0) <= 30 ? 'bg-amber-500/10 text-amber-500' : 'bg-catalan-hover text-catalan-textMuted'
                        }`}>
                          {it.days_left ?? '—'} days
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-3 justify-end">
                          <button
                            onClick={() => restore(it)}
                            disabled={busy === it.id}
                            className="text-xs text-catalan-success hover:underline disabled:opacity-50"
                          >
                            Restore
                          </button>
                          <button
                            onClick={() => purge(it)}
                            disabled={busy === it.id}
                            className="text-xs text-catalan-danger hover:underline disabled:opacity-50"
                            title="Delete permanently now"
                          >
                            Delete forever
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
