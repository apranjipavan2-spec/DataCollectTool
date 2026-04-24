import React, { useState, useEffect, useRef, useCallback } from 'react'
import api, { getStoredUser } from '@/lib/api'
import { homeForRole } from '@/auth/RequireAuth'
import type { FormSchema } from '@/types/form'
import FormRenderer, { type SubmissionDraft } from '@/renderer/FormRenderer'
import { getStorage } from '@/storage'
import { v4 as uuidv4 } from 'uuid'
import { useLanguage, LANGUAGE_OPTIONS } from '@/i18n/LanguageContext'
import { compressImage } from '@/utils/imageCompress'
import { Button } from '@/components/ui'
import Sidebar from '@/components/Sidebar'
import { getNavItems } from '@/lib/navigation'
import BeneficiaryListScreen, { type RosterEntry } from './BeneficiaryListScreen'

function _haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const p1 = (lat1 * Math.PI) / 180, p2 = (lat2 * Math.PI) / 180
  const dp = ((lat2 - lat1) * Math.PI) / 180, dl = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Extract beneficiary name from data_json ────────────────────────────────
// Looks for the first text-like field whose key or label suggests a person's name.
const NAME_KEYS = ['name', 'full_name', 'respondent_name', 'beneficiary_name',
  'hh_name', 'hs_hh_name', 'ha_name', 'participant_name', 'patient_name',
  'farmer_name', 'student_name', 'head_name', 'contact_name']

function extractBeneficiaryName(dataJson: Record<string, unknown> | null | undefined): string | null {
  if (!dataJson) return null
  for (const key of NAME_KEYS) {
    const val = dataJson[key]
    if (typeof val === 'string' && val.trim()) return val.trim()
  }
  // Fallback: first value whose key contains 'name' and is a non-empty string
  for (const [k, v] of Object.entries(dataJson)) {
    if (k.toLowerCase().includes('name') && typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

// ── Tile pre-cache helpers ─────────────────────────────────────────────────

function latLngToTile(lat: number, lng: number, zoom: number): [number, number] {
  const n = Math.pow(2, zoom)
  const x = Math.floor((lng + 180) / 360 * n)
  const latRad = lat * Math.PI / 180
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n)
  return [x, y]
}

function computeTileUrls(lat: number, lng: number, radiusKm: number, zoomLevels: number[]): string[] {
  // 1 degree lat ≈ 111km, 1 degree lng ≈ 111km * cos(lat)
  const deltaLat = radiusKm / 111
  const deltaLng = radiusKm / (111 * Math.cos(lat * Math.PI / 180))
  const urls: string[] = []

  for (const zoom of zoomLevels) {
    const [x1, y1] = latLngToTile(lat + deltaLat, lng - deltaLng, zoom)
    const [x2, y2] = latLngToTile(lat - deltaLat, lng + deltaLng, zoom)
    const maxTile = Math.pow(2, zoom) - 1
    for (let x = Math.max(0, x1); x <= Math.min(maxTile, x2); x++) {
      for (let y = Math.max(0, y1); y <= Math.min(maxTile, y2); y++) {
        urls.push(`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`)
      }
    }
  }
  return urls
}

// ── Types ──────────────────────────────────────────────────────────────────

type Screen = 'list' | 'drafts' | 'collecting' | 'submitted' | 'history' | 'editing' | 'backchecks'

interface BackcheckTask {
  original_submission_id: string
  form_title: string | null
  submitted_at: string | null
  backcheck_form_id: string
  backcheck_form_title: string
  data_json: Record<string, unknown> | null
}

interface FormMeta { id: string; title: string; version: number }

interface DraftEntry {
  id: string
  formId: string
  formTitle: string
  updatedAt: string
}

export default function FieldApp() {
  const [screen, setScreen] = useState<Screen>('list')
  const [forms, setForms] = useState<FormMeta[]>([])
  const [activeForm, setActiveForm] = useState<{ meta: FormMeta; schema: FormSchema } | null>(null)
  const [outboxCount, setOutboxCount] = useState(0)
  const [mediaQueueCount, setMediaQueueCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [schedules, setSchedules] = useState<any[]>([])
  const [myStats, setMyStats] = useState<{ today: number; total: number } | null>(null)
  const [cachingTiles, setCachingTiles] = useState(false)
  const [tilesCacheMsg, setTilesCacheMsg] = useState('')
  const [drafts, setDrafts] = useState<DraftEntry[]>([])
  const [loadingDrafts, setLoadingDrafts] = useState(false)
  const [failedMediaCount, setFailedMediaCount] = useState(0)
  const [retryingMedia, setRetryingMedia] = useState(false)
  const [myHistory, setMyHistory] = useState<any[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [lowStorage, setLowStorage] = useState(false)
  const [resumingDraft, setResumingDraft] = useState<SubmissionDraft | null>(null)
  const [editingSubmission, setEditingSubmission] = useState<{ id: string; formId: string; dataJson: Record<string, unknown>; formTitle: string } | null>(null)
  const [editMsg, setEditMsg] = useState('')
  const [programContext, setProgramContext] = useState<null | {
    program_id: string; program_name: string; scheme_name: string; questionnaire_id: string;
    participant_type_name: string; location_id: string; location_district: string; location_block: string; location_village: string;
  }>(null)
  const [locations, setLocations] = useState<any[]>([])
  const [selectedLocationId, setSelectedLocationId] = useState('')
  const [assignedArm, setAssignedArm] = useState<string | null>(null)
  const [geofenceWarning, setGeofenceWarning] = useState(false)
  const [rosterEntries, setRosterEntries] = useState<RosterEntry[]>([])
  const [showBeneficiaryList, setShowBeneficiaryList] = useState(false)
  const [rosterInitialValues, setRosterInitialValues] = useState<Record<string, unknown> | null>(null)
  const [backchecks, setBackchecks] = useState<BackcheckTask[]>([])
  const [backcheckLoading, setBackcheckLoading] = useState(false)
  const [activeBackcheck, setActiveBackcheck] = useState<BackcheckTask | null>(null)
  const syncRef = useRef<() => Promise<void>>()
  const loadFormsRef = useRef<() => Promise<void>>()
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
          let progCtx: Record<string, string | null> = {}
          try {
            const raw = localStorage.getItem(`fieldgovern_prog_ctx_${s.formId}`)
            if (raw) progCtx = JSON.parse(raw)
          } catch { }
          return {
            local_id: s.id, form_id: s.formId, form_version: s.formVersion,
            data_json: dataClean, gps_open: s.gpsOpen ?? null, gps_submit: s.gpsSubmit ?? null,
            local_created_at: s.createdAt,
            program_id: progCtx.program_id ?? null,
            participant_type_id: progCtx.participant_type_id ?? null,
            questionnaire_id: progCtx.questionnaire_id ?? null,
            location_id: progCtx.location_id ?? null,
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

    setFailedMediaCount(mediaFailed)
    setSyncMsg(parts.length > 0 ? `✓ ${parts.join(', ')}` : '')
    setTimeout(() => setSyncMsg(''), 4000)

    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SYNC_COMPLETE' })
    }
  }, [])

  useEffect(() => { syncRef.current = syncToServer }, [syncToServer])

  // ── Load drafts from local storage ─────────────────────────────────────
  const loadDrafts = useCallback(async () => {
    setLoadingDrafts(true)
    try {
      const store = await getStorage()
      const cached = await store.listFormCache()
      const allDrafts: DraftEntry[] = []
      for (const form of cached) {
        const subs = await store.listSubmissions(form.id, 'draft')
        for (const s of subs) {
          allDrafts.push({ id: s.id, formId: form.id, formTitle: form.title, updatedAt: s.updatedAt })
        }
      }
      allDrafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      setDrafts(allDrafts)
    } finally {
      setLoadingDrafts(false)
    }
  }, [])

  // ── Resume a draft ──────────────────────────────────────────────────────
  const resumeDraft = async (draft: DraftEntry) => {
    const store = await getStorage()
    const record = await store.getSubmission(draft.id)
    const cachedForm = await store.getFormCache(draft.formId)
    if (!record || !cachedForm) { setSyncMsg('Draft data not found'); return }
    const meta: FormMeta = { id: draft.formId, title: draft.formTitle, version: cachedForm.version }
    setActiveForm({ meta, schema: JSON.parse(cachedForm.schema) as FormSchema })
    // Restore saved draft values into FormRenderer
    setResumingDraft({
      id: record.id,
      formVersion: record.formVersion,
      values: record.data,
      gpsOpen: record.gpsOpen ?? null,
      gpsSubmit: null,
      status: 'draft',
      startedAt: record.createdAt,
    })
    setScreen('collecting')
  }

  // ── Delete a draft ──────────────────────────────────────────────────────
  const deleteDraft = async (id: string) => {
    const store = await getStorage()
    await store.deleteSubmission(id)
    setDrafts(prev => prev.filter(d => d.id !== id))
  }

  // ── Retry failed media ──────────────────────────────────────────────────
  const retryFailedMedia = async () => {
    setRetryingMedia(true)
    const store = await getStorage()
    const queue = await store.getMediaQueue()
    for (const item of queue.filter(m => m.status === 'failed')) {
      await store.updateMediaStatus(item.id, 'pending')
    }
    setFailedMediaCount(0)
    setRetryingMedia(false)
    syncToServer()
  }

  const loadHistory = async () => {
    setLoadingHistory(true)
    try {
      const { data } = await api.get('/submissions/?page_size=50')
      setMyHistory(data.items ?? data.submissions ?? [])
    } catch {
      setMyHistory([])
    } finally {
      setLoadingHistory(false)
    }
  }

  const loadBackchecks = async () => {
    setBackcheckLoading(true)
    try {
      const { data } = await api.get('/submissions/my-backchecks')
      setBackchecks(data)
    } catch {
      setBackchecks([])
    } finally {
      setBackcheckLoading(false)
    }
  }

  const openBackcheckForm = async (task: BackcheckTask) => {
    setSyncMsg('Loading back-check form…')
    try {
      const { data } = await api.get<{ json_schema: FormSchema }>(`/forms/${task.backcheck_form_id}`)
      const meta: FormMeta = { id: task.backcheck_form_id, title: task.backcheck_form_title, version: data.version ?? 1 }
      // Pre-fill context from original submission
      const initialValues: Record<string, unknown> = {
        _backcheck_for: task.original_submission_id,
        ...(task.data_json ?? {}),
      }
      setActiveForm({ meta, schema: data.json_schema })
      setRosterInitialValues(initialValues)
      setActiveBackcheck(task)
      setSyncMsg('')
      setScreen('collecting')
    } catch {
      setSyncMsg('Could not load back-check form')
      setTimeout(() => setSyncMsg(''), 3000)
    }
  }

  const openEdit = async (submission: any) => {
    try {
      setSyncMsg('Loading…')
      const { data } = await api.get(`/submissions/${submission.id}`)
      const formId = data.form_id
      let schema: FormSchema | null = null
      try {
        const r = await api.get<{ json_schema: FormSchema }>(`/forms/${formId}`)
        schema = r.data.json_schema
      } catch {
        const store = await getStorage()
        const cached = await store.getFormCache(formId)
        if (cached) schema = JSON.parse(cached.schema) as FormSchema
      }
      if (!schema) { setSyncMsg('Form schema not available'); return }
      const cachedForm = forms.find(f => f.id === formId)
      setEditingSubmission({
        id: submission.id,
        formId,
        dataJson: data.data_json ?? {},
        formTitle: cachedForm?.title ?? submission.form_title ?? 'Edit Submission',
      })
      setActiveForm({ meta: { id: formId, title: cachedForm?.title ?? 'Form', version: data.form_version ?? 1 }, schema })
      setSyncMsg('')
      setScreen('editing')
    } catch {
      setSyncMsg('Failed to load submission')
      setTimeout(() => setSyncMsg(''), 3000)
    }
  }

  const handleEditSubmit = async (draft: SubmissionDraft) => {
    if (!editingSubmission) return
    try {
      await api.patch(`/submissions/${editingSubmission.id}/data`, { data_json: draft.values })
      setMyHistory(prev => prev.map(s => s.id === editingSubmission.id ? { ...s, ...draft.values } : s))
      setEditMsg('✓ Changes saved')
      setScreen('history')
      setEditingSubmission(null)
      setActiveForm(null)
      setTimeout(() => setEditMsg(''), 3000)
    } catch {
      setEditMsg('⚠ Failed to save changes')
      setTimeout(() => setEditMsg(''), 4000)
    }
  }

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
      const allMedia = await store.getMediaQueue()
      setOutboxCount(outbox.length)
      setMediaQueueCount(pendingMedia)
      const failedMedia = allMedia.filter(m => m.status === 'failed')
      setFailedMediaCount(failedMedia.length)
      // Auto-reset failed media to pending on every startup so they retry automatically
      if (failedMedia.length > 0 && navigator.onLine) {
        for (const item of failedMedia) await store.updateMediaStatus(item.id, 'pending')
        setFailedMediaCount(0)
      }
      if ((outbox.length > 0 || pendingMedia > 0 || failedMedia.length > 0) && navigator.onLine) syncToServer()

      // Storage quota warning
      try {
        const info = await store.getStorageInfo()
        const freeMB = (info.quotaBytes - info.usedBytes) / 1024 / 1024
        setLowStorage(freeMB < 200)
      } catch { }

      api.get('/schedules/').then(r => setSchedules(r.data)).catch(() => {})
      api.get('/programs/locations').then(r => setLocations(r.data)).catch(() => {})
      api.get('/submissions/my-backchecks').then(r => setBackchecks(r.data)).catch(() => {})

      // Enumerator stats
      api.get('/submissions/?page_size=200').then(r => {
        const items = r.data.items ?? r.data.submissions ?? []
        const today = new Date().toISOString().slice(0, 10)
        const todayCount = items.filter((s: any) => s.server_received_at?.slice(0, 10) === today).length
        setMyStats({ today: todayCount, total: r.data.total ?? items.length })
      }).catch(() => {})

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
        setRefreshing(false)
      }
    }
    loadFormsRef.current = loadForms
    loadForms()
  }, [syncToServer])

  const handleFormCardClick = async (meta: FormMeta) => {
    if (!isOffline) {
      try {
        const { data } = await api.get<RosterEntry[]>(`/roster/with-status?form_id=${meta.id}`)
        if (data.length > 0) {
          setRosterEntries(data)
          setActiveForm({ meta, schema: {} as FormSchema })
          setShowBeneficiaryList(true)
          setResumingDraft(null)
          return
        }
      } catch { }
    }
    openForm(meta)
  }

  const handleBeneficiarySelect = async (entry: RosterEntry) => {
    if (!activeForm) return
    const meta = activeForm.meta
    const initialValues: Record<string, unknown> = { _roster_id: entry.id }
    if (entry.name) {
      for (const key of ['name', 'full_name', 'respondent_name', 'beneficiary_name']) {
        initialValues[key] = entry.name
      }
    }
    if (entry.phone) initialValues['phone'] = entry.phone
    setShowBeneficiaryList(false)
    setRosterEntries([])
    openForm(meta, undefined, initialValues)
  }

  const handleRefreshForms = async () => {
    if (isOffline) { setSyncMsg('Cannot refresh — offline'); return }
    setRefreshing(true)
    setSyncMsg('')
    await loadFormsRef.current?.()
    setSyncMsg('✓ Forms updated')
    setTimeout(() => setSyncMsg(''), 3000)
  }

  // ── Offline tile pre-caching ───────────────────────────────────────────
  const handleCacheTiles = async () => {
    setCachingTiles(true)
    setTilesCacheMsg('Getting location…')
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, enableHighAccuracy: true })
      )
      const { latitude: lat, longitude: lng } = pos.coords
      setTilesCacheMsg('Caching map tiles…')

      const tilesToCache = computeTileUrls(lat, lng, 15, [12, 13, 14, 15])
      const cache = await caches.open('fieldgovern-map-tiles-v1')
      let done = 0

      // Batch in groups of 10 to avoid overwhelming the browser
      for (let i = 0; i < tilesToCache.length; i += 10) {
        const batch = tilesToCache.slice(i, i + 10)
        await Promise.allSettled(batch.map(url =>
          fetch(url, { mode: 'no-cors' }).then(resp => cache.put(url, resp)).catch(() => {})
        ))
        done += batch.length
        setTilesCacheMsg(`Caching tiles… ${done}/${tilesToCache.length}`)
      }

      setTilesCacheMsg(`✓ ${tilesToCache.length} tiles cached for offline use`)
      setTimeout(() => setTilesCacheMsg(''), 4000)
    } catch (err: any) {
      setTilesCacheMsg(err?.code === 1 ? '⚠ Location permission denied' : '⚠ Could not cache tiles')
      setTimeout(() => setTilesCacheMsg(''), 4000)
    } finally {
      setCachingTiles(false)
    }
  }

  const openForm = async (meta: FormMeta, schedCtx?: { programContext: any; locationContext?: any; locationId?: string }, initialValues?: Record<string, unknown>) => {
    let schema: FormSchema | null = null
    try {
      const { data } = await api.get<{ json_schema: FormSchema }>(`/forms/${meta.id}`)
      schema = data.json_schema
    } catch {
      const store = await getStorage()
      const cached = await store.getFormCache(meta.id)
      if (!cached) { setSyncMsg('Form not available offline'); return }
      schema = JSON.parse(cached.schema) as FormSchema
    }
    setActiveForm({ meta, schema })
    setAssignedArm(null)
    setGeofenceWarning(false)
    setRosterInitialValues(initialValues ?? null)

    // Arm assignment
    const randCfg = schema.settings?.randomization
    if (randCfg?.enabled && (randCfg.arms?.length ?? 0) > 0) {
      const storageKey = `fieldgovern_arm_key_${meta.id}`
      let respondentKey = localStorage.getItem(storageKey)
      if (!respondentKey) {
        respondentKey = uuidv4()
        try { localStorage.setItem(storageKey, respondentKey) } catch { }
      }
      try {
        const { data } = await api.post<{ arm: string }>(`/forms/${meta.id}/assign-arm`, { respondent_key: respondentKey })
        setAssignedArm(data.arm)
      } catch { }
    }

    // Geofence check (client-side warning only)
    const geoCfg = schema.settings?.geofence
    if (geoCfg?.enabled && geoCfg.lat != null && geoCfg.lng != null && geoCfg.radius_meters) {
      navigator.geolocation?.getCurrentPosition(pos => {
        const dist = _haversineM(geoCfg.lat!, geoCfg.lng!, pos.coords.latitude, pos.coords.longitude)
        if (dist > geoCfg.radius_meters!) setGeofenceWarning(true)
      }, () => {}, { enableHighAccuracy: true, timeout: 10000 })
    }

    if (schedCtx?.programContext) {
      const pc = schedCtx.programContext
      const lc = schedCtx.locationContext ?? {}
      const locId = schedCtx.locationId ?? pc.location_id ?? lc.location_id ?? ''
      setProgramContext({
        program_id: pc.program_id, program_name: pc.program_name, scheme_name: pc.scheme_name,
        questionnaire_id: pc.questionnaire_id, participant_type_name: pc.participant_type_name,
        location_id: locId, location_district: lc.district ?? '', location_block: lc.block ?? '', location_village: lc.village ?? '',
      })
      setSelectedLocationId(locId)
      try {
        localStorage.setItem(`fieldgovern_prog_ctx_${meta.id}`, JSON.stringify({
          program_id: pc.program_id, participant_type_id: pc.participant_type_id,
          questionnaire_id: pc.questionnaire_id, location_id: locId,
        }))
      } catch { }
    } else {
      setProgramContext(null); setSelectedLocationId('')
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

    // If this was a back-check submission, mark the original as completed
    if (activeBackcheck) {
      try {
        await api.post(`/submissions/${activeBackcheck.original_submission_id}/complete-backcheck`)
        setBackchecks(prev => prev.filter(b => b.original_submission_id !== activeBackcheck.original_submission_id))
      } catch { /* non-critical */ }
      setActiveBackcheck(null)
    }

    setScreen('submitted')
  }

  const storedUser = getStoredUser()
  const sidebarItems = getNavItems(storedUser?.role ?? '')

  // Shared layout wrapper with sidebar
  const WithSidebar = ({ children }: { children: React.ReactNode }) => (
    <div className="flex h-screen bg-catalan-bg overflow-hidden">
      <Sidebar items={sidebarItems} role={storedUser?.role} />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">{children}</div>
    </div>
  )

  // Shared sub-page wrapper
  const SubPage = ({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) => (
    <WithSidebar>
      <div className="bg-catalan-surface border-b border-catalan-border sticky top-0 z-10">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-catalan-hover text-catalan-textMuted hover:text-catalan-primary hover:bg-catalan-primary/10 transition-all flex-shrink-0"
          >
            &larr;
          </button>
          <h1 className="text-lg font-bold text-catalan-text">{title}</h1>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 sm:px-6 py-5">{children}</div>
      </div>
    </WithSidebar>
  )

  // Back-check queue screen
  if (screen === 'backchecks') {
    return (
      <SubPage title="Back-checks Assigned to Me" onBack={() => setScreen('list')}>
        {backcheckLoading ? (
          <div className="text-center py-12 text-catalan-textMuted text-sm">Loading…</div>
        ) : backchecks.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">✅</div>
            <p className="text-catalan-textMuted font-medium">No back-checks pending</p>
            <p className="text-catalan-textMuted text-sm mt-1">Your supervisor will assign back-checks here when needed.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-catalan-textMuted bg-catalan-warning/10 border border-catalan-warning/30 rounded-lg px-3 py-2">
              ⚠️ Your supervisor has flagged these submissions for verification. Open each one, fill the back-check form, and submit.
            </div>
            {backchecks.map(task => (
              <div key={task.original_submission_id} className="bg-catalan-surface border border-catalan-border rounded-xl p-4 space-y-3">
                <div>
                  <div className="font-semibold text-catalan-text text-sm">{task.form_title ?? 'Submission'}</div>
                  <div className="text-xs text-catalan-textMuted mt-0.5">
                    Original submitted: {task.submitted_at ? new Date(task.submitted_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </div>
                  <div className="text-xs text-catalan-info mt-1 font-medium">Back-check form: {task.backcheck_form_title}</div>
                </div>
                {task.data_json && (
                  <div className="bg-catalan-hover rounded-lg p-2 text-xs text-catalan-textMuted max-h-20 overflow-y-auto">
                    {Object.entries(task.data_json).filter(([k]) => !k.startsWith('_')).slice(0, 4).map(([k, v]) => (
                      <div key={k} className="truncate"><span className="font-medium">{k}:</span> {String(v)}</div>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => openBackcheckForm(task)}
                  className="w-full text-sm px-4 py-2.5 rounded-lg bg-catalan-primary text-catalan-bg font-semibold hover:opacity-90 transition-opacity"
                >
                  Start Back-check →
                </button>
              </div>
            ))}
          </div>
        )}
      </SubPage>
    )
  }

  // History screen
  if (screen === 'history') {
    const statusColors: Record<string, string> = {
      approved: 'text-catalan-success bg-catalan-success/10',
      flagged:  'text-catalan-warning bg-catalan-warning/10',
      rejected: 'text-catalan-error bg-catalan-error/10',
      pending:  'text-catalan-info bg-catalan-info/10',
    }
    return (
      <SubPage title="My Submissions" onBack={() => setScreen('list')}>
        {editMsg && (
          <div className={`mb-4 text-sm px-4 py-2.5 rounded-lg ${editMsg.startsWith('✓') ? 'bg-catalan-success/10 text-catalan-success' : 'bg-catalan-warning/10 text-catalan-warning'}`}>
            {editMsg}
          </div>
        )}
        {loadingHistory ? (
          <div className="text-center py-12 text-catalan-textMuted text-sm">Loading…</div>
        ) : myHistory.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">📭</div>
            <p className="text-catalan-textMuted">No submissions yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {myHistory.map((s: any) => {
              const beneficiary = extractBeneficiaryName(s.data_json)
              return (
              <div key={s.id} className="bg-catalan-surface border border-catalan-border rounded-xl p-4 flex flex-col gap-3">
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-catalan-text text-sm truncate">
                      {beneficiary ?? s.form_title ?? 'Unknown'}
                    </div>
                    <div className="text-xs text-catalan-textMuted mt-0.5 truncate">
                      {s.form_title && beneficiary ? s.form_title : null}
                    </div>
                    <div className="text-xs text-catalan-textMuted mt-0.5 flex items-center gap-2">
                      {s.serial_no && <span className="font-mono">#{s.serial_no}</span>}
                      <span>
                        {s.server_received_at
                          ? new Date(s.server_received_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
                          : s.local_created_at?.slice(0, 10) ?? '—'}
                      </span>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${statusColors[s.status] ?? 'text-catalan-textMuted bg-catalan-hover'}`}>
                    {s.status ?? 'pending'}
                  </span>
                </div>
                <button
                  onClick={() => openEdit(s)}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-catalan-primary/40 text-catalan-primary hover:bg-catalan-primary/10 transition-colors font-medium"
                >
                  ✏ Edit
                </button>
              </div>
            )})}
          </div>
        )}
      </SubPage>
    )
  }

  // Drafts screen
  if (screen === 'drafts') {
    return (
      <SubPage title="Saved Drafts" onBack={() => setScreen('list')}>
        {loadingDrafts ? (
          <div className="text-center py-12 text-catalan-textMuted text-sm">Loading drafts…</div>
        ) : drafts.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">📝</div>
            <p className="text-catalan-textMuted">No saved drafts.</p>
            <p className="text-catalan-textMuted text-sm mt-1">Start filling a form and save it as a draft to continue later.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {drafts.map(draft => (
              <div key={draft.id} className="bg-catalan-surface border border-catalan-border rounded-xl p-4 flex flex-col gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-catalan-text truncate">{draft.formTitle}</div>
                  <div className="text-xs text-catalan-textMuted mt-0.5">
                    Last edited {new Date(draft.updatedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => resumeDraft(draft)}
                    className="flex-1 text-xs px-3 py-2 rounded-lg border border-catalan-primary/40 text-catalan-primary hover:bg-catalan-primary/10 transition-colors font-medium"
                  >
                    Resume
                  </button>
                  <button
                    onClick={() => deleteDraft(draft.id)}
                    className="text-xs px-3 py-2 rounded-lg border border-catalan-error/30 text-catalan-error hover:bg-catalan-error/10 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SubPage>
    )
  }

  // Submitted confirmation screen
  if (screen === 'submitted') {
    return (
      <WithSidebar>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-sm w-full">
            <div className="text-6xl mb-6">✅</div>
            <h2 className="text-2xl font-bold text-catalan-success mb-3">Submitted!</h2>
            <p className="text-catalan-textMuted mb-2">
              {outboxCount > 0
                ? `${outboxCount} submission(s) in outbox — keep app open to sync`
                : 'Synced to server'}
            </p>
            {syncMsg && <p className="text-catalan-info text-sm mb-6">{syncMsg}</p>}
            <div className="flex gap-3 justify-center flex-col sm:flex-row mt-6">
              <Button onClick={() => setScreen('list')} size="lg">Fill Another Form</Button>
              <Button onClick={() => window.location.href = homeForRole(storedUser?.role ?? 'enumerator')} variant="secondary" size="lg">Home</Button>
            </div>
          </div>
        </div>
      </WithSidebar>
    )
  }

  // Edit existing submission screen
  if (screen === 'editing' && activeForm && editingSubmission) {
    const editDraft: SubmissionDraft = {
      id: editingSubmission.id,
      formVersion: activeForm.meta.version,
      values: editingSubmission.dataJson,
      gpsOpen: null,
      gpsSubmit: null,
      status: 'draft',
      startedAt: new Date().toISOString(),
    }
    return (
      <div className="h-screen flex flex-col">
        <FormRenderer
          schema={activeForm.schema}
          onSave={async () => {}}
          onSubmit={handleEditSubmit}
          initialDraft={editDraft}
          onCancel={() => { setScreen('history'); setEditingSubmission(null); setActiveForm(null) }}
        />
      </div>
    )
  }

  // Beneficiary list screen
  if (showBeneficiaryList && activeForm) {
    return (
      <BeneficiaryListScreen
        formTitle={activeForm.meta.title}
        entries={rosterEntries}
        onSelect={handleBeneficiarySelect}
        onBack={() => { setShowBeneficiaryList(false); setRosterEntries([]); setActiveForm(null) }}
      />
    )
  }

  // Form collection screen
  if (screen === 'collecting' && activeForm) {
    const clearProg = () => { setProgramContext(null); setSelectedLocationId(''); setAssignedArm(null); setGeofenceWarning(false); setRosterInitialValues(null) }
    return (
      <div className="flex flex-col h-screen">
        {assignedArm && (
          <div className="bg-catalan-primary text-catalan-bg px-4 py-2 text-xs font-medium shrink-0 z-50 flex items-center gap-2">
            <span>📊 Arm: {assignedArm}</span>
          </div>
        )}
        {geofenceWarning && (
          <div className="bg-catalan-warning/20 border-b border-catalan-warning/40 text-catalan-warning px-4 py-2 text-xs shrink-0 z-50 flex items-center gap-2">
            <span>⚠️ You are outside the designated survey area. Submissions will be flagged.</span>
          </div>
        )}
        {programContext && (
          <div className="bg-blue-700 text-white px-4 py-2 text-xs flex items-center gap-3 flex-wrap shrink-0 z-50">
            <span className="font-medium truncate">
              🗂️ {programContext.scheme_name ? `${programContext.scheme_name} › ` : ''}{programContext.program_name}
              {programContext.participant_type_name ? ` · 👤 ${programContext.participant_type_name}` : ''}
            </span>
            {programContext.location_id ? (
              <span className="text-blue-200 truncate">📍 {[programContext.location_district, programContext.location_block, programContext.location_village].filter(Boolean).join(' › ')}</span>
            ) : (
              <select className="ml-auto text-blue-900 bg-white text-xs rounded px-2 py-0.5 border-0"
                value={selectedLocationId}
                onChange={e => {
                  const lid = e.target.value
                  setSelectedLocationId(lid)
                  const loc = locations.find((l: any) => l.id === lid)
                  if (loc) setProgramContext(p => p ? { ...p, location_id: lid, location_district: loc.district, location_block: loc.block, location_village: loc.village } : p)
                  try {
                    const raw = localStorage.getItem(`fieldgovern_prog_ctx_${activeForm.meta.id}`)
                    const ctx = raw ? JSON.parse(raw) : {}
                    localStorage.setItem(`fieldgovern_prog_ctx_${activeForm.meta.id}`, JSON.stringify({ ...ctx, location_id: lid }))
                  } catch { }
                }}>
                <option value="">📍 Pick collection location…</option>
                {locations.map((l: any) => <option key={l.id} value={l.id}>{[l.district, l.block, l.village].filter(Boolean).join(' › ')}</option>)}
              </select>
            )}
          </div>
        )}
        <div className="flex-1 min-h-0">
          <FormRenderer
            schema={activeForm.schema}
            onSave={handleSave}
            onSubmit={async (draft) => { await handleSubmit(draft); clearProg() }}
            initialDraft={resumingDraft ?? (rosterInitialValues ? {
              id: uuidv4(),
              formVersion: activeForm.meta.version,
              values: rosterInitialValues,
              gpsOpen: null,
              gpsSubmit: null,
              status: 'draft',
              startedAt: new Date().toISOString(),
            } : undefined)}
            onCancel={() => { setScreen('list'); setActiveForm(null); setResumingDraft(null); setRosterInitialValues(null); clearProg() }}
          />
        </div>
      </div>
    )
  }

  // ── Main form list screen ────────────────────────────────────────────────
  return (
    <WithSidebar>
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">

      {/* ── Top header ── */}
      <div className="bg-catalan-surface border-b border-catalan-border sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          {/* Row 1: logo + nav actions */}
          <div className="flex justify-between items-center py-3 gap-4">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="text-lg font-bold text-catalan-text leading-tight">FieldGovern</h1>
                {myStats !== null && (
                  <p className="text-xs text-catalan-textMuted hidden sm:block">
                    {myStats.today} today · {myStats.total} total · {outboxCount} pending
                  </p>
                )}
              </div>
              {isOffline && (
                <span className="text-xs text-catalan-warning bg-catalan-warning/10 px-2 py-1 rounded-full font-medium hidden sm:inline">
                  📡 Offline
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isOffline && (
                <span className="text-xs text-catalan-warning bg-catalan-warning/10 px-2 py-1 rounded-full font-medium sm:hidden">
                  📡
                </span>
              )}
              {/* Always-visible action buttons */}
              {backchecks.length > 0 && (
                <button
                  onClick={() => setScreen('backchecks')}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-catalan-warning/10 border border-catalan-warning/40 text-catalan-warning hover:bg-catalan-warning/20 transition-all font-medium"
                  title="Back-checks assigned to me"
                >
                  <span>🔁</span>
                  <span className="hidden sm:inline">Back-checks</span>
                  <span className="bg-catalan-warning text-white text-[10px] font-bold rounded-full px-1.5 leading-4">{backchecks.length}</span>
                </button>
              )}
              <button
                onClick={() => { loadHistory(); setScreen('history') }}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-catalan-hover border border-catalan-border text-catalan-textMuted hover:text-catalan-primary hover:border-catalan-primary/50 transition-all"
                title="My submissions"
              >
                <span>📋</span>
                <span className="hidden sm:inline">History</span>
              </button>
              <button
                onClick={() => { loadDrafts(); setScreen('drafts') }}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-catalan-hover border border-catalan-border text-catalan-textMuted hover:text-catalan-primary hover:border-catalan-primary/50 transition-all"
                title="Saved drafts"
              >
                <span>📝</span>
                <span className="hidden sm:inline">Drafts</span>
                {drafts.length > 0 && (
                  <span className="bg-catalan-primary text-catalan-bg text-[10px] font-bold rounded-full px-1.5 leading-4">{drafts.length}</span>
                )}
              </button>
              <button
                onClick={handleRefreshForms}
                disabled={refreshing || isOffline}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-catalan-hover border border-catalan-border text-catalan-textMuted hover:text-catalan-primary hover:border-catalan-primary/50 transition-all disabled:opacity-40"
                title="Refresh forms"
              >
                <span>{refreshing ? '⏳' : '↻'}</span>
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>

          {/* Row 2: language + sync status */}
          <div className="flex items-center justify-between gap-3 pb-3">
            <div className="flex bg-catalan-hover rounded-full p-0.5 border border-catalan-border">
              {LANGUAGE_OPTIONS.map(opt => (
                <button
                  key={opt.code}
                  onClick={() => setLanguage(opt.code)}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-all duration-200 ${
                    language === opt.code
                      ? 'bg-catalan-primary text-catalan-bg shadow-sm'
                      : 'text-catalan-textMuted hover:text-catalan-text'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2 items-center flex-wrap">
              {(outboxCount > 0 || mediaQueueCount > 0) && (
                <button
                  onClick={syncToServer}
                  className="text-catalan-warning bg-catalan-warning/10 px-3 py-1 rounded-full border border-catalan-warning/30 hover:bg-catalan-warning/20 transition-colors text-xs font-medium"
                >
                  ↑ Sync {outboxCount > 0 ? `${outboxCount}` : ''}{mediaQueueCount > 0 ? ` · ${mediaQueueCount} 📷` : ''}
                </button>
              )}
              {failedMediaCount > 0 && (
                <button
                  onClick={retryFailedMedia}
                  disabled={retryingMedia}
                  className="text-catalan-error bg-catalan-error/10 px-3 py-1 rounded-full border border-catalan-error/30 hover:bg-catalan-error/20 transition-colors text-xs disabled:opacity-50"
                >
                  {retryingMedia ? '⏳' : `⚠ ${failedMediaCount} failed`}
                </button>
              )}
              {syncMsg && <span className="text-catalan-info text-xs">{syncMsg}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Low storage banner */}
      {lowStorage && (
        <div className="bg-catalan-warning/10 border-b border-catalan-warning/30 text-catalan-warning text-xs px-4 py-2.5 flex items-center gap-2">
          <div className="max-w-5xl mx-auto w-full flex items-center gap-2">
            <span>⚠️</span>
            <span><strong>Low storage.</strong> Sync now and free space on your device.</span>
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5">

          {/* Desktop 2-col: forms on left, sidebar on right */}
          <div className="lg:grid lg:grid-cols-[1fr_280px] lg:gap-6">

            {/* ── Left: Schedules + Forms ── */}
            <div>
              {/* Schedules */}
              {schedules.length > 0 && (
                <div className="mb-6">
                  <h2 className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wider mb-3">Your Schedules</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3">
                    {schedules.filter(s => s.status === 'active' || s.status === 'upcoming').map((s: any) => {
                      const pc = s.program_context; const lc = s.location_context
                      const formMeta = forms.find(f => f.id === s.form_id) ?? { id: s.form_id, title: s.form_title, version: 1 }
                      return (
                        <div key={s.id} className="bg-catalan-surface border border-catalan-border rounded-xl p-4">
                          {pc && (
                            <div className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 rounded-lg px-2 py-1 mb-2 flex-wrap">
                              <span>🗂️ {pc.scheme_name ? `${pc.scheme_name} › ` : ''}{pc.program_name}</span>
                              {pc.participant_type_name && <span>· 👤 {pc.participant_type_name}</span>}
                              {lc && <span>· 📍 {[lc.district, lc.block, lc.village].filter(Boolean).join(' › ')}</span>}
                            </div>
                          )}
                          <div className="flex justify-between items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-catalan-text text-sm mb-1 truncate">{s.form_title}</h3>
                              <p className="text-xs text-catalan-textMuted">
                                {s.location && <span>{s.location} · </span>}
                                {s.start_date} → {s.end_date}
                                {s.target_count > 0 && <span> · 🎯 {s.target_count}</span>}
                              </p>
                              {s.notes && <p className="text-xs text-catalan-textMuted italic mt-1 truncate">{s.notes}</p>}
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 font-medium ${
                                s.status === 'active' ? 'bg-catalan-success/10 text-catalan-success' : 'bg-catalan-info/10 text-catalan-info'
                              }`}>{s.status}</span>
                              <button onClick={() => openForm(formMeta, pc ? { programContext: pc, locationContext: lc, locationId: s.location_id } : undefined)}
                                className="text-xs px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                                Collect →
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Forms */}
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wider">
                  {loading ? 'Loading forms…' : `Your Forms (${forms.length})`}
                </h2>
              </div>

              {loading && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[1,2,3,4].map(i => (
                    <div key={i} className="h-20 bg-catalan-surface border border-catalan-border rounded-xl animate-pulse" />
                  ))}
                </div>
              )}

              {!loading && forms.length === 0 && (
                <div className="text-center py-16 bg-catalan-surface border border-catalan-border rounded-xl">
                  <div className="text-5xl mb-4">📋</div>
                  <p className="text-catalan-textMuted font-medium">No forms assigned yet</p>
                  <p className="text-catalan-textMuted text-sm mt-1">Your supervisor will assign forms to you.</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {forms.map(f => (
                  <button
                    key={f.id}
                    onClick={() => handleFormCardClick(f)}
                    className="w-full p-4 bg-catalan-surface border border-catalan-border rounded-xl hover:border-catalan-primary hover:bg-catalan-primary/5 active:scale-[0.99] transition-all duration-150 text-left group"
                  >
                    <div className="flex justify-between items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-catalan-text group-hover:text-catalan-primary transition-colors truncate text-sm">{f.title}</div>
                        <div className="text-xs text-catalan-textMuted mt-0.5">Version {f.version}</div>
                      </div>
                      <span className="text-catalan-primary text-lg group-hover:translate-x-1 transition-transform duration-200 flex-shrink-0">&rarr;</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Right sidebar (desktop) / Bottom section (mobile) ── */}
            <div className="mt-6 lg:mt-0 space-y-4">

              {/* Stats */}
              {myStats !== null && (
                <div className="bg-catalan-surface border border-catalan-border rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wider mb-3">Your Progress</h3>
                  <div className="grid grid-cols-3 lg:grid-cols-1 gap-3">
                    {[
                      { label: 'Today', value: myStats.today, color: 'text-catalan-primary' },
                      { label: 'All time', value: myStats.total, color: 'text-catalan-success' },
                      { label: 'Pending sync', value: outboxCount, color: 'text-catalan-warning' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="flex lg:flex-row flex-col lg:items-center lg:justify-between items-center text-center lg:text-left">
                        <span className="text-xs text-catalan-textMuted lg:order-1 order-2">{label}</span>
                        <span className={`text-2xl lg:text-xl font-bold ${color} lg:order-2 order-1`}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick actions */}
              <div className="bg-catalan-surface border border-catalan-border rounded-xl p-4">
                <h3 className="text-xs font-semibold text-catalan-textMuted uppercase tracking-wider mb-3">Quick Actions</h3>
                <div className="space-y-2">
                  <button
                    onClick={() => { loadHistory(); setScreen('history') }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-catalan-hover hover:bg-catalan-primary/10 hover:text-catalan-primary text-catalan-text text-sm transition-colors text-left"
                  >
                    <span>📋</span> My Submissions
                  </button>
                  <button
                    onClick={() => { loadDrafts(); setScreen('drafts') }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-catalan-hover hover:bg-catalan-primary/10 hover:text-catalan-primary text-catalan-text text-sm transition-colors text-left"
                  >
                    <span>📝</span> Saved Drafts
                    {drafts.length > 0 && <span className="ml-auto bg-catalan-primary text-catalan-bg text-xs font-bold rounded-full px-2 py-0.5">{drafts.length}</span>}
                  </button>
                  {backchecks.length > 0 && (
                    <button
                      onClick={() => setScreen('backchecks')}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-catalan-warning/10 hover:bg-catalan-warning/20 text-catalan-warning text-sm transition-colors text-left font-medium"
                    >
                      <span>🔁</span> Back-checks
                      <span className="ml-auto bg-catalan-warning text-white text-xs font-bold rounded-full px-2 py-0.5">{backchecks.length}</span>
                    </button>
                  )}
                  <button
                    onClick={handleCacheTiles}
                    disabled={cachingTiles}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-catalan-hover hover:bg-catalan-primary/10 hover:text-catalan-primary text-catalan-textMuted text-sm transition-colors text-left disabled:opacity-50"
                  >
                    <span>🗺</span>
                    {cachingTiles ? 'Caching map…' : 'Cache map offline'}
                  </button>
                </div>
                {tilesCacheMsg && <p className="text-xs text-catalan-info mt-2 px-1">{tilesCacheMsg}</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </WithSidebar>
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
