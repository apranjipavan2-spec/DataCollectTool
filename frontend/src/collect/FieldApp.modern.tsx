import React, { useState, useEffect, useRef, useCallback } from 'react'
import api from '@/lib/api'
import type { FormSchema } from '@/types/form'
import FormRenderer, { type SubmissionDraft } from '@/renderer/FormRenderer'
import { getStorage } from '@/storage'
import { v4 as uuidv4 } from 'uuid'
import { useLanguage, LANGUAGE_OPTIONS } from '@/i18n/LanguageContext'
import { compressImage } from '@/utils/imageCompress'
import { Button, Card, Alert } from '@/components/ui'

type Screen = 'list' | 'drafts' | 'collecting' | 'submitted'

interface FormMeta { id: string; title: string; version: number }

export default function FieldApp() {
  const [screen, setScreen] = useState<Screen>('list')
  const [forms, setForms] = useState<FormMeta[]>([])
  const [activeForm, setActiveForm] = useState<{ meta: FormMeta; schema: FormSchema } | null>(null)
  const [outboxCount, setOutboxCount] = useState(0)
  const [mediaQueueCount, setMediaQueueCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [syncMsg, setSyncMsg] = useState('')
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [schedules, setSchedules] = useState<any[]>([])
  const syncRef = useRef<() => Promise<void>>()
  const { language, setLanguage } = useLanguage()

  // ── Sync to server ─────────────────────────────────────────
  const syncToServer = useCallback(async () => {
    setSyncMsg('Syncing…')
    const store = await getStorage()
    const outbox = await store.getOutbox()
    const mediaCount = await store.getMediaQueueCount()
    if (outbox.length === 0 && mediaCount === 0) { setSyncMsg(''); return }

    let textSynced = 0
    const idMap = new Map<string, string>()

    // Phase 1: Push text data
    if (outbox.length > 0) {
      try {
        const payload = outbox.map(s => {
          const dataClean: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(s.data)) {
            if (typeof v === 'string' && v.startsWith('data:image/')) {
              dataClean[k] = '__photo_pending__'
            } else if (typeof v === 'string' && v.startsWith('data:audio/')) {
              dataClean[k] = '__audio_pending__'
            } else {
              dataClean[k] = v
            }
          }
          return {
            local_id: s.id, form_id: s.formId, form_version: s.formVersion,
            data_json: dataClean, gps_open: s.gpsOpen ?? null, gps_submit: s.gpsSubmit ?? null,
            local_created_at: s.createdAt,
          }
        })
        const { data } = await api.post('/sync/push', { submissions: payload })
        for (const r of data.results as Array<{ local_id: string; server_id: string }>) {
          idMap.set(r.local_id, r.server_id)
          await store.saveIdMapping(r.local_id, r.server_id)
        }
        await Promise.all(data.results.map((r: { local_id: string }) => store.markSynced(r.local_id)))
        textSynced = data.received
        setOutboxCount(0)
      } catch {
        setSyncMsg(navigator.onLine ? '⚠ Sync failed — tap to retry' : '⚠ Offline — will sync when connected')
        return
      }
    }

    // Phase 2: Upload media
    const mediaQueue = await store.getMediaQueue()
    let mediaUploaded = 0
    let mediaFailed = 0

    for (const item of mediaQueue) {
      let serverId = idMap.get(item.submissionId)
      if (!serverId) {
        serverId = await store.getServerId(item.submissionId) ?? undefined
      }
      if (!serverId) {
        mediaFailed++
        continue
      }

      try {
        await store.updateMediaStatus(item.id, 'uploading')
        setSyncMsg(`Uploading photo ${mediaUploaded + 1}/${mediaQueue.length}…`)
        const blob = dataUriToBlob(item.dataUri)
        const formData = new FormData()
        formData.append('submission_id', serverId)
        formData.append('field_name', item.fieldName)
        formData.append('file_type', item.fileType)
        formData.append('file', blob, `${item.fieldName}.jpg`)
        await api.post('/sync/media', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        await store.deleteMediaItem(item.id)
        mediaUploaded++
      } catch {
        await store.updateMediaStatus(item.id, 'failed')
        mediaFailed++
      }
    }

    const parts: string[] = []
    if (textSynced > 0) parts.push(`${textSynced} synced`)
    if (mediaUploaded > 0) parts.push(`${mediaUploaded} photo(s) uploaded`)
    if (mediaFailed > 0) parts.push(`${mediaFailed} photo(s) failed`)

    setSyncMsg(parts.length > 0 ? `✓ ${parts.join(', ')}` : '')
    setTimeout(() => setSyncMsg(''), 4000)

    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SYNC_COMPLETE' })
    }
  }, [])

  useEffect(() => { syncRef.current = syncToServer }, [syncToServer])

  // Auto-sync on reconnect
  useEffect(() => {
    const goOnline = () => { setIsOffline(false); syncRef.current?.() }
    const goOffline = () => setIsOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline) }
  }, [])

  // Service Worker sync
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'TRIGGER_SYNC') syncRef.current?.() }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [])

  // Load forms
  useEffect(() => {
    const loadForms = async () => {
      const store = await getStorage()
      const outbox = await store.getOutbox()
      const pendingMedia = await store.getMediaQueueCount()
      setOutboxCount(outbox.length)
      setMediaQueueCount(pendingMedia)
      if ((outbox.length > 0 || pendingMedia > 0) && navigator.onLine) syncToServer()

      api.get('/schedules/').then(r => setSchedules(r.data)).catch(() => {})

      try {
        const { data } = await api.get<Array<{ id: string; title: string; version: number }>>('/forms/?status=active')
        setForms(data)
        await Promise.all(data.map(async f => {
          try {
            const detail = await api.get<{ json_schema: FormSchema }>(`/forms/${f.id}`)
            await store.saveFormCache({
              id: f.id, title: f.title, version: f.version, status: 'active',
              schema: JSON.stringify(detail.data.json_schema),
              cachedAt: new Date().toISOString(),
            })
          } catch { }
        }))
      } catch {
        const cached = await store.listFormCache()
        setForms(cached.map(c => ({ id: c.id, title: c.title, version: c.version })))
      } finally {
        setLoading(false)
      }
    }
    loadForms()
  }, [syncToServer])

  const openForm = async (meta: FormMeta) => {
    try {
      const { data } = await api.get<{ json_schema: FormSchema }>(`/forms/${meta.id}`)
      setActiveForm({ meta, schema: data.json_schema })
    } catch {
      const store = await getStorage()
      const cached = await store.getFormCache(meta.id)
      if (!cached) { setSyncMsg('Form not available offline'); return }
      setActiveForm({ meta, schema: JSON.parse(cached.schema) as FormSchema })
    }
    setScreen('collecting')
  }

  const handleSave = async (draft: SubmissionDraft) => {
    const store = await getStorage()
    await store.saveSubmission({
      id: draft.id, formId: activeForm!.meta.id,
      formVersion: draft.formVersion, data: draft.values,
      gpsOpen: draft.gpsOpen ?? undefined, gpsSubmit: draft.gpsSubmit ?? undefined,
      status: draft.status as 'draft' | 'outbox',
      createdAt: draft.startedAt, updatedAt: new Date().toISOString(),
    })
  }

  const handleSubmit = async (draft: SubmissionDraft) => {
    await handleSave(draft)
    setOutboxCount(c => c + 1)

    const store = await getStorage()
    for (const [fieldName, value] of Object.entries(draft.values)) {
      if (typeof value === 'string' && value.startsWith('data:image/')) {
        const { dataUri: compressed, sizeKB } = await compressImage(value)
        console.log(`[FieldApp] Photo '${fieldName}' compressed to ${sizeKB.toFixed(0)}KB`)
        await store.saveMediaItem({
          id: uuidv4(), submissionId: draft.id, fieldName,
          fileType: 'photo', dataUri: compressed, status: 'pending',
          createdAt: new Date().toISOString(),
        })
      } else if (typeof value === 'string' && value.startsWith('data:audio/')) {
        await store.saveMediaItem({
          id: uuidv4(), submissionId: draft.id, fieldName,
          fileType: 'audio', dataUri: value, status: 'pending',
          createdAt: new Date().toISOString(),
        })
      }
    }

    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready
        await reg.sync?.register('sync-submissions')
      } catch { }
    }

    syncToServer()
    setScreen('submitted')
  }

  // Submitted confirmation screen
  if (screen === 'submitted') {
    return (
      <div className="min-h-screen bg-catalan-bg flex flex-col items-center justify-center p-6">
        <div className="text-center">
          <div className="text-6xl mb-6">✅</div>
          <h2 className="text-2xl font-bold text-catalan-success mb-3">Submitted!</h2>
          <p className="text-catalan-textMuted mb-2">
            {outboxCount > 0
              ? `${outboxCount} submission(s) in outbox — keep app open to sync`
              : 'Synced to server'}
          </p>
          {syncMsg && <p className="text-catalan-info text-sm mb-6">{syncMsg}</p>}
          <div className="flex gap-3 justify-center flex-col sm:flex-row">
            <Button onClick={() => setScreen('list')} size="lg">
              Fill Another Form
            </Button>
            <Button
              onClick={() => window.location.href = '/'}
              variant="secondary"
              size="lg"
            >
              Home
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Form collection screen
  if (screen === 'collecting' && activeForm) {
    return (
      <FormRenderer
        schema={activeForm.schema}
        onSave={handleSave}
        onSubmit={handleSubmit}
        onCancel={() => { setScreen('list'); setActiveForm(null) }}
      />
    )
  }

  // Form list screen
  return (
    <div className="min-h-screen bg-catalan-bg flex flex-col max-w-2xl mx-auto">
      {/* Header */}
      <div className="bg-catalan-surface border-b border-catalan-border p-4 sticky top-0 z-10">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-catalan-hover text-catalan-textMuted hover:text-catalan-primary hover:bg-catalan-primary/10 transition-all duration-200"
              title="Back to Dashboard"
            >
              <span className="text-lg leading-none">&larr;</span>
            </a>
            <h1 className="text-2xl font-bold text-catalan-text">FieldPulse</h1>
          </div>
          <div className="flex gap-2 items-center">
            {isOffline && (
              <span className="text-xs text-catalan-warning bg-catalan-warning/10 px-2 py-1 rounded-full font-medium">
                📡 Offline
              </span>
            )}
          </div>
        </div>

        {/* Language Toggle & Sync Status */}
        <div className="flex justify-between items-center gap-4">
          <div className="flex bg-catalan-hover rounded-full p-0.5 border border-catalan-border">
            {LANGUAGE_OPTIONS.map(opt => (
              <button
                key={opt.code}
                onClick={() => setLanguage(opt.code)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 ${
                  language === opt.code
                    ? 'bg-catalan-primary text-catalan-bg shadow-sm'
                    : 'text-catalan-textMuted hover:text-catalan-text'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex gap-3 items-center text-sm">
            {(outboxCount > 0 || mediaQueueCount > 0) && (
              <button
                onClick={syncToServer}
                className="text-catalan-warning bg-catalan-warning/10 px-3 py-1 rounded border border-catalan-warning/30 hover:bg-catalan-warning/20 transition-colors"
              >
                ↑ {outboxCount > 0 ? `${outboxCount}` : ''}{outboxCount > 0 && mediaQueueCount > 0 ? ' · ' : ''}{mediaQueueCount > 0 ? `${mediaQueueCount} 📷` : ''}
              </button>
            )}
            {syncMsg && <span className="text-catalan-info text-xs">{syncMsg}</span>}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Schedules */}
        {schedules.length > 0 && (
          <div className="mb-8">
            <h2 className="text-catalan-primary font-semibold mb-3">Your Schedules</h2>
            <div className="space-y-3">
              {schedules.filter(s => s.status === 'active' || s.status === 'upcoming').map((s: any) => (
                <Card key={s.id}>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="font-medium text-catalan-text mb-1">{s.form_title}</h3>
                      <p className="text-xs text-catalan-textMuted">
                        {s.location && <span>{s.location} · </span>}
                        {s.start_date} → {s.end_date}
                        {s.target_count > 0 && <span> · Target: {s.target_count}</span>}
                      </p>
                      {s.notes && <p className="text-xs text-catalan-textMuted italic mt-2">{s.notes}</p>}
                    </div>
                    <span className={`text-xs px-2 py-1 rounded whitespace-nowrap ml-3 ${
                      s.status === 'active'
                        ? 'bg-catalan-success/10 text-catalan-success'
                        : 'bg-catalan-info/10 text-catalan-info'
                    }`}>
                      {s.status}
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Forms */}
        <div>
          <h2 className="text-catalan-textMuted text-sm font-medium mb-4">Select a form to collect</h2>

          {loading && (
            <div className="text-center py-12">
              <div className="text-catalan-textMuted">Loading forms…</div>
            </div>
          )}

          {!loading && forms.length === 0 && (
            <div className="text-center py-12">
              <div className="text-5xl mb-4">📋</div>
              <p className="text-catalan-textMuted">No active forms assigned to you.</p>
            </div>
          )}

          <div className="space-y-3">
            {forms.map(f => (
              <button
                key={f.id}
                onClick={() => openForm(f)}
                className="w-full p-4 bg-catalan-surface border border-catalan-border rounded-lg hover:border-catalan-primary hover:shadow-lg hover:shadow-catalan-primary/5 transition-all duration-200 text-left group"
              >
                <div className="flex justify-between items-center">
                  <div className="flex-1">
                    <div className="font-medium text-catalan-text group-hover:text-catalan-primary transition-colors">{f.title}</div>
                    <div className="text-xs text-catalan-textMuted mt-1">v{f.version}</div>
                  </div>
                  <span className="text-catalan-primary text-xl ml-3 group-hover:translate-x-1 transition-transform duration-200">&rarr;</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function dataUriToBlob(dataUri: string): Blob {
  const [header, base64] = dataUri.split(',')
  const mime = header.match(/:(.*?);/)?.[1] ?? 'application/octet-stream'
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: mime })
}
