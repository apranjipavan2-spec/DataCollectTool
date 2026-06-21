import React, { useRef, useState, useEffect } from 'react';
import { fgListPrograms, fgListQuestionnaires, importFromFg, fgListUserProjects, listProjects, FgProgressEvent, listServerFiles, uploadToServer, loadServerFile, deleteServerFile, renameProject, deleteProject, isSuperAdmin, ServerFile } from '../api';

interface FgContext { fgUrl: string; token: string; programId?: string }

interface Props {
  onFileUpload: (file: File) => void;
  onProjectImport?: (projectData: any) => void;
  onDatasetLoaded?: (meta: any) => void;
  fgContext?: FgContext | null;
  loading: boolean;
  loadingMsg?: string;
  error: string | null;
  uploadProgress?: number | null;
  onLoadFgProject?: (project: any) => void;
  onLoadLocalProject?: (path: string) => void;
}

interface Program { id: string; name: string; scheme_name: string }
interface Questionnaire { questionnaire_id: string; name: string; form_title: string }
interface RecentProject { id: string; name: string; updated_at: string; program_id?: string }
interface LocalProject { name: string; path: string; created: string; version_count: number; source_file?: string }

const s = {
  wrap: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
    justifyContent: 'center', minHeight: '100vh', padding: '32px 16px',
    background: 'var(--bg, #0f172a)',
  },
  card: {
    background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #334155)',
    borderRadius: 16, padding: 36, width: '100%', maxWidth: 480,
    display: 'flex', flexDirection: 'column' as const, gap: 0,
  },
  cardWide: {
    background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #334155)',
    borderRadius: 16, padding: 36, width: '100%', maxWidth: 820,
    display: 'flex', flexDirection: 'column' as const, gap: 0,
  },
  twoCol: {
    display: 'flex', gap: 28, alignItems: 'flex-start',
  },
  colLeft: {
    flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' as const, gap: 0,
  },
  colRight: {
    flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' as const, gap: 0,
    borderLeft: '1px solid #334155', paddingLeft: 28,
  },
  sectionTitle: {
    fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em',
    textTransform: 'uppercase' as const, marginBottom: 12,
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
  divider: { display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' },
  dividerLine: { flex: 1, height: 1, background: '#334155' },
  dividerText: { fontSize: 12, color: '#475569', whiteSpace: 'nowrap' as const },
  linkBtn: {
    background: 'none', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px',
    color: '#94a3b8', fontSize: 13, cursor: 'pointer', width: '100%', textAlign: 'left' as const,
    display: 'flex', alignItems: 'center', gap: 8,
  },
  errorMsg: { color: '#f87171', fontSize: 12, marginTop: 8, padding: '8px 12px', background: 'rgba(248,113,113,0.08)', borderRadius: 6 },
};

function formatRelative(dateStr: string) {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch { return ''; }
}

export function WelcomeScreen({ onFileUpload, onProjectImport, onDatasetLoaded, fgContext, loading, loadingMsg, error, uploadProgress, onLoadFgProject, onLoadLocalProject }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const projectFileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);

  const [programs, setPrograms]             = useState<Program[]>([]);
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>([]);
  const [selProgram, setSelProgram]         = useState('');
  const [selQ, setSelQ]                     = useState('');
  const [fgLoading, setFgLoading]           = useState(false);
  const [fgError, setFgError]               = useState('');
  const [fgProgress, setFgProgress]         = useState<FgProgressEvent | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [localProjects, setLocalProjects]   = useState<LocalProject[]>([]);
  const [serverFiles, setServerFiles]       = useState<ServerFile[]>([]);
  const [sfLoading, setSfLoading]           = useState('');
  const [sfUploading, setSfUploading]       = useState(false);
  // Tracks the initial project/file fetch so we can show a spinner instead of
  // the "nothing saved" message while the list is still loading. Identity is
  // verified server-side via a live call to FieldGovern, so the first fetch can
  // take a moment — without this, an in-flight request looked like an empty list.
  const [listLoading, setListLoading]       = useState(true);
  const serverFileRef = useRef<HTMLInputElement>(null);
  const isAdmin = isSuperAdmin();

  const refreshProjects = () => {
    return listProjects()
      .then((res: any) => setLocalProjects((res.projects || []).slice(0, 20)))
      .catch(() => {});
  };

  const refreshFiles = () => {
    return listServerFiles()
      .then(res => setServerFiles(res.files || []))
      .catch(() => {});
  };

  useEffect(() => {
    setListLoading(true);
    Promise.all([refreshProjects(), refreshFiles()])
      .finally(() => setListLoading(false));
  }, []);

  const analyzerProjects = localProjects.filter(p => p.name !== '__autosave__');

  const handleRenameProject = async (proj: LocalProject) => {
    const newName = prompt('Rename project:', proj.name);
    if (!newName || !newName.trim() || newName.trim() === proj.name) return;
    try {
      await renameProject(proj.path, newName.trim());
      refreshProjects();
    } catch {}
  };

  const handleDeleteProject = async (proj: LocalProject) => {
    if (!confirm(`Delete project "${proj.name}"? This cannot be undone.`)) return;
    try {
      await deleteProject(proj.path);
      refreshProjects();
    } catch {}
  };

  const handleServerUpload = async (file: File) => {
    setSfUploading(true);
    try {
      await uploadToServer(file);
      const res = await listServerFiles();
      setServerFiles(res.files || []);
    } catch {}
    setSfUploading(false);
  };

  const handleServerLoad = async (f: ServerFile) => {
    setSfLoading(f.id);
    try {
      const meta = await loadServerFile(f.id);
      onDatasetLoaded?.(meta);
    } catch {}
    setSfLoading('');
  };

  const handleServerDelete = async (f: ServerFile) => {
    try {
      await deleteServerFile(f.id);
      setServerFiles(prev => prev.filter(x => x.id !== f.id));
    } catch {}
  };

  useEffect(() => {
    if (!fgContext) return;
    fgListPrograms(fgContext.fgUrl, fgContext.token).then(setPrograms).catch(() => {});
    if (fgContext.programId) setSelProgram(fgContext.programId);
    fgListUserProjects(fgContext.fgUrl, fgContext.token, 'analyzer')
      .then((projs: any[]) => {
        const valid = projs.filter(p => p.name && p.name !== '__autosave__');
        setRecentProjects(valid.slice(0, 3));
      })
      .catch(() => {});
  }, [fgContext]);

  useEffect(() => {
    if (!fgContext || !selProgram) { setQuestionnaires([]); setSelQ(''); return; }
    fgListQuestionnaires(fgContext.fgUrl, fgContext.token, selProgram)
      .then(q => { setQuestionnaires(q); setSelQ(''); })
      .catch(() => {});
  }, [fgContext, selProgram]);

  const handleFgLoad = async () => {
    if (!fgContext || !selProgram) return;
    setFgLoading(true); setFgError(''); setFgProgress(null);
    try {
      const meta = await importFromFg(
        fgContext.fgUrl, fgContext.token, selProgram, selQ || undefined,
        (ev) => setFgProgress(ev),
      );
      onDatasetLoaded?.(meta);
    } catch (e: any) {
      setFgError(e.message || 'Failed to load data from FieldGovern');
    } finally { setFgLoading(false); setFgProgress(null); }
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

  const serverFilesSection = serverFiles.length > 0 || !loading ? (
    <>
      <div style={s.divider}>
        <div style={s.dividerLine} />
        <span style={s.dividerText}>server files</span>
        <div style={s.dividerLine} />
      </div>
      {serverFiles.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {serverFiles.map(f => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                style={{ ...s.linkBtn, flex: 1, opacity: sfLoading === f.id ? 0.5 : 1 }}
                disabled={!!sfLoading}
                onClick={() => handleServerLoad(f)}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                  <span style={{ fontSize: 14 }}>{f.ext === 'csv' || f.ext === 'tsv' ? '\ud83d\udcc4' : '\ud83d\udcca'}</span>
                  <span style={{ fontSize: 13, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.original_name}</span>
                </span>
                <span style={{ fontSize: 11, color: '#475569', whiteSpace: 'nowrap' }}>
                  {f.size_mb > 0 ? `${f.size_mb} MB` : `${Math.round(f.size_bytes / 1024)} KB`} · {formatRelative(f.uploaded_at)}
                </span>
              </button>
              <button
                onClick={() => handleServerDelete(f)}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '4px 6px', fontSize: 14 }}
                title="Delete from server"
              >&times;</button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#475569', textAlign: 'center' }}>No files saved on server yet</div>
      )}
      <button
        style={{ ...s.linkBtn, justifyContent: 'center', marginTop: 6, opacity: sfUploading ? 0.5 : 1 }}
        disabled={sfUploading}
        onClick={() => serverFileRef.current?.click()}
      >
        {sfUploading ? 'Uploading…' : '\u2b06 Save file to server'}
      </button>
    </>
  ) : null;

  return (
    <div style={s.wrap}>
      <div style={fgContext ? s.cardWide : s.card}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img src={import.meta.env.BASE_URL + 'logo-wide.png'} alt="FieldGovern" style={{ height: 44, width: 'auto', display: 'block', margin: '0 auto 8px' }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.04em', marginTop: 2 }}>Data Analyzer</div>
        </div>

        {/* Loading indicator — full width above columns */}
        {fgContext && (loading || fgLoading) && (
          <div style={{ textAlign: 'center', padding: '20px 0', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ width: 18, height: 18, border: '2.5px solid rgba(59,130,246,0.2)', borderTop: '2.5px solid #3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <span style={{ fontSize: 14, color: '#94a3b8' }}>
                {fgProgress?.message || (fgLoading ? 'Connecting…' : (loadingMsg || 'Importing data from FieldGovern…'))}
              </span>
            </div>
            {fgProgress && fgProgress.percent > 0 && (
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{fgProgress.percent}%</div>
            )}
            <div style={{ width: '100%', height: 4, background: 'rgba(100,116,139,0.15)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                width: fgProgress && fgProgress.percent > 0 ? `${fgProgress.percent}%` : '100%',
                height: '100%', background: '#3b82f6', borderRadius: 3,
                transition: fgProgress ? 'width 0.3s ease' : 'none',
                ...(fgProgress && fgProgress.percent > 0 ? {} : { animation: 'indeterminate 1.5s ease-in-out infinite' }),
              }} />
            </div>
            {fgProgress && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {fgProgress.step === 'connecting' && '● Connecting to server'}
                {fgProgress.step === 'downloading' && '● Downloading data'}
                {fgProgress.step === 'saving' && '● Saving file'}
                {fgProgress.step === 'parsing' && '● Parsing Excel'}
                {fgProgress.step === 'extracting' && '● Extracting columns'}
                {fgProgress.step === 'finalizing' && '● Building dataset'}
                {fgProgress.step === 'done' && '● Complete'}
              </div>
            )}
            <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes indeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>
          </div>
        )}

        {/* FG program picker — two-column layout */}
        {fgContext ? (
          <div style={s.twoCol}>
            {/* Left column: Program & Questionnaire selection */}
            <div style={s.colLeft}>
              <div style={s.sectionTitle}>Load Data</div>

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
                  <div style={s.label}>
                    Questionnaire / Form{' '}
                    <span style={{ color: '#475569', textTransform: 'none', fontWeight: 400 }}>(optional)</span>
                  </div>
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
              <button style={{ ...s.linkBtn, justifyContent: 'center', gap: 8 }}
                onClick={() => fileRef.current?.click()}>
                <span>📂</span>
                <span style={{ fontSize: 13, color: '#e2e8f0' }}>Import Excel / CSV File</span>
              </button>

              {/* Recent FG sessions */}
              {recentProjects.length > 0 && (
                <>
                  <div style={s.divider}>
                    <div style={s.dividerLine} />
                    <span style={s.dividerText}>recent sessions</span>
                    <div style={s.dividerLine} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {recentProjects.map(proj => (
                      <button key={proj.id} style={{ ...s.linkBtn, justifyContent: 'space-between' }}
                        onClick={() => {
                          if (proj.program_id) setSelProgram(proj.program_id);
                          if ((proj as any).data && onLoadFgProject) onLoadFgProject(proj);
                        }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span>📊</span>
                          <span style={{ fontSize: 13, color: '#e2e8f0' }}>{proj.name}</span>
                        </span>
                        <span style={{ fontSize: 11, color: '#475569' }}>{formatRelative(proj.updated_at)}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Right column: Files & Projects */}
            <div style={s.colRight}>
              {/* Upload button — super admin only */}
              {isAdmin && !loading && !fgLoading && (
                <div style={{ marginBottom: 16 }}>
                  <button
                    style={{ ...s.btnPrimary, background: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: sfUploading ? 0.5 : 1 }}
                    disabled={sfUploading}
                    onClick={() => serverFileRef.current?.click()}
                  >
                    {sfUploading ? 'Uploading…' : '\u2b06 Upload File to Server'}
                  </button>
                  <div style={{ fontSize: 10, color: '#475569', textAlign: 'center', marginTop: 4 }}>Available in /analyzer and /cleaner</div>
                </div>
              )}

              {/* Scrollable file/project list */}
              <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0, paddingRight: 4 }}>
                {/* Server files section */}
                {!loading && !fgLoading && serverFiles.length > 0 && (
                  <>
                    <div style={s.sectionTitle}>Server Files</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
                      {serverFiles.map(f => (
                        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <button
                            style={{ ...s.linkBtn, flex: 1, opacity: sfLoading === f.id ? 0.5 : 1, padding: '8px 10px' }}
                            disabled={!!sfLoading}
                            onClick={() => handleServerLoad(f)}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                              <span style={{ fontSize: 13 }}>{f.ext === 'csv' || f.ext === 'tsv' ? '\ud83d\udcc4' : '\ud83d\udcca'}</span>
                              <span style={{ fontSize: 12, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.original_name}</span>
                            </span>
                            <span style={{ fontSize: 10, color: '#475569', whiteSpace: 'nowrap' }}>
                              {f.size_mb > 0 ? `${f.size_mb} MB` : `${Math.round(f.size_bytes / 1024)} KB`}
                            </span>
                          </button>
                          <button onClick={() => handleServerDelete(f)}
                            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '2px 4px', fontSize: 13 }}
                            title="Delete from server">&times;</button>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Analyzer Projects folder */}
                {analyzerProjects.length > 0 && (
                  <>
                    <div style={{ ...s.sectionTitle, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13 }}>📂</span> Analyzer Projects
                      <span style={{ fontSize: 10, fontWeight: 400, color: '#475569' }}>({analyzerProjects.length})</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
                      {analyzerProjects.map(proj => (
                        <div key={proj.path} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <button style={{ ...s.linkBtn, flex: 1, padding: '8px 10px' }}
                            onClick={() => onLoadLocalProject?.(proj.path)}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                              <span style={{ fontSize: 13 }}>📋</span>
                              <span style={{ fontSize: 12, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{proj.name}</span>
                            </span>
                            <span style={{ fontSize: 10, color: '#475569', whiteSpace: 'nowrap' }}>{proj.created ? formatRelative(proj.created) : ''}</span>
                          </button>
                          <button onClick={() => handleRenameProject(proj)}
                            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '2px 4px', fontSize: 11 }}
                            title="Rename">✏</button>
                          <button onClick={() => handleDeleteProject(proj)}
                            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '2px 4px', fontSize: 13 }}
                            title="Delete">&times;</button>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Loading indicator — list fetch still in flight */}
                {!loading && !fgLoading && listLoading && serverFiles.length === 0 && analyzerProjects.length === 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '24px 0' }}>
                    <div style={{ width: 14, height: 14, border: '2px solid rgba(59,130,246,0.2)', borderTop: '2px solid #3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    <span style={{ fontSize: 12, color: '#64748b' }}>Loading your files & projects…</span>
                  </div>
                )}

                {/* No content message — only once the fetch has finished */}
                {!loading && !fgLoading && !listLoading && serverFiles.length === 0 && analyzerProjects.length === 0 && (
                  <div style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: '24px 0' }}>
                    No files or projects saved yet
                  </div>
                )}
              </div>

              {/* Non-admin upload */}
              {!isAdmin && !loading && !fgLoading && (
                <button
                  style={{ ...s.linkBtn, justifyContent: 'center', marginTop: 8, opacity: sfUploading ? 0.5 : 1 }}
                  disabled={sfUploading}
                  onClick={() => serverFileRef.current?.click()}
                >
                  {sfUploading ? 'Uploading…' : '\u2b06 Save file to server'}
                </button>
              )}
            </div>
          </div>
        ) : (
          /* No FG context — plain file upload */
          <div
            ref={dragRef}
            onDragOver={e => { e.preventDefault(); dragRef.current?.classList.add('drag-over'); }}
            onDragLeave={() => dragRef.current?.classList.remove('drag-over')}
            onDrop={handleDrop}
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            {loading ? (
              <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: 20 }}>
                {uploadProgress != null ? (
                  <div>
                    <div style={{ marginBottom: 10, fontWeight: 600 }}>Uploading… {uploadProgress}%</div>
                    <div style={{ width: '100%', height: 6, background: 'rgba(100,116,139,0.2)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#3b82f6', borderRadius: 3, transition: 'width 0.2s' }} />
                    </div>
                    {uploadProgress >= 100 && <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>Processing file…</div>}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 24, height: 24, border: '3px solid rgba(59,130,246,0.2)', borderTop: '3px solid #3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    <span>{loadingMsg || 'Loading…'}</span>
                  </div>
                )}
              </div>
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

            {!loading && serverFilesSection}

            {analyzerProjects.length > 0 && !loading && (
              <>
                <div style={s.divider}>
                  <div style={s.dividerLine} />
                  <span style={s.dividerText}>recent projects</span>
                  <div style={s.dividerLine} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {analyzerProjects.map(proj => (
                    <div key={proj.path} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button style={{ ...s.linkBtn, flex: 1, justifyContent: 'space-between' }}
                        onClick={() => onLoadLocalProject?.(proj.path)}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 14 }}>📋</span>
                          <span style={{ fontSize: 13, color: '#e2e8f0' }}>{proj.name}</span>
                        </span>
                        <span style={{ fontSize: 11, color: '#475569' }}>{proj.created ? formatRelative(proj.created) : ''}</span>
                      </button>
                      <button onClick={() => handleRenameProject(proj)}
                        style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '2px 4px', fontSize: 11 }}
                        title="Rename">✏</button>
                      <button onClick={() => handleDeleteProject(proj)}
                        style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '2px 4px', fontSize: 13 }}
                        title="Delete">&times;</button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFileUpload(f); e.target.value = ''; }} />
      <input ref={projectFileRef} type="file" accept=".tableforge,.json" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleProjectFile(f); e.target.value = ''; }} />
      <input ref={serverFileRef} type="file" accept=".xlsx,.xls,.csv,.tsv" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleServerUpload(f); e.target.value = ''; }} />
    </div>
  );
}
