import { useState } from 'react'
import api from '@/lib/api'
import type { FormField, FormSection, SkipLogic, SkipCondition, ConditionGroup } from '@/types/form'
import { isConditionGroup } from '@/types/form'
import EmojiIcon from '@/components/EmojiIcon'

interface AiSuggestion {
  logic: 'AND' | 'OR'; action: 'show' | 'skip'
  conditions: { field: string; operator: SkipCondition['operator']; value?: string }[]
  explanation: string
}

async function fetchAiSuggestions(fieldLabel: string, fields: FormField[], description: string): Promise<AiSuggestion[]> {
  const res = await api.post('/ai/suggest-skip-logic', {
    question_text: fieldLabel,
    user_description: description,
    form_fields: fields.map(f => ({ id: f.id, name: f.name, label: f.label, type: f.type, options: f.options })),
  })
  return res.data.suggestions ?? []
}

interface Props {
  field: FormField
  sections: FormSection[]
  onChange: (skipLogic: SkipLogic | undefined) => void
  /** When provided, use these as the available fields instead of auto-computing from sections. */
  prevFieldsOverride?: FormField[]
}

const OPERATORS: { value: SkipCondition['operator']; label: string }[] = [
  { value: 'eq',           label: '= equals' },
  { value: 'neq',          label: '≠ not equals' },
  { value: 'gt',           label: '> greater than' },
  { value: 'lt',           label: '< less than' },
  { value: 'gte',          label: '≥ gte' },
  { value: 'lte',          label: '≤ lte' },
  { value: 'contains',     label: 'contains' },
  { value: 'is_empty',     label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

const VALUELESS_OPERATORS = new Set(['is_empty', 'is_not_empty'])

// Age operators only apply to date fields (treat the date as a DOB).
const AGE_OPERATORS: { value: SkipCondition['operator']; label: string }[] = [
  { value: 'age_gte', label: 'age is at least' },
  { value: 'age_lt',  label: 'age is under' },
]

/** Parse "Y|M|D" → [years, months, days]. */
function parseAge(v?: string | number): [number, number, number] {
  const p = String(v ?? '').split('|').map(n => parseInt(n, 10) || 0)
  return [p[0] || 0, p[1] || 0, p[2] || 0]
}

const selCls = 'bg-catalan-bg border border-catalan-border text-catalan-text rounded-md px-2 py-1 text-xs focus:outline-none focus:border-catalan-primary'
const inpCls = 'flex-1 bg-catalan-bg border border-catalan-border text-catalan-text rounded-md px-2 py-1 text-xs focus:outline-none focus:border-catalan-primary placeholder-catalan-textMuted min-w-0'

function makeCondition(allFields: FormField[]): SkipCondition {
  return { _key: crypto.randomUUID(), field: allFields[0]?.name ?? '', operator: 'eq', value: '' }
}
function makeGroup(allFields: FormField[]): ConditionGroup {
  return { _key: crypto.randomUUID(), logic: 'OR', conditions: [makeCondition(allFields)] }
}

function updateAtPath(
  conditions: (SkipCondition | ConditionGroup)[],
  path: number[],
  updater: (item: SkipCondition | ConditionGroup) => SkipCondition | ConditionGroup | null,
): (SkipCondition | ConditionGroup)[] {
  if (path.length === 1) {
    const result = updater(conditions[path[0]])
    if (result === null) return conditions.filter((_, i) => i !== path[0])
    return conditions.map((c, i) => (i === path[0] ? result : c))
  }
  const [head, ...rest] = path
  return conditions.map((c, i) => {
    if (i !== head || !isConditionGroup(c)) return c
    return { ...c, conditions: updateAtPath(c.conditions, rest, updater) }
  })
}

/* ─── Condition Row ─── */
function ConditionRow({ condition, allFields, onUpdate, onRemove }: {
  condition: SkipCondition
  allFields: FormField[]
  onUpdate: (patch: Partial<SkipCondition>) => void
  onRemove: () => void
}) {
  const selField = allFields.find(f => f.name === condition.field)
  const isDate = selField?.type === 'date'
  const isAgeOp = condition.operator === 'age_gte' || condition.operator === 'age_lt'
  const operatorList = isDate ? [...OPERATORS, ...AGE_OPERATORS] : OPERATORS
  const needsValue = !VALUELESS_OPERATORS.has(condition.operator)
  const [ay, am, ad] = parseAge(condition.value)
  const setAge = (y: number, m: number, d: number) => onUpdate({ value: `${y}|${m}|${d}` })
  return (
    <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
      <select
        className={selCls}
        value={condition.field}
        onChange={e => onUpdate({ field: e.target.value })}
      >
        {allFields.map(f => <option key={f.id} value={f.name}>{f.label || f.name}</option>)}
      </select>
      <select
        className={selCls}
        value={condition.operator}
        onChange={e => {
          const op = e.target.value as SkipCondition['operator']
          const patch: Partial<SkipCondition> = { operator: op }
          if (VALUELESS_OPERATORS.has(op)) patch.value = undefined
          if (op === 'age_gte' || op === 'age_lt') patch.value = '18|0|0'
          onUpdate(patch)
        }}
      >
        {operatorList.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
      </select>
      {isAgeOp ? (
        <span className="flex items-center gap-1">
          <input type="number" min={0} className={`${inpCls} w-14`} value={ay} onChange={e => setAge(parseInt(e.target.value) || 0, am, ad)} title="years" />
          <span className="text-xs text-catalan-textMuted">y</span>
          <input type="number" min={0} max={11} className={`${inpCls} w-12`} value={am} onChange={e => setAge(ay, parseInt(e.target.value) || 0, ad)} title="months" />
          <span className="text-xs text-catalan-textMuted">m</span>
          <input type="number" min={0} max={30} className={`${inpCls} w-12`} value={ad} onChange={e => setAge(ay, am, parseInt(e.target.value) || 0)} title="days" />
          <span className="text-xs text-catalan-textMuted">d</span>
        </span>
      ) : needsValue && (
        <input
          className={inpCls}
          value={condition.value != null ? String(condition.value) : ''}
          onChange={e => onUpdate({ value: e.target.value })}
          placeholder="value"
        />
      )}
      <button
        onClick={onRemove}
        className="w-6 h-6 flex items-center justify-center rounded text-catalan-textMuted hover:text-catalan-error hover:bg-catalan-error/10 transition-colors text-xs flex-shrink-0"
        title="Remove condition"
      >
        ✕
      </button>
    </div>
  )
}

/* ─── Nested Group ─── */
function GroupEditor({ group, allFields, depth, onUpdate, onRemove }: {
  group: ConditionGroup
  allFields: FormField[]
  depth: number
  onUpdate: (g: ConditionGroup) => void
  onRemove: () => void
}) {
  const updateItem = (i: number, updater: (item: SkipCondition | ConditionGroup) => SkipCondition | ConditionGroup | null) => {
    onUpdate({ ...group, conditions: updateAtPath(group.conditions, [i], updater) })
  }

  return (
    <div className={`border border-catalan-border/60 rounded-lg p-2.5 mb-2 bg-catalan-bg/40 ${depth > 0 ? 'ml-4' : ''}`}>
      <div className="flex items-center gap-2 mb-2 text-xs text-catalan-textMuted">
        <span>Group:</span>
        <select
          className={selCls}
          value={group.logic}
          onChange={e => onUpdate({ ...group, logic: e.target.value as 'AND' | 'OR' })}
        >
          <option value="AND">ALL match (AND)</option>
          <option value="OR">ANY matches (OR)</option>
        </select>
        <div className="flex-1" />
        <button
          onClick={onRemove}
          className="text-catalan-textMuted hover:text-catalan-error text-xs transition-colors"
          title="Remove group"
        >
          ✕ group
        </button>
      </div>

      {group.conditions.map((c, i) =>
        isConditionGroup(c) ? (
          <GroupEditor
            key={c._key ?? i} group={c} allFields={allFields} depth={depth + 1}
            onUpdate={g => updateItem(i, () => g)}
            onRemove={() => updateItem(i, () => null)}
          />
        ) : (
          <ConditionRow
            key={c._key ?? i} condition={c} allFields={allFields}
            onUpdate={patch => updateItem(i, prev => ({ ...(prev as SkipCondition), ...patch }))}
            onRemove={() => updateItem(i, () => null)}
          />
        )
      )}

      <div className="flex gap-2 mt-2">
        <button
          className="text-xs px-2 py-1 rounded border border-catalan-border text-catalan-textMuted hover:text-catalan-primary hover:border-catalan-primary/50 transition-colors"
          onClick={() => onUpdate({ ...group, conditions: [...group.conditions, makeCondition(allFields)] })}
        >
          + Condition
        </button>
        {depth < 2 && (
          <button
            className="text-xs px-2 py-1 rounded border border-catalan-border text-catalan-textMuted hover:text-catalan-primary hover:border-catalan-primary/50 transition-colors"
            onClick={() => onUpdate({ ...group, conditions: [...group.conditions, makeGroup(allFields)] })}
          >
            + Sub-group
          </button>
        )}
      </div>
    </div>
  )
}

/* ─── AI Panel ─── */
function AiSkipPanel({ field, allFields, onApply, onClose }: {
  field: FormField; allFields: FormField[]
  onApply: (s: AiSuggestion) => void; onClose: () => void
}) {
  const [desc, setDesc] = useState('')
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([])
  const [error, setError] = useState('')

  const run = async () => {
    if (!desc.trim()) return
    setLoading(true); setError(''); setSuggestions([])
    try {
      const results = await fetchAiSuggestions(field.label || field.name, allFields, desc)
      if (results.length === 0) setError('No suggestions returned — try rephrasing.')
      else setSuggestions(results)
    } catch (e: any) {
      setError(e.response?.data?.detail || 'AI request failed')
    } finally { setLoading(false) }
  }

  return (
    <div className="mt-2 p-3 bg-catalan-hover border border-catalan-primary/30 rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-catalan-primary">AI Skip Logic Assistant</span>
        <button onClick={onClose} className="text-xs text-catalan-textMuted hover:text-catalan-text">✕</button>
      </div>
      <textarea
        className="w-full bg-catalan-bg border border-catalan-border rounded-md px-2.5 py-1.5 text-xs text-catalan-text placeholder-catalan-textMuted focus:outline-none focus:border-catalan-primary resize-none"
        rows={2}
        placeholder={`e.g. "Show this only if the respondent is female" or "Skip if income is above 50000"`}
        value={desc}
        onChange={e => setDesc(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run() } }}
      />
      <button onClick={run} disabled={loading || !desc.trim()}
        className="text-xs px-3 py-1.5 bg-catalan-primary text-catalan-bg rounded-lg font-medium hover:opacity-90 disabled:opacity-40">
        {loading ? 'Thinking…' : 'Generate Rules'}
      </button>
      {error && <p className="text-xs text-catalan-error">{error}</p>}
      {suggestions.map((s, i) => (
        <div key={i} className="p-2.5 bg-catalan-surface border border-catalan-border rounded-lg space-y-1.5">
          <p className="text-xs text-catalan-textMuted italic">{s.explanation}</p>
          <div className="flex flex-wrap gap-1">
            <span className="text-xs px-1.5 py-0.5 rounded bg-catalan-primary/10 text-catalan-primary font-mono">
              {s.action === 'show' ? 'Show if' : 'Skip if'}
            </span>
            {s.conditions.map((c, ci) => (
              <span key={ci} className="text-xs px-1.5 py-0.5 rounded bg-catalan-hover border border-catalan-border font-mono">
                {c.field} {c.operator} {c.value ?? ''}
              </span>
            ))}
          </div>
          <button onClick={() => { onApply(s); onClose() }}
            className="text-xs px-2.5 py-1 bg-catalan-primary text-catalan-bg rounded font-medium hover:opacity-90">
            Apply this rule
          </button>
        </div>
      ))}
    </div>
  )
}

/* ─── Main Editor ─── */
export default function SkipLogicEditor({ field, sections, onChange, prevFieldsOverride }: Props) {
  const [showAi, setShowAi] = useState(false)

  // If prevFieldsOverride is supplied (e.g. section-level logic), use it directly.
  // Otherwise compute fields that appear before `field` in document order.
  const allFields = prevFieldsOverride ?? (() => {
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
  const logic = field.skipLogic

  const enable = () => {
    if (allFields.length === 0) return  // no preceding fields to reference
    onChange({ logic: 'AND', action: 'show', conditions: [makeCondition(allFields)] })
  }
  const disable = () => onChange(undefined)
  const updateLogic = (patch: Partial<SkipLogic>) => onChange({ ...logic!, ...patch })
  const updateItem = (i: number, updater: (item: SkipCondition | ConditionGroup) => SkipCondition | ConditionGroup | null) => {
    updateLogic({ conditions: updateAtPath(logic!.conditions, [i], updater) })
  }

  const applyAiSuggestion = (s: AiSuggestion) => {
    const conditions: SkipCondition[] = s.conditions.map(c => ({
      _key: crypto.randomUUID(),
      field: c.field,
      operator: c.operator,
      value: c.value ?? '',
    }))
    onChange({ logic: s.logic, action: s.action, conditions })
  }

  if (!logic) {
    if (allFields.length === 0) {
      return (
        <p className="text-xs text-catalan-textMuted italic">
          Skip logic requires at least one preceding question.
        </p>
      )
    }
    return (
      <div>
        <div className="flex gap-2">
          <button
            onClick={enable}
            className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-catalan-border text-catalan-textMuted hover:text-catalan-primary hover:border-catalan-primary/50 transition-colors"
          >
            + Add Skip Logic
          </button>
          <button
            onClick={() => setShowAi(v => !v)}
            className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-catalan-primary/40 text-catalan-primary/70 hover:border-catalan-primary hover:text-catalan-primary transition-colors"
          >
            <EmojiIcon e="🤖" /> AI Suggest
          </button>
        </div>
        {showAi && (
          <AiSkipPanel field={field} allFields={allFields}
            onApply={applyAiSuggestion} onClose={() => setShowAi(false)} />
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Action + top-level logic selectors */}
      <div className="flex items-center gap-2 mb-3 flex-wrap text-xs text-catalan-textMuted">
        <span>Action:</span>
        <select
          className={selCls}
          value={logic.action}
          onChange={e => updateLogic({ action: e.target.value as 'show' | 'skip' })}
        >
          <option value="show">Show this field if</option>
          <option value="skip">Skip this field if</option>
        </select>
        <select
          className={selCls}
          value={logic.logic}
          onChange={e => updateLogic({ logic: e.target.value as 'AND' | 'OR' })}
        >
          <option value="AND">ALL conditions match</option>
          <option value="OR">ANY condition matches</option>
        </select>
      </div>

      {/* Conditions */}
      {logic.conditions.map((c, i) =>
        isConditionGroup(c) ? (
          <GroupEditor
            key={c._key ?? i} group={c} allFields={allFields} depth={0}
            onUpdate={g => updateItem(i, () => g)}
            onRemove={() => updateItem(i, () => null)}
          />
        ) : (
          <ConditionRow
            key={c._key ?? i} condition={c} allFields={allFields}
            onUpdate={patch => updateItem(i, prev => ({ ...(prev as SkipCondition), ...patch }))}
            onRemove={() => updateItem(i, () => null)}
          />
        )
      )}

      {/* Action buttons */}
      <div className="flex gap-2 mt-3 flex-wrap items-center">
        <button
          className="text-xs px-2.5 py-1 rounded border border-catalan-border text-catalan-textMuted hover:text-catalan-primary hover:border-catalan-primary/50 transition-colors"
          onClick={() => updateLogic({ conditions: [...logic.conditions, makeCondition(allFields)] })}
        >
          + Condition
        </button>
        <button
          className="text-xs px-2.5 py-1 rounded border border-catalan-border text-catalan-textMuted hover:text-catalan-primary hover:border-catalan-primary/50 transition-colors"
          onClick={() => updateLogic({ conditions: [...logic.conditions, makeGroup(allFields)] })}
        >
          + Group
        </button>
        <button
          className="text-xs px-2.5 py-1 rounded border border-dashed border-catalan-primary/40 text-catalan-primary/70 hover:border-catalan-primary hover:text-catalan-primary transition-colors"
          onClick={() => setShowAi(v => !v)}
        >
          <EmojiIcon e="🤖" /> AI
        </button>
        <button
          className="text-xs px-3 py-1 rounded-lg bg-catalan-error/10 border border-catalan-error/30 text-catalan-error hover:bg-catalan-error/20 font-medium transition-colors ml-auto flex items-center gap-1"
          onClick={disable}
          title="Remove all conditions and turn off skip logic"
        >
          ✕ Remove skip logic
        </button>
      </div>
      {showAi && (
        <AiSkipPanel field={field} allFields={allFields}
          onApply={s => { applyAiSuggestion(s); setShowAi(false) }}
          onClose={() => setShowAi(false)} />
      )}
    </div>
  )
}
