import React from 'react'
import type { FormField, FormSection, SkipLogic, SkipCondition, ConditionGroup } from '@/types/form'
import { isConditionGroup } from '@/types/form'

interface Props {
  field: FormField
  sections: FormSection[]
  onChange: (skipLogic: SkipLogic | undefined) => void
}

const OPERATORS: { value: SkipCondition['operator']; label: string }[] = [
  { value: 'eq', label: '= equals' },
  { value: 'neq', label: '\u2260 not equals' },
  { value: 'gt', label: '> greater than' },
  { value: 'lt', label: '< less than' },
  { value: 'gte', label: '\u2265 gte' },
  { value: 'lte', label: '\u2264 lte' },
  { value: 'contains', label: 'contains' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

const VALUELESS_OPERATORS: Set<string> = new Set(['is_empty', 'is_not_empty'])

const st: Record<string, React.CSSProperties> = {
  row: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 },
  sel: { background: '#2a2a3e', border: '1px solid #3a3a5c', color: '#cdd6f4', borderRadius: 6, padding: '4px 8px', fontSize: 12 },
  inp: { background: '#2a2a3e', border: '1px solid #3a3a5c', color: '#cdd6f4', borderRadius: 6, padding: '4px 8px', fontSize: 12, flex: 1 },
  btn: { background: '#3a3a5c', border: 'none', color: '#89b4fa', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
  del: { background: 'none', border: 'none', color: '#f38ba8', cursor: 'pointer', fontSize: 14 },
  groupBox: {
    border: '1px solid #3a3a5c', borderRadius: 8, padding: '8px 10px',
    marginBottom: 6, background: '#1a1a2e',
  },
  groupHeader: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, fontSize: 11, color: '#a6adc8' },
}

function makeCondition(allFields: FormField[]): SkipCondition {
  return { field: allFields[0]?.name ?? '', operator: 'eq', value: '' }
}

function makeGroup(allFields: FormField[]): ConditionGroup {
  return { logic: 'OR', conditions: [makeCondition(allFields)] }
}

/** Immutable deep-update helper: update an item at `path` inside a nested conditions array. */
function updateAtPath(
  conditions: (SkipCondition | ConditionGroup)[],
  path: number[],
  updater: (item: SkipCondition | ConditionGroup) => SkipCondition | ConditionGroup | null,
): (SkipCondition | ConditionGroup)[] {
  if (path.length === 1) {
    const result = updater(conditions[path[0]])
    if (result === null) return conditions.filter((_, i) => i !== path[0])
    return conditions.map((c, i) => i === path[0] ? result : c)
  }
  const [head, ...rest] = path
  return conditions.map((c, i) => {
    if (i !== head || !isConditionGroup(c)) return c
    return { ...c, conditions: updateAtPath(c.conditions, rest, updater) }
  })
}

/* ─── Condition Row ─── */
function ConditionRow({
  condition, allFields, onUpdate, onRemove,
}: {
  condition: SkipCondition
  allFields: FormField[]
  onUpdate: (patch: Partial<SkipCondition>) => void
  onRemove: () => void
}) {
  const needsValue = !VALUELESS_OPERATORS.has(condition.operator)
  return (
    <div style={st.row}>
      <select style={st.sel} value={condition.field}
        onChange={e => onUpdate({ field: e.target.value })}>
        {allFields.map(f => <option key={f.id} value={f.name}>{f.label || f.name}</option>)}
      </select>
      <select style={st.sel} value={condition.operator}
        onChange={e => {
          const op = e.target.value as SkipCondition['operator']
          const patch: Partial<SkipCondition> = { operator: op }
          if (VALUELESS_OPERATORS.has(op)) patch.value = undefined
          onUpdate(patch)
        }}>
        {OPERATORS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
      </select>
      {needsValue && (
        <input style={st.inp} value={condition.value != null ? String(condition.value) : ''}
          onChange={e => onUpdate({ value: e.target.value })} placeholder="value" />
      )}
      <button style={st.del} onClick={onRemove}>{'\u2715'}</button>
    </div>
  )
}

/* ─── Nested Group ─── */
function GroupEditor({
  group, allFields, depth, onUpdate, onRemove,
}: {
  group: ConditionGroup
  allFields: FormField[]
  depth: number
  onUpdate: (g: ConditionGroup) => void
  onRemove: () => void
}) {
  const updateItem = (i: number, updater: (item: SkipCondition | ConditionGroup) => SkipCondition | ConditionGroup | null) => {
    const newConds = updateAtPath(group.conditions, [i], updater)
    onUpdate({ ...group, conditions: newConds })
  }

  return (
    <div style={{ ...st.groupBox, marginLeft: depth > 0 ? 12 : 0 }}>
      <div style={st.groupHeader}>
        <span>Group:</span>
        <select style={{ ...st.sel, fontSize: 11 }} value={group.logic}
          onChange={e => onUpdate({ ...group, logic: e.target.value as 'AND' | 'OR' })}>
          <option value="AND">ALL match (AND)</option>
          <option value="OR">ANY matches (OR)</option>
        </select>
        <div style={{ flex: 1 }} />
        <button style={st.del} onClick={onRemove} title="Remove group">{'\u2715'}</button>
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

      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button style={{ ...st.btn, fontSize: 11 }}
          onClick={() => onUpdate({ ...group, conditions: [...group.conditions, makeCondition(allFields)] })}>
          + Condition
        </button>
        {depth < 2 && (
          <button style={{ ...st.btn, fontSize: 11 }}
            onClick={() => onUpdate({ ...group, conditions: [...group.conditions, makeGroup(allFields)] })}>
            + Sub-group
          </button>
        )}
      </div>
    </div>
  )
}

/* ─── Main Editor ─── */
export default function SkipLogicEditor({ field, sections, onChange }: Props) {
  const allFields = sections.flatMap(sec => sec.fields).filter(f => f.id !== field.id)
  const logic = field.skipLogic

  const enable = () => onChange({
    logic: 'AND', action: 'show',
    conditions: [makeCondition(allFields)],
  })

  const disable = () => onChange(undefined)

  const updateLogic = (patch: Partial<SkipLogic>) => onChange({ ...logic!, ...patch })

  const updateItem = (i: number, updater: (item: SkipCondition | ConditionGroup) => SkipCondition | ConditionGroup | null) => {
    const newConds = updateAtPath(logic!.conditions, [i], updater)
    updateLogic({ conditions: newConds })
  }

  if (!logic) {
    return <button onClick={enable} style={st.btn}>+ Add Skip Logic</button>
  }

  return (
    <div style={{ marginTop: 8 }}>
      {/* Action + top-level logic */}
      <div style={{ ...st.row, marginBottom: 10 }}>
        <span style={{ color: '#a6adc8', fontSize: 12 }}>Action:</span>
        <select style={st.sel} value={logic.action}
          onChange={e => updateLogic({ action: e.target.value as 'show' | 'skip' })}>
          <option value="show">Show this field if</option>
          <option value="skip">Skip this field if</option>
        </select>
        <select style={st.sel} value={logic.logic}
          onChange={e => updateLogic({ logic: e.target.value as 'AND' | 'OR' })}>
          <option value="AND">ALL conditions match</option>
          <option value="OR">ANY condition matches</option>
        </select>
      </div>

      {/* Conditions + groups */}
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

      {/* Bottom buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button style={st.btn}
          onClick={() => updateLogic({ conditions: [...logic.conditions, makeCondition(allFields)] })}>
          + Condition
        </button>
        <button style={st.btn}
          onClick={() => updateLogic({ conditions: [...logic.conditions, makeGroup(allFields)] })}>
          + Condition Group
        </button>
        <button style={{ ...st.btn, color: '#f38ba8' }} onClick={disable}>Remove Skip Logic</button>
      </div>
    </div>
  )
}
