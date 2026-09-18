import type { FormField } from '@/types/form'
import { labelCls, hintCls, optionBtnCls, requiredCls } from './styles'

interface Props { field: FormField; value: string[]; onChange: (v: string[]) => void }

export default function MultipleChoiceField({ field, value, onChange }: Props) {
  const selected = value ?? []
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])

  return (
    <div>
      <label className={labelCls}>
        {field.label}
        {field.required && <span className={requiredCls}> *</span>}
      </label>
      {field.hint && <div className={hintCls}>{field.hint}</div>}
      <div className="mt-1 space-y-0">
        {(field.options ?? []).map(opt => {
          const on = selected.includes(opt.value)
          return (
            <button
              key={opt.value}
              className={optionBtnCls(on)}
              onClick={() => toggle(opt.value)}
            >
              {/* Checkbox */}
              <span className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                on ? 'bg-catalan-primary border-catalan-primary' : 'border-catalan-textMuted/50 bg-transparent'
              }`}>
                {on && <span className="text-catalan-bg text-xs font-bold leading-none">✓</span>}
              </span>
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
