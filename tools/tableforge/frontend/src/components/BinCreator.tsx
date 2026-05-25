import React, { useState } from 'react';
import { ColumnInfo } from '../types';
import { API_BASE, createBin } from '../api';

interface Props {
  datasetId: string;
  columns: ColumnInfo[];
  onCreated: (name: string) => void;
  onClose: () => void;
  embedded?: boolean;
}

export function BinCreator({ datasetId, columns, onCreated, onClose, embedded }: Props) {
  const [name, setName] = useState('');
  const [sourceCol, setSourceCol] = useState('');
  const [binType, setBinType] = useState('numeric');
  const [ranges, setRanges] = useState<{ label: string; lower: number; upper: number }[]>([{ label: '', lower: 0, upper: 0 }]);
  const [frequency, setFrequency] = useState('month');
  const [mappingText, setMappingText] = useState('');
  // Equal-freq / quantile
  const [numBins, setNumBins] = useState(5);
  const [quantileType, setQuantileType] = useState('equal_width'); // equal_width | equal_freq | quartile | decile | percentile
  // Fiscal year
  const [fiscalStartMonth, setFiscalStartMonth] = useState(4); // April
  // Regex
  const [regexText, setRegexText] = useState('');
  // Category collapsing
  const [groupMapText, setGroupMapText] = useState('');

  // Boundary inclusive/exclusive
  const [lowerInclusive, setLowerInclusive] = useState(true);
  const [upperInclusive, setUpperInclusive] = useState(false);
  const [remainderLabel, setRemainderLabel] = useState('Other');
  const [handleRemainder, setHandleRemainder] = useState(false);
  // Custom date ranges
  const [customDateRanges, setCustomDateRanges] = useState<{ label: string; start: string; end: string }[]>([{ label: '', start: '', end: '' }]);
  // Case normalization
  const [caseNorm, setCaseNorm] = useState<'none' | 'lower' | 'upper' | 'title'>('none');
  // Auto-detect codings
  const [autoDetectResult, setAutoDetectResult] = useState<Record<string, string>>({});

  const [preview, setPreview] = useState<Record<string, number>>({});
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedCol = columns.find(c => c.name === sourceCol);

  const addRange = () => {
    const last = ranges[ranges.length - 1];
    setRanges([...ranges, { label: '', lower: last?.upper || 0, upper: (last?.upper || 0) + 10 }]);
  };
  const updateRange = (idx: number, field: string, value: any) => {
    setRanges(ranges.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };
  const removeRange = (idx: number) => setRanges(ranges.filter((_, i) => i !== idx));

  const autoFill = (type: string) => {
    if (!selectedCol || selectedCol.stats.min == null || selectedCol.stats.max == null) return;
    const min = selectedCol.stats.min;
    const max = selectedCol.stats.max;
    const count = numBins;
    const width = (max - min) / count;
    const newRanges = [];
    for (let i = 0; i < count; i++) {
      const lower = parseFloat((min + i * width).toFixed(2));
      const upper = parseFloat((min + (i + 1) * width).toFixed(2));
      newRanges.push({ label: `${lower}–${upper}`, lower, upper });
    }
    setRanges(newRanges);
  };

  const buildBinDef = (): any => {
    const bin: any = { name: name.trim(), source_column: sourceCol, bin_type: binType };
    if (binType === 'numeric') {
      if (quantileType === 'equal_width') {
        bin.ranges = ranges.filter(r => r.label);
        bin.lower_inclusive = lowerInclusive;
        bin.upper_inclusive = upperInclusive;
      } else {
        bin.quantile_type = quantileType;
        bin.num_bins = quantileType === 'quartile' ? 4 : quantileType === 'decile' ? 10 : numBins;
      }
      if (handleRemainder) bin.remainder_label = remainderLabel;
    } else if (binType === 'date_range') {
      bin.date_ranges = customDateRanges.filter(r => r.label && (r.start || r.end));
      if (handleRemainder) bin.remainder_label = remainderLabel;
    } else if (binType === 'relative_date') {
      bin.frequency = frequency;
    } else if (binType === 'date') {
      bin.frequency = frequency;
      if (frequency === 'fiscal_year') bin.fiscal_start_month = fiscalStartMonth;
    } else if (binType === 'text') {
      const mapping: Record<string, string> = {};
      mappingText.split('\n').forEach(line => {
        const [from, to] = line.split('=').map(s => s.trim());
        if (from && to) mapping[from] = to;
      });
      bin.mapping = mapping;
      if (caseNorm !== 'none') bin.case_normalize = caseNorm;
    } else if (binType === 'regex') {
      const patterns: { pattern: string; label: string }[] = [];
      regexText.split('\n').forEach(line => {
        const [pat, label] = line.split('→').map(s => s.trim());
        if (pat && label) patterns.push({ pattern: pat, label });
      });
      bin.regex_patterns = patterns;
    } else if (binType === 'group') {
      const groupMap: Record<string, string[]> = {};
      groupMapText.split('\n').forEach(line => {
        const [newLabel, values] = line.split(':').map(s => s.trim());
        if (newLabel && values) groupMap[newLabel] = values.split(',').map(s => s.trim());
      });
      bin.group_map = groupMap;
      if (caseNorm !== 'none') bin.case_normalize = caseNorm;
      if (handleRemainder) bin.remainder_label = remainderLabel;
    }
    return bin;
  };

  const handlePreview = async () => {
    if (!name.trim()) { setError('Enter a name before previewing'); return; }
    if (!sourceCol) { setError('Select a source column'); return; }
    setPreviewing(true); setError('');
    try {
      const bin = buildBinDef();
      const res = await fetch(`${API_BASE}/bins/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_id: datasetId, ...bin }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setPreview(data.preview || {});
    } catch (e: any) { setError(e.message || 'Preview failed'); }
    finally { setPreviewing(false); }
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    if (!sourceCol) { setError('Source column is required'); return; }
    setSaving(true); setError('');
    try {
      const bin = buildBinDef();
      const res = await createBin(datasetId, bin);
      setPreview(res.preview || {});
      onCreated(name.trim());
    } catch (e: any) {
      setError(e.message || 'Failed to create bin');
    } finally { setSaving(false); }
  };

  const autoDetectCodings = async () => {
    if (!sourceCol) return;
    try {
      const res = await fetch(`${API_BASE}/bin/auto_detect?dataset_id=${datasetId}&column=${encodeURIComponent(sourceCol)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.mapping && Object.keys(data.mapping).length > 0) {
          setAutoDetectResult(data.mapping);
          setMappingText(Object.entries(data.mapping).map(([k, v]) => `${k} = ${v}`).join('\n'));
          setBinType('text');
        } else {
          setError('No common codings detected for this column');
        }
      }
    } catch { setError('Auto-detect failed'); }
  };

  const BIN_TYPES = [
    { value: 'numeric', label: 'Numeric' },
    { value: 'date', label: 'Date' },
    { value: 'date_range', label: 'Custom Date Ranges' },
    { value: 'relative_date', label: 'Relative Period' },
    { value: 'text', label: 'Text Map' },
    { value: 'regex', label: 'Regex' },
    { value: 'group', label: 'Category Collapse' },
  ];

  const body = (
    <>
        <div className={embedded ? '' : 'modal-body'}>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label>Bin Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Age Group" />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Source Column</label>
              <select value={sourceCol} onChange={e => {
                setSourceCol(e.target.value);
                const col = columns.find(c => c.name === e.target.value);
                if (col?.type === 'numeric') setBinType('numeric');
                else if (col?.type === 'date') setBinType('date');
                else setBinType('text');
              }}>
                <option value="">Select column...</option>
                {columns.map(c => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>Bin Type</label>
            <div className="btn-group">
              {BIN_TYPES.map(t => (
                <button key={t.value} className={`btn-toggle ${binType === t.value ? 'active' : ''}`}
                  onClick={() => setBinType(t.value)}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {binType === 'numeric' && (
            <>
              <div className="form-group">
                <label>Method</label>
                <div className="btn-group">
                  {[
                    { value: 'equal_width', label: 'Equal Width' },
                    { value: 'equal_freq', label: 'Equal Frequency' },
                    { value: 'quartile', label: 'Quartiles (4)' },
                    { value: 'decile', label: 'Deciles (10)' },
                  ].map(q => (
                    <button key={q.value} className={`btn-toggle ${quantileType === q.value ? 'active' : ''}`}
                      onClick={() => setQuantileType(q.value)}>
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
              {(quantileType === 'equal_width' || quantileType === 'equal_freq') && (
                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label>Number of Bins</label>
                    <input type="number" min={2} max={50} value={numBins}
                      onChange={e => setNumBins(parseInt(e.target.value) || 5)}
                      style={{ width: 60 }} />
                    {quantileType === 'equal_width' && (
                      <button className="btn-small" onClick={() => autoFill('equal_width')}>Auto-fill</button>
                    )}
                  </div>
                </div>
              )}
              {quantileType === 'equal_width' && (
                <>
                  <div className="range-list">
                    {ranges.map((r, i) => (
                      <div key={i} className="range-row">
                        <input type="text" placeholder="Label" value={r.label}
                          onChange={e => updateRange(i, 'label', e.target.value)} />
                        <input type="number" placeholder="From" value={r.lower}
                          onChange={e => updateRange(i, 'lower', parseFloat(e.target.value))} />
                        <span className="range-sep">to</span>
                        <input type="number" placeholder="To" value={r.upper}
                          onChange={e => updateRange(i, 'upper', parseFloat(e.target.value))} />
                        <button className="chip-remove" onClick={() => removeRange(i)}>×</button>
                      </div>
                    ))}
                    <button className="btn-small" onClick={addRange}>+ Add Range</button>
                  </div>
                  <div className="form-group" style={{ marginTop: 8 }}>
                    <label>Boundary Inclusivity</label>
                    <div className="form-row" style={{ gap: 12 }}>
                      <label className="checkbox-label">
                        <input type="checkbox" checked={lowerInclusive} onChange={e => setLowerInclusive(e.target.checked)} />
                        Lower inclusive [
                      </label>
                      <label className="checkbox-label">
                        <input type="checkbox" checked={upperInclusive} onChange={e => setUpperInclusive(e.target.checked)} />
                        Upper inclusive ]
                      </label>
                    </div>
                    <div className="hint-text">e.g., [10, 20) means ≥10 and &lt;20</div>
                  </div>
                  <label className="checkbox-label" style={{ marginTop: 6 }}>
                    <input type="checkbox" checked={handleRemainder} onChange={e => setHandleRemainder(e.target.checked)} />
                    Handle values outside ranges
                  </label>
                  {handleRemainder && (
                    <div className="form-group" style={{ marginTop: 4 }}>
                      <label>Remainder label</label>
                      <input type="text" value={remainderLabel} onChange={e => setRemainderLabel(e.target.value)} placeholder="Other" />
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {binType === 'date' && (
            <>
              <div className="form-group">
                <label>Group By</label>
                <select value={frequency} onChange={e => setFrequency(e.target.value)}>
                  <option value="year">Year</option>
                  <option value="quarter">Quarter</option>
                  <option value="month">Month</option>
                  <option value="week">Week</option>
                  <option value="day">Day</option>
                  <option value="fiscal_year">Fiscal Year</option>
                </select>
              </div>
              {frequency === 'fiscal_year' && (
                <div className="form-group">
                  <label>Fiscal Year Start Month</label>
                  <select value={fiscalStartMonth} onChange={e => setFiscalStartMonth(parseInt(e.target.value))}>
                    {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
                      <option key={i+1} value={i+1}>{m}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          {binType === 'date_range' && (
            <div>
              <p className="hint-text" style={{ marginBottom: 8 }}>Define named date ranges. Leave start/end blank for open-ended.</p>
              {customDateRanges.map((dr, i) => (
                <div key={i} className="range-row" style={{ marginBottom: 4 }}>
                  <input type="text" placeholder="Label" value={dr.label}
                    onChange={e => { const a = [...customDateRanges]; a[i] = { ...a[i], label: e.target.value }; setCustomDateRanges(a); }}
                    style={{ flex: 1 }} />
                  <input type="date" value={dr.start}
                    onChange={e => { const a = [...customDateRanges]; a[i] = { ...a[i], start: e.target.value }; setCustomDateRanges(a); }}
                    style={{ flex: 1 }} />
                  <span className="range-sep">–</span>
                  <input type="date" value={dr.end}
                    onChange={e => { const a = [...customDateRanges]; a[i] = { ...a[i], end: e.target.value }; setCustomDateRanges(a); }}
                    style={{ flex: 1 }} />
                  <button className="chip-remove" onClick={() => setCustomDateRanges(customDateRanges.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
              <button className="btn-small" onClick={() => setCustomDateRanges([...customDateRanges, { label: '', start: '', end: '' }])}>+ Add Range</button>
              <label className="checkbox-label" style={{ marginTop: 8 }}>
                <input type="checkbox" checked={handleRemainder} onChange={e => setHandleRemainder(e.target.checked)} />
                Label out-of-range dates as:
              </label>
              {handleRemainder && (
                <input type="text" value={remainderLabel} onChange={e => setRemainderLabel(e.target.value)} placeholder="Other" style={{ marginTop: 4 }} />
              )}
            </div>
          )}

          {binType === 'relative_date' && (
            <div>
              <p className="hint-text" style={{ marginBottom: 10 }}>
                Creates a flag column indicating whether each row's date falls within the selected period.
              </p>
              <div className="form-group">
                <label>Relative Period</label>
                <select value={frequency} onChange={e => setFrequency(e.target.value)}>
                  <option value="last_7d">Last 7 Days</option>
                  <option value="last_30d">Last 30 Days</option>
                  <option value="last_90d">Last 90 Days</option>
                  <option value="last_12m">Rolling 12 Months</option>
                  <option value="ytd">Year to Date (YTD)</option>
                  <option value="last_year">Last Calendar Year</option>
                  <option value="qtd">Quarter to Date (QTD)</option>
                  <option value="mtd">Month to Date (MTD)</option>
                </select>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '8px', background: 'var(--bg-2)', borderRadius: 4 }}>
                Will create column "{name || 'period_flag'}" with values "In Period" / "Prior Period"
              </div>
            </div>
          )}

          {binType === 'text' && (
            <div>
              <div className="form-group">
                <label>Value Mapping (one per line: old_value = new_label)</label>
                <textarea rows={6} value={mappingText} onChange={e => setMappingText(e.target.value)}
                  placeholder={"1 = Male\n2 = Female\n3 = Other"} />
              </div>
              <div className="form-row" style={{ alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <button className="btn-small" onClick={autoDetectCodings} disabled={!sourceCol}>
                  Auto-detect codings
                </button>
                {Object.keys(autoDetectResult).length > 0 && (
                  <span className="hint-text">✓ Detected {Object.keys(autoDetectResult).length} mappings</span>
                )}
              </div>
              <div className="form-group">
                <label>Case Normalization (applied before mapping)</label>
                <select value={caseNorm} onChange={e => setCaseNorm(e.target.value as any)}>
                  <option value="none">None</option>
                  <option value="lower">lowercase</option>
                  <option value="upper">UPPERCASE</option>
                  <option value="title">Title Case</option>
                </select>
              </div>
            </div>
          )}

          {binType === 'regex' && (
            <div className="form-group">
              <label>Regex Patterns (pattern → label, one per line)</label>
              <textarea rows={6} value={regexText} onChange={e => setRegexText(e.target.value)}
                placeholder={"^New York.*→ New York\n^Los Angeles.*→ Los Angeles\n.*→ Other"} />
              <div className="hint-text">Patterns matched in order; use .* for any characters</div>
            </div>
          )}

          {binType === 'group' && (
            <div>
              <div className="form-group">
                <label>Category Groups (NewLabel: val1, val2, val3)</label>
                <textarea rows={6} value={groupMapText} onChange={e => setGroupMapText(e.target.value)}
                  placeholder={"North: NY, NJ, CT, MA\nSouth: FL, GA, TX, NC\nWest: CA, OR, WA"} />
                <div className="hint-text">Group multiple categories into a single new label</div>
              </div>
              <div className="form-group">
                <label>Case Normalization (normalize values before grouping)</label>
                <select value={caseNorm} onChange={e => setCaseNorm(e.target.value as any)}>
                  <option value="none">None</option>
                  <option value="lower">lowercase</option>
                  <option value="upper">UPPERCASE</option>
                  <option value="title">Title Case</option>
                </select>
              </div>
              <label className="checkbox-label">
                <input type="checkbox" checked={handleRemainder} onChange={e => setHandleRemainder(e.target.checked)} />
                Label ungrouped values as:
              </label>
              {handleRemainder && (
                <input type="text" value={remainderLabel} onChange={e => setRemainderLabel(e.target.value)} placeholder="Other" style={{ marginTop: 4 }} />
              )}
            </div>
          )}

          {Object.keys(preview).length > 0 && (
            <div className="metric-preview">
              <label>Distribution Preview</label>
              <div className="bin-preview">
                {Object.entries(preview).map(([k, v]) => (
                  <div key={k} className="bin-bar-row">
                    <span className="bin-label">{k}</span>
                    <div className="bin-bar-track">
                      <div className="bin-bar" style={{ width: `${Math.min(v / Math.max(...Object.values(preview)) * 100, 100)}%` }} />
                    </div>
                    <span className="bin-count">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {error && <div className="error-msg">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-secondary" onClick={handlePreview} disabled={previewing || !name.trim() || !sourceCol} title="Preview distribution without saving">
            {previewing ? 'Loading...' : '▶ Preview Distribution'}
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Creating...' : 'Create Bin'}
          </button>
        </div>
    </>
  );

  if (embedded) return body;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Bin Creator & Data Recoding</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {body}
      </div>
    </div>
  );
}
