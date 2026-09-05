import { useRef, useState } from 'react'
import type { FormField } from '@/types/form'
import { labelCls, hintCls, captureButtonCls, recordingButtonCls, fieldErrorCls, fieldHintCls, requiredCls } from './styles'
import EmojiIcon from '@/components/EmojiIcon'

interface Props { field: FormField; value: string | null; onChange: (v: string) => void; submissionId?: string }

/** Guess a file extension from a data: URI's mime type, for the download filename. */
function extFromDataUri(uri: string): string {
  const m = /^data:audio\/([a-z0-9]+)/i.exec(uri)
  const mime = m?.[1]?.toLowerCase()
  return mime === 'webm' ? 'webm' : mime === 'mp4' ? 'm4a' : mime === 'ogg' ? 'ogg' : mime === 'mpeg' ? 'mp3' : 'audio'
}

/**
 * AudioField — records audio via MediaRecorder API.
 * Stores compressed audio as a base64 data URI (webm/opus or mp4/aac fallback).
 * Typically 30s recording = ~60-100KB at low bitrate.
 */
export default function AudioField({ field, value, onChange, submissionId }: Props) {
  const [recording, setRecording] = useState(false)
  const [paused, setPaused]       = useState(false)
  const [duration, setDuration]   = useState(0)
  const [error, setError]         = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef   = useRef<Blob[]>([])
  const timerRef    = useRef<ReturnType<typeof setInterval>>()
  const audioRef    = useRef<HTMLAudioElement>(null)

  const startRecording = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      })

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : ''

      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 24000,
      })

      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        clearInterval(timerRef.current)
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType })
        blobToDataUri(blob).then(onChange)
        setRecording(false)
        setPaused(false)
      }

      recorder.start(1000)
      recorderRef.current = recorder
      setRecording(true)
      setPaused(false)
      setDuration(0)
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000)
    } catch (e) {
      const err = e as DOMException
      const msg =
        err?.name === 'NotAllowedError'  ? 'Microphone access denied. Allow mic in your browser settings and retry.'
        : err?.name === 'NotFoundError'  ? 'No microphone found on this device.'
        : err?.name === 'NotReadableError' ? 'Microphone is in use by another app. Close it and retry.'
        : window.isSecureContext === false ? 'Recording needs a secure (https) connection.'
        : `Recording failed: ${err?.name || ''} ${err?.message || String(e)}`.trim()
      setError(msg)
      console.error('[AudioField] recording error', e)
    }
  }

  const stopRecording = () => { recorderRef.current?.stop() }

  const pauseRecording = () => {
    recorderRef.current?.pause()
    clearInterval(timerRef.current)
    setPaused(true)
  }

  const resumeRecording = () => {
    recorderRef.current?.resume()
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000)
    setPaused(false)
  }

  const deleteRecording = () => { onChange('') }

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

  return (
    <div>
      <label className={labelCls}>
        {field.label}
        {field.required && <span className={requiredCls}> *</span>}
      </label>
      {field.hint && <div className={hintCls}>{field.hint}</div>}

      {recording ? (
        <div className="flex gap-2">
          <button type="button" onClick={stopRecording} className={`${recordingButtonCls} flex-1`}>
            <span className="text-3xl">⏹</span>
            <span>Stop — {fmt(duration)}</span>
            {!paused && <span className="text-xl animate-pulse">●</span>}
          </button>
          <button type="button" onClick={paused ? resumeRecording : pauseRecording} className={`${captureButtonCls} flex-1`}>
            <span className="text-3xl">{paused ? '▶' : '⏸'}</span>
            <span>{paused ? 'Resume' : 'Pause'}</span>
          </button>
        </div>
      ) : (
        <button type="button" onClick={startRecording} className={captureButtonCls}>
          <span className="text-3xl"><EmojiIcon e="🎙" /></span>
          <span>{value ? 'Re-record Audio' : 'Record Audio'}</span>
        </button>
      )}

      {error && <div className={fieldErrorCls}>{error}</div>}

      {value && !recording && (
        <div className="mt-3 bg-catalan-hover border border-catalan-border rounded-xl p-3">
          <audio ref={audioRef} src={value} controls className="w-full h-9" />
          <div className="flex items-center justify-between mt-1">
            <div className={fieldHintCls}>{Math.round(value.length * 0.75 / 1024)} KB recorded</div>
            <div className="flex items-center gap-3">
              <a
                href={value}
                download={`${field.name}_${submissionId ?? 'draft'}.${extFromDataUri(value)}`}
                className="text-catalan-primary text-xs font-medium cursor-pointer hover:underline"
              >
                Download
              </a>
              <button type="button" onClick={deleteRecording} className="text-catalan-error text-xs font-medium cursor-pointer hover:underline">
                Delete recording
              </button>
            </div>
          </div>
          {submissionId && (
            <div className="text-catalan-textMuted text-[10px] mt-1 font-mono opacity-60">ID: {submissionId}/{field.name}</div>
          )}
        </div>
      )}
    </div>
  )
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.readAsDataURL(blob)
  })
}
