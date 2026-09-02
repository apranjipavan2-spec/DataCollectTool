import React, { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { FormField, FormSection, FieldOption, FieldType } from '@/types/form'
import { evalFormula } from '@/lib/formUtils'
import SkipLogicEditor from './SkipLogicEditor'
import EmojiIcon from '@/components/EmojiIcon'

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text',            label: 'Text' },
  { value: 'number',          label: 'Number' },
  { value: 'decimal',         label: 'Decimal' },
  { value: 'single_choice',   label: 'Single Choice' },
  { value: 'multiple_choice', label: 'Multiple Choice' },
  { value: 'date',            label: 'Date' },
  { value: 'time',            label: 'Time' },
  { value: 'gps',             label: 'GPS Location' },
  { value: 'photo',           label: 'Photo' },
  { value: 'audio',           label: 'Audio' },
  { value: 'barcode',         label: 'Barcode' },
  { value: 'calculated',      label: 'Calculated / Conditional' },
  { value: 'repeat_group',    label: 'Repeat Group' },
  { value: 'rating',          label: 'Rating' },
  { value: 'note',            label: 'Note / Instruction' },
]

const CHILD_FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text',            label: 'Text' },
  { value: 'number',          label: 'Number' },
  { value: 'decimal',         label: 'Decimal' },
  { value: 'single_choice',   label: 'Single Choice' },
  { value: 'multiple_choice', label: 'Multiple Choice' },
  { value: 'date',            label: 'Date' },
  { value: 'time',            label: 'Time' },
  { value: 'gps',             label: 'GPS' },
  { value: 'photo',           label: 'Photo' },
  { value: 'barcode',         label: 'Barcode' },
  { value: 'rating',          label: 'Rating' },
  { value: 'note',            label: 'Note' },
]

interface Props {
  field: FormField
  sectionId: string
  sections: FormSection[]
  onChange: (patch: Partial<FormField>) => void
  onDelete: () => void
}

const inputCls = 'w-full bg-catalan-hover border border-catalan-border rounded-lg px-3 py-2 text-sm text-catalan-text placeholder-catalan-textMuted focus:outline-none focus:border-catalan-primary transition-colors'
const labelCls = 'block text-xs font-medium text-catalan-textMuted mb-1.5 uppercase tracking-wider'
const groupCls = 'mb-5'
const selCls   = 'bg-catalan-hover border border-catalan-border text-catalan-text rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-catalan-primary'

// ── Operator sets per field type ────────────────────────────────────────────
type Op = { value: string; label: string }

function getOps(type?: FieldType): Op[] {
  switch (type) {
    case 'number':
    case 'decimal':
    case 'rating':
      return [
        { value: '==', label: 'equals' },
        { value: '!=', label: 'not equals' },
        { value: '>',  label: 'greater than' },
        { value: '<',  label: 'less than' },
        { value: '>=', label: 'is ≥' },
        { value: '<=', label: 'is ≤' },
      ]
    case 'date':
      return [
        { value: '==', label: 'is on' },
        { value: '!=', label: 'is not on' },
        { value: '>',  label: 'is after' },
        { value: '<',  label: 'is before' },
        { value: '>=', label: 'is on or after' },
        { value: '<=', label: 'is on or before' },
      ]
    case 'time':
      return [
        { value: '==', label: 'equals' },
        { value: '!=', label: 'not equals' },
        { value: '>',  label: 'is later than' },
        { value: '<',  label: 'is earlier than' },
      ]
    case 'single_choice':
      return [
        { value: '==', label: 'is' },
        { value: '!=', label: 'is not' },
      ]
    case 'multiple_choice':
      return [
        { value: 'contains', label: 'includes option' },
        { value: '==',       label: 'exactly equals' },
        { value: '!=',       label: 'does not equal' },
      ]
    case 'text':
    case 'barcode':
      return [
        { value: '==',       label: 'equals' },
        { value: '!=',       label: 'not equals' },
        { value: 'contains', label: 'contains' },
      ]
    default:
      return [
        { value: '==', label: 'equals' },
        { value: '!=', label: 'not equals' },
      ]
  }
}

// ── Build the condition part of the if() formula ────────────────────────────
function buildConditionExpr(field: string, op: string, value: string, condField?: FormField): string {
  const isNumeric = condField && ['number', 'decimal', 'rating'].includes(condField.type)
  const isDate    = condField?.type === 'date' || condField?.type === 'time'

  if (op === 'contains') {
    // Use the contains() helper added to evalFormula
    return `contains(${field}, "${value}")`
  }

  // Quote the comparison value for non-numeric fields
  const cmpVal = (isNumeric || isDate) && !isNaN(Number(value)) && value !== ''
    ? value
    : `"${value}"`

  return `${field} ${op} ${cmpVal}`
}

// ── Smart quoting for THEN / ELSE expressions ───────────────────────────────
function formatExpr(expr: string, prevFields: FormField[]): string {
  const t = expr.trim()
  if (!t) return '""'
  if (/^-?\d+(\.\d+)?$/.test(t)) return t                   // pure number
  if (prevFields.some(f => f.name === t)) return t           // field reference
  if (/[+\-*/()]/.test(t) || /\w+\(/.test(t)) return t      // expression / fn call
  return `"${t}"`                                             // plain string → quote
}

// ── Build full if() formula ─────────────────────────────────────────────────
interface CondRow { field: string; op: string; value: string; then: string; else_: string }

function buildIfFormula(cond: CondRow, condField: FormField | undefined, prevFields: FormField[]): string {
  const condition = buildConditionExpr(cond.field, cond.op, cond.value, condField)
  return `if(${condition}, ${formatExpr(cond.then, prevFields)}, ${formatExpr(cond.else_, prevFields)})`
}

// ── Comparison value widget (adapts to field type) ──────────────────────────
function CompareValueInput({ condField, value, onChange }: {
  condField?: FormField; value: string; onChange: (v: string) => void
}) {
  const base = 'border border-catalan-border rounded-lg px-2 py-1.5 text-sm text-catalan-text bg-catalan-bg focus:outline-none focus:border-catalan-primary'

  if (condField?.type === 'single_choice' || condField?.type === 'multiple_choice') {
    const opts = condField.options ?? []
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className={`${base} min-w-[120px]`}>
        <option value="">-- pick option --</option>
        {opts.map(o => <option key={o.value} value={o.value}>{o.label || o.value}</option>)}
      </select>
    )
  }

  if (condField?.type === 'number' || condField?.type === 'decimal') {
    return <input type="number" step="any" value={value} onChange={e => onChange(e.target.value)} className={`${base} w-28`} placeholder="e.g. 5" />
  }

  if (condField?.type === 'rating') {
    const min = condField.min ?? 1
    const max = condField.max ?? 5
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className={`${base} w-24`}>
        <option value="">--</option>
        {Array.from({ length: max - min + 1 }, (_, i) => i + min).map(n => (
          <option key={n} value={String(n)}>{n}</option>
        ))}
      </select>
    )
  }

  if (condField?.type === 'date') {
    return <input type="date" value={value} onChange={e => onChange(e.target.value)} className={`${base} w-36`} />
  }

  if (condField?.type === 'time') {
    return <input type="time" value={value} onChange={e => onChange(e.target.value)} className={`${base} w-28`} />
  }

  // text, barcode, default
  return <input type="text" value={value} onChange={e => onChange(e.target.value)} className={`${base} w-36`} placeholder="value" />
}

// ── THEN / ELSE picker: free expression + field insert ──────────────────────
function ExprInput({ label, value, prevFields, onChange }: {
  label: string; value: string; prevFields: FormField[]; onChange: (v: string) => void
}) {
  const handleInsertField = (name: string) => {
    if (!name) return
    onChange(value ? `${value} ${name}` : name)
  }
  return (
    <div className="flex gap-2 items-start">
      <span className="text-xs font-bold text-catalan-textMuted w-10 pt-2 flex-shrink-0 tracking-wider">{label}</span>
      <div className="flex-1 relative">
        <input
          className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-1.5 text-sm font-mono text-catalan-text placeholder-catalan-textMuted focus:outline-none focus:border-catalan-primary pr-24"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder='number, "text", or expression'
        />
        <select
          value=""
          onChange={e => handleInsertField(e.target.value)}
          className="absolute right-1 top-1 bottom-1 text-xs bg-catalan-primary/10 border border-catalan-primary/20 text-catalan-primary rounded-md px-1 focus:outline-none cursor-pointer"
        >
          <option value="">+ field</option>
          {prevFields.map(f => (
            <option key={f.id} value={f.name}>{f.label || f.name}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

// ── Formula Builder ─────────────────────────────────────────────────────────
function FormulaBuilder({ field, prevFields, onChange }: {
  field: FormField; prevFields: FormField[]; onChange: (formula: string) => void
}) {
  const [mode, setMode] = useState<'arithmetic' | 'conditional' | 'custom'>(() =>
    field.formula?.trim().startsWith('if(') ? 'conditional' : 'arithmetic'
  )

  // Parse existing if() formula back into UI state if possible
  const [cond, setCond] = useState<CondRow>(() => {
    if (field.formula?.trim().startsWith('if(')) {
      // Pattern: if(field op "val", then, else) or if(contains(field, "val"), then, else)
      const containsM = field.formula.match(/^if\(contains\(([a-zA-Z_]\w*),\s*"([^"]*)"\)\s*,\s*(.+),\s*(.+)\)$/)
      if (containsM) return {
        field: containsM[1], op: 'contains', value: containsM[2],
        then: containsM[3].trim().replace(/^"(.*)"$/, '$1'),
        else_: containsM[4].trim().replace(/^"(.*)"$/, '$1'),
      }
      const m = field.formula.match(/^if\(([a-zA-Z_]\w*)\s*(==|!=|>=|<=|>|<)\s*("?[^,]*"?)\s*,\s*(.+),\s*(.+)\)$/)
      if (m) return {
        field: m[1], op: m[2],
        value: m[3].replace(/^"(.*)"$/, '$1'),
        then: m[4].trim().replace(/^"(.*)"$/, '$1'),
        else_: m[5].trim().replace(/^"(.*)"$/, '$1'),
      }
    }
    return { field: prevFields[0]?.name ?? '', op: '==', value: '', then: '', else_: '' }
  })

  const condField = prevFields.find(f => f.name === cond.field)
  const availableOps = getOps(condField?.type)

  const updateCond = (patch: Partial<CondRow>) => {
    const next = { ...cond, ...patch }

    // When field changes: reset op to first valid op for new type, clear value
    if (patch.field !== undefined && patch.field !== cond.field) {
      const newField = prevFields.find(f => f.name === patch.field)
      const newOps = getOps(newField?.type)
      next.op = newOps[0].value
      next.value = ''
    }

    setCond(next)

    // Regenerate formula if the condition is complete
    if (next.field && next.op && next.then !== '') {
      onChange(buildIfFormula(next, prevFields.find(f => f.name === next.field), prevFields))
    }
  }

  // Live preview uses sample values (field names → their index as a number, or "sample" as text)
  const sampleValues = Object.fromEntries(
    prevFields.map((f, i) => [
      f.name,
      f.type === 'number' || f.type === 'decimal' || f.type === 'rating'
        ? i + 1
        : f.type === 'date'
          ? '2005-06-15'   // sample DOB so age()/ageAtLeast() previews are meaningful
          : f.type === 'time'
            ? '10:30'
            : f.options?.[0]?.value ?? f.name,
    ])
  )
  const preview = field.formula ? evalFormula(field.formula, sampleValues) : null
  const formulaValid = preview !== null

  const tabCls = (m: string) =>
    `px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
      mode === m ? 'bg-catalan-primary text-white' : 'text-catalan-textMuted hover:text-catalan-text hover:bg-catalan-hover'
    }`

  return (
    <div className="space-y-3">
      {/* Mode tabs */}
      <div className="flex gap-1 p-1 bg-catalan-hover rounded-lg w-fit">
        <button className={tabCls('arithmetic')}  onClick={() => setMode('arithmetic')}>Arithmetic</button>
        <button className={tabCls('conditional')} onClick={() => setMode('conditional')}>Conditional</button>
        <button className={tabCls('custom')}      onClick={() => setMode('custom')}>Custom</button>
      </div>

      {/* ── Arithmetic mode ── */}
      {mode === 'arithmetic' && (
        <div className="space-y-2 w-full min-w-0">
          {/* Formula input — full width, wraps inside the panel */}
          <textarea
            className={`${inputCls} font-mono text-sm w-full resize-y min-h-[3rem] break-words`}
            value={field.formula ?? ''}
            onChange={e => onChange(e.target.value)}
            placeholder="e.g.  area * rate + bonus"
          />

          {/* Insert helpers — wrap within the panel width */}
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value=""
              onChange={e => { if (e.target.value) onChange((field.formula ?? '') + (field.formula ? ' ' : '') + e.target.value) }}
              className="max-w-full text-xs bg-catalan-primary/10 border border-catalan-primary/20 text-catalan-primary rounded-md px-2 py-1 focus:outline-none cursor-pointer"
            >
              <option value="">+ insert field</option>
              {prevFields.map(f => <option key={f.id} value={f.name}>{f.label || f.name}</option>)}
            </select>

            {/* Age from a date-of-birth field */}
            {prevFields.some(f => f.type === 'date') && (
              <select
                value=""
                onChange={e => { if (e.target.value) onChange((field.formula ?? '') + (field.formula ? ' ' : '') + `age(${e.target.value})`) }}
                className="max-w-full text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 rounded-md px-2 py-1 focus:outline-none cursor-pointer"
                title="Insert age in completed years from a date field (to today)"
              >
                <option value="">+ age(date)</option>
                {prevFields.filter(f => f.type === 'date').map(f => <option key={f.id} value={f.name}>{f.label || f.name}</option>)}
              </select>
            )}

            {['+', '−', '×', '÷', 'round(', 'sum('].map(op => (
              <button
                key={op}
                type="button"
                onClick={() => onChange((field.formula ?? '') + (field.formula ? ' ' : '') + (op === '−' ? '-' : op === '×' ? '*' : op === '÷' ? '/' : op))}
                className="text-xs font-mono bg-catalan-hover border border-catalan-border rounded-md px-2 py-1 hover:border-catalan-primary"
              >{op}</button>
            ))}
          </div>

          <p className="text-xs text-catalan-textMuted break-words">
            Use field variable names. Supports <code className="bg-catalan-hover px-1 rounded">+ − × ÷</code>,&nbsp;
            <code className="bg-catalan-hover px-1 rounded">sum() round() abs() max() min()</code>, and&nbsp;
            <code className="bg-catalan-hover px-1 rounded">age(dob)</code> / <code className="bg-catalan-hover px-1 rounded">ageAtLeast(dob, 18, 11, 25)</code>.
          </p>
        </div>
      )}

      {/* ── Conditional mode ── */}
      {mode === 'conditional' && (
        <div className="bg-catalan-hover border border-catalan-border rounded-xl p-4 space-y-4">

          {/* IF row */}
          <div>
            <div className="text-xs font-bold text-catalan-primary mb-2 tracking-wider">IF</div>
            <div className="flex gap-2 items-center flex-wrap">
              {/* Field selector */}
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-catalan-textMuted">Field</span>
                <select
                  className={selCls}
                  value={cond.field}
                  onChange={e => updateCond({ field: e.target.value })}
                >
                  <option value="">-- pick field --</option>
                  {prevFields.map(f => (
                    <option key={f.id} value={f.name}>{f.label || f.name}</option>
                  ))}
                </select>
              </div>

              {/* Operator selector — adapts to field type */}
              {cond.field && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-catalan-textMuted">Condition</span>
                  <select
                    className={selCls}
                    value={cond.op}
                    onChange={e => updateCond({ op: e.target.value })}
                  >
                    {availableOps.map(op => (
                      <option key={op.value} value={op.value}>{op.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Value input — adapts to field type */}
              {cond.field && cond.op !== 'contains' && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-catalan-textMuted">
                    {condField?.type === 'single_choice' || condField?.type === 'multiple_choice'
                      ? 'Option'
                      : condField?.type === 'number' || condField?.type === 'decimal'
                        ? 'Number'
                        : condField?.type === 'date'
                          ? 'Date'
                          : 'Value'}
                  </span>
                  <CompareValueInput
                    condField={condField}
                    value={cond.value}
                    onChange={v => updateCond({ value: v })}
                  />
                </div>
              )}

              {/* "contains" shows a text input regardless */}
              {cond.field && cond.op === 'contains' && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-catalan-textMuted">Search text</span>
                  <input
                    type="text"
                    value={cond.value}
                    onChange={e => updateCond({ value: e.target.value })}
                    className="border border-catalan-border rounded-lg px-2 py-1.5 text-sm bg-catalan-bg text-catalan-text focus:outline-none focus:border-catalan-primary w-36"
                    placeholder="text to search"
                  />
                </div>
              )}
            </div>

            {/* Field type hint */}
            {condField && (
              <div className="mt-1.5 text-xs text-catalan-textMuted">
                <span className="bg-catalan-surface border border-catalan-border px-1.5 py-0.5 rounded font-mono mr-1">
                  {condField.type}
                </span>
                field
              </div>
            )}
          </div>

          {/* THEN row */}
          <div>
            <div className="text-xs font-bold text-catalan-success mb-2 tracking-wider">THEN show</div>
            <ExprInput
              label=""
              value={cond.then}
              prevFields={prevFields}
              onChange={v => updateCond({ then: v })}
            />
            <p className="text-xs text-catalan-textMuted mt-1">
              Can be a number, <code className="bg-catalan-bg px-1 rounded">"text in quotes"</code>, a field name, or an expression like <code className="bg-catalan-bg px-1 rounded">area * 2000</code>
            </p>
          </div>

          {/* ELSE row */}
          <div>
            <div className="text-xs font-bold text-catalan-textMuted mb-2 tracking-wider">OTHERWISE show</div>
            <ExprInput
              label=""
              value={cond.else_}
              prevFields={prevFields}
              onChange={v => updateCond({ else_: v })}
            />
          </div>

          {/* Generated formula preview */}
          {field.formula && (
            <div className="bg-catalan-bg border border-catalan-border rounded-lg px-3 py-2">
              <div className="text-xs text-catalan-textMuted mb-0.5">Generated formula</div>
              <code className="text-xs text-catalan-primary break-all">{field.formula}</code>
            </div>
          )}
        </div>
      )}

      {/* ── Custom / advanced mode ── */}
      {mode === 'custom' && (
        <div className="space-y-2">
          <textarea
            className={`${inputCls} font-mono text-xs resize-none`}
            rows={4}
            value={field.formula ?? ''}
            onChange={e => onChange(e.target.value)}
            placeholder={`Examples:\nif(crop_type == "paddy", area * 2000, area * 1500)\nif(land_size > 5, "Large farmer", "Small farmer")\nif(contains(crop_name, "wheat"), area * rate * 1.1, area * rate)\nsum(income_a, income_b, income_c)`}
          />
          <div className="text-xs text-catalan-textMuted space-y-1.5">
            <p className="font-medium text-catalan-text">Available helpers:</p>
            <div className="grid grid-cols-1 gap-y-1 font-mono text-xs">
              {[
                ['if(cond, then, else)',     'conditional — returns then or else'],
                ['contains(field, "text")',  'true if field text contains the string'],
                ['sum(a, b, c, …)',          'add multiple values'],
                ['round(n, decimals)',        'round to N decimal places'],
                ['abs(n)',                   'absolute value'],
                ['max(a, b, …)',             'largest value'],
                ['min(a, b, …)',             'smallest value'],
                ['concat(a, b, …)',          'join text together'],
                ['num(text)',                'convert text to number'],
                ['text(n)',                  'convert number to text'],
              ].map(([fn, desc]) => (
                <div key={fn} className="flex gap-2">
                  <code className="text-catalan-primary w-40 flex-shrink-0">{fn}</code>
                  <span className="text-catalan-textMuted">— {desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Live preview */}
      {field.formula && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border ${
          formulaValid
            ? 'bg-catalan-success/5 border-catalan-success/20'
            : 'bg-catalan-error/5 border-catalan-error/20'
        }`}>
          <span className={`text-xs font-medium flex-shrink-0 ${formulaValid ? 'text-catalan-success' : 'text-catalan-error'}`}>
            {formulaValid ? 'Preview (sample data):' : 'Formula error:'}
          </span>
          <span className={`font-mono font-bold text-sm ${formulaValid ? 'text-catalan-success' : 'text-catalan-error'}`}>
            {formulaValid ? String(preview) : 'invalid — check formula'}
          </span>
        </div>
      )}
    </div>
  )
}

// ── Repeat Group Child Field Editor ────────────────────────────────────────
function RepeatGroupChildEditor({ fields, onChange }: {
  fields: FormField[]
  onChange: (fields: FormField[]) => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const addChild = () => {
    const child: FormField = {
      id: uuidv4(),
      type: 'text',
      name: `child_${Math.random().toString(36).slice(2, 7)}`,
      label: '',
      required: false,
    }
    onChange([...fields, child])
    setExpandedId(child.id)
  }

  const updateChild = (id: string, patch: Partial<FormField>) =>
    onChange(fields.map(f => f.id === id ? { ...f, ...patch } : f))

  const deleteChild = (id: string) => {
    onChange(fields.filter(f => f.id !== id))
    if (expandedId === id) setExpandedId(null)
  }

  return (
    <div className="space-y-2">
      {fields.map((cf, idx) => {
        const isOpen = expandedId === cf.id
        return (
          <div key={cf.id} className="border border-catalan-border rounded-lg bg-catalan-bg overflow-hidden">
            <div
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-catalan-hover transition-colors"
              onClick={() => setExpandedId(isOpen ? null : cf.id)}
            >
              <span className="text-xs font-mono text-catalan-primary w-5 flex-shrink-0">{idx + 1}</span>
              <select
                value={cf.type}
                onClick={e => e.stopPropagation()}
                onChange={e => {
                  const newType = e.target.value as FieldType
                  const patch: Partial<FormField> = { type: newType }
                  if (newType === 'single_choice' || newType === 'multiple_choice') {
                    if (!cf.options?.length) patch.options = [{ value: 'option_1', label: 'Option 1' }]
                  } else {
                    patch.options = undefined
                  }
                  updateChild(cf.id, patch)
                }}
                className="text-xs border border-catalan-border rounded px-1.5 py-0.5 bg-catalan-surface text-catalan-text focus:outline-none focus:border-catalan-primary flex-shrink-0"
              >
                {CHILD_FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input
                value={cf.label}
                onClick={e => e.stopPropagation()}
                onChange={e => updateChild(cf.id, { label: e.target.value })}
                placeholder="Field label"
                className="flex-1 text-sm bg-transparent text-catalan-text placeholder-catalan-textMuted focus:outline-none min-w-0"
              />
              <button
                onClick={e => { e.stopPropagation(); deleteChild(cf.id) }}
                className="text-catalan-textMuted hover:text-catalan-error text-sm px-1 transition-colors flex-shrink-0"
              >✕</button>
              <span className="text-catalan-textMuted text-xs flex-shrink-0">{isOpen ? '▲' : '▼'}</span>
            </div>

            {isOpen && (
              <div className="border-t border-catalan-border px-3 py-3 space-y-3 bg-catalan-surface">
                <div>
                  <label className="block text-xs text-catalan-textMuted mb-1">Variable name</label>
                  <input
                    className={`${inputCls} font-mono text-xs`}
                    value={cf.name}
                    onChange={e => updateChild(cf.id, { name: e.target.value.replace(/\s+/g, '_').toLowerCase() })}
                    placeholder="snake_case_name"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateChild(cf.id, { required: !cf.required })}
                    className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${cf.required ? 'bg-catalan-primary' : 'bg-catalan-hover border border-catalan-border'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${cf.required ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                  <span className="text-xs text-catalan-text">Required</span>
                </div>

                {(cf.type === 'single_choice' || cf.type === 'multiple_choice') && (
                  <div>
                    <label className="block text-xs text-catalan-textMuted mb-1.5">Options</label>
                    <div className="space-y-1.5 mb-2">
                      {(cf.options ?? []).map((opt, oi) => (
                        <div key={oi} className="flex gap-1.5 items-center">
                          <input
                            className={`${inputCls} flex-1 text-xs`}
                            value={opt.label}
                            placeholder="Label"
                            onChange={e => {
                              const opts = (cf.options ?? []).map((o, i) => i === oi ? { ...o, label: e.target.value } : o)
                              updateChild(cf.id, { options: opts })
                            }}
                          />
                          <input
                            className={`${inputCls} w-24 text-xs font-mono`}
                            value={opt.value}
                            placeholder="value"
                            onChange={e => {
                              const opts = (cf.options ?? []).map((o, i) => i === oi ? { ...o, value: e.target.value } : o)
                              updateChild(cf.id, { options: opts })
                            }}
                          />
                          <button
                            onClick={() => updateChild(cf.id, { options: (cf.options ?? []).filter((_, i) => i !== oi) })}
                            className="text-catalan-textMuted hover:text-catalan-error text-xs px-1 transition-colors"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => updateChild(cf.id, { options: [...(cf.options ?? []), { value: `opt_${Date.now()}`, label: '' }] })}
                      className="text-xs text-catalan-primary hover:underline"
                    >+ Add option</button>
                  </div>
                )}

                {(cf.type === 'number' || cf.type === 'decimal' || cf.type === 'rating') && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-catalan-textMuted mb-1">Min</label>
                      <input type="number" className={`${inputCls} text-xs`} value={cf.min ?? ''}
                        onChange={e => updateChild(cf.id, { min: e.target.value === '' ? undefined : Number(e.target.value) })}
                        placeholder="No min" />
                    </div>
                    <div>
                      <label className="block text-xs text-catalan-textMuted mb-1">Max</label>
                      <input type="number" className={`${inputCls} text-xs`} value={cf.max ?? ''}
                        onChange={e => updateChild(cf.id, { max: e.target.value === '' ? undefined : Number(e.target.value) })}
                        placeholder="No max" />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs text-catalan-textMuted mb-1">Hint (optional)</label>
                  <input
                    className={`${inputCls} text-xs`}
                    value={cf.hint ?? ''}
                    placeholder="Helper text shown below the field"
                    onChange={e => updateChild(cf.id, { hint: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>
        )
      })}
      <button
        onClick={addChild}
        className="w-full text-xs border border-dashed border-catalan-border rounded-lg py-2.5 text-catalan-primary hover:border-catalan-primary hover:bg-catalan-primary/5 transition-colors"
      >
        + Add child field
      </button>
    </div>
  )
}

// ── Main FieldEditor ────────────────────────────────────────────────────────
export default function FieldEditor({ field, sections, onChange, onDelete }: Props) {
  const updateOption = (i: number, patch: Partial<FieldOption>) => {
    const options = (field.options ?? []).map((o, idx) => idx === i ? { ...o, ...patch } : o)
    onChange({ options })
  }
  const addOption    = () => onChange({ options: [...(field.options ?? []), { value: `option_${Date.now()}`, label: '' }] })
  const removeOption = (i: number) => onChange({ options: (field.options ?? []).filter((_, idx) => idx !== i) })

  const handleTypeChange = (newType: FieldType) => {
    if (newType === field.type) return
    const patch: Partial<FormField> = { type: newType, skipLogic: undefined }
    const choiceTypes = new Set<FieldType>(['single_choice', 'multiple_choice'])
    if (!choiceTypes.has(newType)) patch.options = undefined
    if (newType !== 'calculated') patch.formula = undefined
    if (!['number', 'decimal', 'rating'].includes(newType)) { patch.min = undefined; patch.max = undefined }
    if (choiceTypes.has(newType) && !choiceTypes.has(field.type)) patch.options = []
    onChange(patch)
  }

  // Preceding fields (for formula builder + skip logic)
  const prevFields = (() => {
    const result: FormField[] = []
    const traverse = (secs: FormSection[]): boolean => {
      for (const sec of secs) {
        for (const f of sec.fields) {
          if (f.id === field.id) return true
          if (f.type !== 'note') result.push(f)
        }
        if (sec.subsections?.length && traverse(sec.subsections)) return true
      }
      return false
    }
    traverse(sections)
    return result
  })()

  return (
    <div className="p-5 sm:p-6 max-w-2xl">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <select
          value={field.type}
          onChange={e => handleTypeChange(e.target.value as FieldType)}
          className="text-xs font-semibold text-catalan-primary bg-catalan-primary/10 border border-catalan-primary/20 px-2.5 py-1 rounded-md focus:outline-none focus:border-catalan-primary cursor-pointer hover:bg-catalan-primary/20 transition-colors"
        >
          {FIELD_TYPES.map(ft => <option key={ft.value} value={ft.value}>{ft.label}</option>)}
        </select>
        <button onClick={onDelete} className="text-xs px-3 py-1.5 rounded-lg border border-catalan-error/30 text-catalan-error hover:bg-catalan-error/10 transition-colors">
          Delete field
        </button>
      </div>

      {/* Label */}
      <div className={groupCls}>
        <label className={labelCls}>Label <span className="text-catalan-error normal-case">*</span></label>
        <input className={inputCls} value={field.label} onChange={e => onChange({ label: e.target.value })} placeholder="Question text shown to enumerator" />
      </div>

      {/* Variable name */}
      <div className={groupCls}>
        <label className={labelCls}>Variable name <span className="text-catalan-textMuted/60 normal-case font-normal">(for export)</span></label>
        <input className={`${inputCls} font-mono`} value={field.name} onChange={e => onChange({ name: e.target.value.replace(/\s+/g, '_').toLowerCase() })} placeholder="snake_case_name" />
        <p className="text-xs text-catalan-textMuted mt-1">Used as the column header in CSV/Excel exports.</p>
      </div>

      {/* Hint */}
      <div className={groupCls}>
        <label className={labelCls}>Hint <span className="text-catalan-textMuted/60 normal-case font-normal">(optional)</span></label>
        <input className={inputCls} value={field.hint ?? ''} onChange={e => onChange({ hint: e.target.value })} placeholder="Helper text shown below the question" />
      </div>

      {/* Required toggle */}
      <div className={`${groupCls} flex items-center gap-3`}>
        <button
          onClick={() => onChange({ required: !field.required })}
          className={`relative w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none ${field.required ? 'bg-catalan-primary' : 'bg-catalan-hover border border-catalan-border'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${field.required ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
        <span className="text-sm text-catalan-text">Required</span>
        {field.required && <span className="text-xs text-catalan-error bg-catalan-error/10 px-2 py-0.5 rounded">Must be answered</span>}
      </div>

      {/* Date / Time — auto-fill with current date/time */}
      {(field.type === 'date' || field.type === 'time') && (
        <div className={`${groupCls} flex items-center gap-3`}>
          <button
            onClick={() => onChange({ autoNow: !field.autoNow })}
            className={`relative w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none ${field.autoNow ? 'bg-catalan-primary' : 'bg-catalan-hover border border-catalan-border'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${field.autoNow ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
          <span className="text-sm text-catalan-text">
            Auto-fill with {field.type === 'date' ? "today's date" : 'the current time'}
          </span>
          <span className="text-xs text-catalan-textMuted">enumerator can still change it</span>
        </div>
      )}

      {/* Number / Decimal / Rating — Range */}
      {(field.type === 'number' || field.type === 'decimal' || field.type === 'rating') && (
        <div className={groupCls}>
          <label className={labelCls}>Range</label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-catalan-textMuted mb-1 block">Min</label>
              <input className={inputCls} type="number" value={field.min ?? ''} onChange={e => onChange({ min: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="No minimum" />
            </div>
            <div>
              <label className="text-xs text-catalan-textMuted mb-1 block">Max</label>
              <input className={inputCls} type="number" value={field.max ?? ''} onChange={e => onChange({ max: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="No maximum" />
            </div>
          </div>
        </div>
      )}

      {/* Calculated — Formula Builder */}
      {field.type === 'calculated' && (
        <div className={groupCls}>
          <label className={labelCls}>Formula / Condition</label>
          {prevFields.length === 0 ? (
            <p className="text-xs text-catalan-textMuted italic">Add preceding questions first to reference them here.</p>
          ) : (
            <FormulaBuilder
              field={field}
              prevFields={prevFields}
              onChange={formula => onChange({ formula })}
            />
          )}
        </div>
      )}

      {/* Note */}
      {field.type === 'note' && (
        <div className={groupCls}>
          <label className={labelCls}>Note text</label>
          <textarea className={`${inputCls} resize-none`} rows={3} value={field.hint ?? ''} onChange={e => onChange({ hint: e.target.value })} placeholder="Instructional text displayed to the enumerator…" />
        </div>
      )}

      {/* Repeat Group — max entries + child fields */}
      {field.type === 'repeat_group' && (
        <>
          <div className={groupCls}>
            <label className={labelCls}>Max Entries <span className="normal-case font-normal text-catalan-textMuted">(optional)</span></label>
            <input
              type="number"
              className={inputCls}
              min={1}
              value={field.max ?? ''}
              placeholder="No limit"
              onChange={e => onChange({ max: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
            <p className="text-xs text-catalan-textMuted mt-1">Leave blank to allow unlimited repetitions per submission.</p>
          </div>
          <div className={groupCls}>
            <label className={labelCls}>Child Fields</label>
            <p className="text-xs text-catalan-textMuted mb-3">
              Define the fields collected per row. Each enumerator can add as many rows as needed.
            </p>
            <RepeatGroupChildEditor
              fields={field.fields ?? []}
              onChange={fields => onChange({ fields })}
            />
          </div>
        </>
      )}

      {/* Single / Multiple choice — Options */}
      {(field.type === 'single_choice' || field.type === 'multiple_choice') && (
        <div className={groupCls}>
          <label className={labelCls}>Options</label>
          <div className="space-y-2 mb-3">
            {(field.options ?? []).map((opt, i) => (
              <div key={opt.value || i} className="flex gap-2 items-center">
                <input className={`${inputCls} flex-1`} value={opt.label} placeholder="Option label" onChange={e => updateOption(i, { label: e.target.value })} />
                <input className={`${inputCls} w-32 font-mono text-xs`} value={opt.value} placeholder="value" onChange={e => updateOption(i, { value: e.target.value })} />
                <button onClick={() => removeOption(i)} className="w-8 h-8 flex items-center justify-center rounded-lg text-catalan-textMuted hover:text-catalan-error hover:bg-catalan-error/10 transition-colors flex-shrink-0 text-sm">✕</button>
              </div>
            ))}
          </div>
          <button onClick={addOption} className="text-xs px-3 py-2 rounded-lg border border-dashed border-catalan-border text-catalan-primary hover:border-catalan-primary hover:bg-catalan-primary/5 transition-colors w-full">+ Add Option</button>
          {(field.options ?? []).length === 0 && <p className="text-xs text-catalan-warning mt-2">Add at least one option.</p>}
        </div>
      )}

      {/* Skip Logic (not for note or calculated) */}
      {field.type !== 'note' && field.type !== 'calculated' && (
        <div className={groupCls}>
          <div className="flex items-center justify-between mb-1.5">
            <label className={labelCls + ' mb-0'}>Skip Logic</label>
            {field.skipLogic && (
              <button
                onClick={() => onChange({ skipLogic: undefined })}
                className="text-xs px-2.5 py-0.5 bg-catalan-error/10 border border-catalan-error/30 text-catalan-error hover:bg-catalan-error/20 rounded-lg font-medium transition-colors flex items-center gap-1"
                title="Remove skip logic from this field"
              >
                ✕ Remove condition
              </button>
            )}
          </div>
          {field.skipLogic && (
            <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 bg-catalan-warning/10 border border-catalan-warning/20 rounded-lg">
              <span className="text-catalan-warning text-xs"><EmojiIcon e="⚡" /></span>
              <span className="text-xs text-catalan-warning">
                This field is conditionally {field.skipLogic.action === 'show' ? 'shown' : 'skipped'}.
              </span>
            </div>
          )}
          <div className="bg-catalan-hover border border-catalan-border rounded-lg p-3">
            <SkipLogicEditor field={field} sections={sections} onChange={sl => onChange({ skipLogic: sl })} />
          </div>
        </div>
      )}
    </div>
  )
}
