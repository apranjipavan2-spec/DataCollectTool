import { useState, useEffect } from 'react'
import api from '@/lib/api'
import { getStoredUser } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'
import { useToast } from '@/lib/ToastContext'

interface ToolProject {
  id: string; tool: string; name: string; program_id: string | null
  data: any; created_at: string; updated_at: string
}

export default function FileManagerPage() {
  const user = getStoredUser()
  const toast = useToast()
  const [projects, setProjects] = useState<ToolProject[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    load()
  }, [])

  function load() {
    setLoading(true)
    api.get('/tool-projects/').then(r => setProjects(Array.isArray(r.data) ? r.data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete "${name}"?`)) return
    try {
      await api.delete(`/tool-projects/${id}`)
      setProjects(prev => prev.filter(p => p.id !== id))
      toast.success('File deleted')
    } catch { toast.error('Failed to delete') }
  }

  function downloadCsv(proj: ToolProject) {
    const blob = new Blob([proj.data.csv_content], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${proj.name}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const visible = filter === 'all' ? projects : projects.filter(p => p.tool === filter)

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={getNavItems(user?.role ?? '')} role={user?.role} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav title="File Manager"
          rightContent={
            <button onClick={load} disabled={loading}
              className="px-3 py-1.5 text-xs border border-catalan-border rounded-lg text-catalan-text hover:bg-catalan-hover disabled:opacity-40">
              {loading ? '…' : '↺ Refresh'}
            </button>
          }
        />

        <div className="flex-1 flex overflow-hidden">
          {/* Left panel */}
          <div className="w-48 flex-shrink-0 border-r border-catalan-border bg-catalan-surface flex flex-col p-3 gap-1">
            <p className="text-[11px] font-semibold text-catalan-textMuted uppercase tracking-wider mb-2 px-2">Filter</p>
            {[
              { key: 'all',      label: 'All Files', icon: '📁' },
              { key: 'analyzer', label: 'Analyzer',  icon: '📊' },
              { key: 'cleaner',  label: 'Cleaner',   icon: '🧹' },
            ].map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                  filter === f.key
                    ? 'bg-catalan-primary/10 text-catalan-primary border border-catalan-primary/20'
                    : 'text-catalan-textMuted hover:bg-catalan-hover'
                }`}>
                <span>{f.icon}</span>
                <span>{f.label}</span>
                <span className="ml-auto text-xs text-catalan-textMuted">
                  {f.key === 'all' ? projects.length : projects.filter(p => p.tool === f.key).length}
                </span>
              </button>
            ))}
          </div>

          {/* Right content */}
          <div className="flex-1 overflow-auto p-6">
            <p className="text-sm text-catalan-textMuted mb-4">
              Saved files from Analyzer and Cleaner. Download as CSV or open directly in the tool.
            </p>

            {loading ? (
              <div className="py-16 text-center text-catalan-textMuted text-sm">Loading files…</div>
            ) : visible.length === 0 ? (
              <div className="py-16 text-center text-catalan-textMuted text-sm">
                <div className="text-5xl mb-3">📂</div>
                <div className="font-medium text-catalan-text mb-1">No saved files yet</div>
                <div className="text-xs">Use "Save to Account" in the Analyzer or Cleaner to store files here.</div>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-catalan-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-catalan-border bg-catalan-surface">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wider">Name</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wider">Tool</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wider">Rows</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wider">Saved</th>
                      <th className="px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wider text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(proj => (
                      <tr key={proj.id} className="border-b border-catalan-border hover:bg-catalan-hover transition-colors">
                        <td className="px-4 py-3 font-medium text-catalan-text">{proj.name}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            proj.tool === 'cleaner'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}>
                            {proj.tool === 'cleaner' ? '🧹 Cleaner' : '📊 Analyzer'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-catalan-textMuted text-xs">{proj.data?.row_count ?? '—'}</td>
                        <td className="px-4 py-3 text-catalan-textMuted text-xs">
                          {proj.updated_at ? new Date(proj.updated_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-3 justify-end">
                            {proj.data?.csv_content && (
                              <button onClick={() => downloadCsv(proj)}
                                className="text-xs text-catalan-primary hover:underline">
                                ⬇ CSV
                              </button>
                            )}
                            <button onClick={() => remove(proj.id, proj.name)}
                              className="text-xs text-red-500 hover:underline">
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
