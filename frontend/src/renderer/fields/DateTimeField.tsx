import React from 'react'
import type { FormField } from '@/types/form'
import { labelCls, hintCls, inputCls, requiredCls } from './styles'

interface Props { field: FormField; value: string; onChange: (v: string) => void }

export default function DateTimeField({ field, value, onChange }: Props) {
  const type = field.type === 'date' ? 'date' : 'time'
  return (
    <div>
      <label className={labelCls}>
        {field.label}
        {field.required && <span className={requiredCls}> *</span>}
      </label>
      {field.hint && <div className={hintCls}>{field.hint}</div>}
      {/* color-scheme:dark keeps the native date picker styled dark on Chrome */}
      <input
        className={inputCls}
        type={type}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        style={{ colorScheme: 'dark' }}
      />
    </div>
  )
}
