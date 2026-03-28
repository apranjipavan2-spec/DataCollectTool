import React, { useState, useCallback } from 'react'
import type { FormSchema, FormSection, FormField, FieldType } from '@/types/form'
import { newField, newSection, newSchema, updateFieldInSchema } from '@/lib/formUtils'
import FieldTypeMenu from './FieldTypeMenu'
import FieldEditor from './FieldEditor'
import { v4 as uuidv4 } from 'uuid'
import api from '@/lib/api'

const FIELD_TYPE_ICONS: Record<string, string> = {
  text: '𝐓', number: '#', decimal: '.1', single_choice: '◉', multiple_choice: '☑',
  date: '📅', time: '⏰', gps: '📍', photo: '📷', audio: '🎙', barcode: '▦',
  calculated: '∑', repeat_group: '⟳', note: 'ℹ', rating: '★',
}

export default function FormBuilder() {
  const [schema, setSchema] = useState<FormSchema>(newSchema())
  const [selectedSection, setSelectedSection] = useState<string>(schema.sections[0].id)
  const [selectedField, setSelectedField] = useState<{ sectionId: string; fieldId: string } | null>(null)
  const [showTypeMenu, setShowTypeMenu] = useState(false)
  const [formId, setFormId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  const currentSection = schema.sections.find(s => s.id === selectedSection)!
  const currentField = selectedField
    ? schema.sections.find(s => s.id === selectedField.sectionId)?.fields.find(f => f.id === selectedField.fieldId)
    : null

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
    setSaving(true); setSaveError('')
    try {
      if (formId) {
        await api.put(`/forms/${formId}`, { title: schema.title, json_schema: schema })
      } else {
        const { data } = await api.post('/forms/', { title: schema.title, json_schema: schema })
        setFormId(data.id)
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setSaveError('Save failed — are you logged in?')
    } finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#11111b', color: '#cdd6f4', fontFamily: 'system-ui, sans-serif' }}>

      {/* ── LEFT: Sections + Fields ── */}
      <div style={{ width: 280, borderRight: '1px solid #2a2a3e', display: 'flex', flexDirection: 'column' }}>

        {/* Form title */}
        <div style={{ padding: '16px 16px 8px', borderBottom: '1px solid #2a2a3e' }}>
          <input
            value={schema.title}
            onChange={e => setSchema(s => ({ ...s, title: e.target.value }))}
            style={{ background: 'transparent', border: 'none', color: '#cdd6f4', fontSize: 16, fontWeight: 600, width: '100%', outline: 'none' }}
            placeholder="Form title"
          />
          <div style={{ fontSize: 11, color: '#6c7086', marginTop: 2 }}>v{schema.version} · {schema.sections.flatMap(s => s.fields).length} fields</div>
        </div>

        {/* Sections */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {schema.sections.map(sec => (
            <div key={sec.id}>
              {/* Section header */}
              <div
                onClick={() => { setSelectedSection(sec.id); setSelectedField(null) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', cursor: 'pointer',
                  background: selectedSection === sec.id && !selectedField ? '#2a2a3e' : 'transparent',
                }}
              >
                <span style={{ color: '#89b4fa', fontSize: 11 }}>▶</span>
                <input
                  value={sec.title}
                  onChange={e => { e.stopPropagation(); updateSectionTitle(sec.id, e.target.value) }}
                  onClick={e => e.stopPropagation()}
                  style={{ background: 'transparent', border: 'none', color: '#cdd6f4', fontSize: 13, fontWeight: 500, flex: 1, outline: 'none', cursor: 'pointer' }}
                />
                {schema.sections.length > 1 && (
                  <button
                    onClick={e => { e.stopPropagation(); deleteSection(sec.id) }}
                    style={{ background: 'none', border: 'none', color: '#585b70', cursor: 'pointer', fontSize: 13, padding: 0 }}
                  >✕</button>
                )}
              </div>

              {/* Fields */}
              {sec.fields.map(field => (
                <div
                  key={field.id}
                  onClick={() => { setSelectedSection(sec.id); setSelectedField({ sectionId: sec.id, fieldId: field.id }) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px 5px 28px',
                    cursor: 'pointer', fontSize: 12,
                    background: selectedField?.fieldId === field.id ? '#313244' : 'transparent',
                    borderLeft: selectedField?.fieldId === field.id ? '2px solid #89b4fa' : '2px solid transparent',
                  }}
                >
                  <span style={{ color: '#585b70', fontSize: 13, width: 16, textAlign: 'center' }}>
                    {FIELD_TYPE_ICONS[field.type]}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: field.label ? '#cdd6f4' : '#585b70' }}>
                    {field.label || `(${field.type})`}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <button onClick={e => { e.stopPropagation(); moveField(sec.id, field.id, -1) }}
                      style={{ background: 'none', border: 'none', color: '#585b70', cursor: 'pointer', lineHeight: 1, padding: 0, fontSize: 10 }}>▲</button>
                    <button onClick={e => { e.stopPropagation(); moveField(sec.id, field.id, 1) }}
                      style={{ background: 'none', border: 'none', color: '#585b70', cursor: 'pointer', lineHeight: 1, padding: 0, fontSize: 10 }}>▼</button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Bottom actions */}
        <div style={{ padding: 12, borderTop: '1px solid #2a2a3e', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button onClick={() => setShowTypeMenu(true)} style={{
            background: '#1e66f5', border: 'none', color: '#fff', borderRadius: 7,
            padding: '8px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 500,
          }}>+ Add Question</button>
          <button onClick={addSection} style={{
            background: '#2a2a3e', border: '1px solid #3a3a5c', color: '#89b4fa',
            borderRadius: 7, padding: '7px 12px', cursor: 'pointer', fontSize: 13,
          }}>+ Add Section</button>
        </div>
      </div>

      {/* ── CENTER / RIGHT: Field editor or empty state ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>

        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid #2a2a3e' }}>
          <span style={{ color: '#6c7086', fontSize: 13 }}>
            {currentField
              ? `${currentSection?.title} › ${currentField.label || 'Untitled field'}`
              : currentSection?.title}
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {saveError && <span style={{ color: '#f38ba8', fontSize: 12 }}>{saveError}</span>}
            {formId && <span style={{ color: '#45475a', fontSize: 11, fontFamily: 'monospace' }}>{formId.slice(0, 8)}</span>}
            <a href="/collect" style={{ background: '#2a2a3e', border: '1px solid #3a3a5c', color: '#cdd6f4', borderRadius: 7, padding: '7px 14px', fontSize: 13, textDecoration: 'none' }}>
              Preview
            </a>
            <button onClick={handleSave} style={{
              background: saved ? '#a6e3a1' : '#1e66f5', border: 'none',
              color: saved ? '#1e1e2e' : '#fff', borderRadius: 7,
              padding: '7px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 500,
              minWidth: 80,
            }}>
              {saving ? '…' : saved ? '✓ Saved' : 'Save'}
            </button>
          </div>
        </div>

        {/* Main area */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {currentField ? (
            <FieldEditor
              field={currentField}
              sectionId={selectedField!.sectionId}
              sections={schema.sections}
              onChange={patch => updateField(selectedField!.sectionId, selectedField!.fieldId, patch)}
              onDelete={() => deleteField(selectedField!.sectionId, selectedField!.fieldId)}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#585b70' }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
              <div style={{ fontSize: 15, marginBottom: 8 }}>Select a field to edit</div>
              <div style={{ fontSize: 13 }}>or click <strong style={{ color: '#89b4fa' }}>+ Add Question</strong> to get started</div>
            </div>
          )}
        </div>
      </div>

      {showTypeMenu && <FieldTypeMenu onSelect={addField} onClose={() => setShowTypeMenu(false)} />}
    </div>
  )
}
