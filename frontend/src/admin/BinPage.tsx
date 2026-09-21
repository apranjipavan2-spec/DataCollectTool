import { useEffect, useMemo, useState } from 'react'
import api, { getStoredUser, apiErrorMessage } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'
import { useToast } from '@/lib/ToastContext'
import EmojiIcon from '@/components/EmojiIcon'

interface BinItem {
  entity_type: string
  entity_label: string
  group: string
  icon: string
  id: string
  label: string
  created_at: string | null
  deleted_at: string | null
  purge_at: string | null
  days_left: number | null
}

// Fixed display order for the folders that matter most; anything else falls
// back to alphabetical after these.
const GROUP_ORDER = [
  'Forms', 'Form Assignments', 'Analyzer Projects', 'Cleaner Projects',
  'Writer Files', 'Records', 'Data Collected', 'Shared Files',
]

type SortField = 'deleted_at' | 'created_at'

export default function BinPage() {
  const user = getStoredUser()
  const toast = useToast()
  const [items, setItems] = useState<BinItem[]>([])
  const [loading, setLoading] = useState(true)
  const [retentionDays, setRetentionDays] = useState(360)
  const [allowHardDelete, setAllowHardDelete] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [folder, setFolder] = useState<string>('all')
  const [sortField, setSortField] = useState<SortField>('deleted_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/bin')
      setItems(data.items)
      setRetentionDays(data.retention_days ?? 360)
      setAllowHardDelete(!!data.allow_hard_delete)
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

  // ── Folders (file-manager style) ────────────────────────────────────────────
  const folders = useMemo(() => {
    const counts = new Map<string, { icon: string; count: number }>()
    for (const it of items) {
      const cur = counts.get(it.group)
      if (cur) cur.count++
      else counts.set(it.group, { icon: it.icon, count: 1 })
    }
    const names = Array.from(counts.keys()).sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b)
      if (ia !== -1 && ib !== -1) return ia - ib
      if (ia !== -1) return -1
      if (ib !== -1) return 1
      return a.localeCompare(b)
    })
    return names.map(name => ({ name, icon: counts.get(name)!.icon, count: counts.get(name)!.count }))
  }, [items])

  const visibleItems = useMemo(() => {
    const filtered = folder === 'all' ? items : items.filter(it => it.group === folder)
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortField] || ''
      const bv = b[sortField] || ''
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'desc' ? -cmp : cmp
    })
    return sorted
  }, [items, folder, sortField, sortDir])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const sortArrow = (field: SortField) => sortField !== field ? '' : (sortDir === 'desc' ? ' ↓' : ' ↑')

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
            <>
              {/* Folder tiles — file-manager style */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                <button
                  onClick={() => setFolder('all')}
                  className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-center transition-colors ${
                    folder === 'all'
                      ? 'border-catalan-primary bg-catalan-primary/5'
                      : 'border-catalan-border hover:border-catalan-primary hover:bg-catalan-primary/5'
                  }`}
                >
                  <span className="text-2xl"><EmojiIcon e="🗑️" /></span>
                  <span className="text-xs font-medium text-catalan-text">All items</span>
                  <span className="text-[11px] text-catalan-textMuted">{items.length}</span>
                </button>
                {folders.map(f => (
                  <button
                    key={f.name}
                    onClick={() => setFolder(f.name)}
                    className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-center transition-colors ${
                      folder === f.name
                        ? 'border-catalan-primary bg-catalan-primary/5'
                        : 'border-catalan-border hover:border-catalan-primary hover:bg-catalan-primary/5'
                    }`}
                  >
                    <span className="text-2xl"><EmojiIcon e={f.icon} /></span>
                    <span className="text-xs font-medium text-catalan-text">{f.name}</span>
                    <span className="text-[11px] text-catalan-textMuted">{f.count}</span>
                  </button>
                ))}
              </div>

              {/* Sort controls */}
              <div className="flex items-center gap-2 text-xs text-catalan-textMuted">
                <span>Sort by:</span>
                <button
                  onClick={() => toggleSort('deleted_at')}
                  className={`px-2.5 py-1 rounded-full border ${
                    sortField === 'deleted_at' ? 'border-catalan-primary text-catalan-primary' : 'border-catalan-border'
                  }`}
                >
                  Deleted date{sortArrow('deleted_at')}
                </button>
                <button
                  onClick={() => toggleSort('created_at')}
                  className={`px-2.5 py-1 rounded-full border ${
                    sortField === 'created_at' ? 'border-catalan-primary text-catalan-primary' : 'border-catalan-border'
                  }`}
                >
                  Created date{sortArrow('created_at')}
                </button>
                <span className="ml-auto">{visibleItems.length} item{visibleItems.length === 1 ? '' : 's'}{folder !== 'all' ? ` in ${folder}` : ''}</span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-catalan-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-catalan-border bg-catalan-surface text-catalan-textMuted text-xs uppercase tracking-wide">
                      <th className="text-left px-3 py-2 font-medium">Item</th>
                      <th className="text-left px-3 py-2 font-medium">Type</th>
                      <th className="text-left px-3 py-2 font-medium cursor-pointer select-none" onClick={() => toggleSort('created_at')}>
                        Created{sortArrow('created_at')}
                      </th>
                      <th className="text-left px-3 py-2 font-medium cursor-pointer select-none" onClick={() => toggleSort('deleted_at')}>
                        Deleted{sortArrow('deleted_at')}
                      </th>
                      <th className="text-left px-3 py-2 font-medium">Days left</th>
                      <th className="text-right px-3 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map(it => (
                      <tr key={`${it.entity_type}:${it.id}`} className="border-b border-catalan-border hover:bg-catalan-hover">
                        <td className="px-3 py-2 font-medium text-catalan-text">
                          <span className="mr-1.5"><EmojiIcon e={it.icon} /></span>{it.label}
                        </td>
                        <td className="px-3 py-2 text-catalan-textMuted">{it.group}</td>
                        <td className="px-3 py-2 text-catalan-textMuted">{fmt(it.created_at)}</td>
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
                              className="inline-flex items-center gap-1 text-xs text-catalan-success hover:underline disabled:opacity-50"
                              title="Restore this item"
                            >
                              <EmojiIcon e="↩️" /> Restore
                            </button>
                            <button
                              onClick={() => purge(it)}
                              disabled={busy === it.id || !allowHardDelete}
                              className="inline-flex items-center gap-1 text-xs text-catalan-danger hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                              title={allowHardDelete ? 'Delete permanently now' : 'Hard delete is disabled for this org — data is retained until the retention window ends'}
                            >
                              <EmojiIcon e="🗑️" /> Delete forever
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
