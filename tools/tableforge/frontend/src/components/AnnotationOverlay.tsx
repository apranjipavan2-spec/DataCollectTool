import React, { useState, useRef, useEffect } from 'react';

export interface Annotation {
  rowIdx: number;
  colIdx: number;
  text: string;
  color: string;
  // Cell formatting overrides
  highlight?: string;  // background highlight color
  bold?: boolean;
  italic?: boolean;
}

interface ContextPos { x: number; y: number; rowIdx: number; colIdx: number; }

export function useAnnotations() {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  const addAnnotation = (a: Annotation) => {
    setAnnotations(prev => [...prev.filter(x => !(x.rowIdx === a.rowIdx && x.colIdx === a.colIdx)), a]);
  };

  const removeAnnotation = (rowIdx: number, colIdx: number) => {
    setAnnotations(prev => prev.filter(x => !(x.rowIdx === rowIdx && x.colIdx === colIdx)));
  };

  const getAnnotation = (rowIdx: number, colIdx: number): Annotation | undefined => {
    return annotations.find(a => a.rowIdx === rowIdx && a.colIdx === colIdx);
  };

  return { annotations, addAnnotation, removeAnnotation, getAnnotation };
}

const HIGHLIGHT_COLORS = [
  { value: '', label: 'None' },
  { value: '#fef08a', label: 'Yellow' },
  { value: '#bbf7d0', label: 'Green' },
  { value: '#fecaca', label: 'Red' },
  { value: '#bfdbfe', label: 'Blue' },
  { value: '#e9d5ff', label: 'Purple' },
  { value: '#fed7aa', label: 'Orange' },
];

export function AnnotationContextMenu({ pos, existing, onSave, onClose }: {
  pos: ContextPos;
  existing?: Annotation;
  onSave: (a: Annotation) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(existing?.text || '');
  const [color, setColor] = useState(existing?.color || '#f59e0b');
  const [highlight, setHighlight] = useState(existing?.highlight || '');
  const [bold, setBold] = useState(existing?.bold ?? false);
  const [italic, setItalic] = useState(existing?.italic ?? false);
  const [tab, setTab] = useState<'note' | 'format'>('note');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => window.addEventListener('click', handler), 50);
    return () => window.removeEventListener('click', handler);
  }, [onClose]);

  const handleSave = () => {
    onSave({
      rowIdx: pos.rowIdx, colIdx: pos.colIdx,
      text: text.trim(), color,
      highlight: highlight || undefined,
      bold: bold || undefined,
      italic: italic || undefined,
    });
    onClose();
  };

  const handleRemove = () => {
    onSave({ rowIdx: pos.rowIdx, colIdx: pos.colIdx, text: '', color: '' });
    onClose();
  };

  return (
    <div ref={ref}
      className="annotation-popup"
      style={{ position: 'fixed', left: Math.min(pos.x, window.innerWidth - 260), top: Math.min(pos.y, window.innerHeight - 280), zIndex: 2000 }}
      onClick={e => e.stopPropagation()}
    >
      <div className="annotation-popup-tabs">
        <button className={`ann-tab ${tab === 'note' ? 'active' : ''}`} onClick={() => setTab('note')}>📝 Note</button>
        <button className={`ann-tab ${tab === 'format' ? 'active' : ''}`} onClick={() => setTab('format')}>🎨 Format</button>
      </div>

      {tab === 'note' && (
        <>
          <textarea
            autoFocus
            rows={3}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Enter annotation (leave blank to clear)..."
          />
          <div className="annotation-color-row">
            <span>Marker:</span>
            {['#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'].map(c => (
              <button key={c} className={`color-swatch ${color === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)} />
            ))}
          </div>
        </>
      )}

      {tab === 'format' && (
        <div className="ann-format-panel">
          <div className="form-group">
            <label style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Cell Highlight</label>
            <div className="ann-highlight-row">
              {HIGHLIGHT_COLORS.map(h => (
                <button key={h.value} title={h.label}
                  className={`ann-highlight-btn ${highlight === h.value ? 'active' : ''}`}
                  style={{ background: h.value || 'transparent', border: h.value ? 'none' : '1px dashed #666' }}
                  onClick={() => setHighlight(h.value)}>
                  {!h.value && '∅'}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Text Style</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={`ann-style-btn ${bold ? 'active' : ''}`}
                onClick={() => setBold(b => !b)}
                style={{ fontWeight: 700 }}>B</button>
              <button className={`ann-style-btn ${italic ? 'active' : ''}`}
                onClick={() => setItalic(i => !i)}
                style={{ fontStyle: 'italic' }}>I</button>
            </div>
          </div>
        </div>
      )}

      <div className="annotation-popup-actions">
        {existing?.text && <button className="btn-danger-sm" onClick={handleRemove}>Remove</button>}
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSave}>Save</button>
      </div>
    </div>
  );
}
