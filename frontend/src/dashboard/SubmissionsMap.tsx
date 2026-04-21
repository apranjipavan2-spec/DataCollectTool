import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export interface MapPoint {
  id: string
  lat: number
  lng: number
  status: string
  enumerator_name: string
  form_title: string
  collected_at: string | null
}

interface Props {
  points: MapPoint[]
}

const STATUS_COLOR: Record<string, string> = {
  approved: '#4ade80',
  synced:   '#60a5fa',
  flagged:  '#fbbf24',
  rejected: '#f87171',
}

function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng] as [number, number]))
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 })
  }, [points, map])
  return null
}

export default function SubmissionsMap({ points }: Props) {
  const center: [number, number] = points.length > 0
    ? [points[0].lat, points[0].lng]
    : [20.5937, 78.9629]

  return (
    <div className="relative rounded-lg overflow-hidden border border-catalan-border">
      <MapContainer
        center={center}
        zoom={5}
        style={{ height: '500px', width: '100%' }}
        scrollWheelZoom
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        {points.map(p => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lng]}
            radius={7}
            pathOptions={{
              fillColor: STATUS_COLOR[p.status] ?? '#94a3b8',
              color: '#00000033',
              weight: 1,
              fillOpacity: 0.82,
            }}
          >
            <Popup>
              <div style={{ minWidth: 160, fontFamily: 'inherit' }}>
                <div style={{ fontWeight: 700, marginBottom: 3, fontSize: '0.88rem' }}>{p.enumerator_name}</div>
                <div style={{ fontSize: '0.78rem', color: '#555', marginBottom: 4 }}>{p.form_title}</div>
                <span style={{
                  display: 'inline-block',
                  padding: '1px 8px',
                  borderRadius: 4,
                  background: (STATUS_COLOR[p.status] ?? '#94a3b8') + '30',
                  color: STATUS_COLOR[p.status] ?? '#666',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                }}>{p.status}</span>
                {p.collected_at && (
                  <div style={{ fontSize: '0.7rem', color: '#999', marginTop: 4 }}>
                    {new Date(p.collected_at).toLocaleDateString()}
                  </div>
                )}
              </div>
            </Popup>
          </CircleMarker>
        ))}
        {points.length > 0 && <FitBounds points={points} />}
      </MapContainer>

      {/* Legend */}
      <div
        className="absolute bottom-6 left-3 z-[1000] bg-white/95 border border-gray-200 rounded-lg px-3 py-2 text-xs space-y-1.5 shadow-md"
        style={{ zIndex: 1000 }}
      >
        {Object.entries(STATUS_COLOR).map(([s, c]) => (
          <div key={s} className="flex items-center gap-2">
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: c, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ color: '#555', textTransform: 'capitalize' }}>{s}</span>
          </div>
        ))}
      </div>

      {/* Point count badge */}
      <div
        className="absolute top-3 right-3 bg-white/90 border border-gray-200 rounded-lg px-2.5 py-1 text-xs text-gray-500 shadow"
        style={{ zIndex: 1000 }}
      >
        {points.length.toLocaleString()} point{points.length !== 1 ? 's' : ''}
      </div>
    </div>
  )
}
