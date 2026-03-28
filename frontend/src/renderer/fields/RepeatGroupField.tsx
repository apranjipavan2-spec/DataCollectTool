import React, { useState } from 'react'
import type { FormField } from '@/types/form'
import { labelCls, hintCls, requiredCls } from './styles'
import { v4 as uuidv4 } from 'uuid'

import TextField          from './TextField'
import NumberField        from './NumberField'
import SingleChoiceField  from './SingleChoiceField'
import MultipleChoiceField from './MultipleChoiceField'
import DateTimeField      from './DateTimeField'
import PhotoField         from './PhotoField'
import AudioField         from './AudioField'
import RatingField        from './RatingField'
import NoteField          from './NoteField'

interface RowData { _id: string; [key: string]: unknown }

interface Props {
  field: FormField
  value: RowData[]
  onChange: (v: RowData[]) => void
}

/**
 * RepeatGroupField — renders a dynamic list of sub-field rows.
 * Each row contains all child fields defined in field.fields.
 */
export default function RepeatGroupField({ field, value, onChange }: Props) {
  const rows        = value ?? []
  const childFields = field.fields ?? []
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  const addRow = () => {
    const newRow: RowData = { _id: uuidv4() }
    childFields.forEach(f => { newRow[f.name] = '' })
    onChange([...rows, newRow])
    setExpandedRow(newRow._id)
  }

  const removeRow = (id: string) => {
    onChange(rows.filter(r => r._id !== id))
    if (expandedRow === id) setExpandedRow(null)
  }

  const updateField = (rowId: string, fieldName: string, fieldValue: unknown) => {
    onChange(rows.map(r => r._id === rowId ? { ...r, [fieldName]: fieldValue } : r))
  }

  const renderChildField = (cf: FormField, row: RowData) => {
    const val    = row[cf.name]
    const setVal = (v: unknown) => updateField(row._id, cf.name, v)
    switch (cf.type) {
      case 'text':            return <TextField         field={cf} value={(val as string)    ?? ''} onChange={setVal} />
      case 'number':
      case 'decimal':         return <NumberField        field={cf} value={(val as string)    ?? ''} onChange={setVal} />
      case 'single_choice':  return <SingleChoiceField  field={cf} value={(val as string)    ?? ''} onChange={setVal} />
      case 'multiple_choice': return <MultipleChoiceField field={cf} value={(val as string[]) ?? []} onChange={setVal} />
      case 'date':
      case 'time':            return <DateTimeField      field={cf} value={(val as string)    ?? ''} onChange={setVal} />
      case 'photo':           return <PhotoField         field={cf} value={(val as string)    ?? null} onChange={setVal} />
      case 'audio':           return <AudioField         field={cf} value={(val as string)    ?? null} onChange={setVal} />
      case 'rating':          return <RatingField        field={cf} value={(val as number)    ?? null} onChange={setVal} />
      case 'note':            return <NoteField          field={cf} />
      default:
        return (
          <div className="text-catalan-textMuted text-xs">Unsupported: {cf.type}</div>
        )
    }
  }

  return (
    <div>
      <label className={labelCls}>
        {field.label}
        {field.required && <span className={requiredCls}> *</span>}
      </label>
      {field.hint && <div className={hintCls}>{field.hint}</div>}

      {/* Row count */}
      <div className="text-catalan-textMuted text-xs mb-2.5">
        {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}
        {field.max ? ` (max ${field.max})` : ''}
      </div>

      {/* Existing rows */}
      <div className="space-y-2">
        {rows.map((row, idx) => {
          const isExpanded = expandedRow === row._id
          const summary = childFields
            .slice(0, 2)
            .map(f => row[f.name])
            .filter(v => v !== '' && v !== null && v !== undefined)
            .join(' · ') || 'Empty'

          return (
            <div
              key={row._id}
              className="bg-catalan-surface border border-catalan-border/50 rounded-xl overflow-hidden"
            >
              {/* Row header */}
              <div
                onClick={() => setExpandedRow(isExpanded ? null : row._id)}
                className="flex justify-between items-center px-3.5 py-2.5 cursor-pointer hover:bg-catalan-hover transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-catalan-primary text-sm font-semibold">#{idx + 1}</span>
                  <span className="text-catalan-textMuted text-sm truncate max-w-[200px]">{summary}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={e => { e.stopPropagation(); removeRow(row._id) }}
                    className="text-catalan-textMuted hover:text-catalan-error text-base leading-none transition-colors px-1"
                  >
                    ×
                  </button>
                  <span className="text-catalan-textMuted text-xs">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Expanded child fields */}
              {isExpanded && (
                <div className="px-3.5 pb-3.5 pt-0 border-t border-catalan-border/50 space-y-3 mt-0">
                  {childFields.map(cf => (
                    <div key={cf.id} className="mt-3">
                      {renderChildField(cf, row)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Add row button */}
      {(!field.max || rows.length < field.max) && (
        <button
          onClick={addRow}
          className="w-full mt-2 bg-catalan-hover border border-dashed border-catalan-border text-catalan-primary rounded-xl py-3.5 cursor-pointer text-sm font-medium hover:border-catalan-primary/60 transition-colors"
        >
          + Add Entry
        </button>
      )}
    </div>
  )
}
