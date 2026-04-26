import React, { useRef, useState, useEffect } from 'react';
import { fgListPrograms, fgListQuestionnaires, importFromFg } from '../api';

interface FgContext {
  fgUrl: string;
  token: string;
  programId?: string;
}

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

export function WelcomeScreen({ onFileUpload, onProjectImport, onDatasetLoaded, fgContext, loading, error }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const projectFileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);

  const [programs, setPrograms]             = useState<Program[]>([]);
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>([]);
  const [selProgram, setSelProgram]         = useState('');
  const [selQuestionnaire, setSelQuestionnaire] = useState('');
  const [fgLoading, setFgLoading]           = useState(false);
  const [fgError, setFgError]               = useState('');

  // Load programs when FG context is available
  useEffect(() => {
    if (!fgContext) return;
    fgListPrograms(fgContext.fgUrl, fgContext.token)
      .then(setPrograms)
      .catch(() => {});
    if (fgContext.programId) setSelProgram(fgContext.programId);
  }, [fgContext]);

  // Load questionnaires when program changes
  useEffect(() => {
    if (!fgContext || !selProgram) { setQuestionnaires([]); setSelQuestionnaire(''); return; }
    fgListQuestionnaires(fgContext.fgUrl, fgContext.token, selProgram)
      .then(q => { setQuestionnaires(q); setSelQuestionnaire(''); })
      .catch(() => {});
  }, [fgContext, selProgram]);

  const handleFgLoad = async () => {
    if (!fgContext || !selProgram) return;
    setFgLoading(true); setFgError('');
    try {
      const meta = await importFromFg(fgContext.fgUrl, fgContext.token, selProgram, selQuestionnaire || undefined);
      onDatasetLoaded?.(meta);
    } catch (e: any) {
      setFgError(e.message || 'Load failed');
    } finally {
      setFgLoading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragRef.current?.classList.add('drag-over');
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragRef.current?.classList.remove('drag-over');
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragRef.current?.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) {
      if (file.name.endsWith('.tableforge') || file.name.endsWith('.json')) handleProjectFile(file);
      else onFileUpload(file);
    }
  };
  const handleProjectFile = (file: File) => {
    if (!onProjectImport) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (data.tables) onProjectImport(data);
      } catch { /* invalid */ }
    };
    reader.readAsText(file);
  };

  const selStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)',
    background: 'rgba(255,255,255,0.06)', color: 'var(--text)', fontSize: 13, outline: 'none',
  };
  const btnStyle: React.CSSProperties = {
    width: '100%', padding: '10px', borderRadius: 6, border: 'none',
    background: 'var(--primary, #4f8ef7)', color: '#fff', fontSize: 13, fontWeight: 600,
    cursor: selProgram && !fgLoading ? 'pointer' : 'not-allowed',
    opacity: selProgram && !fgLoading ? 1 : 0.5,
  };

  return (
    <div className="welcome">
      {/* ── FieldGovern data loader ─────────────────────────────────── */}
      {fgContext && (
        <div style={{
          background: 'rgba(79,142,247,0.08)', border: '1px solid rgba(79,142,247,0.3)',
          borderRadius: 12, padding: 20, marginBottom: 20, maxWidth: 400, width: '100%',
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>
            Load from FieldGovern
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <select style={selStyle} value={selProgram} onChange={e => setSelProgram(e.target.value)}>
              <option value="">— Select program —</option>
              {programs.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.scheme_name ? ` · ${p.scheme_name}` : ''}
                </option>
              ))}
            </select>
            {selProgram && (
              <select style={selStyle} value={selQuestionnaire} onChange={e => setSelQuestionnaire(e.target.value)}>
                <option value="">— All questionnaires —</option>
                {questionnaires.map(q => (
                  <option key={q.questionnaire_id} value={q.questionnaire_id}>
                    {q.name}{q.form_title ? ` (${q.form_title})` : ''}
                  </option>
                ))}
              </select>
            )}
            <button style={btnStyle} disabled={!selProgram || fgLoading} onClick={handleFgLoad}>
              {fgLoading ? 'Loading…' : 'Load Data →'}
            </button>
            {fgError && <div style={{ fontSize: 12, color: '#f87171' }}>{fgError}</div>}
          </div>
        </div>
      )}

      {/* ── File upload card ────────────────────────────────────────── */}
      <div ref={dragRef} className="welcome-card" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        <img src="/logo.png" alt="TableForge" style={{ width: 80, height: 80, marginBottom: 8 }} />
        <h1>TableForge</h1>
        <p className="welcome-tagline">by Pavankumar Deshetty &middot; +91 83173 90926</p>
        <p className="welcome-desc">
          Build, analyze, format, and export publication-ready tables from Excel data.
        </p>
        {loading ? (
          <div className="loading-spinner">Loading file...</div>
        ) : (
          <>
            <button className="btn-primary" onClick={() => fileRef.current?.click()}>
              📂 Import Excel or CSV File
            </button>
            <p className="welcome-hint">or drag & drop a file here</p>
            <p className="welcome-formats">Supports .xlsx, .xls, .csv, .tsv</p>
            {onProjectImport && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => projectFileRef.current?.click()}>
                  📋 Import from Project File (.tableforge)
                </button>
                <p className="welcome-hint" style={{ fontSize: 11, marginTop: 4 }}>
                  Load a previously saved project to re-generate tables
                </p>
              </div>
            )}
          </>
        )}
        {error && <div className="error-msg">{error}</div>}
      </div>

      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFileUpload(f); e.target.value = ''; }} />
      <input ref={projectFileRef} type="file" accept=".tableforge,.json" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleProjectFile(f); e.target.value = ''; }} />
    </div>
  );
}
