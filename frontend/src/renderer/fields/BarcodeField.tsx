import type { FormField } from '@/types/form'
import { labelCls, hintCls, inputCls, requiredCls } from './styles'

interface Props { field: FormField; value: string; onChange: (v: string) => void }

// Manual entry only — camera scanning (BarcodeDetector API) removed: on Android
// it can trigger Chrome's Google Play Services / Barcode Scanner install prompt.
export default function BarcodeField({ field, value, onChange }: Props) {
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
        placeholder="Enter barcode…"
      />
    </div>
  )
}
