import type { FormField } from '@/types/form'
import { labelCls, hintCls, inputCls, requiredCls } from './styles'

interface Props { field: FormField; value: string; onChange: (v: string) => void }

export default function DateTimeField({ field, value, onChange }: Props) {
  const type = field.type === 'date' ? 'date' : 'time'

  const setNow = () => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    onChange(type === 'date'
      ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      : `${pad(d.getHours())}:${pad(d.getMinutes())}`)
  }

  return (
    <div>
      <label className={labelCls}>
        {field.label}
        {field.required && <span className={requiredCls}> *</span>}
      </label>
      {field.hint && <div className={hintCls}>{field.hint}</div>}
      {/* color-scheme:dark keeps the native date picker styled dark on Chrome */}
      <div className="flex items-center gap-2">
        <input
          className={inputCls}
          type={type}
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          style={{ colorScheme: 'dark' }}
        />
        <button
          type="button"
          onClick={setNow}
          className="flex-shrink-0 whitespace-nowrap rounded-lg border border-catalan-primary/40 text-catalan-primary text-sm font-medium px-3 py-2 hover:bg-catalan-primary/10 transition-colors"
          title={type === 'date' ? "Fill today's date" : 'Fill the current time'}
        >
          {type === 'date' ? '📅 Today' : '⏰ Now'}
        </button>
      </div>
    </div>
  )
}
