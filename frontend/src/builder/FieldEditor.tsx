import React from 'react'
import type { FormField, FormSection, FieldOption } from '@/types/form'
import SkipLogicEditor from './SkipLogicEditor'

interface Props {
  field: FormField
  sectionId: string
  sections: FormSection[]
  onChange: (patch: Partial<FormField>) => void
  onDelete: () => void
}

const inp: React.CSSProperties = {
  background: '#2a2a3e', border: '1px solid #3a3a5c', color: '#cdd6f4',
  borderRadius: 6, padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box',
}
const label: React.CSSProperties = { color: '#a6adc8', fontSize: 12, display: 'block', marginBottom: 4 }
const group: React.CSSProperties = { marginBottom: 14 }
const row: React.CSSProperties = { display: 'flex', gap: 8 }

export default function FieldEditor({ field, sections, onChange, onDelete }: Props) {
  const updateOption = (i: number, patch: Partial<FieldOption>) => {
    const options = (field.options ?? []).map((o, idx) => idx === i ? { ...o, ...patch } : o)
    onChange({ options })
  }
  const addOption = () => onChange({ options: [...(field.options ?? []), { value: `option_${Date.now()}`, label: '' }] })
  const removeOption = (i: number) => onChange({ options: (field.options ?? []).filter((_, idx) => idx !== i) })

  return (
    <div style={{ padding: 20, overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ color: '#89b4fa', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
          {field.type.replace('_', ' ')}
        </span>
        <button onClick={onDelete} style={{ background: 'none', border: 'none', color: '#f38ba8', cursor: 'pointer', fontSize: 13 }}>
          Delete
        </button>
      </div>

      <div style={group}>
        <label style={label}>Label *</label>
        <input style={inp} value={field.label} onChange={e => onChange({ label: e.target.value })} placeholder="Question text shown to enumerator" />
      </div>

      <div style={group}>
        <label style={label}>Variable Name (export)</label>
        <input style={inp} value={field.name}
          onChange={e => onChange({ name: e.target.value.replace(/\s+/g, '_').toLowerCase() })}
          placeholder="snake_case_name" />
      </div>

      <div style={group}>
        <label style={label}>Hint (optional)</label>
        <input style={inp} value={field.hint ?? ''} onChange={e => onChange({ hint: e.target.value })} placeholder="Helper text shown below the question" />
      </div>

      <div style={{ ...group, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" id="req" checked={!!field.required} onChange={e => onChange({ required: e.target.checked })} />
        <label htmlFor="req" style={{ ...label, marginBottom: 0, cursor: 'pointer' }}>Required</label>
      </div>

      {/* Number / Decimal range */}
      {(field.type === 'number' || field.type === 'decimal' || field.type === 'rating') && (
        <div style={{ ...group, ...row }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Min</label>
            <input style={inp} type="number" value={field.min ?? ''} onChange={e => onChange({ min: Number(e.target.value) })} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Max</label>
            <input style={inp} type="number" value={field.max ?? ''} onChange={e => onChange({ max: Number(e.target.value) })} />
          </div>
        </div>
      )}

      {/* Calculated formula */}
      {field.type === 'calculated' && (
        <div style={group}>
          <label style={label}>Formula</label>
          <input style={inp} value={field.formula ?? ''} onChange={e => onChange({ formula: e.target.value })} placeholder="e.g. farm_income + wage_income" />
        </div>
      )}

      {/* Choice options */}
      {(field.type === 'single_choice' || field.type === 'multiple_choice') && (
        <div style={group}>
          <label style={label}>Options</label>
          {(field.options ?? []).map((opt, i) => (
            <div key={i} style={{ ...row, marginBottom: 6 }}>
              <input style={{ ...inp, flex: 1 }} value={opt.label} placeholder="Label"
                onChange={e => updateOption(i, { label: e.target.value })} />
              <input style={{ ...inp, width: 100 }} value={opt.value} placeholder="value"
                onChange={e => updateOption(i, { value: e.target.value })} />
              <button onClick={() => removeOption(i)} style={{ background: 'none', border: 'none', color: '#f38ba8', cursor: 'pointer' }}>✕</button>
            </div>
          ))}
          <button onClick={addOption} style={{ background: '#2a2a3e', border: '1px solid #3a3a5c', color: '#89b4fa', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12 }}>
            + Add Option
          </button>
        </div>
      )}

      {/* Skip Logic */}
      {field.type !== 'note' && (
        <div style={group}>
          <label style={label}>Skip Logic</label>
          <SkipLogicEditor field={field} sections={sections} onChange={sl => onChange({ skipLogic: sl })} />
        </div>
      )}
    </div>
  )
}
