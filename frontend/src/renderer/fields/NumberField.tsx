import React from 'react'
import type { FormField } from '@/types/form'
import { labelCls, hintCls, numberInputCls, fieldHintCls, requiredCls } from './styles'

interface Props { field: FormField; value: string; onChange: (v: string) => void }

export default function NumberField({ field, value, onChange }: Props) {
  return (
    <div>
      <label className={labelCls}>
        {field.label}
        {field.required && <span className={requiredCls}> *</span>}
      </label>
      {field.hint && <div className={hintCls}>{field.hint}</div>}
      <input
        className={numberInputCls}
        type="number"
        inputMode="numeric"
        min={field.min}
        max={field.max}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder="0"
      />
      {(field.min !== undefined || field.max !== undefined) && (
        <div className={fieldHintCls}>
          {field.min !== undefined && `Min: ${field.min}`}
          {field.min !== undefined && field.max !== undefined && ' · '}
          {field.max !== undefined && `Max: ${field.max}`}
        </div>
      )}
    </div>
  )
}
