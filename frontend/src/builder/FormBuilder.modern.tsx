import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { FormSchema, FormSection, FormField, FieldType } from '@/types/form'
import { newField, newSection, newSchema, updateFieldInSchema } from '@/lib/formUtils'
import { saveFormDraft, loadFormDraft, clearFormDraft, draftAgeLabel, type FormDraft } from '@/lib/formDraft'
import FieldTypeMenu from './FieldTypeMenu'
import FieldEditor from './FieldEditor'
import VersionHistoryPanel from './VersionHistoryPanel'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { Button, Alert, Card, SkeletonBlock } from '@/components/ui'
import { getNavItems } from '@/lib/navigation'
import api, { getStoredUser } from '@/lib/api'
import { useToast } from '@/lib/ToastContext'

const FIELD_TYPE_ICONS: Record<string, string> = {
  text: '𝐓', number: '#', decimal: '.1', single_choice: '◉', multiple_choice: '☑',
  date: '📅', time: '⏰', gps: '📍', photo: '📷', audio: '🎙', barcode: '▦',
  calculated: '∑', repeat_group: '⟳', note: 'ℹ', rating: '★',
}

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'Text', number: 'Number', decimal: 'Decimal', single_choice: 'Single Choice',
  multiple_choice: 'Multiple Choice', date: 'Date', time: 'Time', gps: 'GPS',
  photo: 'Photo', audio: 'Audio', barcode: 'Barcode', calculated: 'Calculated',
  repeat_group: 'Repeat Group', note: 'Note', rating: 'Rating',
}

export default function FormBuilder() {
  const [searchParams]  = useSearchParams()
  const formIdFromUrl   = searchParams.get('id')
  const tabFromUrl      = searchParams.get('tab')
  const toast           = useToast()

  // ── Core form state ──────────────────────────────────────────────────────
  const [schema, setSchema]         = useState<FormSchema>(newSchema())
  const [selectedSection, setSelectedSection] = useState<string>(schema.sections[0].id)
  const [selectedField, setSelectedField]     = useState<{ sectionId: string; fieldId: string } | null>(null)
  const [showTypeMenu, setShowTypeMenu]       = useState(false)
  const [formId, setFormId]         = useState<string | null>(null)
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(false)
  const [saveError, setSaveError]   = useState('')
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [showLeftPanel, setShowLeftPanel]     = useState(false)
  const [showVersions, setShowVersions]       = useState(tabFromUrl === 'versions')

  // ── Load / draft state ───────────────────────────────────────────────────
  const [formLoading, setFormLoading]     = useState(!!formIdFromUrl)
  const [formLoadError, setFormLoadError] = useState('')
  const [draft, setDraft]                 = useState<FormDraft | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const isInitRef        = useRef(true)   // skip auto-save on very first render

  const currentSection = schema.sections.find(s => s.id === selectedSection)!
  const currentField   = selectedField
    ? schema.sections.find(s => s.id === selectedField.sectionId)?.fields.find(f => f.id === selectedField.fieldId)
    : null

  const user         = getStoredUser() || { name: '', role: '' }
  const sidebarItems = getNavItems(user.role)

  // ── Load form from URL ?id= param ─────────────────────────────────────────
  useEffect(() => {
    if (formIdFromUrl) {
      setFormLoading(true)
      setFormLoadError('')
      api.get(`/forms/${formIdFromUrl}`)
        .then(({ data }) => {
          const loaded: FormSchema = data.json_schema ?? data
          setSchema(loaded)
          setFormId(formIdFromUrl)
          setSelectedSection(loaded.sections[0]?.id ?? '')
          setSelectedField(null)
        })
        .catch(err => {
          setFormLoadError(err.response?.data?.detail ?? 'Failed to load form')
        })
        .finally(() => {
          setFormLoading(false)
          isInitRef.current = false
        })
    } else {
      // No ?id= — offer to restore any saved draft
      const saved = loadFormDraft()
      if (saved && saved.schema?.sections?.length) setDraft(saved)
      isInitRef.current = false
    }
  }, [formIdFromUrl])

  // ── Auto-save draft to localStorage (debounced 2 s) ───────────────────────
  useEffect(() => {
    if (isInitRef.current || formLoading) return
    clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      saveFormDraft(schema, formId)
    }, 2000)
    return () => clearTimeout(autoSaveTimerRef.current)
  }, [schema, formId, formLoading])

  // ── Draft handlers ────────────────────────────────────────────────────────
  const handleRestoreDraft = () => {
    if (!draft) return
    setSchema(draft.schema)
    if (draft.formId) setFormId(draft.formId)
    setSelectedSection(draft.schema.sections[0]?.id ?? '')
    setSelectedField(null)
    setDraft(null)
    toast.success('Draft restored')
  }

  const handleDismissDraft = () => {
    clearFormDraft()
    setDraft(null)
  }

  const addSection = () => {
    const sec = newSection()
    setSchema(s => ({ ...s, sections: [...s.sections, sec] }))
    setSelectedSection(sec.id)
    setSelectedField(null)
  }

  const updateSectionTitle = (sectionId: string, title: string) => {
    setSchema(s => ({ ...s, sections: s.sections.map(sec => sec.id === sectionId ? { ...sec, title } : sec) }))
  }

  const deleteSection = (sectionId: string) => {
    if (schema.sections.length === 1) return
    setSchema(s => ({ ...s, sections: s.sections.filter(sec => sec.id !== sectionId) }))
    setSelectedSection(schema.sections.find(s => s.id !== sectionId)!.id)
    setSelectedField(null)
  }

  const addField = (type: FieldType) => {
    const field = newField(type)
    setSchema(s => ({
      ...s,
      sections: s.sections.map(sec =>
        sec.id === selectedSection ? { ...sec, fields: [...sec.fields, field] } : sec
      ),
    }))
    setSelectedField({ sectionId: selectedSection, fieldId: field.id })
    setShowTypeMenu(false)
    setShowLeftPanel(false)
  }

  const updateField = useCallback((sectionId: string, fieldId: string, patch: Partial<FormField>) => {
    setSchema(s => updateFieldInSchema(s, sectionId, fieldId, patch))
  }, [])

  const deleteField = (sectionId: string, fieldId: string) => {
    setSchema(s => ({
      ...s,
      sections: s.sections.map(sec =>
        sec.id !== sectionId ? sec : { ...sec, fields: sec.fields.filter(f => f.id !== fieldId) }
      ),
    }))
    setSelectedField(null)
  }

  const moveField = (sectionId: string, fieldId: string, dir: -1 | 1) => {
    setSchema(s => ({
      ...s,
      sections: s.sections.map(sec => {
        if (sec.id !== sectionId) return sec
        const idx = sec.fields.findIndex(f => f.id === fieldId)
        const next = idx + dir
        if (next < 0 || next >= sec.fields.length) return sec
        const fields = [...sec.fields]
        ;[fields[idx], fields[next]] = [fields[next], fields[idx]]
        return { ...sec, fields }
      }),
    }))
  }

  const handleSave = async () => {
    // ── Validation ────────────────────────────────────────────────────────
    const errs: string[] = []
    if (!schema.title.trim()) errs.push('Form title is required')
    const allFields = schema.sections.flatMap(s => s.fields)
    const emptyLabelFields = allFields.filter(f => !f.label.trim())
    if (emptyLabelFields.length > 0) {
      errs.push(
        `${emptyLabelFields.length} field${emptyLabelFields.length > 1 ? 's are' : ' is'} missing a label`
      )
    }
    if (allFields.length === 0) errs.push('Add at least one question before saving')

    if (errs.length > 0) {
      setValidationErrors(errs)
      return
    }
    setValidationErrors([])
    setSaving(true)
    setSaveError('')
    try {
      if (formId) {
        await api.put(`/forms/${formId}`, { title: schema.title, json_schema: schema })
      } else {
        const { data } = await api.post('/forms/', { title: schema.title, json_schema: schema })
        setFormId(data.id)
      }
      setSaved(true)
      clearFormDraft()
      setDraft(null)
      toast.success('Form saved')
      setTimeout(() => setSaved(false), 2000)
    } catch (err: any) {
      setSaveError(err.response?.data?.detail || 'Save failed')
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Loading state ───────────────────────────────────────────────────────
  if (formLoading) {
    return (
      <div className="flex h-screen bg-catalan-bg">
        <Sidebar items={sidebarItems} role={user.role} />
        <div className="flex-1 flex flex-col overflow-hidden">
          <TopNav breadcrumbs={[{ label: 'Dashboard', path: '/' }, { label: 'Loading…' }]} />
          <div className="flex-1 flex flex-col gap-4 p-6">
            <div className="flex gap-4 items-center">
              <SkeletonBlock className="h-7 w-48" />
              <SkeletonBlock className="h-7 w-20 ml-auto" />
              <SkeletonBlock className="h-7 w-16" />
            </div>
            <div className="flex gap-4 flex-1">
              <div className="w-64 space-y-3">
                {[...Array(8)].map((_, i) => (
                  <SkeletonBlock key={i} className="h-9" style={{ opacity: 1 - i * 0.08 }} />
                ))}
              </div>
              <div className="flex-1 space-y-4">
                {[...Array(5)].map((_, i) => (
                  <SkeletonBlock key={i} className="h-14" style={{ opacity: 1 - i * 0.12 }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-catalan-bg">
      {/* Sidebar */}
      <Sidebar items={sidebarItems} role={user.role} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-auto">
        {/* Top Navigation */}
        <TopNav
          breadcrumbs={[
            { label: 'Dashboard', path: '/' },
            { label: schema.title.trim() || 'Form Builder' },
          ]}
        />

        {/* Content - 3 Panel Layout */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Mobile overlay for left panel */}
          {showLeftPanel && (
            <div
              className="md:hidden fixed inset-0 bg-black/50 z-20 backdrop-blur-sm"
              onClick={() => setShowLeftPanel(false)}
            />
          )}

          {/* Left Panel: Sections & Fields */}
          <div className={`
            fixed md:relative left-0 top-0 h-full z-30
            w-64 border-r border-catalan-border bg-catalan-surface flex flex-col overflow-hidden
            transition-transform duration-300 md:translate-x-0
            ${showLeftPanel ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          `}>

            {/* ── Draft restore banner ── */}
            {draft && (
              <div className="px-3 pt-2.5 pb-2 bg-catalan-warning/10 border-b border-catalan-warning/30 flex-shrink-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-catalan-warning text-sm">📄</span>
                  <span className="text-xs font-medium text-catalan-warning">Unsaved draft found</span>
                </div>
                <p className="text-xs text-catalan-textMuted mb-2 leading-snug">
                  "{draft.schema.title || 'Untitled'}" — {draftAgeLabel(draft.savedAt)}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleRestoreDraft}
                    className="px-2.5 py-1 rounded-lg bg-catalan-warning/20 text-catalan-warning text-xs font-medium hover:bg-catalan-warning/30 transition-colors"
                  >
                    Restore
                  </button>
                  <button
                    onClick={handleDismissDraft}
                    className="px-2.5 py-1 rounded-lg text-catalan-textMuted hover:text-catalan-text text-xs transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* Form Info */}
            <div className="p-4 border-b border-catalan-border flex-shrink-0">
              <input
                value={schema.title}
                onChange={e => { setSchema(s => ({ ...s, title: e.target.value })); setValidationErrors([]) }}
                className={`w-full bg-transparent border-b text-catalan-text font-semibold text-base outline-none mb-2 pb-1 transition-colors ${
                  validationErrors.some(e => e.includes('title'))
                    ? 'border-catalan-error placeholder-catalan-error/60'
                    : 'border-transparent focus:border-catalan-primary'
                }`}
                placeholder="Form title (required)"
              />
              <div className="text-xs text-catalan-textMuted">
                v{schema.version} · {schema.sections.flatMap(s => s.fields).length} fields
              </div>
            </div>

            {/* Sections & Fields */}
            <div className="flex-1 overflow-y-auto">
              {schema.sections.map((sec, secIdx) => (
                <div key={sec.id}>
                  {/* Section separator */}
                  {secIdx > 0 && <div className="mx-3 border-t border-catalan-border/50" />}
                  {/* Section Header */}
                  <div
                    onClick={() => { setSelectedSection(sec.id); setSelectedField(null) }}
                    className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                      selectedSection === sec.id && !selectedField
                        ? 'bg-catalan-hover'
                        : 'hover:bg-catalan-hover/50'
                    }`}
                  >
                    <span className="text-catalan-primary text-xs">▶</span>
                    <input
                      value={sec.title}
                      onChange={e => { e.stopPropagation(); updateSectionTitle(sec.id, e.target.value) }}
                      onClick={e => e.stopPropagation()}
                      className="flex-1 bg-transparent border-none text-catalan-text text-sm font-medium outline-none"
                    />
                    {schema.sections.length > 1 && (
                      <button
                        onClick={e => { e.stopPropagation(); deleteSection(sec.id) }}
                        className="text-catalan-textMuted hover:text-catalan-error text-sm transition-colors"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Fields */}
                  {sec.fields.map(field => (
                    <div
                      key={field.id}
                      onClick={() => { setSelectedSection(sec.id); setSelectedField({ sectionId: sec.id, fieldId: field.id }); setShowLeftPanel(false) }}
                      className={`flex items-center gap-2 px-4 py-2 text-sm cursor-pointer transition-colors border-l-2 ml-2 ${
                        selectedField?.fieldId === field.id
                          ? 'bg-catalan-hover border-catalan-primary'
                          : 'border-transparent hover:bg-catalan-hover/50'
                      }`}
                    >
                      <span className="text-catalan-textMuted text-xs w-4 text-center flex-shrink-0">
                        {FIELD_TYPE_ICONS[field.type]}
                      </span>
                      <span className={`flex-1 truncate ${field.label ? 'text-catalan-text' : 'text-catalan-error/80'}`}>
                        {field.label || `⚠ label missing`}
                      </span>
                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          onClick={e => { e.stopPropagation(); moveField(sec.id, field.id, -1) }}
                          className="text-catalan-textMuted hover:text-catalan-primary text-xs transition-colors"
                        >
                          ▲
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); moveField(sec.id, field.id, 1) }}
                          className="text-catalan-textMuted hover:text-catalan-primary text-xs transition-colors"
                        >
                          ▼
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Bottom Actions */}
            <div className="p-3 border-t border-catalan-border space-y-2 flex-shrink-0">
              <Button
                onClick={() => setShowTypeMenu(true)}
                size="sm"
                fullWidth
              >
                + Add Question
              </Button>
              <Button
                onClick={addSection}
                variant="secondary"
                size="sm"
                fullWidth
              >
                + Add Section
              </Button>
            </div>
          </div>

          {/* Right Panel: Field Editor or Preview */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Top Bar */}
            <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-catalan-border bg-catalan-surface flex-shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowLeftPanel(!showLeftPanel)}
                  className="md:hidden p-1.5 rounded bg-catalan-hover text-catalan-primary text-sm"
                >
                  ☰
                </button>
                <span className="text-sm text-catalan-textMuted truncate">
                  {currentField
                    ? `${currentSection?.title} › ${currentField.label || 'Untitled field'}`
                    : currentSection?.title}
                </span>
              </div>
              <div className="flex gap-3 items-center flex-wrap">
                {formLoadError && (
                  <div className="flex items-center gap-1.5 text-xs text-catalan-error bg-catalan-error/10 border border-catalan-error/30 rounded-lg px-2.5 py-1">
                    <span>⚠</span><span>{formLoadError}</span>
                    <button onClick={() => setFormLoadError('')} className="ml-1 text-catalan-error/60 hover:text-catalan-error">×</button>
                  </div>
                )}
                {validationErrors.length > 0 && (
                  <div className="flex flex-col gap-0.5">
                    {validationErrors.map((e, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-xs text-catalan-error bg-catalan-error/10 border border-catalan-error/30 rounded-lg px-2.5 py-1">
                        <span>⚠</span>
                        <span>{e}</span>
                        <button onClick={() => setValidationErrors([])} className="ml-1 text-catalan-error/60 hover:text-catalan-error leading-none">×</button>
                      </div>
                    ))}
                  </div>
                )}
                {saveError && (
                  <Alert
                    type="error"
                    title="Error"
                    message={saveError}
                    onClose={() => setSaveError('')}
                  />
                )}
                {formId && (
                  <span className="text-xs text-catalan-textMuted font-mono bg-catalan-hover px-2 py-1 rounded">
                    {formId.slice(0, 8)}
                  </span>
                )}
                {formId && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowVersions(v => !v)}
                    className={showVersions ? '!border-catalan-primary !text-catalan-primary' : ''}
                  >
                    {showVersions ? '✕ Versions' : `v${schema.version} History`}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => window.location.href = '/collect'}
                >
                  Preview
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  size="sm"
                  className={saved ? '!bg-catalan-success !text-catalan-bg !border-catalan-success hover:!bg-catalan-success' : ''}
                >
                  {saving ? '...' : saved ? '✓ Saved' : 'Save'}
                </Button>
              </div>
            </div>

            {/* Main Area */}
            <div className="flex-1 overflow-hidden">
              {showVersions && formId ? (
                <VersionHistoryPanel
                  formId={formId}
                  currentVersion={schema.version}
                  onClose={() => setShowVersions(false)}
                />
              ) : currentField ? (
                <div className="h-full overflow-y-auto">
                  <FieldEditor
                    field={currentField}
                    sectionId={selectedField!.sectionId}
                    sections={schema.sections}
                    onChange={patch => updateField(selectedField!.sectionId, selectedField!.fieldId, patch)}
                    onDelete={() => deleteField(selectedField!.sectionId, selectedField!.fieldId)}
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-catalan-textMuted">
                  <div className="text-7xl mb-6">📋</div>
                  <div className="text-xl font-semibold mb-2 text-catalan-text">No field selected</div>
                  <div className="text-sm mb-6 text-center max-w-xs">
                    Select a field from the left panel to edit its properties, or add a new question to get started.
                  </div>
                  <Button onClick={() => setShowTypeMenu(true)} size="sm">
                    + Add Question
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Field Type Menu Modal */}
      {showTypeMenu && <FieldTypeMenu onSelect={addField} onClose={() => setShowTypeMenu(false)} />}
    </div>
  )
}
