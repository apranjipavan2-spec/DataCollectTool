import React, { useState, useEffect } from 'react'
import api from '@/lib/api'
import { Button, Card } from '@/components/ui'

// ── Types ──────────────────────────────────────────────────────────────────

interface VersionSummary {
  id: string
  form_id: string
  version: number
  created_at: string
}

interface SchemaDiff {
  added: string[]
  removed: string[]
  renamed: Record<string, string>   // old_key → new_key
  type_changes: { key: string; old_type: string; new_type: string }[]
}

interface MigrationPreview {
  submission_id: string
  original_data: Record<string, unknown>
  migrated_data: Record<string, unknown>
  removed_fields: Record<string, unknown>
  added_fields_missing: string[]
}

interface MigrateResponse {
  form_id: string
  from_version: number
  to_version: number
  diff: SchemaDiff
  affected_count: number
  preview: MigrationPreview[]
}

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  formId: string
  currentVersion: number
  onClose: () => void
}

export default function VersionHistoryPanel({ formId, currentVersion, onClose }: Props) {
  const [versions, setVersions] = useState<VersionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Diff state
  const [compareFrom, setCompareFrom] = useState<number | null>(null)
  const [compareTo, setCompareTo] = useState<number | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffResult, setDiffResult] = useState<MigrateResponse | null>(null)
  const [diffError, setDiffError] = useState('')

  // Apply migration state
  const [applyLoading, setApplyLoading] = useState(false)
  const [applyResult, setApplyResult] = useState<{ migrated_count: number; renames_applied: Record<string, string> } | null>(null)
  const [showApplyConfirm, setShowApplyConfirm] = useState(false)
  const [applyError, setApplyError] = useState('')

  // Expanded version detail
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null)
  const [versionSchema, setVersionSchema] = useState<Record<string, unknown> | null>(null)
  const [schemaLoading, setSchemaLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get(`/forms/${formId}/versions`)
      .then(({ data }) => {
        setVersions(data)
        // Default: compare last two versions
        if (data.length >= 2) {
          setCompareFrom(data[1].version)
          setCompareTo(data[0].version)
        }
      })
      .catch(err => setError(err.response?.data?.detail ?? 'Failed to load versions'))
      .finally(() => setLoading(false))
  }, [formId])

  const loadDiff = () => {
    if (compareFrom == null || compareTo == null) return
    setDiffLoading(true)
    setDiffError('')
    setDiffResult(null)
    api.post(`/forms/${formId}/migrate`, {
      from_version: compareFrom,
      to_version: compareTo,
    })
      .then(({ data }) => setDiffResult(data))
      .catch(err => setDiffError(err.response?.data?.detail ?? 'Failed to compute diff'))
      .finally(() => setDiffLoading(false))
  }

  const loadVersionSchema = (version: number) => {
    if (expandedVersion === version) {
      setExpandedVersion(null)
      setVersionSchema(null)
      return
    }
    setExpandedVersion(version)
    setSchemaLoading(true)
    api.get(`/forms/${formId}/versions/${version}`)
      .then(({ data }) => setVersionSchema(data.json_schema))
      .catch(() => setVersionSchema(null))
      .finally(() => setSchemaLoading(false))
  }

  const applyMigration = () => {
    if (compareFrom == null || compareTo == null) return
    setApplyLoading(true)
    setApplyError('')
    setApplyResult(null)
    api.post(`/forms/${formId}/migrate/apply`, {
      from_version: compareFrom,
      to_version: compareTo,
    })
      .then(({ data }) => {
        setApplyResult(data)
        setShowApplyConfirm(false)
      })
      .catch(err => {
        setApplyError(err.response?.data?.detail ?? 'Failed to apply migration')
        setShowApplyConfirm(false)
      })
      .finally(() => setApplyLoading(false))
  }

  const isEmpty = (diff: SchemaDiff) =>
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    Object.keys(diff.renamed).length === 0 &&
    diff.type_changes.length === 0

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-catalan-border bg-catalan-surface flex-shrink-0">
        <div>
          <h2 className="text-base font-semibold text-catalan-text">Version History</h2>
          <p className="text-xs text-catalan-textMuted mt-0.5">
            Current: v{currentVersion} · {versions.length} version{versions.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-catalan-textMuted hover:text-catalan-text transition-colors text-lg leading-none p-1"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Error */}
        {error && (
          <div className="text-sm text-catalan-error bg-catalan-error/10 border border-catalan-error/30 rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-catalan-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Version list */}
        {!loading && versions.length === 0 && !error && (
          <p className="text-sm text-catalan-textMuted text-center py-8">No version history available.</p>
        )}

        {!loading && versions.length > 0 && (
          <>
            {/* Timeline */}
            <div className="space-y-0">
              {versions.map((v, i) => {
                const isCurrent = v.version === currentVersion
                const isExpanded = expandedVersion === v.version
                return (
                  <div key={v.id} className="relative">
                    {/* Connector line */}
                    {i < versions.length - 1 && (
                      <div className="absolute left-[11px] top-8 w-0.5 h-full bg-catalan-border" />
                    )}
                    <div className="flex gap-3 items-start py-2">
                      {/* Dot */}
                      <div className={`w-[22px] h-[22px] flex-shrink-0 rounded-full border-2 flex items-center justify-center mt-0.5 ${
                        isCurrent
                          ? 'bg-catalan-primary border-catalan-primary'
                          : 'bg-catalan-surface border-catalan-border'
                      }`}>
                        {isCurrent && <div className="w-2 h-2 rounded-full bg-catalan-bg" />}
                      </div>
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-catalan-text">
                            v{v.version}
                          </span>
                          {isCurrent && (
                            <span className="text-[10px] font-medium text-catalan-primary bg-catalan-primary/10 px-1.5 py-0.5 rounded">
                              CURRENT
                            </span>
                          )}
                          <span className="text-xs text-catalan-textMuted">
                            {new Date(v.created_at).toLocaleDateString()} {new Date(v.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <button
                          onClick={() => loadVersionSchema(v.version)}
                          className="text-xs text-catalan-primary hover:underline mt-1"
                        >
                          {isExpanded ? 'Hide schema' : 'View schema'}
                        </button>

                        {/* Expanded schema view */}
                        {isExpanded && (
                          <div className="mt-2 bg-catalan-bg rounded-lg border border-catalan-border p-3 text-xs">
                            {schemaLoading ? (
                              <div className="flex items-center gap-2 text-catalan-textMuted">
                                <div className="w-3 h-3 border border-catalan-primary border-t-transparent rounded-full animate-spin" />
                                Loading…
                              </div>
                            ) : versionSchema ? (
                              <div className="space-y-2">
                                <div className="flex items-center gap-2 text-catalan-textMuted">
                                  <span>📋</span>
                                  <span>
                                    {countFields(versionSchema)} field{countFields(versionSchema) !== 1 ? 's' : ''}
                                    {' · '}
                                    {countSections(versionSchema)} section{countSections(versionSchema) !== 1 ? 's' : ''}
                                  </span>
                                </div>
                                <pre className="text-[11px] text-catalan-textMuted overflow-x-auto max-h-48 overflow-y-auto font-mono bg-catalan-surface rounded p-2">
                                  {JSON.stringify(versionSchema, null, 2)}
                                </pre>
                              </div>
                            ) : (
                              <span className="text-catalan-textMuted">Unable to load schema</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* ── Compare Versions ── */}
            {versions.length >= 2 && (
              <div className="border-t border-catalan-border pt-5">
                <h3 className="text-sm font-semibold text-catalan-text mb-3">Compare Versions</h3>
                <div className="flex gap-3 items-end flex-wrap">
                  <div className="flex-1 min-w-[100px]">
                    <label className="block text-xs text-catalan-textMuted mb-1">From</label>
                    <select
                      value={compareFrom ?? ''}
                      onChange={e => { setCompareFrom(Number(e.target.value)); setDiffResult(null) }}
                      className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-1.5 text-sm text-catalan-text outline-none focus:border-catalan-primary"
                    >
                      <option value="" disabled>Select…</option>
                      {versions.map(v => (
                        <option key={v.id} value={v.version}>v{v.version}</option>
                      ))}
                    </select>
                  </div>
                  <span className="text-catalan-textMuted text-sm pb-1.5">→</span>
                  <div className="flex-1 min-w-[100px]">
                    <label className="block text-xs text-catalan-textMuted mb-1">To</label>
                    <select
                      value={compareTo ?? ''}
                      onChange={e => { setCompareTo(Number(e.target.value)); setDiffResult(null) }}
                      className="w-full bg-catalan-bg border border-catalan-border rounded-lg px-3 py-1.5 text-sm text-catalan-text outline-none focus:border-catalan-primary"
                    >
                      <option value="" disabled>Select…</option>
                      {versions.map(v => (
                        <option key={v.id} value={v.version}>v{v.version}</option>
                      ))}
                    </select>
                  </div>
                  <Button
                    size="sm"
                    onClick={loadDiff}
                    disabled={compareFrom == null || compareTo == null || compareFrom === compareTo || diffLoading}
                  >
                    {diffLoading ? '…' : 'Compare'}
                  </Button>
                </div>

                {diffError && (
                  <div className="mt-3 text-xs text-catalan-error bg-catalan-error/10 border border-catalan-error/30 rounded-lg px-3 py-2">
                    {diffError}
                  </div>
                )}

                {/* ── Diff Result ── */}
                {diffResult && (
                  <div className="mt-4 space-y-3">
                    {isEmpty(diffResult.diff) ? (
                      <div className="text-sm text-catalan-success bg-catalan-success/10 border border-catalan-success/30 rounded-lg px-4 py-3 flex items-center gap-2">
                        <span>✓</span>
                        <span>No structural changes between v{diffResult.from_version} and v{diffResult.to_version}</span>
                      </div>
                    ) : (
                      <>
                        {/* Summary badges */}
                        <div className="flex gap-2 flex-wrap">
                          {diffResult.diff.added.length > 0 && (
                            <span className="text-xs font-medium text-catalan-success bg-catalan-success/10 px-2 py-1 rounded-lg">
                              +{diffResult.diff.added.length} added
                            </span>
                          )}
                          {diffResult.diff.removed.length > 0 && (
                            <span className="text-xs font-medium text-catalan-error bg-catalan-error/10 px-2 py-1 rounded-lg">
                              −{diffResult.diff.removed.length} removed
                            </span>
                          )}
                          {Object.keys(diffResult.diff.renamed).length > 0 && (
                            <span className="text-xs font-medium text-catalan-warning bg-catalan-warning/10 px-2 py-1 rounded-lg">
                              ↔ {Object.keys(diffResult.diff.renamed).length} renamed
                            </span>
                          )}
                          {diffResult.diff.type_changes.length > 0 && (
                            <span className="text-xs font-medium text-catalan-warning bg-catalan-warning/10 px-2 py-1 rounded-lg">
                              ⚡ {diffResult.diff.type_changes.length} type change{diffResult.diff.type_changes.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>

                        {/* Detailed changes */}
                        <div className="bg-catalan-bg rounded-lg border border-catalan-border divide-y divide-catalan-border text-xs">
                          {diffResult.diff.added.map(key => (
                            <div key={`add-${key}`} className="px-3 py-2 flex items-center gap-2">
                              <span className="text-catalan-success font-medium w-4">+</span>
                              <span className="text-catalan-text font-mono">{key}</span>
                              <span className="text-catalan-textMuted ml-auto">new field</span>
                            </div>
                          ))}
                          {diffResult.diff.removed.map(key => (
                            <div key={`rem-${key}`} className="px-3 py-2 flex items-center gap-2">
                              <span className="text-catalan-error font-medium w-4">−</span>
                              <span className="text-catalan-text font-mono line-through">{key}</span>
                              <span className="text-catalan-textMuted ml-auto">removed</span>
                            </div>
                          ))}
                          {Object.entries(diffResult.diff.renamed).map(([oldK, newK]) => (
                            <div key={`ren-${oldK}`} className="px-3 py-2 flex items-center gap-2">
                              <span className="text-catalan-warning font-medium w-4">↔</span>
                              <span className="text-catalan-textMuted font-mono">{oldK}</span>
                              <span className="text-catalan-textMuted">→</span>
                              <span className="text-catalan-text font-mono">{newK}</span>
                              <span className="text-catalan-textMuted ml-auto">renamed</span>
                            </div>
                          ))}
                          {diffResult.diff.type_changes.map(tc => (
                            <div key={`tc-${tc.key}`} className="px-3 py-2 flex items-center gap-2">
                              <span className="text-catalan-warning font-medium w-4">⚡</span>
                              <span className="text-catalan-text font-mono">{tc.key}</span>
                              <span className="text-catalan-textMuted">{tc.old_type} → {tc.new_type}</span>
                            </div>
                          ))}
                        </div>

                        {/* Affected submissions */}
                        <div className="text-xs text-catalan-textMuted">
                          <span className="font-medium text-catalan-text">{diffResult.affected_count}</span>
                          {' '}submission{diffResult.affected_count !== 1 ? 's' : ''} collected with v{diffResult.from_version} would be affected
                        </div>

                        {/* Migration preview */}
                        {diffResult.preview.length > 0 && (
                          <details className="group">
                            <summary className="text-xs text-catalan-primary cursor-pointer hover:underline">
                              Preview migration ({diffResult.preview.length} of {diffResult.affected_count})
                            </summary>
                            <div className="mt-2 space-y-2 max-h-60 overflow-y-auto">
                              {diffResult.preview.map(p => (
                                <div key={p.submission_id} className="bg-catalan-surface rounded border border-catalan-border p-2 text-[11px]">
                                  <div className="font-mono text-catalan-textMuted mb-1">
                                    {p.submission_id.slice(0, 8)}…
                                  </div>
                                  {p.added_fields_missing.length > 0 && (
                                    <div className="text-catalan-warning">
                                      Missing new fields: {p.added_fields_missing.join(', ')}
                                    </div>
                                  )}
                                  {Object.keys(p.removed_fields).length > 0 && (
                                    <div className="text-catalan-error">
                                      Orphaned data: {Object.keys(p.removed_fields).join(', ')}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}

                        {/* Apply Migration */}
                        {applyResult ? (
                          <div className="text-sm text-catalan-success bg-catalan-success/10 border border-catalan-success/30 rounded-lg px-4 py-3 space-y-1">
                            <div className="flex items-center gap-2 font-medium">
                              <span>✓</span>
                              <span>Migration applied successfully</span>
                            </div>
                            <div className="text-xs text-catalan-success/80">
                              {applyResult.migrated_count} submission{applyResult.migrated_count !== 1 ? 's' : ''} updated
                              from v{diffResult.from_version} to v{diffResult.to_version}
                              {Object.keys(applyResult.renames_applied).length > 0 && (
                                <span>
                                  {' · '}{Object.keys(applyResult.renames_applied).length} field{Object.keys(applyResult.renames_applied).length !== 1 ? 's' : ''} renamed
                                </span>
                              )}
                            </div>
                          </div>
                        ) : applyError ? (
                          <div className="text-xs text-catalan-error bg-catalan-error/10 border border-catalan-error/30 rounded-lg px-3 py-2">
                            {applyError}
                          </div>
                        ) : showApplyConfirm ? (
                          <div className="bg-catalan-warning/5 border border-catalan-warning/30 rounded-lg px-4 py-3 space-y-3">
                            <div className="text-sm text-catalan-text">
                              This will update <span className="font-semibold">{diffResult.affected_count}</span> submission{diffResult.affected_count !== 1 ? 's' : ''} from
                              v{diffResult.from_version} to v{diffResult.to_version}. This action cannot be undone.
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={applyMigration}
                                disabled={applyLoading}
                                className="bg-catalan-warning text-white hover:bg-catalan-warning/90"
                              >
                                {applyLoading ? (
                                  <span className="flex items-center gap-2">
                                    <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    Applying…
                                  </span>
                                ) : (
                                  'Yes, apply migration'
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setShowApplyConfirm(false)}
                                disabled={applyLoading}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => { setShowApplyConfirm(true); setApplyError('') }}
                            className="w-full"
                          >
                            Apply Migration ({diffResult.affected_count} submission{diffResult.affected_count !== 1 ? 's' : ''})
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function countFields(schema: Record<string, unknown>): number {
  const sections = (schema.sections as { fields?: unknown[] }[] | undefined) ?? []
  const topFields = (schema.fields as unknown[] | undefined) ?? []
  return topFields.length + sections.reduce((acc, s) => acc + (s.fields?.length ?? 0), 0)
}

function countSections(schema: Record<string, unknown>): number {
  return ((schema.sections as unknown[] | undefined) ?? []).length
}
