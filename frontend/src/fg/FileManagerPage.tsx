import { useState, useEffect, useCallback, useRef } from 'react'
import api from '@/lib/api'
import { getStoredUser } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'
import { useToast } from '@/lib/ToastContext'

interface ToolProject {
  id: string; tool: string; name: string; program_id: string | null
  data: Record<string, unknown>; created_at: string; updated_at: string
}

interface Submission {
  id: string; form_id: string; form_title: string
  enumerator_name: string; status: string
  submitted_at: string | null; synced_at: string | null
  location: string | null; beneficiary_name: string | null
  data: Record<string, unknown>
}

const STATUS_CLS: Record<string, string> = {
  synced:   'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  flagged:  'bg-amber-100 text-amber-700',
  rejected: 'bg-red-100 text-red-600',
  pending:  'bg-gray-100 text-gray-500',
}

type Section = 'recent' | 'analyzer' | 'cleaner' | 'writer' | 'submissions'

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

export default function FileManagerPage() {
  const user = getStoredUser()
  const toast = useToast()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showScrollTop, setShowScrollTop] = useState(false)

  const [projects, setProjects] = useState<ToolProject[]>([])
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [forms, setForms] = useState<{ id: string; title: string }[]>([])
  const [loadingProj, setLoadingProj] = useState(true)
  const [loadingSub, setLoadingSub] = useState(false)
  const [section, setSection] = useState<Section>('recent')
  const [subFormFilter, setSubFormFilter] = useState('')
  const [subStatusFilter, setSubStatusFilter] = useState('')
  const [subPage, setSubPage] = useState(1)
  const [subTotal, setSubTotal] = useState(0)
  const PAGE_SIZE = 50

  // Selection state
  const [selectedSubs, setSelectedSubs] = useState<Set<string>>(new Set())
  const [selectedProjs, setSelectedProjs] = useState<Set<string>>(new Set())

  // ── Scroll-to-top ─────────────────────────────────────────────────────────

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => setShowScrollTop(el.scrollTop > 300)
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const scrollToTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadProjects = useCallback(() => {
    setLoadingProj(true)
    api.get('/tool-projects/').then(r => setProjects(Array.isArray(r.data) ? r.data : []))
      .catch(() => {})
      .finally(() => setLoadingProj(false))
  }, [])

  const loadSubmissions = useCallback(async () => {
    setLoadingSub(true)
    const params: Record<string, any> = { page: subPage, page_size: PAGE_SIZE }
    if (subFormFilter) params.form_id = subFormFilter
    if (subStatusFilter) params.status = subStatusFilter
    try {
      const { data } = await api.get('/submissions/', { params })
      const items = Array.isArray(data) ? data : data?.items ?? data?.results ?? []
      const total = data?.total ?? data?.count ?? items.length
      setSubmissions(items)
      setSubTotal(total)
      setSelectedSubs(new Set())
    } catch { } finally { setLoadingSub(false) }
  }, [subFormFilter, subStatusFilter, subPage])

  useEffect(() => {
    loadProjects()
    api.get('/forms/?status=active').then(r => {
      const d = r.data
      setForms(Array.isArray(d) ? d : d?.forms ?? d?.results ?? [])
    }).catch(() => {})
    api.get('/submissions/', { params: { page: 1, page_size: 1 } }).then(({ data }) => {
      setSubTotal(data?.total ?? data?.count ?? 0)
    }).catch(() => {})
  }, [loadProjects])

  useEffect(() => {
    if (section === 'submissions') loadSubmissions()
  }, [section, loadSubmissions])

  // Reset selection when switching sections
  useEffect(() => {
    setSelectedSubs(new Set())
    setSelectedProjs(new Set())
  }, [section])

  function load() {
    loadProjects()
    if (section === 'submissions') loadSubmissions()
  }

  // ── File actions ─────────────────────────────────────────────────────────

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

  function exportSubsCsv(subs: Submission[], filename = 'submissions.csv') {
    if (subs.length === 0) return
    const headers = ['ID', 'Form', 'Enumerator', 'Beneficiary', 'Location', 'Status', 'Submitted At']
    const rows = subs.map(s => [
      s.id, s.form_title, s.enumerator_name, s.beneficiary_name ?? '',
      s.location ?? '', s.status, fmtDateTime(s.submitted_at ?? s.synced_at),
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function downloadFormCsv(formId: string, formTitle: string) {
    try {
      const r = await api.get(`/export/${formId}/csv`, { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${formTitle.replace(/[^a-z0-9]/gi, '_')}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Export failed') }
  }

  async function downloadConsentCsv(formId: string, formTitle: string) {
    try {
      const r = await api.get(`/export/consent-report?form_id=${formId}`, { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `consent_${formTitle.replace(/[^a-z0-9]/gi, '_')}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Consent report download failed') }
  }

  // ── Selection helpers ────────────────────────────────────────────────────

  // ── Derived ───────────────────────────────────────────────────────────────

  const byTool = (tool: string) => projects.filter(p => p.tool === tool)
  const recentProjects = [...projects].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  ).slice(0, 20)
  const visibleProjects =
    section === 'recent'      ? recentProjects :
    section === 'submissions' ? [] :
    byTool(section)

  const allSubsSelected = submissions.length > 0 && submissions.every(s => selectedSubs.has(s.id))
  const toggleAllSubs = () => {
    if (allSubsSelected) setSelectedSubs(new Set())
    else setSelectedSubs(new Set(submissions.map(s => s.id)))
  }
  const toggleSub = (id: string) => setSelectedSubs(prev => {
    const n = new Set(prev)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  const allProjsSelected = visibleProjects.length > 0 && visibleProjects.every(p => selectedProjs.has(p.id))
  const toggleAllProjs = () => {
    if (allProjsSelected) setSelectedProjs(new Set())
    else setSelectedProjs(new Set(visibleProjects.map(p => p.id)))
  }
  const toggleProj = (id: string) => setSelectedProjs(prev => {
    const n = new Set(prev)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  function downloadSelectedSubs() {
    const sel = submissions.filter(s => selectedSubs.has(s.id))
    exportSubsCsv(sel, 'selected-submissions.csv')
  }

  function downloadSelectedProjs() {
    const sel = visibleProjects.filter(p => selectedProjs.has(p.id) && p.data?.csv_content)
    if (sel.length === 0) { toast.error('No CSV files in selection'); return }
    sel.forEach(p => downloadCsv(p))
  }

  const NAV_ITEMS = [
    { key: 'recent' as Section,      label: 'Recent',    icon: '🕒', count: recentProjects.length },
    { key: 'submissions' as Section, label: 'Form Data', icon: '📝', count: subTotal },
    { key: 'analyzer' as Section,    label: 'Analyzer',  icon: '📊', count: byTool('analyzer').length },
    { key: 'cleaner' as Section,     label: 'Cleaner',   icon: '🧹', count: byTool('cleaner').length },
    { key: 'writer' as Section,      label: 'Writer',    icon: '✍️', count: byTool('writer').length },
  ]

  const isLoading = section === 'submissions' ? loadingSub : loadingProj
  const selectedSubsList = submissions.filter(s => selectedSubs.has(s.id))
  const selectedProjsList = visibleProjects.filter(p => selectedProjs.has(p.id))

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={getNavItems(user?.role ?? '')} role={user?.role} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav title="File Manager"
          rightContent={
            <div className="flex items-center gap-2">
              {section === 'submissions' && subFormFilter && forms.find(f => f.id === subFormFilter) && (
                <div className="flex gap-2">
                  <button onClick={() => { const f = forms.find(x => x.id === subFormFilter)!; downloadFormCsv(f.id, f.title) }}
                    className="px-3 py-1.5 text-xs bg-catalan-primary text-catalan-bg rounded-lg hover:bg-catalan-primaryDark">
                    ⬇ Form CSV
                  </button>
                  <button onClick={() => { const f = forms.find(x => x.id === subFormFilter)!; downloadConsentCsv(f.id, f.title) }}
                    className="px-3 py-1.5 text-xs border border-catalan-border rounded-lg text-catalan-text hover:bg-catalan-hover">
                    ⬇ Consent Report
                  </button>
                </div>
              )}
              <button onClick={load} disabled={isLoading}
                className="px-3 py-1.5 text-xs border border-catalan-border rounded-lg text-catalan-text hover:bg-catalan-hover disabled:opacity-40">
                {isLoading ? '…' : '↺ Refresh'}
              </button>
            </div>
          }
        />

        <div className="flex-1 flex overflow-hidden">
          {/* Left panel */}
          <div className="w-48 flex-shrink-0 border-r border-catalan-border bg-catalan-surface flex flex-col p-3 gap-1">
            <p className="text-[11px] font-semibold text-catalan-textMuted uppercase tracking-wider mb-2 px-2">Files</p>
            {NAV_ITEMS.map(f => (
              <button key={f.key} onClick={() => { setSection(f.key); setSubPage(1) }}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                  section === f.key
                    ? 'bg-catalan-primary/10 text-catalan-primary border border-catalan-primary/20'
                    : 'text-catalan-textMuted hover:bg-catalan-hover'
                }`}>
                <span>{f.icon}</span>
                <span>{f.label}</span>
                <span className="ml-auto text-xs text-catalan-textMuted">{f.count}</span>
              </button>
            ))}
          </div>

          {/* Right content */}
          <div ref={scrollRef} className="flex-1 overflow-auto p-6">

            {/* ── Submissions section ── */}
            {section === 'submissions' && (
              <>
                {/* Filters + bulk toolbar */}
                <div className="flex flex-wrap gap-3 mb-4 items-center">
                  <select value={subFormFilter} onChange={e => { setSubFormFilter(e.target.value); setSubPage(1) }}
                    className="border border-catalan-border rounded-lg px-3 py-1.5 text-sm bg-catalan-bg text-catalan-text focus:outline-none max-w-[200px]">
                    <option value="">All forms</option>
                    {forms.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
                  </select>
                  <select value={subStatusFilter} onChange={e => { setSubStatusFilter(e.target.value); setSubPage(1) }}
                    className="border border-catalan-border rounded-lg px-3 py-1.5 text-sm bg-catalan-bg text-catalan-text focus:outline-none">
                    <option value="">All statuses</option>
                    {['synced', 'approved', 'flagged', 'rejected', 'pending'].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>

                  {selectedSubs.size > 0 && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-catalan-primary/10 border border-catalan-primary/20 rounded-lg">
                      <span className="text-xs font-medium text-catalan-primary">{selectedSubs.size} selected</span>
                      <button onClick={downloadSelectedSubs}
                        className="text-xs px-2 py-1 bg-catalan-primary text-catalan-bg rounded font-medium hover:opacity-90">
                        ⬇ Download CSV
                      </button>
                      <button onClick={() => setSelectedSubs(new Set())} className="text-xs text-catalan-textMuted hover:text-catalan-text">✕ Clear</button>
                    </div>
                  )}

                  <div className="ml-auto flex items-center gap-3">
                    <span className="text-xs text-catalan-textMuted">{subTotal} submissions</span>
                    {forms.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {forms.map(f => (
                          <button key={f.id} onClick={() => downloadFormCsv(f.id, f.title)}
                            title={`Download all data for "${f.title}"`}
                            className="text-[10px] px-2 py-1 bg-catalan-hover border border-catalan-border rounded text-catalan-textMuted hover:text-catalan-primary hover:border-catalan-primary/40 transition-colors">
                            ⬇ {f.title.length > 20 ? f.title.slice(0, 20) + '…' : f.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {loadingSub ? (
                  <div className="py-16 text-center text-catalan-textMuted text-sm">Loading submissions…</div>
                ) : submissions.length === 0 ? (
                  <div className="py-16 text-center text-catalan-textMuted text-sm">
                    <div className="text-5xl mb-3">📝</div>
                    <div className="font-medium text-catalan-text mb-1">No submissions found</div>
                    <div className="text-xs">Submissions collected by enumerators will appear here.</div>
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto rounded-xl border border-catalan-border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-catalan-border bg-catalan-surface">
                            <th className="px-3 py-3 text-left">
                              <input type="checkbox" checked={allSubsSelected} onChange={toggleAllSubs}
                                className="w-4 h-4 rounded border-catalan-border accent-catalan-primary cursor-pointer" />
                            </th>
                            {['Form', 'Enumerator', 'Beneficiary', 'Location', 'Status', 'Submitted'].map(h => (
                              <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wider">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {submissions.map(s => (
                            <tr key={s.id}
                              className={`border-b border-catalan-border hover:bg-catalan-hover transition-colors cursor-pointer ${selectedSubs.has(s.id) ? 'bg-catalan-primary/5' : ''}`}
                              onClick={() => toggleSub(s.id)}>
                              <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                                <input type="checkbox" checked={selectedSubs.has(s.id)} onChange={() => toggleSub(s.id)}
                                  className="w-4 h-4 rounded border-catalan-border accent-catalan-primary cursor-pointer" />
                              </td>
                              <td className="px-4 py-3 font-medium text-catalan-text max-w-[160px] truncate">{s.form_title || '—'}</td>
                              <td className="px-4 py-3 text-catalan-textMuted text-xs">{s.enumerator_name || '—'}</td>
                              <td className="px-4 py-3 text-catalan-textMuted text-xs font-medium">{s.beneficiary_name || '—'}</td>
                              <td className="px-4 py-3 text-catalan-textMuted text-xs">{s.location || '—'}</td>
                              <td className="px-4 py-3">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_CLS[s.status] ?? 'bg-gray-100 text-gray-500'}`}>
                                  {s.status}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-catalan-textMuted text-xs whitespace-nowrap">
                                {fmtDateTime(s.submitted_at ?? s.synced_at)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Pagination */}
                    {subTotal > PAGE_SIZE && (
                      <div className="flex items-center justify-between mt-4 text-sm text-catalan-textMuted">
                        <span>Page {subPage} of {Math.ceil(subTotal / PAGE_SIZE)}</span>
                        <div className="flex gap-2">
                          <button disabled={subPage <= 1} onClick={() => setSubPage(p => p - 1)}
                            className="px-3 py-1.5 border border-catalan-border rounded-lg text-xs hover:bg-catalan-hover disabled:opacity-40">← Prev</button>
                          <button disabled={subPage >= Math.ceil(subTotal / PAGE_SIZE)} onClick={() => setSubPage(p => p + 1)}
                            className="px-3 py-1.5 border border-catalan-border rounded-lg text-xs hover:bg-catalan-hover disabled:opacity-40">Next →</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* ── Tool projects section ── */}
            {section !== 'submissions' && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-catalan-textMuted">
                    {section === 'recent'   && 'Your 20 most recently saved files across all tools.'}
                    {section === 'analyzer' && 'Saved analysis files from FG Analyzer.'}
                    {section === 'cleaner'  && 'Cleaned datasets saved from FG Cleaner.'}
                    {section === 'writer'   && 'Report versions saved from FG Writer.'}
                  </p>
                  {selectedProjs.size > 0 && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-catalan-primary/10 border border-catalan-primary/20 rounded-lg">
                      <span className="text-xs font-medium text-catalan-primary">{selectedProjs.size} selected</span>
                      <button onClick={downloadSelectedProjs}
                        className="text-xs px-2 py-1 bg-catalan-primary text-catalan-bg rounded font-medium hover:opacity-90">
                        ⬇ Download CSV
                      </button>
                      <button onClick={() => setSelectedProjs(new Set())} className="text-xs text-catalan-textMuted hover:text-catalan-text">✕ Clear</button>
                    </div>
                  )}
                </div>

                {loadingProj ? (
                  <div className="py-16 text-center text-catalan-textMuted text-sm">Loading files…</div>
                ) : visibleProjects.length === 0 ? (
                  <div className="py-16 text-center text-catalan-textMuted text-sm">
                    <div className="text-5xl mb-3">📂</div>
                    <div className="font-medium text-catalan-text mb-1">No saved files yet</div>
                    <div className="text-xs">
                      {section === 'writer'
                        ? 'Use "Save Version" in FG Writer to store reports here.'
                        : 'Use "Save to Account" in the Analyzer or Cleaner to store files here.'}
                    </div>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-catalan-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-catalan-border bg-catalan-surface">
                          <th className="px-3 py-3 text-left">
                            <input type="checkbox" checked={allProjsSelected} onChange={toggleAllProjs}
                              className="w-4 h-4 rounded border-catalan-border accent-catalan-primary cursor-pointer" />
                          </th>
                          {['Name', 'Tool', 'Size', 'Saved'].map(h => (
                            <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wider">{h}</th>
                          ))}
                          <th className="px-4 py-3 text-xs font-semibold text-catalan-textMuted uppercase tracking-wider text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleProjects.map(proj => {
                          const TOOL_BADGE: Record<string, string> = {
                            analyzer: 'bg-blue-100 text-blue-700',
                            cleaner:  'bg-green-100 text-green-700',
                            writer:   'bg-purple-100 text-purple-700',
                          }
                          const TOOL_LABEL: Record<string, string> = {
                            analyzer: '📊 Analyzer',
                            cleaner:  '🧹 Cleaner',
                            writer:   '✍️ Writer',
                          }
                          return (
                            <tr key={proj.id}
                              className={`border-b border-catalan-border hover:bg-catalan-hover transition-colors cursor-pointer ${selectedProjs.has(proj.id) ? 'bg-catalan-primary/5' : ''}`}
                              onClick={() => toggleProj(proj.id)}>
                              <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                                <input type="checkbox" checked={selectedProjs.has(proj.id)} onChange={() => toggleProj(proj.id)}
                                  className="w-4 h-4 rounded border-catalan-border accent-catalan-primary cursor-pointer" />
                              </td>
                              <td className="px-4 py-3 font-medium text-catalan-text max-w-[200px] truncate">{proj.name}</td>
                              <td className="px-4 py-3">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TOOL_BADGE[proj.tool] ?? 'bg-gray-100 text-gray-600'}`}>
                                  {TOOL_LABEL[proj.tool] ?? proj.tool}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-catalan-textMuted text-xs">
                                {proj.tool === 'writer'
                                  ? `${Math.round((proj.data?.content?.length ?? 0) / 1000)}k chars`
                                  : (proj.data?.row_count != null ? `${proj.data.row_count} rows` : '—')}
                              </td>
                              <td className="px-4 py-3 text-catalan-textMuted text-xs whitespace-nowrap">
                                {fmtDateTime(proj.updated_at)}
                              </td>
                              <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                                <div className="flex gap-3 justify-end">
                                  {proj.tool === 'writer' && proj.data?.content && (
                                    <a href="/fg/writer" className="text-xs text-catalan-primary hover:underline">Open Writer</a>
                                  )}
                                  {proj.data?.csv_content && (
                                    <button onClick={() => downloadCsv(proj)} className="text-xs text-catalan-primary hover:underline">⬇ CSV</button>
                                  )}
                                  <button onClick={() => remove(proj.id, proj.name)} className="text-xs text-red-500 hover:underline">Delete</button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

          </div>
        </div>
      </div>

      {/* Scroll-to-top button */}
      {showScrollTop && (
        <button onClick={scrollToTop}
          className="fixed bottom-6 right-6 w-10 h-10 bg-catalan-primary text-catalan-bg rounded-full shadow-lg flex items-center justify-center text-lg hover:opacity-90 transition-opacity z-50"
          title="Back to top">
          ↑
        </button>
      )}
    </div>
  )
}
