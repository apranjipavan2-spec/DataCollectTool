import React, { useRef, useState } from 'react'
import type { FormField } from '@/types/form'
import { labelCls, hintCls, captureButtonCls, fieldHintCls, requiredCls } from './styles'
import EmojiIcon from '@/components/EmojiIcon'

interface Props { field: FormField; value: string | null; onChange: (v: string) => void }

// ── Optimal compression settings for field data collection ─────────────────
const MAX_DIMENSION = 1280   // longest edge in px (good enough for ID docs / field photos)
const TARGET_KB     = 150    // target file size after compression
const MIN_QUALITY   = 0.4    // lowest JPEG quality we'll try
const QUALITY_STEP  = 0.1    // step down per iteration

/**
 * Multi-pass compression:
 * 1. Resize to fit within MAX_DIMENSION
 * 2. Start at quality 0.75, step down until < TARGET_KB or MIN_QUALITY hit
 * Returns a compact JPEG data URI (~80-150KB from a 5MB phone camera shot)
 */
async function compressImage(file: File): Promise<{ dataUri: string; sizeKB: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)

      let w = img.width
      let h = img.height
      if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / w, MAX_DIMENSION / h)
        w = Math.round(w * ratio)
        h = Math.round(h * ratio)
      }

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)

      let quality = 0.75
      let dataUri = canvas.toDataURL('image/jpeg', quality)
      let sizeKB  = Math.round((dataUri.length - 'data:image/jpeg;base64,'.length) * 0.75 / 1024)

      while (sizeKB > TARGET_KB && quality > MIN_QUALITY) {
        quality   -= QUALITY_STEP
        dataUri    = canvas.toDataURL('image/jpeg', quality)
        sizeKB     = Math.round((dataUri.length - 'data:image/jpeg;base64,'.length) * 0.75 / 1024)
      }

      resolve({ dataUri, sizeKB })
    }
    img.src = url
  })
}

export default function PhotoField({ field, value, onChange }: Props) {
  const cameraRef  = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [sizeInfo, setSizeInfo]       = useState<string>('')
  const [compressing, setCompressing] = useState(false)

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCompressing(true)
    try {
      const origKB = Math.round(file.size / 1024)
      const { dataUri, sizeKB } = await compressImage(file)
      setSizeInfo(`${origKB.toLocaleString()} KB → ${sizeKB} KB`)
      onChange(dataUri)
    } finally {
      setCompressing(false)
      // Reset so the same file can be re-selected
      e.target.value = ''
    }
  }

  return (
    <div>
      <label className={labelCls}>
        {field.label}
        {field.required && <span className={requiredCls}> *</span>}
      </label>
      {field.hint && <div className={hintCls}>{field.hint}</div>}

      {/* Hidden inputs */}
      <input ref={cameraRef}  type="file" accept="image/*" capture="environment" className="hidden" onChange={handleChange} />
      <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={handleChange} />

      {compressing ? (
        <div className={captureButtonCls}>
          <span className="text-3xl">⏳</span>
          <span>Compressing photo…</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => cameraRef.current?.click()} className={captureButtonCls}>
            <span className="text-3xl"><EmojiIcon e="📷" /></span>
            <span className="text-sm">{value ? 'Retake' : 'Take Photo'}</span>
          </button>
          <button onClick={() => galleryRef.current?.click()} className={captureButtonCls}>
            <span className="text-3xl"><EmojiIcon e="🖼" /></span>
            <span className="text-sm">From Gallery</span>
          </button>
        </div>
      )}

      {sizeInfo && (
        <div className={`${fieldHintCls} text-catalan-success`}>Compressed: {sizeInfo}</div>
      )}
      {value && (
        <div className="mt-3">
          <div className="relative">
            <img src={value} alt="captured" className="w-full rounded-xl" />
            <button
              onClick={() => { onChange(''); setSizeInfo('') }}
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center text-lg hover:bg-black/80 transition-colors"
              title="Remove photo"
            >
              ×
            </button>
          </div>
          <button
            onClick={() => { onChange(''); setSizeInfo('') }}
            className="mt-2 w-full text-xs px-3 py-2 rounded-lg border border-catalan-error/30 text-catalan-error hover:bg-catalan-error/10 transition-colors"
          >
            <EmojiIcon e="🗑" /> Delete Photo
          </button>
        </div>
      )}
    </div>
  )
}
