import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { FormSchema, FormField, FormSection, ConsentNotice } from '@/types/form'
import { shouldShow, shouldShowSection, evalFormula, getAllFieldsInOrder, filterOptions } from '@/lib/formUtils'
import { v4 as uuidv4 } from 'uuid'
import { useLanguage, getLocalizedLabel, LANGUAGE_OPTIONS } from '@/i18n/LanguageContext'

import TextField        from './fields/TextField'
import NumberField      from './fields/NumberField'
import SingleChoiceField from './fields/SingleChoiceField'
import MultipleChoiceField from './fields/MultipleChoiceField'
import DateTimeField    from './fields/DateTimeField'
import GpsField         from './fields/GpsField'
import PhotoField       from './fields/PhotoField'
import AudioField       from './fields/AudioField'
import RepeatGroupField from './fields/RepeatGroupField'
import BarcodeField     from './fields/BarcodeField'
import RatingField      from './fields/RatingField'
import NoteField        from './fields/NoteField'
import SignatureField   from './fields/SignatureField'
import EmojiIcon from '@/components/EmojiIcon'

interface Props {
  schema: FormSchema
  onSave:   (draft: SubmissionDraft) => Promise<void>   // auto-save (debounced)
  onSubmit: (draft: SubmissionDraft) => Promise<void>   // final submit
  onSubmitAndDownload?: (draft: SubmissionDraft) => Promise<void>  // submit + save encrypted backup file
  onSaveExit?: (draft: SubmissionDraft) => void          // fire-and-forget server draft backup on Save & Exit
  onCancel?: () => void                                  // exit form collection
  initialDraft?: SubmissionDraft
  formId?: string                                        // enables the resubmit cooldown + duplicate check below
  getLastSubmission?: () => Promise<Record<string, unknown> | null>  // most recent locally-saved answers for this form
}

const DUP_COMPARE_SKIP_KEYS = new Set(['_started_at', '_duration_sec', '_audio_audit'])

/** True if two answer sets are identical, ignoring per-submission metadata (timing, audit clip). */
function sameAnswers(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const clean = (o: Record<string, unknown>) => {
    const keys = Object.keys(o).filter(k => !DUP_COMPARE_SKIP_KEYS.has(k)).sort()
    return JSON.stringify(keys.map(k => [k, o[k]]))
  }
  return clean(a) === clean(b)
}

export interface SubmissionDraft {
  id: string
  formId?: string
  formVersion: number
  values: Record<string, unknown>
  gpsOpen:   GpsCoord | null
  gpsSubmit: GpsCoord | null
  status: 'draft' | 'outbox'
  startedAt: string
  consentTimestamp?: string
  consentNoticeVersion?: number
  consentLanguage?: string
  consentPurposes?: Record<string, boolean>   // e.g. {photo: true, audio: false, gps: true, followup: false}
  consentOral?: boolean
  consentOralAudio?: string
}

/** Which per-purpose consent bucket a field type belongs to. Fields not
 * covered by an optional purpose (text, number, choice, etc.) are core
 * "survey answers" — never individually blockable, only the whole form. */
function purposeOfFieldType(type: FormField['type']): 'photo' | 'audio' | 'gps' | 'survey' {
  if (type === 'photo') return 'photo'
  if (type === 'audio') return 'audio'
  if (type === 'gps') return 'gps'
  return 'survey'
}

interface GpsCoord { lat: number; lng: number; accuracy: number }

function captureGps(): Promise<GpsCoord | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      ()  => resolve(null),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  })
}

function validate(field: FormField, value: unknown): string {
  if (field.required && (value === '' || value === null || value === undefined ||
      (Array.isArray(value) && value.length === 0))) return 'This field is required'
  if ((field.type === 'number' || field.type === 'decimal') && value !== '') {
    const n = Number(value)
    if (field.min !== undefined && n < field.min) return `Minimum value is ${field.min}`
    if (field.max !== undefined && n > field.max) return `Maximum value is ${field.max}`
  }
  return ''
}

/** Seed default values for date/time fields flagged autoNow (today / current time). */
function seedAutoNow(schema: FormSchema): Record<string, unknown> {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const values: Record<string, unknown> = {}
  const walk = (secs: FormSection[]) => {
    for (const s of secs) {
      for (const f of s.fields) {
        if (f.autoNow && f.type === 'date') values[f.name] = today
        if (f.autoNow && f.type === 'time') values[f.name] = time
      }
      if (s.subsections?.length) walk(s.subsections)
    }
  }
  walk(schema.sections)
  return values
}

export default function FormRenderer({ schema, onSave, onSubmit, onSubmitAndDownload, onSaveExit, onCancel, initialDraft, getLastSubmission }: Props) {
  const purpose = schema.settings?.purpose as string | undefined
  const noticeCfg = schema.settings?.consent_notice
  const hasNotice = !!(noticeCfg?.org_name || noticeCfg?.purpose || purpose)
  const [consentGiven, setConsentGiven] = useState(!hasNotice || !!initialDraft?.consentTimestamp)

  // Which optional purposes this form actually asks about — only show/ask a
  // toggle for a purpose the form can actually exercise.
  const formFieldTypes = useMemo(() => new Set(getAllFieldsInOrder(schema.sections).map(f => f.type)), [schema])
  const relevantPurposes = useMemo(() => {
    const list: string[] = []
    if (formFieldTypes.has('photo')) list.push('photo')
    if (formFieldTypes.has('audio')) list.push('audio')
    if (formFieldTypes.has('gps')) list.push('gps')
    if (noticeCfg?.ask_followup) list.push('followup')
    return list
  }, [formFieldTypes, noticeCfg?.ask_followup])
  // Gate-local state — only used while the consent screen is showing; the
  // respondent's choices are committed into `draft` on Agree (below), which
  // is what the rest of the session (blocking, auto-save, resume) reads from.
  const [gatePurposes, setGatePurposes] = useState<Record<string, boolean>>(initialDraft?.consentPurposes ?? {})
  const [gateOral, setGateOral] = useState(initialDraft?.consentOral ?? false)
  const [gateOralAudio, setGateOralAudio] = useState<string>(initialDraft?.consentOralAudio ?? '')

  const [draft, setDraft] = useState<SubmissionDraft>(() => initialDraft ?? {
    id: uuidv4(), formVersion: schema.version,
    values: seedAutoNow(schema), gpsOpen: null, gpsSubmit: null, status: 'draft', startedAt: new Date().toISOString(),
  })
  const declinedPurposes = useMemo(
    () => new Set(relevantPurposes.filter(p => !(draft.consentPurposes?.[p]))),
    [relevantPurposes, draft.consentPurposes],
  )
  const [page, setPage]       = useState(0)
  const [errors, setErrors]   = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [syncStatus, setSyncStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [saveExitError, setSaveExitError] = useState('')
  const [dupConfirm, setDupConfirm] = useState<SubmissionDraft | null>(null)  // set when the answers match the last submission
  const saveTimer  = useRef<ReturnType<typeof setTimeout>>()
  const scrollRef  = useRef<HTMLDivElement>(null)
  const submitLatch = useRef(false)   // synchronous re-entry guard; blocks double-tap before cooldown/submitting state settles
  // QC: background audio-audit recorder (compressed)
  const auditRecRef    = useRef<MediaRecorder | null>(null)
  const auditChunksRef = useRef<Blob[]>([])
  const auditStreamRef = useRef<MediaStream | null>(null)

  // Flatten visible fields — respects both section-level and field-level skip logic
  const allFields: FormField[] = useMemo(() => {
    const result: FormField[] = []
    const traverse = (secs: typeof schema.sections) => {
      for (const sec of secs) {
        // Skip entire section if its condition says to hide it
        if (!shouldShowSection(sec, draft.values)) continue
        for (const f of sec.fields) {
          if (!shouldShow(f, draft.values)) continue
          if (declinedPurposes.has(purposeOfFieldType(f.type))) continue  // per-purpose consent refused — skip this question type
          result.push(f)
        }
        if (sec.subsections?.length) traverse(sec.subsections)
      }
    }
    traverse(schema.sections)
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, draft.values, declinedPurposes])

  // Auto-compute calculated fields in document order so later calcs can use earlier ones
  const valuesWithCalc = useMemo(() => {
    const values = { ...draft.values }
    allFields.filter(f => f.type === 'calculated' && f.formula).forEach(f => {
      const result = evalFormula(f.formula!, values)
      if (result !== null) values[f.name] = result
    })
    return values
  }, [allFields, draft.values])

  const currentField = allFields[page]

  // ── Localize current field's label + hint ──
  const { language, setLanguage } = useLanguage()
  const localizedField = useMemo(() => {
    if (!currentField) return currentField
    // Cascading select: narrow options by parent answers before localizing.
    const visibleOptions = filterOptions(currentField, draft.values)
    return {
      ...currentField,
      label: getLocalizedLabel(currentField as unknown as Record<string, unknown>, 'label', language),
      hint: getLocalizedLabel(currentField as unknown as Record<string, unknown>, 'hint', language) || undefined,
      // Localize option labels for choice fields
      options: visibleOptions?.map(opt => ({
        ...opt,
        label: getLocalizedLabel(opt as unknown as Record<string, unknown>, 'label', language),
      })),
    } as FormField
  }, [currentField, language, draft.values])

  // Only capture device location when the form actually asks for it (has a GPS
  // question) AND that purpose wasn't declined at the consent gate. Otherwise
  // we never touch geolocation — no silent tracking behind a declined consent.
  const hasGpsField = useMemo(
    () => getAllFieldsInOrder(schema.sections).some(f => f.type === 'gps') && !declinedPurposes.has('gps'),
    [schema, declinedPurposes],
  )

  // Capture GPS on mount — only if the form has a GPS question
  useEffect(() => {
    if (!hasGpsField) return
    captureGps().then(gps => setDraft(d => ({ ...d, gpsOpen: gps })))
  }, [hasGpsField])

  // QC: start a compressed background audio audit when enabled (never blocks collection)
  useEffect(() => {
    const cfg = schema.settings?.audio_audit as { enabled?: boolean } | undefined
    if (!cfg?.enabled || initialDraft) return  // only fresh sessions
    if (!consentGiven) return  // wait for consent — also ensures mic is granted before we record
    if (declinedPurposes.has('audio')) return  // respondent declined audio consent — no mic capture of any kind
    let cancelled = false
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
        })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        const mt = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : ''
        const rec = new MediaRecorder(stream, { ...(mt ? { mimeType: mt } : {}), audioBitsPerSecond: 16000 })
        auditChunksRef.current = []
        rec.ondataavailable = e => { if (e.data.size > 0) auditChunksRef.current.push(e.data) }
        rec.start(5000)
        auditRecRef.current = rec
        auditStreamRef.current = stream
      } catch { /* mic denied — skip the audit, never block data collection */ }
    })()
    return () => {
      cancelled = true
      try { if (auditRecRef.current?.state !== 'inactive') auditRecRef.current?.stop() } catch { }
      auditStreamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [consentGiven, declinedPurposes])

  // Stop the audit recorder and resolve a compressed data URI (or null)
  const stopAudit = (): Promise<string | null> => new Promise(resolve => {
    const rec = auditRecRef.current
    if (!rec || rec.state === 'inactive') return resolve(null)
    rec.onstop = () => {
      auditStreamRef.current?.getTracks().forEach(t => t.stop())
      try {
        const blob = new Blob(auditChunksRef.current, { type: rec.mimeType })
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.readAsDataURL(blob)
      } catch { resolve(null) }
    }
    try { rec.stop() } catch { resolve(null) }
  })

  // Debounced auto-save (300ms)
  const triggerSave = useCallback((d: SubmissionDraft) => {
    clearTimeout(saveTimer.current)
    setSyncStatus('saving')
    saveTimer.current = setTimeout(async () => {
      try { await onSave(d); setSyncStatus('saved') }
      catch (e) { console.error('[FormRenderer] autosave failed', e); setSyncStatus('error') }
    }, 300)
  }, [onSave])

  // Field types that auto-advance to the next question on selection
  const AUTO_ADVANCE_TYPES = new Set(['single_choice', 'date', 'time', 'rating'])

  const setValue = (name: string, value: unknown) => {
    setDraft(d => {
      const next = { ...d, values: { ...d.values, [name]: value } }
      triggerSave(next)
      return next
    })
    setErrors(e => ({ ...e, [name]: '' }))

    // Auto-advance for simple one-tap selections
    if (currentField && AUTO_ADVANCE_TYPES.has(currentField.type) && value !== '' && value != null) {
      setTimeout(() => {
        setPage(p => {
          if (p < allFields.length - 1) return p + 1
          return p
        })
      }, 320)
    }
  }

  // Scroll content area to top whenever the page changes
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }, [page])

  // Keyboard: Enter/ArrowRight = Next, ArrowLeft = Back
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return
      if (e.key === 'ArrowRight' || e.key === 'Enter') goNext()
      if (e.key === 'ArrowLeft') goPrev()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const goNext = () => {
    if (!currentField) return
    const err = validate(currentField, draft.values[currentField.name])
    if (err) { setErrors(e => ({ ...e, [currentField.name]: err })); return }
    if (page < allFields.length - 1) setPage(p => p + 1)
  }

  const goPrev = () => { if (page > 0) setPage(p => p - 1) }

  const handleSaveExit = async () => {
    setSaveExitError('')
    try {
      const d = { ...draft, status: 'draft' as const }
      await onSave(d)
      onSaveExit?.(d)   // best-effort server backup (must not block exit)
      onCancel?.()
    } catch (e) {
      console.error('[FormRenderer] Save & Exit failed', e)
      setSaveExitError(e instanceof Error ? e.message : String(e))
    }
  }

  // Build the final draft (validate current field, capture GPS, stamp timing +
  // audio audit). Returns null if validation fails.
  const buildFinalDraft = async (): Promise<SubmissionDraft | null> => {
    if (currentField) {
      const err = validate(currentField, draft.values[currentField.name])
      if (err) { setErrors(e => ({ ...e, [currentField.name]: err })); return null }
    }
    const gpsSubmit = hasGpsField ? await captureGps() : null
    const startedMs = draft.startedAt ? Date.parse(draft.startedAt) : Date.now()
    const _duration_sec = Math.max(0, Math.round((Date.now() - startedMs) / 1000))
    const auditUri = await stopAudit()
    const valuesWithMeta = {
      ...valuesWithCalc,
      _started_at: draft.startedAt ?? new Date().toISOString(),
      _duration_sec,
      ...(auditUri && auditUri.startsWith('data:audio/') ? { _audio_audit: auditUri } : {}),
      ...(draft.consentNoticeVersion != null ? { _consent_notice_version: draft.consentNoticeVersion } : {}),
      ...(draft.consentLanguage ? { _consent_language: draft.consentLanguage } : {}),
      ...(draft.consentTimestamp ? { _consent_given_at: draft.consentTimestamp } : {}),
      ...(draft.consentPurposes ? { _consent_purposes: draft.consentPurposes } : {}),
      ...(draft.consentOral ? { _consent_oral: true } : {}),
      ...(draft.consentOralAudio ? { _consent_oral_audio: draft.consentOralAudio } : {}),
    }
    const final: SubmissionDraft = { ...draft, values: valuesWithMeta, gpsSubmit, status: 'outbox' }
    setDraft(final)
    return final
  }

  const doSubmit = async (final: SubmissionDraft, submitFn: (d: SubmissionDraft) => Promise<void>) => {
    await submitFn(final)
  }

  const handleSubmit = async () => {
    if (submitLatch.current) return
    submitLatch.current = true
    setSubmitting(true)
    try {
      const final = await buildFinalDraft()
      if (!final) return
      if (getLastSubmission) {
        const last = await getLastSubmission()
        if (last && sameAnswers(last, final.values)) { setDupConfirm(final); return }
      }
      await doSubmit(final, onSubmit)
    } finally { setSubmitting(false); submitLatch.current = false }
  }

  const handleSubmitAndDownload = async () => {
    if (!onSubmitAndDownload || submitLatch.current) return
    submitLatch.current = true
    setSubmitting(true)
    try {
      const final = await buildFinalDraft()
      if (final) await doSubmit(final, onSubmitAndDownload)
    } finally { setSubmitting(false); submitLatch.current = false }
  }

  const confirmDuplicateSubmit = async () => {
    if (!dupConfirm) return
    setSubmitting(true)
    try { await doSubmit(dupConfirm, onSubmit) } finally { setSubmitting(false); setDupConfirm(null) }
  }

  const isLast = page === allFields.length - 1
  // Auto-advance types move on by themselves — a manual Next is redundant (and confusing) on those pages.
  // currentField can be undefined here (empty form, or every field's purpose was declined) —
  // the consent-gate / no-questions screens below return before these values are ever rendered,
  // but they're still computed on every render, so must not dereference a possibly-undefined field.
  const showManualNext = isLast || !currentField || !AUTO_ADVANCE_TYPES.has(currentField.type)
  const currentHasValue = !!currentField && draft.values[currentField.name] !== '' && draft.values[currentField.name] != null
  const progress = allFields.length > 0 ? ((page + 1) / allFields.length) * 100 : 0

  if (hasNotice && !consentGiven) {
    const asRec = (noticeCfg ?? {}) as unknown as Record<string, unknown>
    const loc = (key: keyof ConsentNotice) => getLocalizedLabel(asRec, key, language)
    const orgName = loc('org_name')
    const itemsText = loc('items_text')
    const items = itemsText ? itemsText.split('\n').map(s => s.trim()).filter(Boolean) : []
    const noticePurpose = loc('purpose') || purpose || ''
    const retention = loc('retention')
    const sharing = loc('sharing')
    const withdrawal = loc('withdrawal')
    const grievance = loc('grievance_contact')
    const board = loc('board_contact')
    const audioUrl = loc('audio_url')
    const isFullNotice = !!noticeCfg?.org_name

    const PURPOSE_LABELS: Record<string, string> = {
      photo: 'Take photos as part of this survey',
      audio: 'Record audio as part of this survey',
      gps: 'Record this device\'s location',
      followup: 'Contact you again for follow-up research',
    }

    const agree = () => {
      const ts = new Date().toISOString()
      setConsentGiven(true)
      setDraft(d => ({
        ...d, consentTimestamp: ts,
        consentNoticeVersion: noticeCfg?.version,
        consentLanguage: language,
        consentPurposes: gatePurposes,
        consentOral: gateOral,
        consentOralAudio: gateOralAudio || undefined,
      }))
    }

    return (
      <div className="h-full bg-catalan-bg flex flex-col items-center justify-center px-5 font-sans overflow-y-auto py-8">
        <div className="w-full max-w-lg bg-catalan-surface border border-catalan-border rounded-2xl p-8">
          {isFullNotice && (
            <div className="flex justify-center gap-0.5 border border-catalan-border rounded-lg overflow-hidden mb-5 w-fit mx-auto">
              {LANGUAGE_OPTIONS.map(opt => (
                <button
                  key={opt.code}
                  type="button"
                  onClick={() => setLanguage(opt.code)}
                  className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${language === opt.code ? 'bg-catalan-primary text-catalan-bg' : 'text-catalan-textMuted hover:bg-catalan-hover'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          <div className="text-center">
            <div className="text-4xl mb-4"><EmojiIcon e="📋" /></div>
            <h2 className="text-lg font-semibold text-catalan-text mb-1">{orgName || 'Data Collection Purpose'}</h2>
            {noticeCfg?.version != null && (
              <p className="text-[11px] text-catalan-textMuted mb-3">Notice v{noticeCfg.version}</p>
            )}
          </div>

          <div className="text-sm text-catalan-textMuted leading-relaxed space-y-3 text-left mb-6">
            {noticePurpose && <p>{noticePurpose}</p>}
            {items.length > 0 && (
              <div>
                <p className="font-medium text-catalan-text mb-1">We will collect:</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  {items.map((it, i) => <li key={i}>{it}</li>)}
                </ul>
              </div>
            )}
            {retention && <p><span className="font-medium text-catalan-text">Retention: </span>{retention}</p>}
            {sharing && <p><span className="font-medium text-catalan-text">Sharing: </span>{sharing}</p>}
            {withdrawal && <p><span className="font-medium text-catalan-text">Withdrawing consent: </span>{withdrawal}</p>}
            {(grievance || board) && (
              <p>
                {grievance && <><span className="font-medium text-catalan-text">Grievance contact: </span>{grievance}<br /></>}
                {board && <><span className="font-medium text-catalan-text">Data Protection Board: </span>{board}</>}
              </p>
            )}
            {audioUrl && (
              <audio controls src={audioUrl} className="w-full mt-2" />
            )}
          </div>

          {relevantPurposes.length > 0 && (
            <div className="mb-6 space-y-2 text-left">
              <p className="text-xs font-medium text-catalan-text uppercase tracking-wider">You may separately agree to:</p>
              {relevantPurposes.map(p => (
                <label key={p} className="flex items-center gap-2.5 text-sm text-catalan-text cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!gatePurposes[p]}
                    onChange={e => setGatePurposes(gp => ({ ...gp, [p]: e.target.checked }))}
                    className="w-4 h-4 accent-catalan-primary flex-shrink-0"
                  />
                  {PURPOSE_LABELS[p] ?? p}
                </label>
              ))}
              <p className="text-xs text-catalan-textMuted">Unchecked items are simply skipped during the survey — the rest still proceeds.</p>
            </div>
          )}

          <div className="mb-6 border-t border-catalan-border pt-4 text-left">
            <label className="flex items-center gap-2.5 text-sm text-catalan-text cursor-pointer">
              <input
                type="checkbox"
                checked={gateOral}
                onChange={e => setGateOral(e.target.checked)}
                className="w-4 h-4 accent-catalan-primary flex-shrink-0"
              />
              Consent given orally (this notice was read aloud / explained to the respondent)
            </label>
            {gateOral && (
              <div className="mt-3">
                <AudioField
                  field={{ id: '_consent_oral_audio', name: '_consent_oral_audio', type: 'audio', label: 'Optional: record proof of oral consent', required: false } as FormField}
                  value={gateOralAudio || null}
                  onChange={v => setGateOralAudio(v)}
                />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={agree}
            className="w-full bg-catalan-primary text-white rounded-xl py-4 text-base font-semibold cursor-pointer hover:brightness-110 active:scale-[0.98] transition-all"
          >
            I Agree &amp; Continue
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} className="mt-3 w-full text-sm text-catalan-textMuted hover:text-catalan-text">
              I Don't Agree
            </button>
          )}
        </div>
      </div>
    )
  }

  if (!currentField) {
    // Two different reasons allFields can be empty: a genuinely question-less
    // form (rare, nothing to do about it), or every question on this form
    // belonged to a purpose the respondent just declined (e.g. an all-photo
    // form where photo consent was refused) — that's a real, valid outcome,
    // not an error, so let them submit the (empty-answers) record rather
    // than stranding them on a dead-end screen.
    const declinedEverything = declinedPurposes.size > 0 && formFieldTypes.size > 0
    if (declinedEverything) {
      return (
        <div className="min-h-screen bg-catalan-bg text-catalan-text font-sans flex flex-col items-center justify-center px-5">
          <div className="text-center max-w-sm">
            <div className="text-5xl mb-4"><EmojiIcon e="📋" /></div>
            <div className="text-base mb-2">No questions to answer</div>
            <p className="text-sm text-catalan-textMuted mb-6">Every question on this form needed a consent you didn't give. Your response — noting what you declined — can still be recorded.</p>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className={`w-full bg-catalan-success text-catalan-bg rounded-xl py-4 text-base font-bold ${submitting ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:brightness-110'}`}
            >
              {submitting ? 'Submitting…' : 'Submit ✓'}
            </button>
            {onCancel && (
              <button type="button" onClick={onCancel} className="mt-3 text-sm text-catalan-textMuted hover:text-catalan-text">
                Cancel
              </button>
            )}
          </div>
        </div>
      )
    }
    return (
      <div className="min-h-screen bg-catalan-bg text-catalan-text font-sans flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4"><EmojiIcon e="📋" /></div>
          <div className="text-base">This form has no questions.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-catalan-bg flex flex-col font-sans h-full min-h-0">

      {saveExitError && (
        <div className="bg-catalan-error/10 border-b border-catalan-error/30 text-catalan-error px-4 py-2 text-xs shrink-0 z-20 flex items-center gap-3">
          <span className="flex-1"><EmojiIcon e="⚠" /> Couldn't save your answers ({saveExitError || 'unknown error'}) — try again before leaving.</span>
          <button type="button" onClick={handleSaveExit} className="font-semibold underline shrink-0">Retry</button>
          <button type="button" onClick={onCancel} className="font-semibold underline shrink-0">Exit without saving</button>
        </div>
      )}

      {/* ── Header ── */}
      <div className="px-4 pt-3 pb-3 border-b border-catalan-border bg-catalan-surface sticky top-0 z-10 flex-shrink-0">
        <div className="max-w-2xl mx-auto">
          {/* Row 1: Back button + form title + lang toggle + save status */}
          <div className="flex items-center gap-2 mb-2">
            {onCancel && (
              <button
                onClick={handleSaveExit}
                className="flex items-center gap-1 min-w-[44px] min-h-[44px] -ml-2 px-2 rounded-lg text-catalan-primary hover:bg-catalan-primary/10 transition-colors text-sm font-medium"
                title="Save draft and go back"
              >
                <EmojiIcon e="←" /> <span className="hidden sm:inline">Save &amp; Exit</span>
              </button>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-catalan-text truncate">{schema.title}</div>
              <div className="text-xs text-catalan-textMuted">
                Question {page + 1} of {allFields.length}
                {' · '}
                {getAllFieldsInOrder(schema.sections).find(f => f.id === currentField.id) && (() => {
                  const findSec = (secs: typeof schema.sections): string => {
                    for (const s of secs) {
                      if (s.fields.some(f => f.id === currentField.id)) return s.title
                      if (s.subsections?.length) { const t = findSec(s.subsections); if (t) return t }
                    }
                    return ''
                  }
                  return findSec(schema.sections)
                })()}
              </div>
            </div>
            {/* Language toggle pill */}
            <div className="flex gap-0.5 border border-catalan-border rounded-lg overflow-hidden flex-shrink-0">
              {LANGUAGE_OPTIONS.map(opt => (
                <button
                  key={opt.code}
                  onClick={() => setLanguage(opt.code)}
                  className={`px-2 py-1 text-[11px] font-semibold transition-colors
                    ${language === opt.code
                      ? 'bg-catalan-primary text-catalan-bg'
                      : 'text-catalan-textMuted hover:bg-catalan-hover'
                    }`}
                >
                  {opt.code.toUpperCase()}
                </button>
              ))}
            </div>
            <span className={`text-xs flex-shrink-0 ${syncStatus === 'saved' ? 'text-catalan-success' : syncStatus === 'saving' ? 'text-catalan-warning' : 'text-catalan-error'}`}>
              {syncStatus === 'saved' ? '● Saved' : syncStatus === 'saving' ? '●' : <EmojiIcon e="⚠" />}
            </span>
          </div>
          {/* Progress bar */}
          <div className="bg-catalan-hover rounded-full h-1.5">
            <div className="bg-catalan-primary rounded-full h-1.5 transition-[width] duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      {/* ── Field ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
      <div className="max-w-2xl mx-auto px-5 py-7 pb-4 md:py-12">
        {localizedField.type === 'text' && (
          <TextField field={localizedField} value={draft.values[currentField.name] as string ?? ''} onChange={v => setValue(currentField.name, v)} />
        )}
        {(localizedField.type === 'number' || localizedField.type === 'decimal') && (
          <NumberField field={localizedField} value={draft.values[currentField.name] as string ?? ''} onChange={v => setValue(currentField.name, v)} />
        )}
        {localizedField.type === 'single_choice' && (
          <SingleChoiceField field={localizedField} value={draft.values[currentField.name] as string ?? ''} onChange={v => setValue(currentField.name, v)} />
        )}
        {localizedField.type === 'multiple_choice' && (
          <MultipleChoiceField field={localizedField} value={draft.values[currentField.name] as string[] ?? []} onChange={v => setValue(currentField.name, v)} />
        )}
        {(localizedField.type === 'date' || localizedField.type === 'time') && (
          <DateTimeField field={localizedField} value={draft.values[currentField.name] as string ?? ''} onChange={v => setValue(currentField.name, v)} />
        )}
        {localizedField.type === 'gps' && (
          <GpsField field={localizedField} value={draft.values[currentField.name] as { lat: number; lng: number; accuracy: number } | null ?? null} onChange={v => setValue(currentField.name, v)} />
        )}
        {localizedField.type === 'photo' && (
          <PhotoField field={localizedField} value={draft.values[currentField.name] as string ?? null} onChange={v => setValue(currentField.name, v)} />
        )}
        {localizedField.type === 'audio' && (
          <AudioField field={localizedField} value={draft.values[currentField.name] as string ?? null} onChange={v => setValue(currentField.name, v)} submissionId={draft.id} />
        )}
        {localizedField.type === 'repeat_group' && (
          <RepeatGroupField field={localizedField} value={draft.values[currentField.name] as { _id: string; [key: string]: unknown }[] ?? []} onChange={v => setValue(currentField.name, v)} />
        )}
        {localizedField.type === 'barcode' && (
          <BarcodeField field={localizedField} value={draft.values[currentField.name] as string ?? ''} onChange={v => setValue(currentField.name, v)} />
        )}
        {localizedField.type === 'rating' && (
          <RatingField field={localizedField} value={draft.values[currentField.name] as number ?? null} onChange={v => setValue(currentField.name, v)} />
        )}
        {localizedField.type === 'note' && <NoteField field={localizedField} />}
        {localizedField.type === 'signature' && (
          <SignatureField field={localizedField} value={draft.values[currentField.name] as string ?? null} onChange={v => setValue(currentField.name, v)} />
        )}
        {localizedField.type === 'calculated' && (
          <div>
            {/* Question label */}
            <h2 className="text-xl font-semibold text-catalan-text mb-1 leading-snug">{localizedField.label}</h2>
            {localizedField.hint && <p className="text-sm text-catalan-textMuted mb-4">{localizedField.hint}</p>}

            {/* Auto-calculated badge */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs bg-catalan-primary/10 text-catalan-primary border border-catalan-primary/20 px-2.5 py-0.5 rounded-full font-medium">
                ∑ Auto-calculated
              </span>
              <span className="text-xs text-catalan-textMuted">Updates as you fill in earlier answers</span>
            </div>

            {/* Value display */}
            <div className="bg-catalan-surface border-2 border-catalan-primary/30 rounded-2xl p-6 text-center">
              {valuesWithCalc[currentField.name] != null && valuesWithCalc[currentField.name] !== '' ? (
                <div className="text-4xl font-bold text-catalan-primary tracking-tight">
                  {String(valuesWithCalc[currentField.name])}
                </div>
              ) : (
                <div className="text-3xl text-catalan-textMuted/40 font-light">—</div>
              )}
              <div className="text-xs text-catalan-textMuted mt-3 font-mono opacity-60">
                {currentField.formula}
              </div>
            </div>

            <p className="text-xs text-catalan-textMuted text-center mt-3">
              This value is computed automatically. Press <strong>Next</strong> to continue.
            </p>
          </div>
        )}

        {errors[currentField.name] && (
          <div className="text-catalan-error text-sm mt-3 flex items-center gap-1.5">
            <span><EmojiIcon e="⚠" /></span> {errors[currentField.name]}
          </div>
        )}
      </div>
      </div>

      {/* ── Navigation ── */}
      <div className="border-t border-catalan-border bg-catalan-surface flex-shrink-0" style={{paddingBottom:'max(env(safe-area-inset-bottom), 12px)'}}>
        <div className="max-w-2xl mx-auto px-4 py-3 flex gap-2.5">
          {page > 0 ? (
            <button
              onClick={goPrev}
              className="flex-1 bg-catalan-hover border border-catalan-border text-catalan-text rounded-xl py-4 text-[15px] font-medium cursor-pointer hover:bg-catalan-surface active:scale-[0.98] transition-all min-h-[56px]"
            >
              <EmojiIcon e="←" /> Back
            </button>
          ) : null}
          {isLast && dupConfirm ? (
            <div className="flex-1 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 flex flex-col gap-2.5">
              <p className="text-sm text-catalan-text leading-snug">
                <EmojiIcon e="⚠" /> These answers look identical to your last submission for this form. Submit anyway, or go back and check?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setDupConfirm(null)}
                  className="flex-1 bg-catalan-hover border border-catalan-border text-catalan-text rounded-lg py-2.5 text-sm font-medium cursor-pointer hover:bg-catalan-surface"
                >
                  Go back
                </button>
                <button
                  onClick={confirmDuplicateSubmit}
                  disabled={submitting}
                  className={`flex-1 bg-catalan-success text-catalan-bg rounded-lg py-2.5 text-sm font-bold ${submitting ? 'cursor-wait opacity-70' : 'cursor-pointer hover:brightness-110'}`}
                >
                  {submitting ? 'Submitting…' : 'Submit anyway'}
                </button>
              </div>
            </div>
          ) : isLast ? (
            <>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className={`relative flex-1 overflow-hidden bg-catalan-success text-catalan-bg rounded-xl py-4 text-base font-bold min-h-[64px] active:scale-[0.98] transition-all ${submitting ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:brightness-110'}`}
              >
                <span className="relative inline-flex items-center justify-center gap-2">
                  {submitting && <span className="w-4 h-4 border-2 border-catalan-bg/40 border-t-catalan-bg rounded-full animate-spin" />}
                  {submitting ? 'Submitting…' : 'Submit ✓'}
                </span>
              </button>
              {onSubmitAndDownload && (
                <button
                  onClick={handleSubmitAndDownload}
                  disabled={submitting}
                  className={`flex-[1.6] bg-green-800 text-white rounded-xl px-3 py-3 text-sm font-semibold min-h-[64px] leading-tight whitespace-normal active:scale-[0.98] transition-all ${submitting ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-green-900'}`}
                  title="Submit to the server AND save an encrypted backup file to this device"
                >
                  {submitting ? 'Submitting…' : <><EmojiIcon e="💾" /> Submit &amp; download form</>}
                </button>
              )}
            </>
          ) : showManualNext ? (
            <button
              onClick={goNext}
              className="flex-[2] bg-catalan-primary text-white rounded-xl py-4 text-[15px] font-semibold cursor-pointer hover:brightness-110 active:scale-[0.98] transition-all min-h-[56px]"
            >
              Next →
            </button>
          ) : !currentField.required && !currentHasValue ? (
            <button
              onClick={goNext}
              className="flex-[2] text-catalan-textMuted rounded-xl py-4 text-[15px] font-medium cursor-pointer hover:text-catalan-text transition-all min-h-[56px]"
            >
              Skip →
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
