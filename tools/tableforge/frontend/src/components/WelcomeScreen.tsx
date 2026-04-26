import React, { useRef } from 'react';

interface Props {
  onFileUpload: (file: File) => void;
  onProjectImport?: (projectData: any) => void;
  loading: boolean;
  error: string | null;
}

export function WelcomeScreen({ onFileUpload, onProjectImport, loading, error }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const projectFileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
      if (file.name.endsWith('.tableforge') || file.name.endsWith('.json')) {
        handleProjectFile(file);
      } else {
        onFileUpload(file);
      }
    }
  };

  const handleProjectFile = (file: File) => {
    if (!onProjectImport) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (data.tables) onProjectImport(data);
      } catch { /* invalid file */ }
    };
    reader.readAsText(file);
  };

  return (
    <div className="welcome">
      <div
        ref={dragRef}
        className="welcome-card"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
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
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv,.tsv"
        style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) onFileUpload(f);
          e.target.value = '';
        }}
      />
      <input
        ref={projectFileRef}
        type="file"
        accept=".tableforge,.json"
        style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) handleProjectFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
