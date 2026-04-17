import type { FormField, FormSection, SkipLogic, SkipCondition, ConditionGroup } from '@/types/form'
import { isConditionGroup } from '@/types/form'

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

const selCls = 'bg-catalan-bg border border-catalan-border text-catalan-text rounded-md px-2 py-1 text-xs focus:outline-none focus:border-catalan-primary'
const inpCls = 'flex-1 bg-catalan-bg border border-catalan-border text-catalan-text rounded-md px-2 py-1 text-xs focus:outline-none focus:border-catalan-primary placeholder-catalan-textMuted min-w-0'

function makeCondition(allFields: FormField[]): SkipCondition {
  return { field: allFields[0]?.name ?? '', operator: 'eq', value: '' }
}
function makeGroup(allFields: FormField[]): ConditionGroup {
  return { logic: 'OR', conditions: [makeCondition(allFields)] }
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
  const needsValue = !VALUELESS_OPERATORS.has(condition.operator)
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
          onUpdate(patch)
        }}
      >
        {OPERATORS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
      </select>
      {needsValue && (
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
            key={i} group={c} allFields={allFields} depth={depth + 1}
            onUpdate={g => updateItem(i, () => g)}
            onRemove={() => updateItem(i, () => null)}
          />
        ) : (
          <ConditionRow
            key={i} condition={c} allFields={allFields}
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

/* ─── Main Editor ─── */
export default function SkipLogicEditor({ field, sections, onChange, prevFieldsOverride }: Props) {
  // If prevFieldsOverride is supplied (e.g. section-level logic), use it directly.
  // Otherwise compute fields that appear before `field` in document order.
  const allFields = prevFieldsOverride ?? (() => {
    const result: FormField[] = []
    const traverse = (secs: FormSection[]): boolean => {
      for (const sec of secs) {
        for (const f of sec.fields) {
          if (f.id === field.id) return true
          result.push(f)
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

  if (!logic) {
    if (allFields.length === 0) {
      return (
        <p className="text-xs text-catalan-textMuted italic">
          Skip logic requires at least one preceding question.
        </p>
      )
    }
    return (
      <button
        onClick={enable}
        className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-catalan-border text-catalan-textMuted hover:text-catalan-primary hover:border-catalan-primary/50 transition-colors"
      >
        + Add Skip Logic
      </button>
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
            key={i} group={c} allFields={allFields} depth={0}
            onUpdate={g => updateItem(i, () => g)}
            onRemove={() => updateItem(i, () => null)}
          />
        ) : (
          <ConditionRow
            key={i} condition={c} allFields={allFields}
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
          className="text-xs px-3 py-1 rounded-lg bg-catalan-error/10 border border-catalan-error/30 text-catalan-error hover:bg-catalan-error/20 font-medium transition-colors ml-auto flex items-center gap-1"
          onClick={disable}
          title="Remove all conditions and turn off skip logic"
        >
          ✕ Remove skip logic
        </button>
      </div>
    </div>
  )
}
