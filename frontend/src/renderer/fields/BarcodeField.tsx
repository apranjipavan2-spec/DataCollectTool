import { useRef, useState, useEffect } from 'react'
import type { FormField } from '@/types/form'
import { labelCls, hintCls, inputCls, captureButtonCls, recordingButtonCls, fieldErrorCls, requiredCls } from './styles'
import EmojiIcon from '@/components/EmojiIcon'

interface Props { field: FormField; value: string; onChange: (v: string) => void }

/**
 * BarcodeField — scans barcodes/QR codes using the BarcodeDetector API (Chrome 83+).
 * Falls back to manual text input on unsupported browsers (Safari, older devices).
 */
export default function BarcodeField({ field, value, onChange }: Props) {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const [scanning, setScanning]     = useState(false)
  const [error, setError]           = useState('')
  const [hasDetector]               = useState(() => 'BarcodeDetector' in window)
  const streamRef = useRef<MediaStream | null>(null)
  const animRef   = useRef<number>(0)

  const startScanning = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      streamRef.current = stream
      setScanning(true)
      await new Promise(r => setTimeout(r, 100))
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        detectLoop()
      }
    } catch {
      setError('Camera access denied')
    }
  }

  const stopScanning = () => {
    cancelAnimationFrame(animRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setScanning(false)
  }

  const detectLoop = async () => {
    if (!videoRef.current || !streamRef.current) return
    try {
      // @ts-ignore — BarcodeDetector not in all TS libs
      const detector = new (window as any).BarcodeDetector({
        formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf'],
      })
      const barcodes = await detector.detect(videoRef.current)
      if (barcodes.length > 0) {
        onChange(barcodes[0].rawValue)
        stopScanning()
        return
      }
    } catch { /* continue */ }
    if (streamRef.current) {
      animRef.current = requestAnimationFrame(detectLoop)
    }
  }

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  return (
    <div>
      <label className={labelCls}>
        {field.label}
        {field.required && <span className={requiredCls}> *</span>}
      </label>
      {field.hint && <div className={hintCls}>{field.hint}</div>}

      {/* Scanned value display */}
      {value && (
        <div className="bg-catalan-success/10 border border-catalan-success/40 rounded-xl px-3.5 py-2.5 mb-3 flex justify-between items-center">
          <div>
            <div className="text-catalan-success text-xs mb-0.5">Scanned</div>
            <div className="text-catalan-text text-base font-mono">{value}</div>
          </div>
          <button
            onClick={() => onChange('')}
            className="text-catalan-textMuted hover:text-catalan-error text-lg leading-none transition-colors"
          >
            ×
          </button>
        </div>
      )}

      {scanning ? (
        <div className="relative">
          <video ref={videoRef} className="w-full rounded-xl bg-black" />
          {/* Crosshair overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-3/5 h-1/3 border-2 border-catalan-primary/60 rounded-lg" />
          </div>
          <button onClick={stopScanning} className={`${recordingButtonCls} mt-2`}>
            Cancel Scan
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          {hasDetector && (
            <button onClick={startScanning} className={`${captureButtonCls} flex-1`}>
              <span className="text-3xl"><EmojiIcon e="📷" /></span>
              <span>Scan Barcode</span>
            </button>
          )}
          <div className="flex-1">
            <input
              className={inputCls}
              type="text"
              placeholder={hasDetector ? 'Or type manually…' : 'Enter barcode…'}
              value={value}
              onChange={e => onChange(e.target.value)}
            />
            {!hasDetector && (
              <div className="text-catalan-textMuted text-xs mt-1">
                Camera scanning not supported in this browser
              </div>
            )}
          </div>
        </div>
      )}

      {error && <div className={fieldErrorCls}>{error}</div>}
    </div>
  )
}
