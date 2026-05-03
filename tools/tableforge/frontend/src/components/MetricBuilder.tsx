import React, { useState } from 'react';
import { ColumnInfo } from '../types';
import { API_BASE, createMetric } from '../api';

interface Props {
  datasetId: string;
  columns: ColumnInfo[];
  onCreated: (name: string) => void;
  onClose: () => void;
  onOpenLibrary?: () => void;
  embedded?: boolean;
}

const METRIC_TYPES = [
  { value: 'formula', label: 'Basic Formula', desc: 'Arithmetic on columns (+, -, *, /)' },
  { value: 'ratio', label: 'Ratio', desc: 'Numerator ÷ Denominator' },
  { value: 'percentage', label: 'Percentage', desc: 'Express as % of another value' },
  { value: 'growth', label: 'Growth / Change', desc: 'Change between two values' },
  { value: 'weighted_average', label: 'Weighted Average', desc: 'Average weighted by another column' },
  { value: 'index', label: 'Index (Base=100)', desc: 'Index value relative to a base' },
  { value: 'rank', label: 'Rank', desc: 'Rank rows by column value' },
  { value: 'cumulative', label: 'Cumulative Sum', desc: 'Running total of a column' },
  { value: 'composite', label: 'Composite', desc: 'Combine two existing metrics' },
  { value: 'conditional', label: 'Conditional / IF', desc: 'IF column condition THEN value ELSE value' },
];

export function MetricBuilder({ datasetId, columns, onCreated, onClose, onOpenLibrary, embedded }: Props) {
  const [name, setName] = useState('');
  const [metricType, setMetricType] = useState('formula');
  const [columnA, setColumnA] = useState('');
  const [columnB, setColumnB] = useState('');
  const [operator, setOperator] = useState('+');
  const [numerator, setNumerator] = useState('');
  const [denominator, setDenominator] = useState('');
  const [part, setPart] = useState('');
  const [whole, setWhole] = useState('');
  const [current, setCurrent] = useState('');
  const [previous, setPrevious] = useState('');
  const [growthType, setGrowthType] = useState('percentage');
  const [valueCol, setValueCol] = useState('');
  const [weightCol, setWeightCol] = useState('');
  // Index
  const [baseColumn, setBaseColumn] = useState('');
  const [baseValue, setBaseValue] = useState<number>(100);
  // Rank
  const [rankColumn, setRankColumn] = useState('');
  const [rankOrder, setRankOrder] = useState('desc');
  // Composite
  const [compositeMetricA, setCompositeMetricA] = useState('');
  const [compositeMetricB, setCompositeMetricB] = useState('');
  const [compositeOp, setCompositeOp] = useState('+');
  // Format
  const [formatType, setFormatType] = useState('number');
  const [decimalPlaces, setDecimalPlaces] = useState(2);

  // Conditional/IF
  const [condColumn, setCondColumn] = useState('');
  const [condOperator, setCondOperator] = useState('gt');
  const [condValue, setCondValue] = useState('0');
  const [condThenCol, setCondThenCol] = useState('');
  const [condThenVal, setCondThenVal] = useState('');
  const [condElseCol, setCondElseCol] = useState('');
  const [condElseVal, setCondElseVal] = useState('0');
  const [condThenType, setCondThenType] = useState<'column' | 'value'>('column');
  const [condElseType, setCondElseType] = useState<'column' | 'value'>('value');

  const [preview, setPreview] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const numericCols = columns.filter(c => c.type === 'numeric');

  const buildMetricDef = () => {
    const metric: any = {
      name: name.trim(), metric_type: metricType,
      format_type: formatType, decimal_places: decimalPlaces,
    };
    if (metricType === 'formula') { metric.column_a = columnA; metric.column_b = columnB; metric.operator = operator; }
    else if (metricType === 'ratio') { metric.numerator = numerator; metric.denominator = denominator; }
    else if (metricType === 'percentage') { metric.part = part; metric.whole = whole; }
    else if (metricType === 'growth') { metric.current = current; metric.previous = previous; metric.growth_type = growthType; }
    else if (metricType === 'weighted_average') { metric.value_column = valueCol; metric.weight_column = weightCol; }
    else if (metricType === 'index') { metric.base_column = baseColumn; metric.base_value = baseValue; }
    else if (metricType === 'rank') { metric.rank_column = rankColumn; metric.rank_order = rankOrder; }
    else if (metricType === 'cumulative') { metric.value_column = valueCol; }
    else if (metricType === 'composite') { metric.column_a = compositeMetricA; metric.column_b = compositeMetricB; metric.operator = compositeOp; }
    else if (metricType === 'conditional') {
      metric.cond_column = condColumn; metric.cond_operator = condOperator; metric.cond_value = condValue;
      metric.cond_then_type = condThenType; metric.cond_then_col = condThenCol; metric.cond_then_val = condThenVal;
      metric.cond_else_type = condElseType; metric.cond_else_col = condElseCol; metric.cond_else_val = condElseVal;
    }
    return metric;
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const metric = buildMetricDef();
      const res = await createMetric(datasetId, metric);
      setPreview(res.preview || []);
      onCreated(name.trim());
    } catch (e: any) {
      setError(e.message || 'Failed to create metric');
    } finally { setSaving(false); }
  };

  const handleSaveToLibrary = async () => {
    if (!name.trim()) { setError('Name is required to save to library'); return; }
    const def = buildMetricDef();
    setSaving(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/library/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          metric_type: metricType,
          definition: def,
          category: 'General',
          description: '',
          tags: [],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setError('');
      // Show brief success hint in preview area
      setPreview(['saved_to_library']);
    } catch (e: any) {
      setError(e.message || 'Failed to save to library');
    } finally { setSaving(false); }
  };

  const ColSelect = ({ value, onChange, label, allCols }: { value: string; onChange: (v: string) => void; label: string; allCols?: boolean }) => (
    <div className="form-group">
      <label>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Select column...</option>
        {(allCols ? columns : numericCols).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
      </select>
    </div>
  );

  const body = (
    <>
        <div className={embedded ? '' : 'modal-body'}>
          <div className="form-group">
            <label>Metric Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g., Profit Margin %" />
          </div>

          <div className="form-group">
            <label>Metric Type</label>
            <div className="metric-type-grid">
              {METRIC_TYPES.map(mt => (
                <button key={mt.value}
                  className={`metric-type-btn ${metricType === mt.value ? 'active' : ''}`}
                  onClick={() => setMetricType(mt.value)}>
                  <strong>{mt.label}</strong>
                  <span>{mt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {metricType === 'formula' && (
            <div className="formula-row">
              <ColSelect value={columnA} onChange={setColumnA} label="Column A" />
              <div className="form-group">
                <label>Operator</label>
                <div className="op-buttons">
                  {['+', '-', '*', '/'].map(op => (
                    <button key={op} className={`op-btn ${operator === op ? 'active' : ''}`}
                      onClick={() => setOperator(op)}>{op}</button>
                  ))}
                </div>
              </div>
              <ColSelect value={columnB} onChange={setColumnB} label="Column B" />
            </div>
          )}
          {metricType === 'ratio' && (
            <div className="formula-row">
              <ColSelect value={numerator} onChange={setNumerator} label="Numerator" />
              <div className="op-divider">/</div>
              <ColSelect value={denominator} onChange={setDenominator} label="Denominator" />
            </div>
          )}
          {metricType === 'percentage' && (
            <div className="formula-row">
              <ColSelect value={part} onChange={setPart} label="Part" />
              <div className="op-divider">÷ × 100</div>
              <ColSelect value={whole} onChange={setWhole} label="Whole" />
            </div>
          )}
          {metricType === 'growth' && (
            <>
              <div className="formula-row">
                <ColSelect value={current} onChange={setCurrent} label="Current Value" />
                <div className="op-divider">vs</div>
                <ColSelect value={previous} onChange={setPrevious} label="Previous Value" />
              </div>
              <div className="form-group">
                <label>Type</label>
                <select value={growthType} onChange={e => setGrowthType(e.target.value)}>
                  <option value="percentage">Percentage Change (%)</option>
                  <option value="absolute">Absolute Change</option>
                </select>
              </div>
            </>
          )}
          {metricType === 'weighted_average' && (
            <div className="formula-row">
              <ColSelect value={valueCol} onChange={setValueCol} label="Value Column" />
              <div className="op-divider">× weight</div>
              <ColSelect value={weightCol} onChange={setWeightCol} label="Weight Column" />
            </div>
          )}
          {metricType === 'index' && (
            <div className="formula-row">
              <ColSelect value={baseColumn} onChange={setBaseColumn} label="Column to Index" />
              <div className="form-group">
                <label>Base Value</label>
                <input type="number" value={baseValue} onChange={e => setBaseValue(parseFloat(e.target.value) || 100)} style={{ width: 80 }} />
              </div>
            </div>
          )}
          {metricType === 'rank' && (
            <div className="formula-row">
              <ColSelect value={rankColumn} onChange={setRankColumn} label="Column to Rank" />
              <div className="form-group">
                <label>Direction</label>
                <select value={rankOrder} onChange={e => setRankOrder(e.target.value)}>
                  <option value="desc">Highest = Rank 1</option>
                  <option value="asc">Lowest = Rank 1</option>
                </select>
              </div>
            </div>
          )}
          {metricType === 'cumulative' && (
            <ColSelect value={valueCol} onChange={setValueCol} label="Column to Cumulate" />
          )}
          {metricType === 'conditional' && (
            <div>
              <div style={{ background: 'var(--bg-2)', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                <div className="form-row" style={{ alignItems: 'flex-end', gap: 8 }}>
                  <div className="form-group" style={{ flex: 2 }}>
                    <label>IF Column</label>
                    <select value={condColumn} onChange={e => setCondColumn(e.target.value)}>
                      <option value="">Select column...</option>
                      {columns.map(c => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>Condition</label>
                    <select value={condOperator} onChange={e => setCondOperator(e.target.value)}>
                      <option value="gt">&gt;</option>
                      <option value="gte">≥</option>
                      <option value="lt">&lt;</option>
                      <option value="lte">≤</option>
                      <option value="eq">=</option>
                      <option value="neq">≠</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>Value</label>
                    <input type="text" value={condValue} onChange={e => setCondValue(e.target.value)} placeholder="0" />
                  </div>
                </div>
              </div>
              <div className="form-row" style={{ gap: 8 }}>
                <div style={{ flex: 1, background: 'var(--bg-2)', borderRadius: 6, padding: 8 }}>
                  <label style={{ fontSize: 11, color: '#22c55e', marginBottom: 4, display: 'block' }}>THEN (true)</label>
                  <div className="form-row" style={{ gap: 4 }}>
                    <select value={condThenType} onChange={e => setCondThenType(e.target.value as any)} style={{ flex: 1 }}>
                      <option value="column">Column</option>
                      <option value="value">Fixed Value</option>
                    </select>
                    {condThenType === 'column'
                      ? <select value={condThenCol} onChange={e => setCondThenCol(e.target.value)} style={{ flex: 1 }}>
                          <option value="">Select...</option>
                          {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                        </select>
                      : <input type="text" value={condThenVal} onChange={e => setCondThenVal(e.target.value)} placeholder="Value" style={{ flex: 1 }} />
                    }
                  </div>
                </div>
                <div style={{ flex: 1, background: 'var(--bg-2)', borderRadius: 6, padding: 8 }}>
                  <label style={{ fontSize: 11, color: '#ef4444', marginBottom: 4, display: 'block' }}>ELSE (false)</label>
                  <div className="form-row" style={{ gap: 4 }}>
                    <select value={condElseType} onChange={e => setCondElseType(e.target.value as any)} style={{ flex: 1 }}>
                      <option value="column">Column</option>
                      <option value="value">Fixed Value</option>
                    </select>
                    {condElseType === 'column'
                      ? <select value={condElseCol} onChange={e => setCondElseCol(e.target.value)} style={{ flex: 1 }}>
                          <option value="">Select...</option>
                          {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                        </select>
                      : <input type="text" value={condElseVal} onChange={e => setCondElseVal(e.target.value)} placeholder="0" style={{ flex: 1 }} />
                    }
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8, padding: '6px 8px', background: 'var(--bg-2)', borderRadius: 4 }}>
                IF {condColumn || '?'} {condOperator} {condValue} → THEN {condThenType === 'column' ? (condThenCol || '?') : condThenVal} ELSE {condElseType === 'column' ? (condElseCol || '?') : condElseVal}
              </div>
            </div>
          )}
          {metricType === 'composite' && (
            <div className="formula-row">
              <div className="form-group">
                <label>Metric A</label>
                <select value={compositeMetricA} onChange={e => setCompositeMetricA(e.target.value)}>
                  <option value="">Select...</option>
                  {columns.filter(c => c.type === 'numeric').map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Operation</label>
                <div className="op-buttons">
                  {['+', '-', '*', '/'].map(op => (
                    <button key={op} className={`op-btn ${compositeOp === op ? 'active' : ''}`}
                      onClick={() => setCompositeOp(op)}>{op}</button>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label>Metric B</label>
                <select value={compositeMetricB} onChange={e => setCompositeMetricB(e.target.value)}>
                  <option value="">Select...</option>
                  {columns.filter(c => c.type === 'numeric').map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="form-row" style={{ marginTop: 12 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Output Format</label>
              <select value={formatType} onChange={e => setFormatType(e.target.value)}>
                <option value="number">Number</option>
                <option value="percentage">Percentage (%)</option>
                <option value="currency">Currency</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Decimal Places</label>
              <input type="number" min={0} max={6} value={decimalPlaces}
                onChange={e => setDecimalPlaces(parseInt(e.target.value) || 0)} />
            </div>
          </div>

          {preview.length > 0 && (
            <div className="metric-preview">
              {preview[0] === 'saved_to_library' ? (
                <div className="success-msg">✓ Saved to Global Metric Library</div>
              ) : (
                <>
                  <label>Preview (first 5 values)</label>
                  <div className="preview-values">
                    {preview.map((v, i) => (
                      <span key={i} className="preview-val">{typeof v === 'number' ? v.toFixed(decimalPlaces) : String(v)}</span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {error && <div className="error-msg">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          {onOpenLibrary && (
            <button className="btn-secondary" onClick={onOpenLibrary} title="Browse Global Metric Library">
              📚 Library
            </button>
          )}
          <button className="btn-secondary" onClick={handleSaveToLibrary} disabled={saving || !name.trim()} title="Save this metric definition to the Global Library">
            💾 Save to Library
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Creating...' : 'Create Metric'}
          </button>
        </div>
    </>
  );

  if (embedded) return body;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Visual Metric Builder</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {body}
      </div>
    </div>
  );
}
