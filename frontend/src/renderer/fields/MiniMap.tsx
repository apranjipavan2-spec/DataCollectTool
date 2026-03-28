import React, { useState } from 'react'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix default marker icon path issue (known webpack/vite bundling problem)
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

interface Props {
  lat: number
  lng: number
  accuracy?: number
}

function RecenterMap({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  React.useEffect(() => {
    map.setView([lat, lng], 15)
  }, [lat, lng, map])
  return null
}

export default function MiniMap({ lat, lng, accuracy: _accuracy }: Props) {
  const [interactive, setInteractive] = useState(false)

  return (
    <div className="relative mt-2 rounded-lg overflow-hidden border border-catalan-border">
      <MapContainer
        center={[lat, lng]}
        zoom={15}
        style={{ height: '200px', width: '100%' }}
        scrollWheelZoom={interactive}
        dragging={interactive}
        zoomControl={interactive}
        doubleClickZoom={interactive}
        touchZoom={interactive}
        attributionControl={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[lat, lng]} />
        <RecenterMap lat={lat} lng={lng} />
      </MapContainer>
      {!interactive && (
        <button
          onClick={() => setInteractive(true)}
          className="absolute top-2 right-2 z-[1000] bg-catalan-surface/90 text-catalan-text text-xs px-2 py-1 rounded border border-catalan-border hover:bg-catalan-hover transition-colors"
        >
          Expand Map
        </button>
      )}
      {interactive && (
        <button
          onClick={() => setInteractive(false)}
          className="absolute top-2 right-2 z-[1000] bg-catalan-surface/90 text-catalan-text text-xs px-2 py-1 rounded border border-catalan-border hover:bg-catalan-hover transition-colors"
        >
          Lock Map
        </button>
      )}
    </div>
  )
}
