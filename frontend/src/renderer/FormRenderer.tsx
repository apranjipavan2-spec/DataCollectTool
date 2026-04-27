import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { FormSchema, FormField } from '@/types/form'
import { shouldShow, shouldShowSection, evalFormula, getAllFieldsInOrder } from '@/lib/formUtils'
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

interface Props {
  schema: FormSchema
  onSave:   (draft: SubmissionDraft) => Promise<void>   // auto-save (debounced)
  onSubmit: (draft: SubmissionDraft) => Promise<void>   // final submit
  onCancel?: () => void                                  // exit form collection
  initialDraft?: SubmissionDraft
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

export default function FormRenderer({ schema, onSave, onSubmit, onCancel, initialDraft }: Props) {
  const purpose = (schema as any).settings?.purpose as string | undefined
  const [consentGiven, setConsentGiven] = useState(!purpose || !!initialDraft?.consentTimestamp)

  const [draft, setDraft] = useState<SubmissionDraft>(() => initialDraft ?? {
    id: uuidv4(), formVersion: schema.version,
    values: {}, gpsOpen: null, gpsSubmit: null, status: 'draft', startedAt: new Date().toISOString(),
  })
  const [page, setPage]       = useState(0)
  const [errors, setErrors]   = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [syncStatus, setSyncStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const saveTimer  = useRef<ReturnType<typeof setTimeout>>()
  const scrollRef  = useRef<HTMLDivElement>(null)

  // Flatten visible fields — respects both section-level and field-level skip logic
  const allFields: FormField[] = (() => {
    const result: FormField[] = []
    const traverse = (secs: typeof schema.sections) => {
      for (const sec of secs) {
        // Skip entire section if its condition says to hide it
        if (!shouldShowSection(sec, draft.values)) continue
        for (const f of sec.fields) {
          if (shouldShow(f, draft.values)) result.push(f)
        }
        if (sec.subsections?.length) traverse(sec.subsections)
      }
    }
    traverse(schema.sections)
    return result
  })()

  // Auto-compute calculated fields in document order so later calcs can use earlier ones
  const valuesWithCalc = { ...draft.values }
  allFields.filter(f => f.type === 'calculated' && f.formula).forEach(f => {
    const result = evalFormula(f.formula!, valuesWithCalc)
    if (result !== null) valuesWithCalc[f.name] = result
  })

  const currentField = allFields[page]

  // ── Localize current field's label + hint ──
  const { language, setLanguage } = useLanguage()
  const localizedField = useMemo(() => {
    if (!currentField) return currentField
    return {
      ...currentField,
      label: getLocalizedLabel(currentField as unknown as Record<string, unknown>, 'label', language),
      hint: getLocalizedLabel(currentField as unknown as Record<string, unknown>, 'hint', language) || undefined,
      // Localize option labels for choice fields
      options: currentField.options?.map(opt => ({
        ...opt,
        label: getLocalizedLabel(opt as unknown as Record<string, unknown>, 'label', language),
      })),
    } as FormField
  }, [currentField, language])

  // Capture GPS on mount
  useEffect(() => {
    captureGps().then(gps => setDraft(d => ({ ...d, gpsOpen: gps })))
  }, [])

  // Debounced auto-save (300ms)
  const triggerSave = useCallback((d: SubmissionDraft) => {
    clearTimeout(saveTimer.current)
    setSyncStatus('saving')
    saveTimer.current = setTimeout(async () => {
      try { await onSave(d); setSyncStatus('saved') }
      catch  { setSyncStatus('error') }
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
    try { await onSave({ ...draft, status: 'draft' }) } catch { }
    onCancel?.()
  }

  const handleSubmit = async () => {
    // Validate current field first
    if (currentField) {
      const err = validate(currentField, draft.values[currentField.name])
      if (err) { setErrors(e => ({ ...e, [currentField.name]: err })); return }
    }
    setSubmitting(true)
    const gpsSubmit = await captureGps()
    const final: SubmissionDraft = { ...draft, values: valuesWithCalc, gpsSubmit, status: 'outbox' }
    setDraft(final)
    try { await onSubmit(final) }
    finally { setSubmitting(false) }
  }

  const isLast = page === allFields.length - 1
  const progress = allFields.length > 0 ? ((page + 1) / allFields.length) * 100 : 0

  if (purpose && !consentGiven) {
    return (
      <div className="h-full bg-catalan-bg flex flex-col items-center justify-center px-5 font-sans">
        <div className="w-full max-w-lg bg-catalan-surface border border-catalan-border rounded-2xl p-8 text-center">
          <div className="text-4xl mb-4">📋</div>
          <h2 className="text-lg font-semibold text-catalan-text mb-2">Data Collection Purpose</h2>
          <p className="text-sm text-catalan-textMuted mb-6 leading-relaxed">{purpose}</p>
          <button
            onClick={() => {
              const ts = new Date().toISOString()
              setConsentGiven(true)
              setDraft(d => ({ ...d, consentTimestamp: ts }))
            }}
            className="w-full bg-catalan-primary text-white rounded-xl py-4 text-base font-semibold cursor-pointer hover:brightness-110 active:scale-[0.98] transition-all"
          >
            I Agree &amp; Continue
          </button>
          {onCancel && (
            <button onClick={onCancel} className="mt-3 text-sm text-catalan-textMuted hover:text-catalan-text">
              Cancel
            </button>
          )}
        </div>
      </div>
    )
  }

  if (!currentField) {
    return (
      <div className="min-h-screen bg-catalan-bg text-catalan-text font-sans flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4">📋</div>
          <div className="text-base">This form has no questions.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-catalan-bg flex flex-col font-sans h-full min-h-0">

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
                ← <span className="hidden sm:inline">Save &amp; Exit</span>
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
              {syncStatus === 'saved' ? '● Saved' : syncStatus === 'saving' ? '●' : '⚠'}
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
          <GpsField field={localizedField} value={draft.values[currentField.name] as any ?? null} onChange={v => setValue(currentField.name, v)} />
        )}
        {localizedField.type === 'photo' && (
          <PhotoField field={localizedField} value={draft.values[currentField.name] as string ?? null} onChange={v => setValue(currentField.name, v)} />
        )}
        {localizedField.type === 'audio' && (
          <AudioField field={localizedField} value={draft.values[currentField.name] as string ?? null} onChange={v => setValue(currentField.name, v)} />
        )}
        {localizedField.type === 'repeat_group' && (
          <RepeatGroupField field={localizedField} value={draft.values[currentField.name] as any[] ?? []} onChange={v => setValue(currentField.name, v)} />
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
            <span>⚠</span> {errors[currentField.name]}
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
              ← Back
            </button>
          ) : null}
          {isLast ? (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className={`flex-[2] bg-catalan-success text-catalan-bg rounded-xl py-4 text-base font-bold min-h-[56px] active:scale-[0.98] transition-all ${submitting ? 'cursor-wait opacity-70' : 'cursor-pointer hover:brightness-110'}`}
            >
              {submitting ? 'Submitting…' : 'Submit ✓'}
            </button>
          ) : (
            <button
              onClick={goNext}
              className="flex-[2] bg-catalan-primary text-white rounded-xl py-4 text-[15px] font-semibold cursor-pointer hover:brightness-110 active:scale-[0.98] transition-all min-h-[56px]"
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
