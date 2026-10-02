import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// A <select> replacement for options whose text is too long to read when
// native <select> truncates/single-lines them (browsers never wrap option
// text, with no CSS override). Renders the open list in a portal so it
// isn't clipped by a scrolling modal body.
export function WrapSelect({ value, options, onChange, emptyLabel = '-- skip --' }: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 360) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="wrap-select">
      <button type="button" ref={btnRef} className="wrap-select-btn" onClick={() => setOpen(o => !o)}>
        <span className="wrap-select-value">{value || emptyLabel}</span>
        <span className="wrap-select-caret">▾</span>
      </button>
      {open && rect && createPortal(
        <div className="wrap-select-menu" style={{ top: rect.top, left: rect.left, width: rect.width }}>
          <div className="wrap-select-option" onClick={() => { onChange(''); setOpen(false); }}>{emptyLabel}</div>
          {options.map(o => (
            <div key={o} className={'wrap-select-option' + (o === value ? ' selected' : '')}
              onClick={() => { onChange(o); setOpen(false); }}>{o}</div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
