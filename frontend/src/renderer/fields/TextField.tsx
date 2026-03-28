import React from 'react'
import type { FormField } from '@/types/form'
import { labelCls, hintCls, inputCls, requiredCls } from './styles'

interface Props { field: FormField; value: string; onChange: (v: string) => void }

export default function TextField({ field, value, onChange }: Props) {
  return (
    <div>
      <label className={labelCls}>
        {field.label}
        {field.required && <span className={requiredCls}> *</span>}
      </label>
      {field.hint && <div className={hintCls}>{field.hint}</div>}
      <input
        className={inputCls}
        type="text"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder="Type your answer…"
      />
    </div>
  )
}
