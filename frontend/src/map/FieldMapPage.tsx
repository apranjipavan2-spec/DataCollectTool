import { useState, useEffect, useRef, useCallback } from 'react'
import api, { getStoredUser } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'

interface Pin {
  id: string; lat: number; lng: number; accuracy: number
  status: string; enumerator: string; form: string; received: string | null
}

const STATUS_COLOR: Record<string, string> = {
  synced: '#3B82F6', approved: '#22C55E', flagged: '#F59E0B', rejected: '#EF4444',
}

export default function FieldMapPage() {
  const user = getStoredUser()
  const [pins, setPins] = useState<Pin[]>([])
  const [days, setDays] = useState(30)
  const [filterForm, setFilterForm] = useState('')
  const [filterEnum, setFilterEnum] = useState('')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Pin | null>(null)
  const [forms, setForms] = useState<{ id: string; title: string }[]>([])
  const [enumerators, setEnumerators] = useState<string[]>([])
  const [filterStatus, setFilterStatus] = useState('')
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = { days }
      if (filterForm) params.form_id = filterForm
      const { data } = await api.get('/submissions/map-data', { params })
      setPins(data)
      // Derive enumerator list from pin data
      const enumSet = new Set<string>(data.map((p: Pin) => p.enumerator).filter(Boolean))
      setEnumerators(Array.from(enumSet).sort())
    } catch { } finally { setLoading(false) }
  }, [days, filterForm])

  // Load available forms for filter dropdown
  useEffect(() => {
    api.get('/forms/?status=active').then(r => setForms(r.data || [])).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  // Init Leaflet from CDN script tag
  useEffect(() => {
    if (!mapRef.current) return
    const win = window as any

    const initMap = () => {
      if (leafletRef.current) return
      const L = win.L
      if (!L) return
      const map = L.map(mapRef.current, { center: [20.5937, 78.9629], zoom: 5 })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 18,
      }).addTo(map)
      leafletRef.current = map
    }

    if (win.L) { initMap(); return }

    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'; link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }
    if (!document.getElementById('leaflet-js')) {
      const script = document.createElement('script')
      script.id = 'leaflet-js'
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
      script.onload = initMap
      document.head.appendChild(script)
    }
  }, [])

  // Re-render pins whenever filters change
  useEffect(() => {
    const L = (window as any).L
    const map = leafletRef.current
    if (!L || !map) return

    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    const visiblePins = pins
      .filter(p => !filterEnum || p.enumerator === filterEnum)
      .filter(p => !filterStatus || p.status === filterStatus)

    visiblePins.forEach(pin => {
      if (!pin.lat || !pin.lng) return
      const color = STATUS_COLOR[pin.status] || '#6B7280'
      const icon = L.divIcon({
        html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)" title="${pin.form} · ${pin.enumerator}"></div>`,
        iconSize: [12, 12], iconAnchor: [6, 6], className: '',
      })
      const marker = L.marker([pin.lat, pin.lng], { icon })
        .addTo(map)
        .on('click', () => setSelected(pin))
      markersRef.current.push(marker)
    })

    if (visiblePins.length > 0) {
      const latlngs = visiblePins.filter(p => p.lat && p.lng).map(p => [p.lat, p.lng])
      if (latlngs.length) map.fitBounds(latlngs, { padding: [40, 40] })
    }
  }, [pins, filterEnum, filterStatus])

  const visible = pins
    .filter(p => !filterEnum || p.enumerator === filterEnum)
    .filter(p => !filterStatus || p.status === filterStatus)
  const counts = visible.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc }, {} as Record<string, number>)

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
              <button onClick={load} disabled={loading}
                className="px-3 py-1.5 text-xs border border-catalan-border rounded-lg text-catalan-text hover:bg-catalan-hover disabled:opacity-40">
                {loading ? '…' : '↺ Refresh'}
              </button>
            </div>
          }
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Stats bar */}
          <div className="flex gap-4 px-4 py-2 bg-catalan-surface border-b border-catalan-border text-xs flex-wrap">
            <span className="text-catalan-textMuted font-medium">{visible.length} submissions</span>
            {Object.entries(STATUS_COLOR).map(([s, c]) => counts[s] ? (
              <span key={s} className="flex items-center gap-1">
                <span style={{ background: c }} className="w-2.5 h-2.5 rounded-full inline-block" />
                <span className="capitalize">{s}</span>: <strong>{counts[s]}</strong>
              </span>
            ) : null)}
            {loading && <span className="text-catalan-textMuted animate-pulse">Loading…</span>}
          </div>

          {/* Map */}
          <div className="flex-1 relative">
            <div ref={mapRef} className="absolute inset-0" />

            {/* Legend */}
            <div className="absolute bottom-4 left-4 z-[400] bg-catalan-surface/95 border border-catalan-border rounded-xl p-3 shadow-lg text-xs space-y-1.5">
              {Object.entries(STATUS_COLOR).map(([s, c]) => (
                <div key={s} className="flex items-center gap-2">
                  <span style={{ background: c }} className="w-3 h-3 rounded-full inline-block flex-shrink-0" />
                  <span className="capitalize text-catalan-text">{s}</span>
                </div>
              ))}
            </div>

            {/* Selected pin popup */}
            {selected && (
              <div className="absolute top-4 right-4 z-[500] bg-catalan-surface border border-catalan-border rounded-xl shadow-xl p-4 w-72">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: (STATUS_COLOR[selected.status] || '#6B7280') + '22', color: STATUS_COLOR[selected.status] || '#6B7280' }}>
                      {selected.status}
                    </span>
                  </div>
                  <button onClick={() => setSelected(null)} className="text-catalan-textMuted hover:text-catalan-text text-lg leading-none ml-2">×</button>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="font-semibold text-catalan-text text-base leading-snug">{selected.form}</div>
                  <div className="flex items-center gap-1.5 text-catalan-textMuted text-xs">
                    <span>👤</span>
                    <span>{selected.enumerator}</span>
                  </div>
                  {selected.received && (
                    <div className="flex items-center gap-1.5 text-catalan-textMuted text-xs">
                      <span>🕐</span>
                      <span>{new Date(selected.received).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-catalan-textMuted text-xs">
                    <span>📍</span>
                    <span className="font-mono">{selected.lat?.toFixed(5)}, {selected.lng?.toFixed(5)}</span>
                    {selected.accuracy && <span>(±{selected.accuracy.toFixed(0)}m)</span>}
                  </div>
                  <div className="pt-2 border-t border-catalan-border">
                    <a
                      href={`/dashboard?submission=${selected.id}`}
                      className="text-xs text-catalan-primary hover:underline"
                    >View submission →</a>
                  </div>
                </div>
              </div>
            )}

            {visible.length === 0 && !loading && (
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
      </div>
    </div>
  )
}
