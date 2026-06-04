import React, { useRef, useState } from 'react'
import type { FormField } from '@/types/form'
import { labelCls, hintCls, captureButtonCls, recordingButtonCls, fieldErrorCls, fieldHintCls, requiredCls } from './styles'
import EmojiIcon from '@/components/EmojiIcon'

interface Props { field: FormField; value: string | null; onChange: (v: string) => void }

/**
 * AudioField — records audio via MediaRecorder API.
 * Stores compressed audio as a base64 data URI (webm/opus or mp4/aac fallback).
 * Typically 30s recording = ~60-100KB at low bitrate.
 */
export default function AudioField({ field, value, onChange }: Props) {
  const [recording, setRecording] = useState(false)
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
      }

      recorder.start(1000)
      recorderRef.current = recorder
      setRecording(true)
      setDuration(0)
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000)
    } catch {
      setError('Microphone access denied')
    }
  }

  const stopRecording = () => { recorderRef.current?.stop() }

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
        <button onClick={stopRecording} className={recordingButtonCls}>
          <span className="text-3xl">⏹</span>
          <span>Stop Recording — {fmt(duration)}</span>
          <span className="text-xl animate-pulse">●</span>
        </button>
      ) : (
        <button onClick={startRecording} className={captureButtonCls}>
          <span className="text-3xl"><EmojiIcon e="🎙" /></span>
          <span>{value ? 'Re-record Audio' : 'Record Audio'}</span>
        </button>
      )}

      {error && <div className={fieldErrorCls}>{error}</div>}

      {value && !recording && (
        <div className="mt-3 bg-catalan-hover border border-catalan-border rounded-xl p-3">
          <audio ref={audioRef} src={value} controls className="w-full h-9" />
          <div className={`${fieldHintCls} mt-1`}>
            {Math.round(value.length * 0.75 / 1024)} KB recorded
          </div>
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
