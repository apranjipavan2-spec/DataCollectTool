import api from '@/lib/api'

export interface SavedTabulation {
  id: string
  title: string
  description: string
  groupby_field: string
  value_field: string
  aggregation: string
  chart_type: string
  rows: { group: string; value: number; pct?: number; [key: string]: string | number | undefined }[]
  total: number
  created_at: string
  show_percent?: boolean
  secondary_groupby?: string
  sub_keys?: string[]
  is_cross_tab?: boolean
  feedback?: 'up' | 'down' | null
  interpretation?: string
  column_labels?: Record<string, string>
}

export interface SavedReport {
  id: string
  label: string
  style: string
  content: string
  created_at: string
}

// ── Tabulations — DB-backed, localStorage as session cache ────────────────────

export async function loadTabulations(programId: string): Promise<SavedTabulation[]> {
  try {
    const res = await api.get(`/fg/programs/${programId}/analysis`)
    const configs: SavedTabulation[] = res.data.table_configs ?? []
    localStorage.setItem(`fg_tabs_${programId}`, JSON.stringify(configs))
    return configs
  } catch {
    // fallback to localStorage cache if API is unavailable
    try { return JSON.parse(localStorage.getItem(`fg_tabs_${programId}`) || '[]') } catch { return [] }
  }
}

export function loadTabulationsCache(programId: string): SavedTabulation[] {
  try { return JSON.parse(localStorage.getItem(`fg_tabs_${programId}`) || '[]') } catch { return [] }
}

export async function saveTabulation(programId: string, tab: SavedTabulation): Promise<void> {
  // optimistic local update
  const all = loadTabulationsCache(programId)
  const idx = all.findIndex(t => t.id === tab.id)
  if (idx >= 0) all[idx] = tab; else all.push(tab)
  localStorage.setItem(`fg_tabs_${programId}`, JSON.stringify(all))

  await api.post(`/fg/programs/${programId}/analysis/tabulations`, { tabulation: tab })
}

export async function deleteTabulation(programId: string, tabId: string): Promise<void> {
  // optimistic local update
  const all = loadTabulationsCache(programId).filter(t => t.id !== tabId)
  localStorage.setItem(`fg_tabs_${programId}`, JSON.stringify(all))

  await api.delete(`/fg/programs/${programId}/analysis/tabulations/${tabId}`)
}

// ── Reports ───────────────────────────────────────────────────────────────────

export function loadReports(programId: string): SavedReport[] {
  try {
    return JSON.parse(localStorage.getItem(`fg_reports_${programId}`) || '[]')
  } catch { return [] }
}

export function saveReport(programId: string, report: SavedReport) {
  const all = loadReports(programId)
  all.unshift(report)
  localStorage.setItem(`fg_reports_${programId}`, JSON.stringify(all.slice(0, 20)))
}

export function deleteReport(programId: string, reportId: string) {
  const all = loadReports(programId).filter(r => r.id !== reportId)
  localStorage.setItem(`fg_reports_${programId}`, JSON.stringify(all))
}

// ── Last selected program ─────────────────────────────────────────────────────

export function getLastProgram(): string {
  return localStorage.getItem('fg_last_program') || ''
}

export function setLastProgram(id: string) {
  localStorage.setItem('fg_last_program', id)
}
