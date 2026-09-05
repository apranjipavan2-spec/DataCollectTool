import React, { useState, useEffect, useRef, useCallback } from 'react'
import api from '@/lib/api'
import type { FormSchema } from '@/types/form'
import FormRenderer, { type SubmissionDraft } from '@/renderer/FormRenderer'
import { getStorage } from '@/storage'
import { v4 as uuidv4 } from 'uuid'
import { useLanguage, LANGUAGE_OPTIONS } from '@/i18n/LanguageContext'
import { compressImage } from '@/utils/imageCompress'

type Screen = 'list' | 'drafts' | 'collecting' | 'submitted'

interface FormMeta { id: string; title: string; version: number }
interface Schedule { id: string; form_title: string; status: string; due_date: string | null; location: string | null; program_name: string | null; start_date: string | null; end_date: string | null; target_count: number; notes: string | null }

export default function FieldApp() {
  const [screen, setScreen]           = useState<Screen>('list')
  const [forms, setForms]             = useState<FormMeta[]>([])
  const [activeForm, setActiveForm]   = useState<{ meta: FormMeta; schema: FormSchema } | null>(null)
  const [outboxCount, setOutboxCount] = useState(0)
  const [mediaQueueCount, setMediaQueueCount] = useState(0)
  const [loading, setLoading]         = useState(true)
  const [syncMsg, setSyncMsg]         = useState('')
  const [, setIsOffline] = useState(!navigator.onLine)
  const [schedules, setSchedules]   = useState<Schedule[]>([])
  const syncRef = useRef<() => Promise<void>>()   // stable ref so online/SW handlers always call latest
  const { language, setLanguage } = useLanguage()

  // ── Sync to server (two-phase: text first, media second) ─────────────────
  const syncToServer = useCallback(async () => {
    setSyncMsg('Syncing…')
    const store = await getStorage()
    const outbox = await store.getOutbox()
    const mediaCount = await store.getMediaQueueCount()
    if (outbox.length === 0 && mediaCount === 0) { setSyncMsg(''); return }

    let textSynced = 0
    // Map local submission IDs → server IDs for media uploads
    const idMap = new Map<string, string>()

    // ── Phase 1: Push text data (strip photo base64 from payload) ─────
    if (outbox.length > 0) {
      try {
        const payload = outbox.map(s => {
          // Strip base64 media data — replace with placeholder so payload stays small
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
        // Build local → server ID mapping for Phase 2 media uploads & persist
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

    // ── Phase 2: Upload queued media files one by one ──────────────────
    const mediaQueue = await store.getMediaQueue()
    let mediaUploaded = 0
    let mediaFailed = 0

    for (const item of mediaQueue) {
      // Resolve server-side submission ID (from Phase 1 mapping, or stored from previous sync)
      let serverId = idMap.get(item.submissionId)
      if (!serverId) {
        serverId = await store.getServerId(item.submissionId) ?? undefined
      }
      if (!serverId) {
        // Server ID not available yet — submission may not have synced; skip for now
        mediaFailed++
        continue
      }

      try {
        await store.updateMediaStatus(item.id, 'uploading')
        setSyncMsg(`Uploading photo ${mediaUploaded + 1}/${mediaQueue.length}…`)

        // Convert data URI to blob for multipart upload
        const blob = dataUriToBlob(item.dataUri)
        const formData = new FormData()
        formData.append('submission_id', serverId)
        formData.append('field_name', item.fieldName)
        formData.append('file_type', item.fileType)
        formData.append('file', blob, `${item.fieldName}.jpg`)

        await api.post('/sync/media', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })

        await store.deleteMediaItem(item.id)  // uploaded — free local storage
        mediaUploaded++
      } catch {
        await store.updateMediaStatus(item.id, 'failed')
        mediaFailed++
      }
    }

    // ── Summary message ───────────────────────────────────────────────
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

  // Keep ref current so event handlers below always call the latest version
  useEffect(() => { syncRef.current = syncToServer }, [syncToServer])

  // ── Network state: auto-sync on reconnect ────────────────────────────────
  useEffect(() => {
    const goOnline  = () => { setIsOffline(false); syncRef.current?.() }
    const goOffline = () => setIsOffline(true)
    window.addEventListener('online',  goOnline)
    window.addEventListener('offline', goOffline)
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline) }
  }, [])

  // ── SW → app: handle TRIGGER_SYNC from background sync event ─────────────
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'TRIGGER_SYNC') syncRef.current?.() }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [])

  // ── Load forms + sync-on-open ─────────────────────────────────────────────
  useEffect(() => {
    const loadForms = async () => {
      const store = await getStorage()

      // Count pending outbox + media — sync immediately if online
      const outbox = await store.getOutbox()
      const pendingMedia = await store.getMediaQueueCount()
      setOutboxCount(outbox.length)
      setMediaQueueCount(pendingMedia)
      if ((outbox.length > 0 || pendingMedia > 0) && navigator.onLine) syncToServer()

      // Load schedules (non-blocking)
      api.get('/schedules/').then(r => setSchedules(r.data)).catch(() => {})

      // Try server first, fall back to local cache
      try {
        const { data } = await api.get<Array<{ id: string; title: string; version: number }>>('/forms/?status=active')
        setForms(data)
        // Write-through: cache every form schema for offline use
        await Promise.all(data.map(async f => {
          try {
            const detail = await api.get<{ json_schema: FormSchema }>(`/forms/${f.id}`)
            await store.saveFormCache({
              id: f.id, title: f.title, version: f.version, status: 'active',
              schema: JSON.stringify(detail.data.json_schema),
              cachedAt: new Date().toISOString(),
            })
          } catch { /* schema fetch failed — skip caching this form */ }
        }))
      } catch {
        // Offline — load from local cache
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
      // Offline — load from local cache
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
    await handleSave(draft)        // persist to local store first
    setOutboxCount(c => c + 1)

    // Enqueue any photo/audio fields into media_queue for separate upload
    // Photos are compressed client-side BEFORE queueing to save bandwidth on 2G
    const store = await getStorage()
    for (const [fieldName, value] of Object.entries(draft.values)) {
      if (typeof value === 'string' && value.startsWith('data:image/')) {
        const { dataUri: compressed } = await compressImage(value)
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

    // Register Background Sync tag — browser fires sync event even if app closes
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready
        await reg.sync?.register('sync-submissions')
      } catch { /* Background Sync not supported — foreground sync covers it */ }
    }

    syncToServer()
    setScreen('submitted')
  }

  // ── Submitted confirmation ───────────────────────────────────────────────
  if (screen === 'submitted') {
    return (
      <div style={page}>
        <div style={{ textAlign: 'center', paddingTop: 80 }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
          <div style={{ color: '#a6e3a1', fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Submitted!</div>
          <div style={{ color: '#6c7086', fontSize: 14, marginBottom: 8 }}>
            {outboxCount > 0 ? `${outboxCount} submission(s) in outbox — keep app open to sync` : 'Synced to server'}
          </div>
          {syncMsg && <div style={{ color: '#89b4fa', fontSize: 13, marginBottom: 16 }}>{syncMsg}</div>}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button onClick={() => setScreen('list')} style={btn}>Fill Another Form</button>
            <button onClick={() => window.location.href = '/'} style={{ ...btn, background: '#2a2a3e', color: '#cdd6f4' }}>Home</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Active collection ─────────────────────────────────────────────────────
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

  // ── Form list ─────────────────────────────────────────────────────────────
  return (
    <div style={page}>
      {/* Sub-header: language toggle + sync status */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid #2a2a3e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #3a3a5c' }}>
          {LANGUAGE_OPTIONS.map(opt => (
            <button
              key={opt.code}
              onClick={() => setLanguage(opt.code)}
              style={{
                background: language === opt.code ? '#89b4fa' : '#1e1e2e',
                color: language === opt.code ? '#11111b' : '#6c7086',
                border: 'none',
                padding: '3px 8px',
                fontSize: 11,
                fontWeight: language === opt.code ? 700 : 400,
                cursor: 'pointer',
                borderRight: opt.code !== 'te' ? '1px solid #3a3a5c' : 'none',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {(outboxCount > 0 || mediaQueueCount > 0) && (
            <button onClick={syncToServer} style={{ background: '#f9e2af22', border: '1px solid #f9e2af', color: '#f9e2af', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
              ↑ {outboxCount > 0 ? `${outboxCount} pending` : ''}{outboxCount > 0 && mediaQueueCount > 0 ? ' · ' : ''}{mediaQueueCount > 0 ? `${mediaQueueCount} photo(s)` : ''}
            </button>
          )}
          {syncMsg && <span style={{ color: '#89b4fa', fontSize: 12 }}>{syncMsg}</span>}
        </div>
      </div>

      <div style={{ padding: 20 }}>
        {/* Upcoming schedules */}
        {schedules.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: '#89b4fa', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Your Schedules</div>
            {schedules.filter(s => s.status === 'active' || s.status === 'upcoming').map((s) => (
              <div key={s.id} style={{
                background: '#1e1e2e', border: '1px solid #2a2a3e', borderRadius: 10,
                padding: '12px 16px', marginBottom: 8,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#cdd6f4' }}>{s.form_title}</div>
                    <div style={{ fontSize: 12, color: '#6c7086', marginTop: 3 }}>
                      {s.location && <span>{s.location} · </span>}
                      {s.start_date} → {s.end_date}
                      {s.target_count > 0 && <span> · Target: {s.target_count}</span>}
                    </div>
                    {s.notes && <div style={{ fontSize: 11, color: '#a6adc8', marginTop: 4, fontStyle: 'italic' }}>{s.notes}</div>}
                  </div>
                  <span style={{
                    background: s.status === 'active' ? '#a6e3a122' : '#89b4fa22',
                    color: s.status === 'active' ? '#a6e3a1' : '#89b4fa',
                    borderRadius: 4, padding: '2px 8px', fontSize: 11,
                  }}>
                    {s.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ color: '#a6adc8', fontSize: 13, marginBottom: 16 }}>Select a form to collect</div>

        {loading && <div style={{ color: '#6c7086' }}>Loading forms…</div>}

        {!loading && forms.length === 0 && (
          <div style={{ color: '#6c7086', textAlign: 'center', paddingTop: 40 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <div>No active forms assigned to you.</div>
          </div>
        )}

        {forms.map(f => (
          <button key={f.id} onClick={() => openForm(f)} style={{
            width: '100%', background: '#1e1e2e', border: '1px solid #2a2a3e',
            borderRadius: 12, padding: '16px 18px', cursor: 'pointer',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 10, color: '#cdd6f4', textAlign: 'left',
          }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 500 }}>{f.title}</div>
              <div style={{ color: '#6c7086', fontSize: 12, marginTop: 3 }}>v{f.version}</div>
            </div>
            <span style={{ color: '#89b4fa', fontSize: 20 }}>→</span>
          </button>
        ))}
      </div>
    </div>
  )
}

const page: React.CSSProperties = {
  background: '#11111b', minHeight: '100vh', color: '#cdd6f4',
  fontFamily: 'system-ui', maxWidth: 540, margin: '0 auto',
}
const btn: React.CSSProperties = {
  background: '#1e66f5', border: 'none', color: '#fff', borderRadius: 10,
  padding: '14px 28px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
}

/** Convert a data URI (e.g. data:image/jpeg;base64,…) to a Blob for multipart upload. */
function dataUriToBlob(dataUri: string): Blob {
  const [header, base64] = dataUri.split(',')
  const mime = header.match(/:(.*?);/)?.[1] ?? 'application/octet-stream'
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: mime })
}
