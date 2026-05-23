import React, { useState } from 'react';
import { ColumnInfo } from '../types';
import { API_BASE } from '../api';

export type AdvancedKind =
  | 'causal_did'
  | 'causal_psm'
  | 'causal_mixed_lm'
  | 'power_planner'
  | 'export_codebook'
  | 'exec_summary';

interface Props {
  kind: AdvancedKind;
  datasetId: string;
  columns: ColumnInfo[];
  analysisPack?: any[] | null;
  onClose: () => void;
}

const TITLES: Record<AdvancedKind, string> = {
  causal_did: 'Difference-in-Differences (DiD)',
  causal_psm: 'Propensity Score Matching (PSM)',
  causal_mixed_lm: 'Mixed-Effects Model (clustered)',
  power_planner: 'Power & Sample-Size Planner',
  export_codebook: 'Export Codebook (DOCX)',
  exec_summary: 'AI Executive Summary',
};

const DESCRIPTIONS: Record<AdvancedKind, string> = {
  causal_did: 'Pre/post × treatment/control. Returns ATT, CI, p-value.',
  causal_psm: '1-NN matching on logit-propensity. Returns ATT + covariate balance.',
  causal_mixed_lm: 'Linear mixed model with random intercept on a cluster column (e.g., village).',
  power_planner: 'Compute required sample size, achievable power, or detectable effect.',
  export_codebook: 'Generate a Word codebook (data dictionary) for this dataset.',
  exec_summary: 'AI-written one-pager from your latest Auto-Analyze pack.',
};

export function AdvancedAnalysisPanel({ kind, datasetId, columns, analysisPack, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const numericCols = columns.filter(c => c.type === 'numeric');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: 960 }}>
        <div className="modal-header">
          <h2>{TITLES[kind]}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ maxHeight: '75vh', overflow: 'auto' }}>
          <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 12 }}>{DESCRIPTIONS[kind]}</p>

          {kind === 'causal_did' && (
            <DiDForm datasetId={datasetId} columns={columns} numericCols={numericCols}
              loading={loading} setLoading={setLoading} setError={setError} setResult={setResult} />
          )}
          {kind === 'causal_psm' && (
            <PSMForm datasetId={datasetId} columns={columns} numericCols={numericCols}
              loading={loading} setLoading={setLoading} setError={setError} setResult={setResult} />
          )}
          {kind === 'causal_mixed_lm' && (
            <MixedLMForm datasetId={datasetId} columns={columns} numericCols={numericCols}
              loading={loading} setLoading={setLoading} setError={setError} setResult={setResult} />
          )}
          {kind === 'power_planner' && (
            <PowerForm loading={loading} setLoading={setLoading} setError={setError} setResult={setResult} />
          )}
          {kind === 'export_codebook' && (
            <CodebookForm datasetId={datasetId} loading={loading}
              setLoading={setLoading} setError={setError} setResult={setResult} />
          )}
          {kind === 'exec_summary' && (
            <ExecSummaryForm datasetId={datasetId} analysisPack={analysisPack}
              loading={loading} setLoading={setLoading} setError={setError} setResult={setResult} />
          )}

          {error && (
            <div style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid #dc2626',
              padding: 10, borderRadius: 6, color: '#fca5a5', marginTop: 12, fontSize: 12 }}>
              {error}
            </div>
          )}
          {result && <ResultView kind={kind} result={result} />}
        </div>
      </div>
    </div>
  );
}

// ── Shared widgets ────────────────────────────────────────────────────────

function ColPicker({ value, onChange, cols, placeholder }: {
  value: string; onChange: (v: string) => void; cols: ColumnInfo[]; placeholder?: string;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ width: '100%', padding: 6, background: 'var(--bg-alt)', color: 'var(--text)',
        border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}>
      <option value="">{placeholder || '— pick column —'}</option>
      {cols.map(c => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
    </select>
  );
}

function MultiColPicker({ values, onChange, cols }: {
  values: string[]; onChange: (v: string[]) => void; cols: ColumnInfo[];
}) {
  const toggle = (n: string) => onChange(values.includes(n) ? values.filter(v => v !== n) : [...values, n]);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 110, overflow: 'auto',
      border: '1px solid var(--border)', padding: 6, borderRadius: 4 }}>
      {cols.map(col => (
        <button key={col.name}
          className={`btn-small ${values.includes(col.name) ? 'btn-primary' : ''}`}
          onClick={() => toggle(col.name)} style={{ fontSize: 11 }}>
          {col.name}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)',
        display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</label>
      {children}
    </div>
  );
}

function RunBtn({ loading, disabled, onClick, label }: {
  loading: boolean; disabled?: boolean; onClick: () => void; label?: string;
}) {
  return (
    <button className="btn-primary" onClick={onClick} disabled={loading || disabled}>
      {loading ? 'Running...' : (label || 'Run')}
    </button>
  );
}

async function postJson(path: string, body: any) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    try { throw new Error(JSON.parse(text).detail || text); } catch (e: any) { throw e.message ? e : new Error(text); }
  }
  return JSON.parse(text);
}

interface RunnerProps {
  datasetId: string;
  columns: ColumnInfo[];
  numericCols: ColumnInfo[];
  loading: boolean;
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
  setResult: (v: any) => void;
}

// ── DiD form ─────────────────────────────────────────────────────────────
function DiDForm({ datasetId, columns, numericCols, loading, setLoading, setError, setResult }: RunnerProps) {
  const [tCol, setTCol] = useState(''); const [pCol, setPCol] = useState('');
  const [yCol, setYCol] = useState(''); const [covs, setCovs] = useState<string[]>([]);
  const run = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await postJson('/causal/did', {
        dataset_id: datasetId, treatment_col: tCol, post_col: pCol,
        outcome_col: yCol, covariate_cols: covs,
      });
      setResult(r);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };
  return (
    <>
      <Field label="Treatment column (binary: 0/1 or Yes/No)">
        <ColPicker value={tCol} onChange={setTCol} cols={columns} />
      </Field>
      <Field label="Post column (binary: 1 = post, 0 = pre)">
        <ColPicker value={pCol} onChange={setPCol} cols={columns} />
      </Field>
      <Field label="Outcome (continuous)">
        <ColPicker value={yCol} onChange={setYCol} cols={numericCols} />
      </Field>
      <Field label="Covariates (optional, numeric)">
        <MultiColPicker values={covs} onChange={setCovs} cols={numericCols} />
      </Field>
      <RunBtn loading={loading} disabled={!tCol || !pCol || !yCol} onClick={run} />
    </>
  );
}

// ── PSM form ─────────────────────────────────────────────────────────────
function PSMForm({ datasetId, columns, numericCols, loading, setLoading, setError, setResult }: RunnerProps) {
  const [tCol, setTCol] = useState(''); const [yCol, setYCol] = useState('');
  const [covs, setCovs] = useState<string[]>([]); const [caliper, setCaliper] = useState<string>('');
  const run = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const body: any = {
        dataset_id: datasetId, treatment_col: tCol, outcome_col: yCol, covariate_cols: covs,
      };
      if (caliper) body.caliper = parseFloat(caliper);
      const r = await postJson('/causal/psm', body);
      setResult(r);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };
  return (
    <>
      <Field label="Treatment column (binary)">
        <ColPicker value={tCol} onChange={setTCol} cols={columns} />
      </Field>
      <Field label="Outcome (continuous)">
        <ColPicker value={yCol} onChange={setYCol} cols={numericCols} />
      </Field>
      <Field label="Covariates for propensity model (numeric)">
        <MultiColPicker values={covs} onChange={setCovs} cols={numericCols} />
      </Field>
      <Field label="Caliper (optional, SD units e.g., 0.2)">
        <input type="text" value={caliper} onChange={e => setCaliper(e.target.value)}
          placeholder="leave blank for no caliper"
          style={{ width: 200, padding: 6, background: 'var(--bg-alt)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }} />
      </Field>
      <RunBtn loading={loading} disabled={!tCol || !yCol || covs.length === 0} onClick={run} />
    </>
  );
}

// ── MixedLM form ─────────────────────────────────────────────────────────
function MixedLMForm({ datasetId, columns, numericCols, loading, setLoading, setError, setResult }: RunnerProps) {
  const [yCol, setYCol] = useState(''); const [gCol, setGCol] = useState('');
  const [fixed, setFixed] = useState<string[]>([]); const [slope, setSlope] = useState('');
  const run = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const body: any = {
        dataset_id: datasetId, outcome_col: yCol, group_col: gCol,
        fixed_cols: fixed, use_weights: true,
      };
      if (slope) body.random_slope_col = slope;
      const r = await postJson('/causal/mixed_lm', body);
      setResult(r);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };
  return (
    <>
      <Field label="Outcome (continuous)">
        <ColPicker value={yCol} onChange={setYCol} cols={numericCols} />
      </Field>
      <Field label="Cluster column (e.g., village_id)">
        <ColPicker value={gCol} onChange={setGCol} cols={columns} />
      </Field>
      <Field label="Fixed-effect predictors">
        <MultiColPicker values={fixed} onChange={setFixed} cols={columns} />
      </Field>
      <Field label="Random slope on (optional)">
        <ColPicker value={slope} onChange={setSlope} cols={numericCols} placeholder="(random intercept only)" />
      </Field>
      <RunBtn loading={loading} disabled={!yCol || !gCol} onClick={run} />
    </>
  );
}

// ── Power planner form ──────────────────────────────────────────────────
function PowerForm({ loading, setLoading, setError, setResult }:
  Pick<RunnerProps, 'loading' | 'setLoading' | 'setError' | 'setResult'>) {
  const [test, setTest] = useState<'two_sample_t' | 'paired_t' | 'proportions' | 'anova'>('two_sample_t');
  const [solveFor, setSolveFor] = useState<'n' | 'power' | 'effect'>('n');
  const [es, setEs] = useState('0.5');
  const [alpha, setAlpha] = useState('0.05');
  const [power, setPower] = useState('0.8');
  const [n, setN] = useState(''); const [p1, setP1] = useState(''); const [p2, setP2] = useState('');
  const [k, setK] = useState('3');

  const run = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const body: any = { alpha: parseFloat(alpha), solve_for: solveFor };
      if (solveFor !== 'effect') body.effect_size = parseFloat(es);
      if (solveFor !== 'power') body.power = parseFloat(power);
      if (solveFor === 'power' || solveFor === 'effect') {
        if (test === 'paired_t') body.n = parseFloat(n);
        else if (test === 'anova') body.n_total = parseFloat(n);
        else body.n_per_group = parseFloat(n);
      }
      if (test === 'proportions') {
        delete body.effect_size;
        if (p1) body.p1 = parseFloat(p1);
        if (p2) body.p2 = parseFloat(p2);
      }
      if (test === 'anova') body.k_groups = parseInt(k);
      const r = await postJson(`/power/${test}`, body);
      setResult(r);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <>
      <Field label="Test">
        <select value={test} onChange={e => setTest(e.target.value as any)}
          style={{ width: 280, padding: 6, background: 'var(--bg-alt)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 4 }}>
          <option value="two_sample_t">Two-sample t (independent means)</option>
          <option value="paired_t">Paired t (within-subject means)</option>
          <option value="proportions">Two-proportion z-test</option>
          <option value="anova">One-way ANOVA</option>
        </select>
      </Field>
      <Field label="Solve for">
        <select value={solveFor} onChange={e => setSolveFor(e.target.value as any)}
          style={{ width: 200, padding: 6, background: 'var(--bg-alt)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 4 }}>
          <option value="n">Sample size (N)</option>
          <option value="power">Achievable power</option>
          <option value="effect">Detectable effect</option>
        </select>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {test !== 'proportions' && solveFor !== 'effect' && (
          <Field label={test === 'anova' ? "Effect size (Cohen's f)" : "Effect size (Cohen's d)"}>
            <input type="number" step="0.05" value={es} onChange={e => setEs(e.target.value)}
              style={{ width: '100%', padding: 6, background: 'var(--bg-alt)', color: 'var(--text)',
                border: '1px solid var(--border)', borderRadius: 4 }} />
          </Field>
        )}
        {test === 'proportions' && (
          <>
            <Field label="p₁ (group 1 proportion)">
              <input type="number" step="0.01" value={p1} onChange={e => setP1(e.target.value)}
                style={{ width: '100%', padding: 6, background: 'var(--bg-alt)',
                  color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4 }} />
            </Field>
            <Field label="p₂ (group 2 proportion)">
              <input type="number" step="0.01" value={p2} onChange={e => setP2(e.target.value)}
                style={{ width: '100%', padding: 6, background: 'var(--bg-alt)',
                  color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4 }} />
            </Field>
          </>
        )}
        <Field label="α (significance level)">
          <input type="number" step="0.01" value={alpha} onChange={e => setAlpha(e.target.value)}
            style={{ width: '100%', padding: 6, background: 'var(--bg-alt)', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: 4 }} />
        </Field>
        {solveFor !== 'power' && (
          <Field label="Power">
            <input type="number" step="0.05" value={power} onChange={e => setPower(e.target.value)}
              style={{ width: '100%', padding: 6, background: 'var(--bg-alt)', color: 'var(--text)',
                border: '1px solid var(--border)', borderRadius: 4 }} />
          </Field>
        )}
        {solveFor !== 'n' && (
          <Field label={test === 'anova' ? 'N total' : test === 'paired_t' ? 'N pairs' : 'N per group'}>
            <input type="number" value={n} onChange={e => setN(e.target.value)}
              style={{ width: '100%', padding: 6, background: 'var(--bg-alt)', color: 'var(--text)',
                border: '1px solid var(--border)', borderRadius: 4 }} />
          </Field>
        )}
        {test === 'anova' && (
          <Field label="K groups">
            <input type="number" value={k} onChange={e => setK(e.target.value)}
              style={{ width: '100%', padding: 6, background: 'var(--bg-alt)', color: 'var(--text)',
                border: '1px solid var(--border)', borderRadius: 4 }} />
          </Field>
        )}
      </div>
      <RunBtn loading={loading} onClick={run} label="Compute" />
    </>
  );
}

// ── Codebook form ──────────────────────────────────────────────────────
function CodebookForm({ datasetId, loading, setLoading, setError, setResult }:
  Pick<RunnerProps, 'datasetId' | 'loading' | 'setLoading' | 'setError' | 'setResult'>) {
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [includeFreq, setIncludeFreq] = useState(true);
  const [maxLevels, setMaxLevels] = useState('25');

  const run = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await postJson('/export/codebook', {
        dataset_id: datasetId, title: title || undefined, subtitle: subtitle || undefined,
        include_frequencies: includeFreq, max_freq_levels: parseInt(maxLevels) || 25,
      });
      setResult(r);
      // Auto-trigger download
      window.location.href = `${API_BASE}/files/download?path=${encodeURIComponent(r.path)}`;
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <>
      <Field label="Title (optional)">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Data Codebook"
          style={{ width: '100%', padding: 6, background: 'var(--bg-alt)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 4 }} />
      </Field>
      <Field label="Subtitle (optional)">
        <input value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="Methodology appendix"
          style={{ width: '100%', padding: 6, background: 'var(--bg-alt)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 4 }} />
      </Field>
      <Field label="Max frequency levels per variable">
        <input type="number" value={maxLevels} onChange={e => setMaxLevels(e.target.value)}
          style={{ width: 100, padding: 6, background: 'var(--bg-alt)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 4 }} />
      </Field>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 12 }}>
        <input type="checkbox" checked={includeFreq} onChange={e => setIncludeFreq(e.target.checked)} />
        Include frequency tables for categorical/low-cardinality columns
      </label>
      <RunBtn loading={loading} onClick={run} label="Generate Codebook" />
    </>
  );
}

// ── Exec summary form ──────────────────────────────────────────────────
function ExecSummaryForm({ datasetId, analysisPack, loading, setLoading, setError, setResult }:
  Pick<RunnerProps, 'datasetId' | 'loading' | 'setLoading' | 'setError' | 'setResult'> &
  { analysisPack?: any[] | null }) {
  const [audience, setAudience] = useState<'executive' | 'general' | 'technical'>('general');
  const [title, setTitle] = useState('');

  const run = async () => {
    if (!analysisPack || analysisPack.length === 0) {
      setError('No Analysis Pack available. Run Auto-Analyze first.');
      return;
    }
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await postJson('/analyze/exec-summary', {
        dataset_id: datasetId, results: analysisPack,
        audience, title: title || undefined,
      });
      setResult(r);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <>
      {!analysisPack || analysisPack.length === 0 ? (
        <div style={{ padding: 12, background: 'rgba(251,191,36,0.1)',
          border: '1px solid rgba(251,191,36,0.4)', borderRadius: 6, color: '#fbbf24', fontSize: 12 }}>
          No Analysis Pack found. Run <strong>Run Full Analysis</strong> first, then come back.
        </div>
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {analysisPack.length} results in the current pack.
          </p>
          <Field label="Audience">
            <select value={audience} onChange={e => setAudience(e.target.value as any)}
              style={{ width: 240, padding: 6, background: 'var(--bg-alt)', color: 'var(--text)',
                border: '1px solid var(--border)', borderRadius: 4 }}>
              <option value="executive">Executive (250 w, no jargon)</option>
              <option value="general">General (400 w, plain English)</option>
              <option value="technical">Technical (600 w, with caveats)</option>
            </select>
          </Field>
          <Field label="Study title (optional)">
            <input value={title} onChange={e => setTitle(e.target.value)}
              style={{ width: '100%', padding: 6, background: 'var(--bg-alt)', color: 'var(--text)',
                border: '1px solid var(--border)', borderRadius: 4 }} />
          </Field>
          <RunBtn loading={loading} onClick={run} label="Generate Summary" />
        </>
      )}
    </>
  );
}

// ── Result view ────────────────────────────────────────────────────────
function ResultView({ kind, result }: { kind: AdvancedKind; result: any }) {
  if (kind === 'exec_summary' && result.summary_markdown) {
    return (
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
          Audience: {result.audience} · {result.n_significant}/{result.n_total} significant findings
        </div>
        <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--border)',
          borderRadius: 6, padding: 16, whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.55,
          fontFamily: 'inherit' }}>{result.summary_markdown}</div>
      </div>
    );
  }
  if (kind === 'export_codebook' && result.download_filename) {
    return (
      <div style={{ marginTop: 16, padding: 12, background: 'rgba(34,197,94,0.1)',
        border: '1px solid rgba(34,197,94,0.4)', borderRadius: 6, color: '#86efac', fontSize: 13 }}>
        ✓ {result.message}. Download triggered for <strong>{result.download_filename}</strong>
        ({result.n_variables} variables).
      </div>
    );
  }
  if (kind === 'power_planner') {
    return (
      <div style={{ marginTop: 16 }}>
        <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--border)',
          borderRadius: 6, padding: 14 }}>
          <div style={{ fontSize: 14, color: 'var(--text)', marginBottom: 8 }}>
            {result.interpretation}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
            {Object.entries(result).filter(([k]) =>
              !['interpretation', 'solved', 'effect_label'].includes(k)
            ).map(([k, v]: [string, any]) => (
              <div key={k} style={{ background: 'rgba(0,0,0,0.2)', padding: '6px 10px',
                borderRadius: 4, fontSize: 12 }}>
                <span style={{ color: 'var(--text-dim)' }}>{k}: </span>
                <strong style={{ fontFamily: 'monospace' }}>
                  {typeof v === 'number' ? v.toFixed(4).replace(/\.?0+$/, '') : String(v)}
                </strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  // DiD / PSM / MixedLM share the AnalysisResult shape
  const r = result?.result || result;
  const tbl = r?.table || (r?.headers ? r : null);
  return (
    <div style={{ marginTop: 16 }}>
      {r?.interpretation && (
        <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.3)',
          padding: 12, borderRadius: 6, fontSize: 13, color: 'var(--text)', marginBottom: 12 }}>
          {r.interpretation}
        </div>
      )}
      {tbl?.headers && (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'rgba(0,0,0,0.3)' }}>
                {tbl.headers.map((h: string, i: number) => (
                  <th key={i} style={{ padding: '6px 10px', textAlign: 'left',
                    borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(tbl.rows || []).map((row: any[], ri: number) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ padding: '5px 10px',
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                      fontFamily: typeof cell === 'number' ? 'monospace' : 'inherit' }}>
                      {cell == null ? '' : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r?.warnings && r.warnings.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 11, color: '#fbbf24' }}>
          ⚠ {r.warnings.join(' · ')}
        </div>
      )}
    </div>
  );
}
