import React, { useState, useCallback, useEffect, useRef } from 'react'
import InfoButton from '@/help/InfoButton'
import { useSearchParams } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import type { FormSchema, FormSection, FormField, FieldType, FieldOption } from '@/types/form'
import { newField, newSection, newSchema, updateFieldInSchema, mapSectionById, getAllFieldsInOrder } from '@/lib/formUtils'
import type { SkipLogic } from '@/types/form'
import { saveFormDraft, loadFormDraft, clearFormDraft, draftAgeLabel, type FormDraft } from '@/lib/formDraft'
import FieldTypeMenu from './FieldTypeMenu'
import FieldEditor from './FieldEditor'
import SkipLogicEditor from './SkipLogicEditor'
import VersionHistoryPanel from './VersionHistoryPanel'
import Sidebar from '@/components/Sidebar'
import TopNav from '@/components/TopNav'
import { Button, Alert, SkeletonBlock } from '@/components/ui'
import { getNavItems } from '@/lib/navigation'
import api, { getStoredUser } from '@/lib/api'
import { useToast } from '@/lib/ToastContext'

const FIELD_TYPE_ICONS: Record<string, string> = {
  text: '𝐓', number: '#', decimal: '.1', single_choice: '◉', multiple_choice: '☑',
  date: '📅', time: '⏰', gps: '📍', photo: '📷', audio: '🎙', barcode: '▦',
  calculated: '∑', repeat_group: '⟳', note: 'ℹ', rating: '★', signature: '✍️',
}

interface DeleteConfirm {
  kind: 'section' | 'field'
  sectionId: string
  fieldId?: string
  label: string
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

  // ── Collapse, inline-edit & delete-confirm state ─────────────────────────
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [editingSectionId, setEditingSectionId]   = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm]         = useState<DeleteConfirm | null>(null)

  // ── Load / draft state ───────────────────────────────────────────────────
  const [formLoading, setFormLoading]     = useState(!!formIdFromUrl)
  const [formLoadError, setFormLoadError] = useState('')
  const [draft, setDraft]                 = useState<FormDraft | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const isInitRef        = useRef(true)

  // ── Drag state ───────────────────────────────────────────────────────────
  const [dragSrc, setDragSrc] = useState<{ sectionId: string; fieldId: string } | null>(null)
  const [dragOver, setDragOver] = useState<{ sectionId: string; fieldId: string } | null>(null)

  // ── Left panel resize ────────────────────────────────────────────────────
  const [panelWidth, setPanelWidth] = useState(256)   // px — default 256 (w-64)
  const resizingRef = useRef(false)
  const resizeStartX = useRef(0)
  const resizeStartW = useRef(0)

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    resizingRef.current = true
    resizeStartX.current = e.clientX
    resizeStartW.current = panelWidth

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      const delta = ev.clientX - resizeStartX.current
      const next = Math.min(520, Math.max(180, resizeStartW.current + delta))
      setPanelWidth(next)
    }
    const onUp = () => {
      resizingRef.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── Excel import state ───────────────────────────────────────────────────
  const [importingExcel, setImportingExcel] = useState(false)
  const [importSummary, setImportSummary]   = useState<{ title: string; sections: number; fields: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const currentSection = (() => {
    const find = (secs: FormSection[]): FormSection | undefined => {
      for (const s of secs) {
        if (s.id === selectedSection) return s
        if (s.subsections?.length) { const f = find(s.subsections); if (f) return f }
      }
    }
    return find(schema.sections)
  })()

  const currentField = selectedField
    ? (() => {
        const find = (secs: FormSection[]): FormField | undefined => {
          for (const s of secs) {
            const f = s.fields.find(f => f.id === selectedField.fieldId)
            if (f) return f
            if (s.subsections?.length) { const ff = find(s.subsections); if (ff) return ff }
          }
        }
        return find(schema.sections)
      })()
    : null

  const user         = getStoredUser() || { name: '', role: '' }
  const sidebarItems = getNavItems(user.role)

  // ── Load form from URL ?id= ───────────────────────────────────────────────
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
        .catch(err => setFormLoadError(err.response?.data?.detail ?? 'Failed to load form'))
        .finally(() => { setFormLoading(false); isInitRef.current = false })
    } else {
      const saved = loadFormDraft()
      if (saved && saved.schema?.sections?.length) setDraft(saved)
      isInitRef.current = false
    }
  }, [formIdFromUrl])

  // ── Auto-save draft ───────────────────────────────────────────────────────
  useEffect(() => {
    if (isInitRef.current || formLoading) return
    clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => saveFormDraft(schema, formId), 2000)
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
  const handleDismissDraft = () => { clearFormDraft(); setDraft(null) }

  // ── Section helpers ───────────────────────────────────────────────────────
  const toggleCollapse = (id: string) =>
    setCollapsedSections(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const updateSections = useCallback((sectionId: string, updater: (s: FormSection) => FormSection) =>
    setSchema(s => ({ ...s, sections: mapSectionById(s.sections, sectionId, updater) })), [])

  const updateSectionTitleById = (id: string, title: string) =>
    updateSections(id, sec => ({ ...sec, title }))

  const addSection = () => {
    const sec = newSection()
    setSchema(s => ({ ...s, sections: [...s.sections, sec] }))
    setSelectedSection(sec.id)
    setSelectedField(null)
  }

  const addSubsection = (parentId: string) => {
    const sub: FormSection = { id: uuidv4(), title: 'Sub-section', fields: [] }
    updateSections(parentId, sec => ({ ...sec, subsections: [...(sec.subsections ?? []), sub] }))
    setSelectedSection(sub.id)
    setSelectedField(null)
  }

  // ── Delete with confirmation ──────────────────────────────────────────────
  const requestDeleteSection = (sectionId: string, label: string) =>
    setDeleteConfirm({ kind: 'section', sectionId, label })

  const requestDeleteField = (sectionId: string, fieldId: string, label: string) =>
    setDeleteConfirm({ kind: 'field', sectionId, fieldId, label })

  const cancelDelete = () => setDeleteConfirm(null)

  const executeDelete = () => {
    if (!deleteConfirm) return
    if (deleteConfirm.kind === 'field') {
      updateSections(deleteConfirm.sectionId, sec => ({
        ...sec,
        fields: sec.fields.filter(f => f.id !== deleteConfirm.fieldId),
      }))
      if (selectedField?.fieldId === deleteConfirm.fieldId) setSelectedField(null)
    } else {
      const removeSection = (secs: FormSection[]): FormSection[] =>
        secs
          .filter(s => s.id !== deleteConfirm.sectionId)
          .map(s => s.subsections?.length ? { ...s, subsections: removeSection(s.subsections) } : s)
      setSchema(s => {
        const next = removeSection(s.sections)
        return { ...s, sections: next }
      })
      setSelectedSection(prev => {
        if (prev !== deleteConfirm.sectionId) return prev
        const allSecs = getAllSectionIds(schema.sections).filter(id => id !== deleteConfirm.sectionId)
        return allSecs[0] ?? ''
      })
      setSelectedField(null)
    }
    setDeleteConfirm(null)
  }

  // ── Field helpers ─────────────────────────────────────────────────────────
  const addField = (type: FieldType) => {
    const field = newField(type)
    updateSections(selectedSection, sec => ({ ...sec, fields: [...sec.fields, field] }))
    setSelectedField({ sectionId: selectedSection, fieldId: field.id })
    setShowTypeMenu(false)
    setShowLeftPanel(false)
  }

  const updateField = useCallback((sectionId: string, fieldId: string, patch: Partial<FormField>) =>
    setSchema(s => updateFieldInSchema(s, sectionId, fieldId, patch)), [])

  const moveField = (sectionId: string, fieldId: string, dir: -1 | 1) =>
    updateSections(sectionId, sec => {
      const idx = sec.fields.findIndex(f => f.id === fieldId)
      const next = idx + dir
      if (next < 0 || next >= sec.fields.length) return sec
      const fields = [...sec.fields]
      ;[fields[idx], fields[next]] = [fields[next], fields[idx]]
      return { ...sec, fields }
    })

  const moveFieldToIndex = (srcSecId: string, srcFieldId: string, dstSecId: string, dstFieldId: string) => {
    if (srcFieldId === dstFieldId) return
    let draggedField: FormField | null = null
    // Remove from source
    const withoutSrc = (secs: FormSection[]): FormSection[] =>
      secs.map(sec => {
        if (sec.id === srcSecId) {
          const f = sec.fields.find(f => f.id === srcFieldId)
          if (f) draggedField = f
          return { ...sec, fields: sec.fields.filter(f => f.id !== srcFieldId) }
        }
        return sec.subsections?.length ? { ...sec, subsections: withoutSrc(sec.subsections) } : sec
      })
    // Insert before target
    const withInsert = (secs: FormSection[]): FormSection[] =>
      secs.map(sec => {
        if (sec.id === dstSecId) {
          const dstIdx = sec.fields.findIndex(f => f.id === dstFieldId)
          const fields = [...sec.fields]
          fields.splice(dstIdx >= 0 ? dstIdx : fields.length, 0, draggedField!)
          return { ...sec, fields }
        }
        return sec.subsections?.length ? { ...sec, subsections: withInsert(sec.subsections) } : sec
      })
    setSchema(s => {
      const step1 = withoutSrc(s.sections)
      if (!draggedField) return s
      return { ...s, sections: withInsert(step1) }
    })
  }

  // ── Excel import ──────────────────────────────────────────────────────────
  const toFieldType = (t: string): FieldType => {
    const MAP: Record<string, FieldType> = {
      select: 'single_choice', number: 'number', date: 'date',
      text: 'text', textarea: 'text', gps: 'gps', photo: 'photo',
    }
    return (MAP[t] as FieldType) ?? 'text'
  }

  const toOptions = (opts?: string[]): FieldOption[] | undefined => {
    if (!opts || opts.length === 0) return undefined
    return opts.map(o => ({ value: o, label: o }))
  }

  const handleImportExcel = async (file: File) => {
    setImportingExcel(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await api.post('/forms/import-excel', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const sections: FormSection[] = (data.sections ?? []).map((sec: any) => ({
        id: uuidv4(),
        title: sec.title || 'Section',
        fields: (sec.fields ?? []).map((f: any): FormField => {
          const ft = toFieldType(f.type)
          const opts = toOptions(f.options)
          return {
            id: uuidv4(),
            name: f.id || uuidv4(),
            label: f.label || '',
            type: ft,
            required: !!f.required,
            ...(opts ? { options: opts } : {}),
          }
        }),
      })).filter((s: FormSection) => s.fields.length > 0)

      if (sections.length === 0) { toast.error('No fields found in this Excel file'); return }

      const imported: FormSchema = { title: data.title || file.name.replace(/\.[^.]+$/, ''), version: 1, sections }
      setSchema(imported)
      setFormId(null)
      setSelectedSection(sections[0].id)
      setSelectedField(null)
      setDraft(null)
      clearFormDraft()
      const totalFields = sections.reduce((n, s) => n + s.fields.length, 0)
      setImportSummary({ title: imported.title, sections: sections.length, fields: totalFields })
      toast.success(`Imported: ${sections.length} sections, ${totalFields} fields`)
    } catch (err: any) {
      toast.error(err.response?.data?.detail ?? 'Import failed — check the file format')
    } finally {
      setImportingExcel(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const errs: string[] = []
    if (!schema.title.trim()) errs.push('Form title is required')
    const allFields = getAllFieldsInOrder(schema.sections)
    const emptyLabelFields = allFields.filter(f => !f.label.trim())
    if (emptyLabelFields.length > 0)
      errs.push(`${emptyLabelFields.length} field${emptyLabelFields.length > 1 ? 's are' : ' is'} missing a label`)
    if (allFields.length === 0) errs.push('Add at least one question before saving')
    if (errs.length > 0) { setValidationErrors(errs); return }
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

  // ── Recursive left panel renderers ────────────────────────────────────────
  const renderFieldRow = (sectionId: string, field: FormField, depth: number) => {
    const isSelected  = selectedField?.fieldId === field.id
    const isDragOver  = dragOver?.fieldId === field.id && dragSrc?.fieldId !== field.id
    const isDragging  = dragSrc?.fieldId === field.id
    const confirmThis = deleteConfirm?.kind === 'field' && deleteConfirm.fieldId === field.id

    return (
      <React.Fragment key={field.id}>
        <div
          draggable
          onDragStart={e => { setDragSrc({ sectionId, fieldId: field.id }); e.dataTransfer.effectAllowed = 'move' }}
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver({ sectionId, fieldId: field.id }) }}
          onDragLeave={() => setDragOver(null)}
          onDrop={e => { e.preventDefault(); if (dragSrc) moveFieldToIndex(dragSrc.sectionId, dragSrc.fieldId, sectionId, field.id); setDragSrc(null); setDragOver(null) }}
          onDragEnd={() => { setDragSrc(null); setDragOver(null) }}
          onClick={() => { setSelectedSection(sectionId); setSelectedField({ sectionId, fieldId: field.id }); setShowLeftPanel(false) }}
          style={{ paddingLeft: `${16 + depth * 12}px` }}
          className={`flex items-center gap-2 pr-2 py-2 text-sm cursor-pointer transition-colors border-l-2 ${
            isSelected    ? 'bg-catalan-hover border-catalan-primary' :
            isDragOver    ? 'bg-catalan-primary/10 border-catalan-primary/60' :
                            'border-transparent hover:bg-catalan-hover/50'
          } ${isDragging ? 'opacity-40' : ''}`}
        >
          <span className="text-catalan-textMuted/40 text-xs cursor-grab active:cursor-grabbing flex-shrink-0 select-none">⠿</span>
          <span className="text-catalan-textMuted text-xs w-4 text-center flex-shrink-0">{FIELD_TYPE_ICONS[field.type] ?? '?'}</span>
          <span className={`flex-1 text-xs leading-snug break-words min-w-0 ${field.label ? 'text-catalan-text' : 'text-catalan-error/80'}`}>
            {field.label || '⚠ label missing'}
          </span>
          <button
            onClick={e => { e.stopPropagation(); requestDeleteField(sectionId, field.id, field.label || 'this field') }}
            className="text-catalan-textMuted hover:text-catalan-error text-xs transition-colors px-0.5 flex-shrink-0"
            title="Delete field"
          >✕</button>
        </div>

        {/* Inline delete confirmation */}
        {confirmThis && (
          <div
            style={{ paddingLeft: `${16 + depth * 12}px` }}
            className="pr-2 py-1.5 bg-catalan-error/10 border-l-2 border-catalan-error/40"
          >
            <p className="text-xs text-catalan-error mb-1 truncate">Delete "{deleteConfirm.label}"?</p>
            <div className="flex gap-2">
              <button onClick={executeDelete} className="text-xs px-2 py-0.5 bg-catalan-error text-white rounded">Delete</button>
              <button onClick={cancelDelete} className="text-xs text-catalan-textMuted hover:text-catalan-text">Cancel</button>
            </div>
          </div>
        )}
      </React.Fragment>
    )
  }

  const renderSectionNode = (sec: FormSection, depth: number, isTopLevel: boolean): React.ReactNode => {
    const isCollapsed    = collapsedSections.has(sec.id)
    const isActive       = selectedSection === sec.id && !selectedField
    const isEditingTitle = editingSectionId === sec.id
    const confirmThis    = deleteConfirm?.kind === 'section' && deleteConfirm.sectionId === sec.id
    const fieldCount     = sec.fields.length + (sec.subsections?.reduce((n, s) => n + s.fields.length, 0) ?? 0)
    const canDelete      = isTopLevel ? schema.sections.length > 1 : true
    const hasCondition   = !!sec.skipLogic

    return (
      <div key={sec.id}>
        {/* Section / Sub-section header */}
        <div
          onClick={() => { setSelectedSection(sec.id); setSelectedField(null) }}
          style={{ paddingLeft: `${depth === 0 ? 8 : 4 + depth * 12}px` }}
          className={`flex items-center gap-1 pr-2 py-2 cursor-pointer transition-colors group ${
            isActive ? 'bg-catalan-hover' : 'hover:bg-catalan-hover/50'
          } ${depth > 0 ? 'border-l-2 border-catalan-border/40 ml-2' : ''}`}
        >
          {/* Collapse toggle */}
          <button
            onClick={e => { e.stopPropagation(); toggleCollapse(sec.id) }}
            title={isCollapsed ? 'Expand section' : 'Collapse section'}
            className="w-5 h-5 flex items-center justify-center text-catalan-primary text-xs flex-shrink-0 rounded hover:bg-catalan-primary/10 transition-colors"
          >
            {isCollapsed ? '▶' : '▼'}
          </button>

          {/* Title — label normally, input when editing */}
          {isEditingTitle ? (
            <input
              autoFocus
              value={sec.title}
              onChange={e => updateSectionTitleById(sec.id, e.target.value)}
              onBlur={() => setEditingSectionId(null)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  e.preventDefault()
                  setEditingSectionId(null)
                }
              }}
              onClick={e => e.stopPropagation()}
              className={`flex-1 min-w-0 bg-catalan-bg border border-catalan-primary rounded px-1.5 py-0.5 outline-none ${
                depth === 0 ? 'text-sm font-medium text-catalan-text' : 'text-xs font-medium text-catalan-textMuted'
              }`}
            />
          ) : (
            <span
              onDoubleClick={e => { e.stopPropagation(); setEditingSectionId(sec.id) }}
              title="Double-click to rename"
              className={`flex-1 min-w-0 truncate select-none ${
                depth === 0 ? 'text-sm font-medium text-catalan-text' : 'text-xs font-medium text-catalan-textMuted'
              }`}
            >
              {sec.title || 'Untitled'}
            </span>
          )}

          {/* Field count */}
          {fieldCount > 0 && !isEditingTitle && (
            <span className="text-xs text-catalan-textMuted/50 flex-shrink-0 tabular-nums">{fieldCount}</span>
          )}

          {/* ⚡ Condition indicator — always visible when section has a condition */}
          {hasCondition && (
            <span
              title="This section has a visibility condition — click section to edit"
              className="flex-shrink-0 text-catalan-warning text-xs px-0.5"
            >
              ⚡
            </span>
          )}

          {/* Action buttons — visible on hover (or always when active) */}
          <div className={`flex items-center gap-0.5 flex-shrink-0 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
            {/* Add sub-section (top-level only) */}
            {depth === 0 && (
              <button
                onClick={e => { e.stopPropagation(); addSubsection(sec.id) }}
                title="Add sub-section inside this section"
                className="w-5 h-5 flex items-center justify-center rounded text-catalan-textMuted hover:text-catalan-primary hover:bg-catalan-primary/10 transition-colors text-xs"
              >
                ⊕
              </button>
            )}
            {/* Delete section */}
            {canDelete && (
              <button
                onClick={e => { e.stopPropagation(); requestDeleteSection(sec.id, sec.title) }}
                title="Delete this section"
                className="w-5 h-5 flex items-center justify-center rounded text-catalan-textMuted hover:text-catalan-error hover:bg-catalan-error/10 transition-colors text-xs"
              >
                ␡
              </button>
            )}
          </div>
        </div>

        {/* Inline delete confirmation for section */}
        {confirmThis && (
          <div
            style={{ paddingLeft: `${12 + depth * 12}px` }}
            className="pr-2 py-1.5 bg-catalan-error/10 border-l-2 border-catalan-error/40"
          >
            <p className="text-xs text-catalan-error mb-1 truncate">Delete "{deleteConfirm.label}"?</p>
            <div className="flex gap-2">
              <button onClick={executeDelete} className="text-xs px-2 py-0.5 bg-catalan-error text-white rounded">Delete</button>
              <button onClick={cancelDelete} className="text-xs text-catalan-textMuted hover:text-catalan-text">Cancel</button>
            </div>
          </div>
        )}

        {/* Collapsed content */}
        {!isCollapsed && (
          <div>
            {sec.fields.map(f => renderFieldRow(sec.id, f, depth + 1))}
            {sec.subsections?.map(sub => renderSectionNode(sub, depth + 1, false))}
          </div>
        )}
      </div>
    )
  }

  // ── Loading state ─────────────────────────────────────────────────────────
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
                {[...Array(8)].map((_, i) => <SkeletonBlock key={i} className="h-9" style={{ opacity: 1 - i * 0.08 }} />)}
              </div>
              <div className="flex-1 space-y-4">
                {[...Array(5)].map((_, i) => <SkeletonBlock key={i} className="h-14" style={{ opacity: 1 - i * 0.12 }} />)}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-catalan-bg">
      <Sidebar items={sidebarItems} role={user.role} />

      <div className="flex-1 flex flex-col overflow-auto">
        <TopNav breadcrumbs={[{ label: 'Dashboard', path: '/' }, { label: schema.title.trim() || 'Form Builder' }]} />

        <div className="md:hidden flex items-center gap-2 px-4 py-2 bg-catalan-warning/10 border-b border-catalan-warning/30 text-xs text-catalan-warning">
          <span>⚠</span><span>Form Builder works best on a larger screen.</span>
        </div>

        <div className="flex-1 flex overflow-hidden relative">
          {showLeftPanel && (
            <div className="md:hidden fixed inset-0 bg-black/50 z-20 backdrop-blur-sm" onClick={() => setShowLeftPanel(false)} />
          )}

          {/* Left Panel */}
          <div
            style={{ width: panelWidth, minWidth: panelWidth, maxWidth: panelWidth }}
            className={`
              fixed md:relative left-0 top-0 h-full z-30
              border-r border-catalan-border bg-catalan-surface flex flex-col overflow-hidden
              transition-transform duration-300 md:translate-x-0
              ${showLeftPanel ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
            `}
          >

            {/* Draft banner */}
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
                  <button onClick={handleRestoreDraft} className="px-2.5 py-1 rounded-lg bg-catalan-warning/20 text-catalan-warning text-xs font-medium hover:bg-catalan-warning/30 transition-colors">Restore</button>
                  <button onClick={handleDismissDraft} className="px-2.5 py-1 rounded-lg text-catalan-textMuted hover:text-catalan-text text-xs transition-colors">Dismiss</button>
                </div>
              </div>
            )}

            {/* Form info */}
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
                v{schema.version} · {getAllFieldsInOrder(schema.sections).length} fields
              </div>
            </div>

            {/* Sections & Fields tree */}
            <div className="flex-1 overflow-y-auto">
              {schema.sections.map((sec, i) => (
                <div key={sec.id}>
                  {i > 0 && <div className="mx-3 border-t border-catalan-border/50" />}
                  {renderSectionNode(sec, 0, true)}
                </div>
              ))}
            </div>

            {/* Bottom Actions */}
            <div className="p-3 border-t border-catalan-border space-y-2 flex-shrink-0">
              <Button onClick={() => setShowTypeMenu(true)} size="sm" fullWidth>+ Add Question</Button>
              <Button onClick={addSection} variant="secondary" size="sm" fullWidth>+ Add Section</Button>

              <div className="flex items-center gap-1.5 mb-1" data-help-id="import-excel-btn">
                <InfoButton topicId="import-excel" />
                <span className="text-xs text-catalan-textMuted">Import form from Excel</span>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importingExcel}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-catalan-primary/50 text-catalan-primary text-xs font-medium hover:bg-catalan-primary/10 hover:border-catalan-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importingExcel ? <><span className="animate-spin">⟳</span><span>Importing…</span></> : <><span>📊</span><span>Import from Excel</span></>}
              </button>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImportExcel(f) }} />

              {importSummary && (
                <div className="flex items-start gap-2 px-2 py-1.5 rounded-lg bg-catalan-success/10 border border-catalan-success/30">
                  <span className="text-catalan-success text-xs mt-0.5">✓</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-catalan-success truncate">{importSummary.title}</div>
                    <div className="text-xs text-catalan-textMuted">{importSummary.sections} sections · {importSummary.fields} fields</div>
                  </div>
                  <button onClick={() => setImportSummary(null)} className="text-catalan-textMuted hover:text-catalan-text text-xs">×</button>
                </div>
              )}
            </div>
          </div>

          {/* Resize handle */}
          <div
            onMouseDown={onResizeMouseDown}
            className="hidden md:flex w-1 flex-shrink-0 cursor-col-resize items-center justify-center hover:bg-catalan-primary/40 active:bg-catalan-primary/60 transition-colors group relative z-10"
            title="Drag to resize"
          >
            <div className="w-0.5 h-8 rounded-full bg-catalan-border group-hover:bg-catalan-primary/60 transition-colors" />
          </div>

          {/* Right Panel */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Top Bar */}
            <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-catalan-border bg-catalan-surface flex-shrink-0">
              <div className="flex items-center gap-2">
                <button onClick={() => setShowLeftPanel(!showLeftPanel)} className="md:hidden p-1.5 rounded bg-catalan-hover text-catalan-primary text-sm">☰</button>
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
                {validationErrors.length > 0 && validationErrors.map((e, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-catalan-error bg-catalan-error/10 border border-catalan-error/30 rounded-lg px-2.5 py-1">
                    <span>⚠</span><span>{e}</span>
                    <button onClick={() => setValidationErrors([])} className="ml-1 text-catalan-error/60 hover:text-catalan-error leading-none">×</button>
                  </div>
                ))}
                {saveError && <Alert type="error" title="Error" message={saveError} onClose={() => setSaveError('')} />}
                {formId && (
                  <span className="text-xs text-catalan-textMuted font-mono bg-catalan-hover px-2 py-1 rounded">{formId.slice(0, 8)}</span>
                )}
                {formId && (
                  <span className="inline-flex items-center gap-1" data-help-id="version-history-btn">
                    <InfoButton topicId="form-versions" />
                    <Button variant="secondary" size="sm" onClick={() => setShowVersions(v => !v)}
                      className={showVersions ? '!border-catalan-primary !text-catalan-primary' : ''}>
                      {showVersions ? '✕ Versions' : `v${schema.version} History`}
                    </Button>
                  </span>
                )}
                <Button variant="secondary" size="sm" onClick={() => window.location.href = '/collect'}>Preview</Button>
                <Button onClick={handleSave} disabled={saving} size="sm"
                  className={saved ? '!bg-catalan-success !text-catalan-bg !border-catalan-success hover:!bg-catalan-success' : ''}>
                  {saving ? '...' : saved ? '✓ Saved' : 'Save'}
                </Button>
              </div>
            </div>

            {/* Main Area */}
            <div className="flex-1 overflow-hidden">
              {showVersions && formId ? (
                <VersionHistoryPanel formId={formId} currentVersion={schema.version} onClose={() => setShowVersions(false)} />
              ) : currentField ? (
                <div className="h-full overflow-y-auto">
                  <FieldEditor
                    field={currentField}
                    sectionId={selectedField!.sectionId}
                    sections={schema.sections}
                    onChange={patch => updateField(selectedField!.sectionId, selectedField!.fieldId, patch)}
                    onDelete={() => requestDeleteField(selectedField!.sectionId, selectedField!.fieldId, currentField.label || 'this field')}
                  />
                </div>
              ) : currentSection ? (
                <SectionEditor
                  section={currentSection}
                  schema={schema}
                  onTitleChange={t => updateSectionTitleById(currentSection.id, t)}
                  onSkipLogicChange={sl => updateSections(currentSection.id, sec => ({ ...sec, skipLogic: sl }))}
                  onAddField={() => setShowTypeMenu(true)}
                />
              ) : (
                <FormSettingsPanel schema={schema} onChange={setSchema} />
              )}
            </div>
          </div>
        </div>
      </div>

      {showTypeMenu && <FieldTypeMenu onSelect={addField} onClose={() => setShowTypeMenu(false)} />}
    </div>
  )
}

// ── Section Editor (right panel when a section is selected) ─────────────────
function SectionEditor({ section, schema, onTitleChange, onSkipLogicChange, onAddField }: {
  section: FormSection
  schema: FormSchema
  onTitleChange: (t: string) => void
  onSkipLogicChange: (sl: SkipLogic | undefined) => void
  onAddField: () => void
}) {
  // All fields that appear in sections/subsections strictly before this section
  const prevFields = (() => {
    const result: FormField[] = []
    const traverse = (secs: FormSection[]): boolean => {
      for (const sec of secs) {
        if (sec.id === section.id) return true
        result.push(...sec.fields)
        if (sec.subsections?.length && traverse(sec.subsections)) return true
      }
      return false
    }
    traverse(schema.sections)
    return result
  })()

  const totalFields  = section.fields.length + (section.subsections?.reduce((n, s) => n + s.fields.length, 0) ?? 0)
  const hasCondition = !!section.skipLogic

  // ⚠ Critical: pass section.skipLogic into the synthetic field so SkipLogicEditor
  // loads the existing conditions rather than always showing "+ Add Skip Logic".
  const syntheticField: FormField = {
    id: `__section_${section.id}`,
    type: 'text',
    name: section.id,
    label: section.title,
    skipLogic: section.skipLogic,   // ← loads existing logic into the editor
  }

  const inputCls = 'w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text placeholder-catalan-textMuted focus:outline-none focus:border-catalan-primary transition-colors'
  const labelCls = 'block text-xs font-medium text-catalan-textMuted mb-1.5 uppercase tracking-wider'

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 sm:p-6 max-w-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-catalan-border">
          <div className="w-9 h-9 rounded-xl bg-catalan-primary/10 flex items-center justify-center text-catalan-primary font-bold flex-shrink-0 text-base">§</div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-catalan-textMuted mb-0.5">Section settings</div>
            <div className="text-base font-semibold text-catalan-text truncate">{section.title || 'Untitled section'}</div>
          </div>
          <div className="text-xs text-catalan-textMuted bg-catalan-hover px-2 py-1 rounded-lg border border-catalan-border flex-shrink-0">
            {totalFields} field{totalFields !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Title */}
        <div className="mb-6">
          <label className={labelCls}>Section title</label>
          <input
            className={inputCls}
            value={section.title}
            onChange={e => onTitleChange(e.target.value)}
            placeholder="Section name"
          />
          <p className="text-xs text-catalan-textMuted mt-1">Or double-click the section name in the left panel to rename inline.</p>
        </div>

        {/* ── Section visibility condition ── */}
        <div className="mb-6" data-help-id="skip-logic-btn">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <label className={labelCls + ' mb-0'}>When to show this section</label>
              <InfoButton topicId="skip-logic" />
            </div>
          </div>

          {/* Active condition banner with clear remove button */}
          {hasCondition && (
            <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-catalan-warning/10 border border-catalan-warning/30 rounded-xl">
              <span className="text-catalan-warning">⚡</span>
              <span className="flex-1 text-xs text-catalan-warning font-medium">
                Visibility condition is active — this section is conditionally shown.
              </span>
              <button
                onClick={() => onSkipLogicChange(undefined)}
                className="flex-shrink-0 text-xs px-2.5 py-1 bg-catalan-error/10 border border-catalan-error/30 text-catalan-error hover:bg-catalan-error/20 rounded-lg font-medium transition-colors flex items-center gap-1"
                title="Remove the condition — section will always be shown"
              >
                ✕ Remove condition
              </button>
            </div>
          )}

          {prevFields.length === 0 ? (
            /* First section — nothing precedes it */
            <div className="flex items-start gap-3 p-4 bg-catalan-hover border border-catalan-border rounded-xl">
              <span className="text-2xl flex-shrink-0">📋</span>
              <div>
                <p className="text-sm font-medium text-catalan-text mb-0.5">No preceding questions</p>
                <p className="text-xs text-catalan-textMuted">This is the first section, so there are no earlier questions to base a condition on. Move it after another section if you need conditional visibility.</p>
              </div>
            </div>
          ) : (
            <div>
              {/* Context — show which fields can be used */}
              <div className="mb-3 p-3 bg-catalan-surface border border-catalan-border rounded-xl">
                <p className="text-xs font-medium text-catalan-text mb-2">
                  {prevFields.length} preceding question{prevFields.length !== 1 ? 's' : ''} available for conditions:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {prevFields.slice(0, 8).map(f => (
                    <span key={f.id} className="text-xs bg-catalan-hover border border-catalan-border px-2 py-0.5 rounded-full text-catalan-textMuted font-mono truncate max-w-[140px]" title={f.label}>
                      {f.label || f.name}
                    </span>
                  ))}
                  {prevFields.length > 8 && (
                    <span className="text-xs text-catalan-textMuted px-1">+{prevFields.length - 8} more</span>
                  )}
                </div>
              </div>

              {/* Skip logic editor */}
              <div className="border border-catalan-border rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-catalan-surface border-b border-catalan-border flex items-center gap-2">
                  <span className="text-xs font-semibold text-catalan-text">Visibility rule</span>
                  <span className="text-xs text-catalan-textMuted">— set when this section should appear</span>
                </div>
                <div className="p-3 bg-catalan-hover">
                  <SkipLogicEditor
                    field={syntheticField}
                    sections={schema.sections}
                    prevFieldsOverride={prevFields}
                    onChange={onSkipLogicChange}
                  />
                </div>
              </div>

              {/* Hint when no condition set yet */}
              {!hasCondition && (
                <p className="mt-2 text-xs text-catalan-textMuted">
                  Example: show <em>Business Details</em> only when <em>started_business</em> = <strong>Yes</strong>. The entire section is skipped otherwise.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Add question shortcut */}
        <Button onClick={onAddField} size="sm" fullWidth>
          + Add Question to this section
        </Button>
      </div>
    </div>
  )
}

// ── Form-level Settings Panel ────────────────────────────────────────────────
function FormSettingsPanel({ schema, onChange }: { schema: FormSchema; onChange: (s: FormSchema) => void }) {
  const [randOpen, setRandOpen] = React.useState(false)
  const [geoOpen, setGeoOpen] = React.useState(false)
  const [validationOpen, setValidationOpen] = React.useState(false)
  const [locating, setLocating] = React.useState(false)

  const rand = schema.settings?.randomization ?? {}
  const geo = schema.settings?.geofence ?? {}
  const validationRules: Array<{ field_id: string; operator: string; value: string; message: string }> =
    (schema.settings as any)?.validation_rules ?? []
  const allFields = getAllFieldsInOrder(schema.sections)

  const updateValidationRules = (rules: typeof validationRules) =>
    onChange({ ...schema, settings: { ...(schema.settings as any), validation_rules: rules } } as FormSchema)

  const addValidationRule = () =>
    updateValidationRules([...validationRules, { field_id: '', operator: 'min', value: '', message: '' }])

  const removeValidationRule = (i: number) =>
    updateValidationRules(validationRules.filter((_, idx) => idx !== i))

  const updateValidationRule = (i: number, patch: Partial<typeof validationRules[0]>) =>
    updateValidationRules(validationRules.map((r, idx) => idx === i ? { ...r, ...patch } : r))

  const updateRand = (patch: Record<string, unknown>) =>
    onChange({ ...schema, settings: { ...schema.settings, randomization: { ...rand, ...patch } } })

  const updateGeo = (patch: Record<string, unknown>) =>
    onChange({ ...schema, settings: { ...schema.settings, geofence: { ...geo, ...patch } } })

  const useMyLocation = () => {
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      p => { updateGeo({ lat: p.coords.latitude, lng: p.coords.longitude }); setLocating(false) },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const inputCls = 'w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text placeholder-catalan-textMuted focus:outline-none focus:border-catalan-primary transition-colors'
  const labelCls = 'block text-xs font-medium text-catalan-textMuted mb-1.5 uppercase tracking-wider'

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 sm:p-6 max-w-2xl">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-catalan-border">
          <div className="w-9 h-9 rounded-xl bg-catalan-primary/10 flex items-center justify-center text-catalan-primary font-bold flex-shrink-0 text-base">⚙</div>
          <div>
            <div className="text-xs text-catalan-textMuted mb-0.5">Form-level settings</div>
            <div className="text-base font-semibold text-catalan-text">Form Settings</div>
          </div>
        </div>

        {/* Data Purpose (DPDP) */}
        <div className="mb-4">
          <label className={labelCls}>Data Purpose (DPDP Compliance)</label>
          <textarea
            className={inputCls + ' resize-none'}
            rows={3}
            value={(schema.settings as any)?.purpose ?? ''}
            onChange={e => onChange({ ...schema, settings: { ...(schema.settings as any), purpose: e.target.value || undefined } } as FormSchema)}
            placeholder="Describe why this data is being collected. If set, respondents will see a consent banner before starting."
          />
          <p className="text-xs text-catalan-textMuted mt-1">Leave blank to skip the consent banner.</p>
        </div>

        {/* Validation Rules */}
        <div className="mb-4 border border-catalan-border rounded-xl overflow-hidden">
          <button
            onClick={() => setValidationOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 bg-catalan-surface hover:bg-catalan-hover transition-colors text-left"
          >
            <span className="font-medium text-catalan-text text-sm">✅ Validation Rules {validationRules.length > 0 && <span className="ml-1 text-xs bg-catalan-primary/20 text-catalan-primary px-1.5 py-0.5 rounded-full">{validationRules.length}</span>}</span>
            <span className="text-catalan-textMuted text-xs">{validationOpen ? '▲' : '▼'}</span>
          </button>
          {validationOpen && (
            <div className="p-4 border-t border-catalan-border bg-catalan-hover/30 space-y-3">
              <p className="text-xs text-catalan-textMuted">Server-side rules evaluated when submissions are synced. Violations are flagged automatically.</p>
              {validationRules.map((rule, i) => (
                <div key={i} className="bg-catalan-surface border border-catalan-border rounded-lg p-3 space-y-2">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className={labelCls}>Field</label>
                      <select
                        className={inputCls}
                        value={rule.field_id}
                        onChange={e => updateValidationRule(i, { field_id: e.target.value })}
                      >
                        <option value="">Select field…</option>
                        {allFields.map(f => <option key={f.id} value={f.id}>{f.label || f.name}</option>)}
                      </select>
                    </div>
                    <div className="w-36">
                      <label className={labelCls}>Operator</label>
                      <select
                        className={inputCls}
                        value={rule.operator}
                        onChange={e => updateValidationRule(i, { operator: e.target.value })}
                      >
                        <option value="min">min</option>
                        <option value="max">max</option>
                        <option value="regex">regex</option>
                        <option value="required_if_field">required_if_field</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>
                      {rule.operator === 'required_if_field' ? 'Required when this field ID is non-empty' : 'Value'}
                    </label>
                    {rule.operator === 'required_if_field' ? (
                      <select
                        className={inputCls}
                        value={rule.value}
                        onChange={e => updateValidationRule(i, { value: e.target.value })}
                      >
                        <option value="">Select triggering field…</option>
                        {allFields.filter(f => f.id !== rule.field_id).map(f => <option key={f.id} value={f.id}>{f.label || f.name}</option>)}
                      </select>
                    ) : (
                      <input
                        className={inputCls}
                        value={rule.value}
                        onChange={e => updateValidationRule(i, { value: e.target.value })}
                        placeholder={rule.operator === 'regex' ? 'e.g. ^[0-9]{10}$' : 'e.g. 0'}
                      />
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>Error message</label>
                    <input
                      className={inputCls}
                      value={rule.message}
                      onChange={e => updateValidationRule(i, { message: e.target.value })}
                      placeholder="e.g. Age must be at least 0"
                    />
                  </div>
                  <button
                    onClick={() => removeValidationRule(i)}
                    className="text-xs text-catalan-error hover:underline"
                  >
                    Remove rule
                  </button>
                </div>
              ))}
              <button
                onClick={addValidationRule}
                className="w-full text-sm py-2 rounded-lg border border-dashed border-catalan-primary/50 text-catalan-primary hover:bg-catalan-primary/10 transition-colors"
              >
                + Add Rule
              </button>
            </div>
          )}
        </div>

        {/* Randomization */}
        <div className="mb-4 border border-catalan-border rounded-xl overflow-hidden">
          <button
            onClick={() => setRandOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 bg-catalan-surface hover:bg-catalan-hover transition-colors text-left"
          >
            <span className="font-medium text-catalan-text text-sm">📊 Randomization / Arm Assignment</span>
            <span className="text-catalan-textMuted text-xs">{randOpen ? '▲' : '▼'}</span>
          </button>
          {randOpen && (
            <div className="p-4 border-t border-catalan-border space-y-4 bg-catalan-hover/30">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!rand.enabled}
                  onChange={e => updateRand({ enabled: e.target.checked })}
                  className="w-4 h-4 accent-catalan-primary"
                />
                <span className="text-sm text-catalan-text">Enable arm assignment</span>
              </label>
              {rand.enabled && (
                <div>
                  <label className={labelCls}>Arm names (comma-separated)</label>
                  <input
                    className={inputCls}
                    value={(rand.arms ?? []).join(', ')}
                    onChange={e => updateRand({ arms: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })}
                    placeholder="Control, Treatment A, Treatment B"
                  />
                  <p className="text-xs text-catalan-textMuted mt-1">Each respondent is deterministically assigned to one arm.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Geofencing */}
        <div className="mb-4 border border-catalan-border rounded-xl overflow-hidden">
          <button
            onClick={() => setGeoOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 bg-catalan-surface hover:bg-catalan-hover transition-colors text-left"
          >
            <span className="font-medium text-catalan-text text-sm">🗺 Geofencing</span>
            <span className="text-catalan-textMuted text-xs">{geoOpen ? '▲' : '▼'}</span>
          </button>
          {geoOpen && (
            <div className="p-4 border-t border-catalan-border space-y-4 bg-catalan-hover/30">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!geo.enabled}
                  onChange={e => updateGeo({ enabled: e.target.checked })}
                  className="w-4 h-4 accent-catalan-primary"
                />
                <span className="text-sm text-catalan-text">Enable geofence</span>
              </label>
              {geo.enabled && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Center latitude</label>
                      <input
                        type="number"
                        step="any"
                        className={inputCls}
                        value={geo.lat ?? ''}
                        onChange={e => updateGeo({ lat: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                        placeholder="e.g. 28.6139"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Center longitude</label>
                      <input
                        type="number"
                        step="any"
                        className={inputCls}
                        value={geo.lng ?? ''}
                        onChange={e => updateGeo({ lng: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                        placeholder="e.g. 77.2090"
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Radius (meters)</label>
                    <input
                      type="number"
                      className={inputCls}
                      value={geo.radius_meters ?? ''}
                      onChange={e => updateGeo({ radius_meters: e.target.value === '' ? undefined : parseInt(e.target.value, 10) })}
                      placeholder="e.g. 500"
                    />
                  </div>
                  <button
                    onClick={useMyLocation}
                    disabled={locating}
                    className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-catalan-primary/40 text-catalan-primary hover:bg-catalan-primary/10 transition-colors disabled:opacity-50"
                  >
                    {locating ? '⏳ Getting location…' : '📍 Use my location'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Helper: collect all section IDs recursively
function getAllSectionIds(sections: FormSection[]): string[] {
  const result: string[] = []
  const traverse = (secs: FormSection[]) => {
    for (const s of secs) { result.push(s.id); if (s.subsections?.length) traverse(s.subsections) }
  }
  traverse(sections)
  return result
}
