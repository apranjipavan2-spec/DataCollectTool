import React, { useRef, useState, useEffect } from 'react';
import { fgListPrograms, fgListQuestionnaires, importFromFg } from '../api';

interface FgContext { fgUrl: string; token: string; programId?: string }

interface Props {
  onFileUpload: (file: File) => void;
  onProjectImport?: (projectData: any) => void;
  onDatasetLoaded?: (meta: any) => void;
  fgContext?: FgContext | null;
  loading: boolean;
  error: string | null;
}

interface Program { id: string; name: string; scheme_name: string }
interface Questionnaire { questionnaire_id: string; name: string; form_title: string }

const s = {
  wrap: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
    justifyContent: 'center', minHeight: '100vh', padding: '32px 16px',
    background: 'var(--bg, #0f172a)',
  },
  card: {
    background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #334155)',
    borderRadius: 16, padding: 36, width: '100%', maxWidth: 460,
    display: 'flex', flexDirection: 'column' as const, gap: 0,
  },
  label: { fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: 6 },
  select: {
    width: '100%', padding: '11px 14px', borderRadius: 8, fontSize: 14,
    border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0',
    outline: 'none', cursor: 'pointer', appearance: 'none' as const,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748b' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
  },
  btnPrimary: {
    width: '100%', padding: '12px 0', borderRadius: 8, border: 'none',
    background: '#3b82f6', color: '#fff', fontSize: 14, fontWeight: 700,
    cursor: 'pointer', transition: 'opacity 0.15s',
  },
  divider: { display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0' },
  dividerLine: { flex: 1, height: 1, background: '#1e293b' },
  dividerText: { fontSize: 12, color: '#475569', whiteSpace: 'nowrap' as const },
  linkBtn: {
    background: 'none', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px',
    color: '#94a3b8', fontSize: 13, cursor: 'pointer', width: '100%', textAlign: 'left' as const,
    display: 'flex', alignItems: 'center', gap: 8,
  },
  errorMsg: { color: '#f87171', fontSize: 12, marginTop: 8, padding: '8px 12px', background: 'rgba(248,113,113,0.08)', borderRadius: 6 },
};

export function WelcomeScreen({ onFileUpload, onProjectImport, onDatasetLoaded, fgContext, loading, error }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const projectFileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);

  const [programs, setPrograms]           = useState<Program[]>([]);
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>([]);
  const [selProgram, setSelProgram]         = useState('');
  const [selQ, setSelQ]                     = useState('');
  const [fgLoading, setFgLoading]           = useState(false);
  const [fgError, setFgError]               = useState('');
  const [showUpload, setShowUpload]         = useState(!fgContext);

  useEffect(() => {
    if (!fgContext) { setShowUpload(true); return; }
    setShowUpload(false);
    fgListPrograms(fgContext.fgUrl, fgContext.token).then(setPrograms).catch(() => {});
    if (fgContext.programId) setSelProgram(fgContext.programId);
  }, [fgContext]);

  useEffect(() => {
    if (!fgContext || !selProgram) { setQuestionnaires([]); setSelQ(''); return; }
    fgListQuestionnaires(fgContext.fgUrl, fgContext.token, selProgram)
      .then(q => { setQuestionnaires(q); setSelQ(''); })
      .catch(() => {});
  }, [fgContext, selProgram]);

  const handleFgLoad = async () => {
    if (!fgContext || !selProgram) return;
    setFgLoading(true); setFgError('');
    try {
      const meta = await importFromFg(fgContext.fgUrl, fgContext.token, selProgram, selQ || undefined);
      onDatasetLoaded?.(meta);
    } catch (e: any) {
      setFgError(e.message || 'Load failed');
    } finally { setFgLoading(false); }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragRef.current?.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (file.name.endsWith('.tableforge') || file.name.endsWith('.json')) handleProjectFile(file);
    else onFileUpload(file);
  };

  const handleProjectFile = (file: File) => {
    if (!onProjectImport) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try { const d = JSON.parse(ev.target?.result as string); if (d.tables) onProjectImport(d); } catch {}
    };
    reader.readAsText(file);
  };

  const selectedProgName = programs.find(p => p.id === selProgram)?.name;

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img src="/logo-icon.png" alt="Analyzer" style={{ width: 40, height: 40, marginBottom: 8, display: 'block', margin: '0 auto 8px' }} />
          <div style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.02em' }}>Analyzer</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>FieldGovern Data Analyzer</div>
        </div>

        {/* FG loader — shown when token present */}
        {fgContext && (
          <>
            <div style={{ marginBottom: 16 }}>
              <div style={s.label}>Program</div>
              <select style={s.select} value={selProgram} onChange={e => setSelProgram(e.target.value)}>
                <option value="">Select a program…</option>
                {programs.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.scheme_name ? ` — ${p.scheme_name}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {selProgram && (
              <div style={{ marginBottom: 20 }}>
                <div style={s.label}>Questionnaire / Form <span style={{ color: '#475569', textTransform: 'none', fontWeight: 400 }}>(optional — leave blank to load all)</span></div>
                <select style={s.select} value={selQ} onChange={e => setSelQ(e.target.value)}>
                  <option value="">All questionnaires</option>
                  {questionnaires.map(q => (
                    <option key={q.questionnaire_id} value={q.questionnaire_id}>
                      {q.name}{q.form_title ? ` (${q.form_title})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              style={{ ...s.btnPrimary, opacity: selProgram && !fgLoading ? 1 : 0.4 }}
              disabled={!selProgram || fgLoading}
              onClick={handleFgLoad}
            >
              {fgLoading ? 'Loading data…' : `Load${selectedProgName ? ` "${selectedProgName}"` : ''} →`}
            </button>

            {fgError && <div style={s.errorMsg}>{fgError}</div>}

            <div style={s.divider}>
              <div style={s.dividerLine} />
              <span style={s.dividerText}>or</span>
              <div style={s.dividerLine} />
            </div>
          </>
        )}

        {/* Upload / project import — only show when no FG context */}
        {!fgContext && (
          <div
            ref={dragRef}
            onDragOver={e => { e.preventDefault(); dragRef.current?.classList.add('drag-over'); }}
            onDragLeave={() => dragRef.current?.classList.remove('drag-over')}
            onDrop={handleDrop}
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            {loading ? (
              <div style={{ textAlign: 'center', color: '#64748b', fontSize: 13, padding: 16 }}>Loading…</div>
            ) : (
              <>
                <button style={s.linkBtn} onClick={() => fileRef.current?.click()}>
                  <span>📂</span> Import CSV or Excel file
                </button>
                {onProjectImport && (
                  <button style={s.linkBtn} onClick={() => projectFileRef.current?.click()}>
                    <span>📋</span> Load saved project (.tableforge)
                  </button>
                )}
                <div style={{ fontSize: 11, color: '#475569', textAlign: 'center', marginTop: 4 }}>
                  Drag &amp; drop a file anywhere on this screen
                </div>
              </>
            )}
            {error && <div style={s.errorMsg}>{error}</div>}
          </div>
        )}

        {/* When FG context, offer local import as last resort */}
        {fgContext && (
          <button style={{ ...s.linkBtn, marginTop: 8, opacity: 0.6, fontSize: 12 }} onClick={() => fileRef.current?.click()}>
            <span>📂</span> Import a local CSV / Excel file instead
          </button>
        )}
      </div>

      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFileUpload(f); e.target.value = ''; }} />
      <input ref={projectFileRef} type="file" accept=".tableforge,.json" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleProjectFile(f); e.target.value = ''; }} />
    </div>
  );
}
