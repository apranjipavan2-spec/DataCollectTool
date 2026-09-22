import { useEffect, useMemo, useState } from 'react'
import api, { getStoredUser, apiErrorMessage } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'
import { useToast } from '@/lib/ToastContext'
import EmojiIcon from '@/components/EmojiIcon'
import Select from '@/components/Select'

interface OrgOption {
  tenant_id: string
  org_name: string
}

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

interface BinGroup {
  name: string
  icon: string
  count: number
}

type SortField = 'deleted_at' | 'created_at'

export default function BinPage() {
  const user = getStoredUser()
  const toast = useToast()
  const [items, setItems] = useState<BinItem[]>([])
  const [groups, setGroups] = useState<BinGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [retentionDays, setRetentionDays] = useState(360)
  const [allowHardDelete, setAllowHardDelete] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [folder, setFolder] = useState<string>('all')
  const [sortField, setSortField] = useState<SortField>('deleted_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const isMasterAdmin = user?.role === 'master_admin'
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [selectedTenantId, setSelectedTenantId] = useState<string>('')
  // Only master_admin can override tenant_id (backend ignores it for anyone else).
  const tenantParam = isMasterAdmin && selectedTenantId ? { tenant_id: selectedTenantId } : {}

  useEffect(() => {
    if (!isMasterAdmin) return
    api.get('/billing/admin/subscriptions')
      .then(({ data }) => setOrgs(data.map((o: any) => ({ tenant_id: o.tenant_id, org_name: o.org_name }))))
      .catch(() => {}) // non-fatal — picker just stays empty, own-tenant bin still works
  }, [isMasterAdmin])

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/bin', { params: tenantParam })
      setItems(data.items)
      setGroups(data.groups ?? [])
      setRetentionDays(data.retention_days ?? 360)
      setAllowHardDelete(!!data.allow_hard_delete)
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Could not load the bin'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [selectedTenantId])

  const restore = async (it: BinItem) => {
    setBusy(it.id)
    try {
      await api.post(`/bin/${it.entity_type}/${it.id}/restore`, null, { params: tenantParam })
      setItems(prev => prev.filter(x => x.id !== it.id))
      setGroups(prev => prev.map(g => g.name === it.group ? { ...g, count: Math.max(0, g.count - 1) } : g))
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
      await api.delete(`/bin/${it.entity_type}/${it.id}`, { params: tenantParam })
      setItems(prev => prev.filter(x => x.id !== it.id))
      setGroups(prev => prev.map(g => g.name === it.group ? { ...g, count: Math.max(0, g.count - 1) } : g))
      toast.success(`Permanently deleted "${it.label}"`)
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Delete failed'))
    } finally {
      setBusy(null)
    }
  }

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleDateString() : '—'

  const totalCount = items.length

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
        <TopNav
          titleNode={<span className="text-catalan-text font-semibold text-base">Recycle Bin</span>}
          rightContent={isMasterAdmin ? (
            <Select
              value={selectedTenantId}
              onChange={e => setSelectedTenantId(e.target.value)}
              className="text-sm py-1.5"
              wrapperClassName="w-56"
            >
              <option value="">My account</option>
              {orgs.map(o => <option key={o.tenant_id} value={o.tenant_id}>{o.org_name}</option>)}
            </Select>
          ) : undefined}
        />

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-catalan-textMuted animate-pulse">Loading…</div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            {/* ── Folder tree (Explorer-style left pane) ─────────────────────── */}
            <aside className="w-64 flex-shrink-0 border-r border-catalan-border overflow-y-auto p-3 space-y-0.5">
              <p className="px-2 pb-2 text-xs text-catalan-textMuted">
                Kept <span className="font-semibold text-catalan-text">{retentionDays} days</span> before permanent removal.
              </p>
              <button
                onClick={() => setFolder('all')}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                  folder === 'all' ? 'bg-catalan-primary/10 text-catalan-primary font-medium' : 'text-catalan-text hover:bg-catalan-hover'
                }`}
              >
                <span className="text-base"><EmojiIcon e="🗑️" /></span>
                <span className="flex-1 text-left">All items</span>
                <span className={`text-xs rounded-full px-2 py-0.5 ${folder === 'all' ? 'bg-catalan-primary/15' : 'bg-catalan-hover text-catalan-textMuted'}`}>
                  {totalCount}
                </span>
              </button>

              <div className="pt-2 mt-2 border-t border-catalan-border space-y-0.5">
                {groups.map(g => (
                  <button
                    key={g.name}
                    onClick={() => setFolder(g.name)}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                      folder === g.name ? 'bg-catalan-primary/10 text-catalan-primary font-medium' : 'text-catalan-text hover:bg-catalan-hover'
                    }`}
                  >
                    <span className="text-base"><EmojiIcon e={g.icon} /></span>
                    <span className="flex-1 text-left truncate">{g.name}</span>
                    <span className={`text-xs rounded-full px-2 py-0.5 ${
                      g.count > 0
                        ? (folder === g.name ? 'bg-catalan-primary/15' : 'bg-catalan-hover text-catalan-textMuted')
                        : 'text-catalan-textMuted/50'
                    }`}>
                      {g.count}
                    </span>
                  </button>
                ))}
              </div>
            </aside>

            {/* ── File list (Explorer-style right pane) ──────────────────────── */}
            <main className="flex-1 overflow-auto p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs text-catalan-textMuted">
                <span className="text-sm font-medium text-catalan-text">{folder === 'all' ? 'All items' : folder}</span>
                <span>· {visibleItems.length} item{visibleItems.length === 1 ? '' : 's'}</span>
                <span className="ml-auto">Sort by:</span>
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
              </div>

              {visibleItems.length === 0 ? (
                <div className="text-center py-16 text-catalan-textMuted">
                  <div className="text-4xl mb-3"><EmojiIcon e="🗑️" /></div>
                  <div className="text-sm">
                    {totalCount === 0 ? 'The bin is empty — nothing has been deleted.' : `Nothing deleted in "${folder}" yet.`}
                  </div>
                </div>
              ) : (
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
              )}
            </main>
          </div>
        )}
      </div>
    </div>
  )
}
