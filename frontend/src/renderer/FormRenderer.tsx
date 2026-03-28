import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { FormSchema, FormField } from '@/types/form'
import { shouldShow, evalFormula } from '@/lib/formUtils'
import { v4 as uuidv4 } from 'uuid'
import { useLanguage, getLocalizedLabel } from '@/i18n/LanguageContext'

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
  const [draft, setDraft] = useState<SubmissionDraft>(() => initialDraft ?? {
    id: uuidv4(), formVersion: schema.version,
    values: {}, gpsOpen: null, gpsSubmit: null, status: 'draft', startedAt: new Date().toISOString(),
  })
  const [page, setPage]       = useState(0)          // index into visibleFields
  const [errors, setErrors]   = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [syncStatus, setSyncStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()

  // Flatten all visible fields respecting skip logic
  const allFields: FormField[] = schema.sections.flatMap(s =>
    s.fields.filter(f => shouldShow(f, draft.values))
  )

  // Auto-compute calculated fields on every change
  const valuesWithCalc = { ...draft.values }
  allFields.filter(f => f.type === 'calculated' && f.formula).forEach(f => {
    const result = evalFormula(f.formula!, valuesWithCalc)
    if (result !== null) valuesWithCalc[f.name] = result
  })

  const currentField = allFields[page]

  // ── Localize current field's label + hint ──
  const { language } = useLanguage()
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

  const setValue = (name: string, value: unknown) => {
    setDraft(d => {
      const next = { ...d, values: { ...d.values, [name]: value } }
      triggerSave(next)
      return next
    })
    setErrors(e => ({ ...e, [name]: '' }))
  }

  const goNext = () => {
    if (!currentField) return
    const err = validate(currentField, draft.values[currentField.name])
    if (err) { setErrors(e => ({ ...e, [currentField.name]: err })); return }
    if (page < allFields.length - 1) setPage(p => p + 1)
  }

  const goPrev = () => { if (page > 0) setPage(p => p - 1) }

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
    <div className="min-h-screen bg-catalan-bg flex flex-col font-sans max-w-[540px] mx-auto">

      {/* ── Header ── */}
      <div className="px-5 py-3.5 border-b border-catalan-border">
        <div className="flex justify-between items-center mb-2.5">
          <div className="flex items-center gap-2">
            {onCancel && (
              <button onClick={onCancel} className="bg-transparent border-none text-catalan-primary text-lg cursor-pointer px-1.5 py-0.5 leading-none" title="Exit form">✕</button>
            )}
            <span className="text-catalan-textMuted text-[13px]">{page + 1} / {allFields.length}</span>
          </div>
          {/* Sync traffic light */}
          <span className={`text-xs ${syncStatus === 'saved' ? 'text-catalan-success' : syncStatus === 'saving' ? 'text-catalan-warning' : 'text-catalan-error'}`}>
            {syncStatus === 'saved' ? '● Saved' : syncStatus === 'saving' ? '● Saving…' : '● Save error'}
          </span>
        </div>
        {/* Progress bar */}
        <div className="bg-catalan-hover rounded h-1">
          <div className="bg-catalan-primary rounded h-1 transition-[width] duration-200" style={{ width: `${progress}%` }} />
        </div>
        <div className="text-catalan-textMuted text-xs mt-1.5">
          {schema.sections.find(s => s.fields.some(f => f.id === currentField.id))?.title}
        </div>
      </div>

      {/* ── Field ── */}
      <div className="flex-1 px-5 py-7 overflow-y-auto">
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
        {localizedField.type === 'calculated' && (
          <div>
            <div style={{ color: '#a6adc8', fontSize: 12, marginBottom: 6 }}>{localizedField.label}</div>
            <div style={{ color: '#a6e3a1', fontSize: 28, fontWeight: 700, textAlign: 'center', padding: 20 }}>
              {valuesWithCalc[currentField.name] ?? '—'}
            </div>
            <div style={{ color: '#45475a', fontSize: 11, textAlign: 'center' }}>{currentField.formula}</div>
          </div>
        )}

        {errors[currentField.name] && (
          <div style={{ color: '#f38ba8', fontSize: 13, marginTop: 10 }}>⚠ {errors[currentField.name]}</div>
        )}
      </div>

      {/* ── Navigation ── */}
      <div className="px-5 py-4 border-t border-catalan-border flex gap-2.5">
        {page > 0 && (
          <button onClick={goPrev} className="flex-1 bg-catalan-hover border border-catalan-border text-catalan-text rounded-[10px] py-3.5 text-[15px] cursor-pointer hover:bg-catalan-surface transition-colors">
            ← Back
          </button>
        )}
        {isLast ? (
          <button onClick={handleSubmit} disabled={submitting} className={`flex-[2] bg-catalan-success border-none text-catalan-bg rounded-[10px] py-3.5 text-base font-bold ${submitting ? 'cursor-wait opacity-70' : 'cursor-pointer hover:brightness-110'} transition-all`}>
            {submitting ? 'Submitting…' : 'Submit ✓'}
          </button>
        ) : (
          <button onClick={goNext} className="flex-[2] bg-catalan-primary border-none text-white rounded-[10px] py-3.5 text-[15px] font-semibold cursor-pointer hover:brightness-110 transition-all">
            Next →
          </button>
        )}
      </div>
    </div>
  )
}
