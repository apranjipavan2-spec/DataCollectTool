import { useState, useEffect, useRef, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api, { getStoredUser } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'

interface Pin {
  id: string; lat: number; lng: number; accuracy: number
  status: string; enumerator: string; form: string; form_id: string
  received: string | null; beneficiary_name: string | null
}

interface SubmissionDetail {
  id: string; form_id: string; form_version: number | null; serial_no: number | null
  enumerator_name: string; status: string; flag_note: string | null
  data_json: Record<string, any>
  gps_open: { lat: number; lng: number; accuracy?: number } | null
  gps_submit: { lat: number; lng: number; accuracy?: number } | null
  local_created_at: string | null; server_received_at: string | null
  backcheck_required: boolean; consent_given: boolean | null
}

interface MapSummary {
  total_submissions: number
  total_with_gps: number
  forms: { form_id: string; title: string; gps_count: number }[]
  enumerators: { name: string; gps_count: number }[]
  date_range: { first: string | null; last: string | null }
  bounds: { lat_min: number; lat_max: number; lng_min: number; lng_max: number } | null
}

const STATUS_COLOR: Record<string, string> = {
  synced: '#3B82F6', approved: '#22C55E', flagged: '#F59E0B', rejected: '#EF4444',
}
const STATUS_BG: Record<string, string> = {
  synced: 'bg-blue-100 text-blue-700', approved: 'bg-green-100 text-green-700',
  flagged: 'bg-amber-100 text-amber-700', rejected: 'bg-red-100 text-red-600',
  pending: 'bg-gray-100 text-gray-500',
}

function fmtKey(k: string) {
  return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const SKIP_KEYS = new Set(['_roster_id', '_program_id', '_questionnaire_id', '_location_id', '_participant_type_id'])

export default function FieldMapPage() {
  const user = getStoredUser()
  const [pins, setPins] = useState<Pin[]>([])
  const [pinsLoaded, setPinsLoaded] = useState(false)
  const [pinsLoading, setPinsLoading] = useState(false)
  const [mapSummary, setMapSummary] = useState<MapSummary | null>(null)
  const [days, setDays] = useState(30)
  const [filterForm, setFilterForm] = useState('')
  const [filterEnum, setFilterEnum] = useState('')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Pin | null>(null)
  const [detail, setDetail] = useState<SubmissionDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [forms, setForms] = useState<{ id: string; title: string }[]>([])
  const [enumerators, setEnumerators] = useState<string[]>([])
  const [filterStatus, setFilterStatus] = useState('')
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletRef = useRef<L.Map | null>(null)
  const markersRef = useRef<L.Marker[]>([])

  // Load summary on mount (fast — no rows)
  useEffect(() => {
    api.get('/submissions/map-summary').then(r => setMapSummary(r.data)).catch(() => {})
    api.get('/forms/?status=active').then(r => setForms(r.data || [])).catch(() => {})
  }, [])

  const loadPins = useCallback(async () => {
    setPinsLoading(true)
    try {
      const params: Record<string, string | number> = { days }
      if (filterForm) params.form_id = filterForm
      const { data } = await api.get('/submissions/map-data', { params })
      setPins(data)
      setPinsLoaded(true)
      const enumSet = new Set<string>(data.map((p: Pin) => p.enumerator).filter(Boolean))
      setEnumerators(Array.from(enumSet).sort())
    } catch { } finally { setPinsLoading(false) }
  }, [days, filterForm])

  const refresh = useCallback(async () => {
    if (!pinsLoaded) return
    setLoading(true)
    try {
      const params: Record<string, string | number> = { days }
      if (filterForm) params.form_id = filterForm
      const { data } = await api.get('/submissions/map-data', { params })
      setPins(data)
      const enumSet = new Set<string>(data.map((p: Pin) => p.enumerator).filter(Boolean))
      setEnumerators(Array.from(enumSet).sort())
    } catch { } finally { setLoading(false) }
  }, [days, filterForm, pinsLoaded])

  const selectPin = useCallback(async (pin: Pin) => {
    setSelected(pin)
    setDetail(null)
    setLoadingDetail(true)
    try {
      const { data } = await api.get(`/submissions/${pin.id}`)
      setDetail(data)
    } catch { } finally { setLoadingDetail(false) }
  }, [])

  // Init Leaflet
  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return
    const map = L.map(mapRef.current, { center: [20.5937, 78.9629], zoom: 5 })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 18,
    }).addTo(map)
    leafletRef.current = map
    return () => { map.remove(); leafletRef.current = null }
  }, [])

  // Re-render pins on filter/data change
  useEffect(() => {
    const map = leafletRef.current
    if (!map) return

    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    const visiblePins = pins
      .filter(p => !filterEnum || p.enumerator === filterEnum)
      .filter(p => !filterStatus || p.status === filterStatus)

    visiblePins.forEach(pin => {
      if (!pin.lat || !pin.lng) return
      const color = STATUS_COLOR[pin.status] || '#6B7280'
      const hoverText = [pin.beneficiary_name, pin.form, pin.enumerator].filter(Boolean).join(' · ')
      const icon = L.divIcon({
        html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:pointer" title="${hoverText}"></div>`,
        iconSize: [12, 12], iconAnchor: [6, 6], className: '',
      })
      const marker = L.marker([pin.lat, pin.lng], { icon })
        .addTo(map)
        .on('click', () => selectPin(pin))
      markersRef.current.push(marker)
    })

    if (visiblePins.length > 0) {
      const latlngs = visiblePins.filter(p => p.lat && p.lng).map(p => [p.lat, p.lng])
      if (latlngs.length) map.fitBounds(latlngs, { padding: [40, 40] })
    }
  }, [pins, filterEnum, filterStatus, selectPin])

  const visible = pins
    .filter(p => !filterEnum || p.enumerator === filterEnum)
    .filter(p => !filterStatus || p.status === filterStatus)
  const counts = visible.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc }, {} as Record<string, number>)

  // Build display rows from data_json
  const formAnswers = detail
    ? Object.entries(detail.data_json)
        .filter(([k]) => !SKIP_KEYS.has(k) && !k.startsWith('_'))
        .map(([k, v]) => ({ key: k, label: fmtKey(k), value: fmtVal(v) }))
    : []

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={getNavItems(user?.role ?? '')} role={user?.role} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav title="Live Field Map"
          rightContent={
            <div className="flex items-center gap-2 flex-nowrap overflow-x-auto">
              <select value={filterForm} onChange={e => setFilterForm(e.target.value)}
                className="border border-catalan-border rounded-lg px-2 py-1.5 text-xs bg-catalan-bg text-catalan-text max-w-[140px]">
                <option value="">All forms</option>
                {forms.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
              </select>
              <select value={filterEnum} onChange={e => setFilterEnum(e.target.value)}
                className="border border-catalan-border rounded-lg px-2 py-1.5 text-xs bg-catalan-bg text-catalan-text max-w-[130px]">
                <option value="">All enumerators</option>
                {enumerators.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="border border-catalan-border rounded-lg px-2 py-1.5 text-xs bg-catalan-bg text-catalan-text">
                <option value="">All statuses</option>
                {Object.keys(STATUS_COLOR).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={days} onChange={e => setDays(Number(e.target.value))}
                className="border border-catalan-border rounded-lg px-2 py-1.5 text-xs bg-catalan-bg text-catalan-text">
                <option value={0}>All time</option>
                <option value={1}>Today</option>
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
                <option value={365}>Last year</option>
              </select>
              {pinsLoaded && (
                <button onClick={refresh} disabled={loading}
                  className="px-3 py-1.5 text-xs border border-catalan-border rounded-lg text-catalan-text hover:bg-catalan-hover disabled:opacity-40">
                  {loading ? '…' : '↺ Refresh'}
                </button>
              )}
            </div>
          }
        />

        <div className="flex-1 flex overflow-hidden">
          {/* Map area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Stats bar */}
            <div className="flex gap-4 px-4 py-2 bg-catalan-surface border-b border-catalan-border text-xs flex-wrap flex-shrink-0">
              {pinsLoaded ? (
                <>
                  <span className="text-catalan-textMuted font-medium">{visible.length} GPS points</span>
                  {Object.entries(STATUS_COLOR).map(([s, c]) => counts[s] ? (
                    <span key={s} className="flex items-center gap-1">
                      <span style={{ background: c }} className="w-2.5 h-2.5 rounded-full inline-block" />
                      <span className="capitalize">{s}</span>: <strong>{counts[s]}</strong>
                    </span>
                  ) : null)}
                  {loading && <span className="text-catalan-textMuted animate-pulse">Refreshing…</span>}
                </>
              ) : (
                <>
                  {mapSummary ? (
                    <>
                      <span className="text-catalan-textMuted font-medium">
                        {mapSummary.total_with_gps.toLocaleString()} GPS points available · {mapSummary.total_submissions.toLocaleString()} total submissions
                      </span>
                      {mapSummary.date_range.first && (
                        <span className="text-catalan-textMuted">
                          {mapSummary.date_range.first} – {mapSummary.date_range.last}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-catalan-textMuted animate-pulse">Loading summary…</span>
                  )}
                </>
              )}
            </div>

            {/* Map */}
            <div className="flex-1 relative">
              <div ref={mapRef} className="absolute inset-0" />

              {/* Load GPS Points overlay — shown before pins are loaded */}
              {!pinsLoaded && (
                <div className="absolute inset-0 flex items-center justify-center z-[500] bg-catalan-bg/60 backdrop-blur-sm">
                  <div className="bg-catalan-surface border border-catalan-border rounded-2xl p-8 text-center shadow-xl max-w-sm mx-4">
                    <div className="text-4xl mb-3">🗺️</div>
                    <div className="text-base font-semibold text-catalan-text mb-1">Field Map</div>
                    {mapSummary && (
                      <div className="text-sm text-catalan-textMuted mb-4">
                        {mapSummary.total_with_gps.toLocaleString()} GPS points ready to display
                      </div>
                    )}
                    <button
                      onClick={loadPins}
                      disabled={pinsLoading}
                      className="px-6 py-2.5 bg-catalan-primary text-catalan-bg rounded-lg font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                      {pinsLoading ? 'Loading GPS Points…' : `Load${mapSummary ? ` ${mapSummary.total_with_gps.toLocaleString()}` : ''} GPS Points →`}
                    </button>
                  </div>
                </div>
              )}

              {/* Legend */}
              <div className="absolute bottom-4 left-4 z-[400] bg-catalan-surface/95 border border-catalan-border rounded-xl p-3 shadow-lg text-xs space-y-1.5">
                {Object.entries(STATUS_COLOR).map(([s, c]) => (
                  <div key={s} className="flex items-center gap-2">
                    <span style={{ background: c }} className="w-3 h-3 rounded-full inline-block flex-shrink-0" />
                    <span className="capitalize text-catalan-text">{s}</span>
                  </div>
                ))}
              </div>

              {pinsLoaded && visible.length === 0 && !loading && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-catalan-surface/90 rounded-xl p-6 text-center shadow">
                    <div className="text-4xl mb-2">🗺️</div>
                    <div className="text-sm text-catalan-textMuted">No GPS submissions in the selected period</div>
                    <div className="text-xs text-catalan-textMuted mt-1">Try expanding the date range or changing filters</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Detail panel — slides in when a pin is selected */}
          {selected && (
            <div className="w-96 flex-shrink-0 border-l border-catalan-border bg-catalan-surface flex flex-col overflow-hidden">
              {/* Panel header */}
              <div className="flex items-start justify-between px-4 py-3 border-b border-catalan-border flex-shrink-0">
                <div className="flex-1 min-w-0 pr-2">
                  {selected.beneficiary_name && (
                    <div className="font-bold text-catalan-text text-base leading-snug truncate">{selected.beneficiary_name}</div>
                  )}
                  <div className={`truncate ${selected.beneficiary_name ? 'text-xs text-catalan-textMuted mt-0.5' : 'font-semibold text-catalan-text text-sm'}`}>
                    {selected.form}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BG[selected.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {selected.status}
                    </span>
                    {detail?.serial_no && (
                      <span className="text-xs text-catalan-textMuted">#{detail.serial_no}</span>
                    )}
                  </div>
                </div>
                <button onClick={() => { setSelected(null); setDetail(null) }}
                  className="text-catalan-textMuted hover:text-catalan-text text-xl leading-none flex-shrink-0 mt-0.5">×</button>
              </div>

              {/* Panel body */}
              <div className="flex-1 overflow-y-auto">
                {/* Meta info */}
                <div className="px-4 py-3 border-b border-catalan-border space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-catalan-textMuted text-xs">
                    <span>👤</span>
                    <span className="font-medium text-catalan-text">{selected.enumerator}</span>
                    <span className="text-catalan-textMuted/60">Enumerator</span>
                  </div>
                  {selected.received && (
                    <div className="flex items-center gap-2 text-catalan-textMuted text-xs">
                      <span>🕐</span>
                      <span>{new Date(selected.received).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-catalan-textMuted text-xs">
                    <span>📍</span>
                    <span className="font-mono">{selected.lat?.toFixed(5)}, {selected.lng?.toFixed(5)}</span>
                    {selected.accuracy && <span className="text-catalan-textMuted/70">(±{selected.accuracy.toFixed(0)}m)</span>}
                  </div>
                  {detail?.flag_note && (
                    <div className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-700">
                      <span className="flex-shrink-0">🚩</span>
                      <span>{detail.flag_note}</span>
                    </div>
                  )}
                  {detail?.backcheck_required && (
                    <div className="text-xs bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 text-blue-700">
                      🔍 Backcheck required
                    </div>
                  )}
                </div>

                {/* Form answers */}
                <div className="px-4 py-3">
                  <div className="text-[11px] font-semibold text-catalan-textMuted uppercase tracking-wider mb-3">
                    Form Answers
                  </div>

                  {loadingDetail ? (
                    <div className="py-8 text-center text-catalan-textMuted text-sm animate-pulse">Loading answers…</div>
                  ) : formAnswers.length === 0 ? (
                    <div className="py-6 text-center text-catalan-textMuted text-xs">No form data available</div>
                  ) : (
                    <div className="space-y-3">
                      {formAnswers.map(({ key, label, value }) => (
                        <div key={key} className="border-b border-catalan-border/50 pb-2 last:border-0">
                          <div className="text-xs text-catalan-textMuted mb-0.5">{label}</div>
                          <div className={`text-sm text-catalan-text break-words ${value === '—' ? 'text-catalan-textMuted/60 italic' : 'font-medium'}`}>
                            {value}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Panel footer */}
              <div className="px-4 py-3 border-t border-catalan-border flex-shrink-0">
                <a href={`/dashboard?submission=${selected.id}`}
                  className="block w-full text-center py-2 text-xs font-semibold text-catalan-primary border border-catalan-primary/30 rounded-lg hover:bg-catalan-primary/5 transition-colors">
                  Open full submission →
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
