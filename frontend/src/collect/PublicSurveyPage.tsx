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

  // Submit: guarantee the response is saved locally, THEN upload (with retry).
  const handleSubmit = async (draft: SubmissionDraft) => {
    if (!token) return
    let stored = false
    try {
      await enqueueSubmission(token, draft.values)
      await clearDraft(token)
      stored = true
    } catch (e) {
      console.error('[PublicSurvey] local save failed', e)
    }

    if (!stored) {
      // Storage unavailable — hold the data in memory and try a direct upload.
      try {
        await axios.post(`/api/v1/survey/${token}/submit`, { data_json: draft.values })
        setUploadState('uploaded')
        setSubmitted(true)
        return
      } catch {
        // Both failed: never lose it. Keep in memory; the retry loop recovers it.
        memoryFallback.current = draft.values
        setUploadState('pending')
        setSubmitted(true)
        return
      }
    }

    // Stored safely. Show success immediately; upload in the background.
    setSubmitted(true)
    try {
      const remaining = await flush(token)
      setUploadState(remaining === 0 ? 'uploaded' : 'pending')
    } catch {
      setUploadState('pending')
    }
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
            initialDraft={initialDraft ?? undefined}
          />
        )}
      </div>
    </div>
  )
}
