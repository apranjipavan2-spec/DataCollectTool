import React from 'react'
import type { FormField } from '@/types/form'
import { labelCls, hintCls, fieldHintCls, requiredCls } from './styles'
import EmojiIcon from '@/components/EmojiIcon'

interface Props { field: FormField; value: number | null; onChange: (v: number) => void }

export default function RatingField({ field, value, onChange }: Props) {
  const min  = field.min ?? 1
  const max  = field.max ?? 5
  const stars = Array.from({ length: max - min + 1 }, (_, i) => i + min)

  return (
    <div>
      <label className={labelCls}>
        {field.label}
        {field.required && <span className={requiredCls}> *</span>}
      </label>
      {field.hint && <div className={hintCls}>{field.hint}</div>}

      <div className="flex gap-2 justify-center mt-2">
        {stars.map(n => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={`text-4xl bg-transparent border-none cursor-pointer transition-colors leading-none ${
              value !== null && n <= value ? 'text-catalan-warning' : 'text-catalan-border'
            }`}
          >
            ★
          </button>
        ))}
      </div>

      {value !== null && (
        <div className={`${fieldHintCls} text-catalan-textMuted`}>
          {value} / {max}
        </div>
      )}
    </div>
  )
}
