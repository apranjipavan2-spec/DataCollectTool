import { useState, useEffect, useRef } from 'react'
import api, { getStoredUser } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { getNavItems } from '@/lib/navigation'

interface Pin {
  id: string; lat: number; lng: number; accuracy: number
  status: string; enumerator: string; form: string; received: string | null
}

const STATUS_COLOR: Record<string, string> = {
  synced: '#3B82F6', approved: '#22C55E', flagged: '#F59E0B', rejected: '#EF4444'
}

export default function FieldMapPage() {
  const user = getStoredUser()
  const [pins, setPins] = useState<Pin[]>([])
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Pin | null>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await api.get(`/submissions/map-data?days=${days}`)
      setPins(data)
    } catch { } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [days])

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
      renderPins(L, map)
    }

    if (win.L) { initMap(); return }

    // Load Leaflet CSS + JS dynamically
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'
      link.rel = 'stylesheet'
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

  const renderPins = (L: any, map: any) => {
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []
    pins.forEach(pin => {
      if (!pin.lat || !pin.lng) return
      const color = STATUS_COLOR[pin.status] || '#6B7280'
      const icon = L.divIcon({
        html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
        iconSize: [12, 12], iconAnchor: [6, 6], className: '',
      })
      const marker = L.marker([pin.lat, pin.lng], { icon })
        .addTo(map)
        .on('click', () => setSelected(pin))
      markersRef.current.push(marker)
    })
    if (pins.length > 0 && map) {
      const latlngs = pins.filter(p => p.lat && p.lng).map(p => [p.lat, p.lng])
      if (latlngs.length) map.fitBounds(latlngs, { padding: [30, 30] })
    }
  }

  useEffect(() => {
    const L = (window as any).L
    if (L && leafletRef.current) renderPins(L, leafletRef.current)
  }, [pins])

  const counts = pins.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc }, {} as Record<string, number>)

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={getNavItems(user?.role ?? '')} role={user?.role} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav title="Live Field Map"
          rightContent={
            <div className="flex items-center gap-3">
              <select value={days} onChange={e => setDays(Number(e.target.value))}
                className="border border-catalan-border rounded-lg px-3 py-1.5 text-sm bg-catalan-bg text-catalan-text">
                <option value={1}>Today</option>
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
              <button onClick={load} disabled={loading}
                className="px-3 py-1.5 text-sm border border-catalan-border rounded-lg text-catalan-text hover:bg-catalan-hover disabled:opacity-40">
                {loading ? '...' : 'Refresh'}
              </button>
            </div>
          }
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Stats bar */}
          <div className="flex gap-4 px-4 py-2 bg-catalan-surface border-b border-catalan-border text-xs">
            <span className="text-catalan-textMuted">{pins.length} submissions</span>
            {Object.entries(STATUS_COLOR).map(([s, c]) => counts[s] ? (
              <span key={s} className="flex items-center gap-1">
                <span style={{ background: c }} className="w-2.5 h-2.5 rounded-full inline-block" />
                {s}: {counts[s]}
              </span>
            ) : null)}
          </div>

          {/* Map */}
          <div className="flex-1 relative">
            <div ref={mapRef} className="absolute inset-0" />

            {/* Selected pin popup */}
            {selected && (
              <div className="absolute top-4 right-4 z-[500] bg-catalan-surface border border-catalan-border rounded-xl shadow-xl p-4 w-64">
                <div className="flex justify-between items-start mb-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full`}
                    style={{ background: STATUS_COLOR[selected.status] + '22', color: STATUS_COLOR[selected.status] }}>
                    {selected.status}
                  </span>
                  <button onClick={() => setSelected(null)} className="text-catalan-textMuted hover:text-catalan-text text-lg leading-none">×</button>
                </div>
                <div className="space-y-1.5 text-sm">
                  <div><span className="text-catalan-textMuted">Form:</span> <span className="text-catalan-text">{selected.form}</span></div>
                  <div><span className="text-catalan-textMuted">By:</span> <span className="text-catalan-text">{selected.enumerator}</span></div>
                  {selected.received && (
                    <div><span className="text-catalan-textMuted">Date:</span> <span className="text-catalan-text">
                      {new Date(selected.received).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span></div>
                  )}
                  <div><span className="text-catalan-textMuted">GPS:</span> <span className="text-catalan-text text-xs">
                    {selected.lat?.toFixed(4)}, {selected.lng?.toFixed(4)} (±{selected.accuracy?.toFixed(0)}m)
                  </span></div>
                </div>
              </div>
            )}

            {pins.length === 0 && !loading && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-catalan-surface/90 rounded-xl p-6 text-center shadow">
                  <div className="text-4xl mb-2">🗺️</div>
                  <div className="text-sm text-catalan-textMuted">No GPS submissions in the selected period</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
