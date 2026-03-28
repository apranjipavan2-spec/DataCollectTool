import React, { useState, lazy, Suspense } from 'react'
import type { FormField } from '@/types/form'
import { labelCls, hintCls, captureButtonCls, fieldErrorCls, fieldSuccessCls, requiredCls } from './styles'

const MiniMap = lazy(() => import('./MiniMap'))

interface GpsValue { lat: number; lng: number; accuracy: number }
interface Props { field: FormField; value: GpsValue | null; onChange: (v: GpsValue) => void }

export default function GpsField({ field, value, onChange }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const capture = () => {
    setLoading(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      pos => {
        onChange({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        })
        setLoading(false)
      },
      err => { setError(err.message); setLoading(false) },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  return (
    <div>
      <label className={labelCls}>
        {field.label}
        {field.required && <span className={requiredCls}> *</span>}
      </label>
      {field.hint && <div className={hintCls}>{field.hint}</div>}

      <button onClick={capture} disabled={loading} className={captureButtonCls}>
        <span className="text-3xl">📍</span>
        <span>{loading ? 'Getting location…' : value ? 'Retake GPS' : 'Capture GPS'}</span>
      </button>

      {value && (
        <div className={fieldSuccessCls}>
          {value.lat.toFixed(6)}, {value.lng.toFixed(6)} · ±{value.accuracy}m
        </div>
      )}
      {value && (
        <Suspense fallback={<div className="mt-2 h-[200px] bg-catalan-surface rounded-lg animate-pulse" />}>
          <MiniMap lat={value.lat} lng={value.lng} accuracy={value.accuracy} />
        </Suspense>
      )}
      {error && <div className={fieldErrorCls}>{error}</div>}
    </div>
  )
}
