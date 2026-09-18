import type { FormField } from '@/types/form'
import { labelCls, hintCls, optionBtnCls, requiredCls } from './styles'

interface Props { field: FormField; value: string; onChange: (v: string) => void }

export default function SingleChoiceField({ field, value, onChange }: Props) {
  return (
    <div>
      <label className={labelCls}>
        {field.label}
        {field.required && <span className={requiredCls}> *</span>}
      </label>
      {field.hint && <div className={hintCls}>{field.hint}</div>}
      <div className="mt-1 space-y-0">
        {(field.options ?? []).map(opt => {
          const selected = value === opt.value
          return (
            <button
              key={opt.value}
              className={optionBtnCls(selected)}
              onClick={() => onChange(opt.value)}
            >
              {/* Radio circle */}
              <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                selected ? 'border-catalan-primary' : 'border-catalan-textMuted/50'
              }`}>
                {selected && (
                  <span className="w-2.5 h-2.5 rounded-full bg-catalan-primary" />
                )}
              </span>
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
