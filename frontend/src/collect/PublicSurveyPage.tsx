import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'
import FormRenderer, { type SubmissionDraft } from '@/renderer/FormRenderer'
import type { FormSchema } from '@/types/form'
import EmojiIcon from '@/components/EmojiIcon'
import {
  requestPersistence, saveDraft, loadDraft, clearDraft,
  enqueueSubmission, flush,
} from './surveyStore'
import { encryptCapsule, downloadBlob } from './surveyCrypto'
import { buildQA } from './responseRecord'

export default function PublicSurveyPage() {
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [schema, setSchema] = useState<FormSchema | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [initialDraft, setInitialDraft] = useState<SubmissionDraft | null>(null)
  const [submitted, setSubmitted] = useState(false)
  // 'uploaded' = confirmed on server. 'pending' = safe on this device, still uploading.
  const [uploadState, setUploadState] = useState<'uploaded' | 'pending'>('uploaded')
  // Rare double-failure (storage AND network both down): keep the values here and retry.
  const memoryFallback = useRef<Record<string, unknown> | null>(null)
  // Offline backup: server's RSA public key (if the feature is enabled) + the data
  // needed to (re)build the encrypted .fgresp file for this response.
  const [recoveryPubKey, setRecoveryPubKey] = useState<string | null>(null)
  const backup = useRef<{ id: string; values: Record<string, unknown> } | null>(null)
  const [backupSaved, setBackupSaved] = useState(false)

  // Load form + restore any autosaved draft, and flush leftover pending uploads.
  useEffect(() => {
    if (!token) return
    requestPersistence()
    // Retry any submission a prior visit failed to upload.
    flush(token).catch(() => {})
    axios.get(`/api/v1/survey/${token}/info`)
      .then(async r => {
        setSchema(r.data.json_schema as FormSchema)
        setFormTitle(r.data.title)
        setRecoveryPubKey(r.data.recovery_public_key ?? null)
        const values = await loadDraft(token).catch(() => null)
        if (values) {
          setInitialDraft({
            id: 'draft', formVersion: (r.data.json_schema?.version ?? 1) as number,
            values, gpsOpen: null, gpsSubmit: null, status: 'draft',
            startedAt: new Date().toISOString(),
          })
        }
      })
      .catch(() => setError('This survey link is invalid or has been deactivated.'))
      .finally(() => setLoading(false))
  }, [token])

  // Keep retrying pending uploads: on regaining connectivity and on an interval.
  useEffect(() => {
    if (!token) return
    const retry = async () => {
      // Recover a double-failure submission first, then flush the queue.
      if (memoryFallback.current) {
        try {
          await enqueueSubmission(token, memoryFallback.current)
          memoryFallback.current = null
        } catch { /* storage still down — leave it in memory */ }
      }
      const remaining = await flush(token).catch(() => 1)
      if (submitted && remaining === 0 && !memoryFallback.current) setUploadState('uploaded')
    }
    window.addEventListener('online', retry)
    const iv = setInterval(retry, 15000)
    return () => { window.removeEventListener('online', retry); clearInterval(iv) }
  }, [token, submitted])

  // Autosave: persist the in-progress draft on every debounced change.
  const handleSave = async (draft: SubmissionDraft) => {
    if (!token) return
    await saveDraft(token, draft.values)
  }

  // Build + download the encrypted backup file for the current response.
  const saveBackup = async () => {
    if (!token || !recoveryPubKey || !backup.current) return
    try {
      const { id, values } = backup.current
      const blob = await encryptCapsule(recoveryPubKey, { data_json: values }, { id, token })
      const safe = (formTitle || 'survey').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
      downloadBlob(blob, `${safe}-response-${id.slice(0, 8)}.fgresp`)
      setBackupSaved(true)
    } catch (e) {
      console.error('[PublicSurvey] backup encryption failed', e)
    }
  }

  // Submit AND download in one action (last-question button). Per requirement:
  // DOWNLOAD FIRST — a full questions+answers record, encrypted — so the response
  // is safely on the device even if the network fails, THEN submit to the server.
  // The file's id == the submission id, so a later recovery dedups cleanly.
  const handleSubmitAndDownload = async (draft: SubmissionDraft) => {
    if (!token) return
    const id = crypto.randomUUID()
    if (recoveryPubKey && schema) {
      try {
        const payload = {
          data_json: draft.values,
          qa: buildQA(schema, draft.values),      // full question + answer detail
          form_title: schema.title,
          saved_at: new Date().toISOString(),
        }
        const blob = await encryptCapsule(recoveryPubKey, payload, { id, token })
        const safe = (formTitle || 'survey').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
        downloadBlob(blob, `${safe}-response-${id.slice(0, 8)}.fgresp`)
        setBackupSaved(true)
      } catch (e) {
        console.error('[PublicSurvey] backup encryption failed', e)
      }
    }
    await handleSubmit(draft, id)   // then submit, sharing the same id
  }

  // Submit: guarantee the response is saved locally, THEN upload (with retry).
  const handleSubmit = async (draft: SubmissionDraft, presetId?: string) => {
    if (!token) return
    let submissionId: string | null = null
    try {
      submissionId = await enqueueSubmission(token, draft.values, presetId)
      await clearDraft(token)
    } catch (e) {
      console.error('[PublicSurvey] local save failed', e)
    }

    // Remember what we'd need to encrypt as a device backup for this response.
    const backupId = submissionId ?? presetId ?? crypto.randomUUID()
    backup.current = { id: backupId, values: draft.values }
    setBackupSaved(false)

    if (!submissionId) {
      // Storage unavailable — hold the data in memory and try a direct upload.
      try {
        await axios.post(`/api/v1/survey/${token}/submit`,
          { data_json: draft.values, local_id: backupId }, { timeout: 12000 })
        setUploadState('uploaded')
      } catch {
        // Both failed: never lose it. Keep in memory; retry loop recovers it.
        memoryFallback.current = draft.values
        setUploadState('pending')
        void autoBackup()
      }
      setSubmitted(true)
      return
    }

    // Stored safely. Show success immediately; upload in the background.
    setSubmitted(true)
    try {
      const remaining = await flush(token)
      if (remaining === 0) {
        setUploadState('uploaded')
      } else {
        setUploadState('pending')
        void autoBackup()   // slow/offline/failed → proactively save the backup file
      }
    } catch {
      setUploadState('pending')
      void autoBackup()
    }
  }

  // Best-effort automatic download when the upload didn't complete. The visible
  // "Save backup file" button on the success screen is the reliable fallback if a
  // browser blocks this programmatic download.
  const autoBackup = async () => {
    if (recoveryPubKey && !backupSaved) await saveBackup()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-catalan-bg flex items-center justify-center">
        <div className="text-catalan-textMuted text-sm animate-pulse">Loading survey…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-catalan-bg flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="text-4xl mb-4"><EmojiIcon e="🔒" /></div>
          <h1 className="text-lg font-semibold text-catalan-text mb-2">Survey Unavailable</h1>
          <p className="text-sm text-catalan-textMuted">{error}</p>
        </div>
      </div>
    )
  }

  if (submitted) {
    const uploaded = uploadState === 'uploaded'
    return (
      <div className="min-h-screen bg-catalan-bg flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center bg-catalan-surface border border-catalan-border rounded-2xl p-8">
          <div className="text-5xl mb-4"><EmojiIcon e={uploaded ? '✅' : '💾'} /></div>
          <h1 className="text-xl font-bold text-catalan-text mb-2">Thank you!</h1>
          {uploaded ? (
            <p className="text-sm text-catalan-textMuted">Your response has been recorded successfully.</p>
          ) : (
            <p className="text-sm text-catalan-textMuted">
              Your response is <span className="font-semibold text-catalan-text">saved on this device</span> and
              will upload automatically once you have a connection. You can safely leave this page open.
            </p>
          )}

          {/* Encrypted device backup — the strong safety net when the network is
              poor. Prominent while the upload is still pending; a quiet optional
              link once it's confirmed. Only shown if the server enabled recovery. */}
          {recoveryPubKey && backup.current && (
            <div className="mt-6">
              {/* Always offer a clear download of the submitted response as an
                  encrypted backup file — prominent when the upload is still
                  pending, still a full button (not a faint link) once confirmed. */}
              <button onClick={saveBackup}
                className={`w-full rounded-xl py-3 text-sm font-bold active:scale-[0.98] transition-all ${
                  uploaded
                    ? 'border border-catalan-primary/40 text-catalan-primary hover:bg-catalan-primary/10'
                    : 'bg-catalan-primary text-white hover:brightness-110'}`}>
                <EmojiIcon e="💾" /> {backupSaved ? 'Backup downloaded ✓ — keep it safe' : 'Download my response (backup)'}
              </button>
              {!uploaded && (
                <p className="text-xs text-catalan-textMuted mt-2">
                  Keep this file. If your answers don’t upload, open the{' '}
                  <a href="/survey/recover" className="text-catalan-primary underline">Recover page</a>{' '}
                  later and upload it — your data stays safe.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    // Full-height flex column: FormRenderer uses h-full + internal flex-1 scrolling,
    // so it MUST have a bounded-height parent or the form area collapses to 0px.
    <div className="h-screen flex flex-col bg-catalan-bg">
      {/* Branded header */}
      <header className="bg-catalan-surface border-b border-catalan-border flex-shrink-0">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <img src="/logo-wide.png" alt="FieldGovern" className="h-7 w-auto object-contain" />
          {formTitle && <span className="text-sm font-semibold text-catalan-text truncate">{formTitle}</span>}
        </div>
      </header>

      <div className="flex-1 min-h-0">
        {schema && (
          <FormRenderer
            schema={schema}
            onSave={handleSave}
            onSubmit={handleSubmit}
            onSubmitAndDownload={recoveryPubKey ? handleSubmitAndDownload : undefined}
            initialDraft={initialDraft ?? undefined}
          />
        )}
      </div>
    </div>
  )
}
