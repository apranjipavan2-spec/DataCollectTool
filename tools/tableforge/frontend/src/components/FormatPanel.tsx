import React, { useState } from 'react';
import { TableConfig, NumberFormat, ConditionalFormat, SortKey, HeaderFormat, DateFormat } from '../types';

interface Props {
  table: TableConfig;
  onUpdate: (update: Partial<TableConfig>) => void;
}

const BUILT_IN_THEMES = [
  { value: 'default', label: 'Default Dark', icon: '🌑' },
  { value: 'corporate_blue', label: 'Corporate Blue', icon: '🔵' },
  { value: 'minimal_bw', label: 'Minimalist B&W', icon: '⬜' },
  { value: 'financial', label: 'Financial', icon: '💹' },
  { value: 'government', label: 'Government', icon: '🏛' },
  { value: 'teal', label: 'Modern Teal', icon: '🟢' },
];

const DATE_FORMATS = [
  { value: 'YYYY-MM-DD', label: '2024-03-15' },
  { value: 'DD/MM/YYYY', label: '15/03/2024' },
  { value: 'MM/DD/YYYY', label: '03/15/2024' },
  { value: 'D MMM YYYY', label: '15 Mar 2024' },
  { value: 'MMMM YYYY', label: 'March 2024' },
  { value: 'MMM YYYY', label: 'Mar 2024' },
  { value: 'Q[Q] YYYY', label: 'Q1 2024' },
  { value: 'YYYY', label: '2024' },
  { value: 'WW-YYYY', label: 'W12-2024' },
];

const BORDER_PRESETS = [
  { value: 'full', label: 'Full Grid', icon: '▦' },
  { value: 'horizontal', label: 'Horizontal', icon: '▤' },
  { value: 'booktabs', label: 'Booktabs', icon: '═' },
  { value: 'dashed', label: 'Dashed', icon: '┄' },
  { value: 'dotted', label: 'Dotted', icon: '┈' },
  { value: 'double_line', label: 'Double', icon: '║' },
  { value: 'minimal', label: 'Minimal', icon: '─' },
  { value: 'none', label: 'None', icon: '○' },
];

const DEFAULT_FORMAT: NumberFormat = {
  style: 'number', decimals: 2, separator: true, prefix: '', suffix: '', currency_symbol: '$',
};

// ─── Collapsible Section ───
function Section({ title, icon, children, defaultOpen = true }: {
  title: string; icon: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`fp-section ${open ? 'open' : ''}`}>
      <button className="fp-section-header" onClick={() => setOpen(o => !o)}>
        <span className="fp-section-icon">{icon}</span>
        <span className="fp-section-title">{title}</span>
        <span className="fp-section-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="fp-section-body">{children}</div>}
    </div>
  );
}

// ─── Small inline field ───
function Field({ label, children, inline }: { label: string; children: React.ReactNode; inline?: boolean }) {
  return (
    <div className={`fp-field ${inline ? 'fp-field-inline' : ''}`}>
      <label className="fp-label">{label}</label>
      <div className="fp-control">{children}</div>
    </div>
  );
}

function Row({ children, gap = 8 }: { children: React.ReactNode; gap?: number }) {
  return <div className="fp-row" style={{ gap }}>{children}</div>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="fp-toggle">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="fp-toggle-label">{label}</span>
    </label>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`fp-chip ${active ? 'active' : ''}`} onClick={onClick}>{label}</button>
  );
}

// ─── Main Panel ───
export function FormatPanel({ table, onUpdate }: Props) {
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const [activeHeader, setActiveHeader] = useState<string | null>(null);
  const [customThemeName, setCustomThemeName] = useState('');
  const [panelTab, setPanelTab] = useState<'appearance' | 'content' | 'advanced'>('appearance');

  const savedThemes: { value: string; label: string }[] = (() => {
    try { return JSON.parse(localStorage.getItem('tableforge_custom_themes') || '[]'); } catch { return []; }
  })();
  const THEMES = [...BUILT_IN_THEMES, ...savedThemes.map(t => ({ ...t, icon: '🎨' }))];

  const saveCustomTheme = () => {
    if (!customThemeName.trim()) return;
    const existing = savedThemes.filter(t => t.value !== `custom_${customThemeName.trim().toLowerCase().replace(/\s+/g, '_')}`);
    const themeKey = `custom_${customThemeName.trim().toLowerCase().replace(/\s+/g, '_')}`;
    const newEntry = { value: themeKey, label: customThemeName.trim() };
    localStorage.setItem('tableforge_custom_themes', JSON.stringify([...existing, newEntry]));
    localStorage.setItem(`tableforge_theme_${themeKey}`, JSON.stringify({
      zebra: table.zebra, zebra_color: table.zebra_color, border_preset: table.border_preset,
      header_formats: table.header_formats, title_size: table.title_size, title_bold: table.title_bold,
      title_italic: table.title_italic, title_color: table.title_color,
    }));
    onUpdate({ theme: themeKey });
    setCustomThemeName('');
  };

  const loadCustomTheme = (themeKey: string) => {
    if (!themeKey.startsWith('custom_')) return;
    try {
      const saved = JSON.parse(localStorage.getItem(`tableforge_theme_${themeKey}`) || '{}');
      if (Object.keys(saved).length > 0) onUpdate(saved);
    } catch {}
  };

  const getHeaderFmt = (field: string): HeaderFormat => {
    return (table.header_formats || []).find(hf => hf.field === field) || { field };
  };

  const updateHeaderFmt = (field: string, update: Partial<HeaderFormat>) => {
    const existing = table.header_formats || [];
    const idx = existing.findIndex(hf => hf.field === field);
    if (idx >= 0) {
      const updated = [...existing];
      updated[idx] = { ...updated[idx], ...update };
      onUpdate({ header_formats: updated });
    } else {
      onUpdate({ header_formats: [...existing, { field, ...update }] });
    }
  };

  const getDateFmt = (field: string): string => {
    return (table.date_formats || []).find(df => df.field === field)?.format || '';
  };

  const updateDateFmt = (field: string, format: string) => {
    const existing = table.date_formats || [];
    const idx = existing.findIndex(df => df.field === field);
    if (format === '') {
      onUpdate({ date_formats: existing.filter(df => df.field !== field) });
    } else if (idx >= 0) {
      const updated = [...existing];
      updated[idx] = { field, format };
      onUpdate({ date_formats: updated });
    } else {
      onUpdate({ date_formats: [...existing, { field, format }] });
    }
  };

  const allHeaderFields = [...table.rows, ...table.columns, ...table.values.map(v => v.label || v.field)];

  const getNumFmt = (field: string): NumberFormat => {
    const v = table.values.find(vf => vf.field === field);
    return v?.number_format || { ...DEFAULT_FORMAT };
  };

  const updateNumFmt = (field: string, update: Partial<NumberFormat>) => {
    onUpdate({
      values: table.values.map(v =>
        v.field === field
          ? { ...v, number_format: { ...getNumFmt(field), ...update } }
          : v
      ),
    });
  };

  const updateHeaderRename = (original: string, newName: string) => {
    const renames = { ...(table.header_renames || {}) };
    if (newName && newName !== original) {
      renames[original] = newName;
    } else {
      delete renames[original];
    }
    onUpdate({ header_renames: renames });
  };

  return (
    <div className="format-panel fp-redesign">
      <div className="fp-header">
        <h3>Format</h3>
      </div>

      {/* Panel sub-tabs */}
      <div className="fp-tabs">
        <button className={panelTab === 'appearance' ? 'active' : ''} onClick={() => setPanelTab('appearance')}>
          🎨 Appearance
        </button>
        <button className={panelTab === 'content' ? 'active' : ''} onClick={() => setPanelTab('content')}>
          📝 Content
        </button>
        <button className={panelTab === 'advanced' ? 'active' : ''} onClick={() => setPanelTab('advanced')}>
          ⚙ Advanced
        </button>
      </div>

      <div className="fp-body">
        {/* ═══ APPEARANCE TAB ═══ */}
        {panelTab === 'appearance' && (
          <>
            {/* Theme */}
            <Section title="Theme" icon="🎨">
              <div className="fp-theme-grid">
                {THEMES.map(t => (
                  <button key={t.value}
                    className={`fp-theme-btn ${(table.theme || 'default') === t.value ? 'active' : ''}`}
                    onClick={() => {
                      // Reset custom colors when selecting a theme preset — theme defaults take over
                      onUpdate({
                        theme: t.value,
                        header_bg_color: '',
                        header_text_color: '',
                        row_bg_color: '',
                        bg_color: '',
                        total_bg_color: '',
                      });
                      if (t.value.startsWith('custom_')) loadCustomTheme(t.value);
                    }}
                    title={t.label}>
                    <div className={`fp-theme-swatch theme-${t.value}`} />
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
              <Row>
                <input type="text" value={customThemeName} onChange={e => setCustomThemeName(e.target.value)}
                  placeholder="Custom theme name..." className="fp-input" style={{ flex: 1 }} />
                <button className="fp-btn-sm" onClick={saveCustomTheme} disabled={!customThemeName.trim()}>Save</button>
              </Row>
            </Section>

            {/* Borders */}
            <Section title="Borders" icon="▦">
              <div className="fp-border-grid">
                {BORDER_PRESETS.map(b => (
                  <button key={b.value}
                    className={`fp-border-btn ${(table.border_preset || 'full') === b.value ? 'active' : ''}`}
                    onClick={() => onUpdate({ border_preset: b.value })} title={b.label}>
                    <span className="fp-border-icon">{b.icon}</span>
                    <span>{b.label}</span>
                  </button>
                ))}
              </div>
            </Section>

            {/* Shading */}
            <Section title="Row Shading" icon="▤">
              <Toggle label="Alternating Row Colors (Zebra)" checked={table.zebra ?? false}
                onChange={v => onUpdate({ zebra: v })} />
              {table.zebra && (
                <Field label="Stripe Color">
                  <input type="color" value={table.zebra_color || '#f0f4ff'}
                    onChange={e => onUpdate({ zebra_color: e.target.value })} className="fp-color" />
                </Field>
              )}
            </Section>

            {/* Background Colors */}
            <Section title="Background Colors" icon="🎨">
              <div className="fp-row" style={{ gap: 8, alignItems: 'center' }}>
                <label style={{ fontSize: 11, minWidth: 100 }}>Header Row:</label>
                <input type="color" value={table.header_bg_color || '#1a1e2e'}
                  onChange={e => onUpdate({ header_bg_color: e.target.value })} className="fp-color" />
                <button className="fp-btn-ghost fp-btn-sm" style={{ fontSize: 10, padding: '2px 6px' }}
                  onClick={() => onUpdate({ header_bg_color: '' })}>Reset</button>
              </div>
              <div className="fp-row" style={{ gap: 8, alignItems: 'center' }}>
                <label style={{ fontSize: 11, minWidth: 100 }}>Row Labels:</label>
                <input type="color" value={table.row_bg_color || '#0d1117'}
                  onChange={e => onUpdate({ row_bg_color: e.target.value })} className="fp-color" />
                <button className="fp-btn-ghost fp-btn-sm" style={{ fontSize: 10, padding: '2px 6px' }}
                  onClick={() => onUpdate({ row_bg_color: '' })}>Reset</button>
              </div>
              <div className="fp-row" style={{ gap: 8, alignItems: 'center' }}>
                <label style={{ fontSize: 11, minWidth: 100 }}>Values Area:</label>
                <input type="color" value={table.bg_color || '#0d1117'}
                  onChange={e => onUpdate({ bg_color: e.target.value })} className="fp-color" />
                <button className="fp-btn-ghost fp-btn-sm" style={{ fontSize: 10, padding: '2px 6px' }}
                  onClick={() => onUpdate({ bg_color: '' })}>Reset</button>
              </div>
              <div className="fp-row" style={{ gap: 8, alignItems: 'center' }}>
                <label style={{ fontSize: 11, minWidth: 100 }}>Grand Total Row:</label>
                <input type="color" value={table.total_bg_color || ''}
                  onChange={e => onUpdate({ total_bg_color: e.target.value })} className="fp-color" />
                <button className="fp-btn-ghost fp-btn-sm" style={{ fontSize: 10, padding: '2px 6px' }}
                  onClick={() => onUpdate({ total_bg_color: '' })}>Reset</button>
              </div>
              <div className="fp-row" style={{ gap: 8, alignItems: 'center' }}>
                <label style={{ fontSize: 11, minWidth: 100 }}>Header Text:</label>
                <input type="color" value={table.header_text_color || '#ffffff'}
                  onChange={e => onUpdate({ header_text_color: e.target.value })} className="fp-color" />
                <button className="fp-btn-ghost fp-btn-sm" style={{ fontSize: 10, padding: '2px 6px' }}
                  onClick={() => onUpdate({ header_text_color: '' })}>Reset</button>
              </div>
            </Section>

            {/* Table Display */}
            <Section title="Table Display" icon="🖥">
              <Toggle label="Freeze First Column" checked={table.frozen_first_col ?? false}
                onChange={v => onUpdate({ frozen_first_col: v })} />
              <Toggle label="Header Word Wrap" checked={table.header_word_wrap ?? false}
                onChange={v => onUpdate({ header_word_wrap: v })} />
              <Toggle label="Show Serial Numbers" checked={table.serial_number ?? false}
                onChange={v => onUpdate({ serial_number: v })} />
              {table.serial_number && (
                <Field label="Numbering">
                  <select value={table.serial_number_mode || 'continuous'} className="fp-select"
                    onChange={e => onUpdate({ serial_number_mode: e.target.value as any })}>
                    <option value="continuous">Continuous (1, 2, 3...)</option>
                    <option value="per_group">Restart per Group</option>
                  </select>
                </Field>
              )}
              <Field label="Zoom">
                <select value={table.zoom_level || 100} className="fp-select"
                  onChange={e => onUpdate({ zoom_level: Number(e.target.value) })}>
                  {[50, 75, 100, 125, 150, 200].map(z => (
                    <option key={z} value={z}>{z}%</option>
                  ))}
                </select>
              </Field>
            </Section>

            {/* Row & Column Sizing */}
            <Section title="Sizing" icon="↔" defaultOpen={false}>
              <Field label="Row Height (px)">
                <input type="number" min={20} max={100} value={table.row_height || 32} className="fp-input fp-input-sm"
                  onChange={e => onUpdate({ row_height: parseInt(e.target.value) || 32 })} />
              </Field>
              <div className="fp-divider" />
              <label className="fp-label" style={{ marginBottom: 4 }}>Column Widths</label>
              {[...table.rows, ...table.columns, ...table.values.map(v => v.label || v.field)].map(f => (
                <div key={f} className="fp-inline-field">
                  <span className="fp-field-name">{f}</span>
                  <input type="number" min={40} max={400}
                    value={(table.column_widths || {})[f] || ''}
                    placeholder="Auto" className="fp-input fp-input-xs"
                    onChange={e => {
                      const widths = { ...(table.column_widths || {}) };
                      const val = parseInt(e.target.value);
                      if (val > 0) widths[f] = val; else delete widths[f];
                      onUpdate({ column_widths: widths });
                    }} />
                </div>
              ))}
              <button className="fp-btn-sm fp-btn-ghost" onClick={() => onUpdate({ column_widths: {} })}>Reset All Widths</button>
            </Section>
          </>
        )}

        {/* ═══ CONTENT TAB ═══ */}
        {panelTab === 'content' && (
          <>
            {/* Title & Subtitle */}
            <Section title="Title & Subtitle" icon="T">
              <Field label="Table Title">
                <input type="text" value={table.title} className="fp-input"
                  onChange={e => onUpdate({ title: e.target.value })}
                  placeholder="{filename} — {date}" />
              </Field>
              <div className="fp-token-row">
                {['{filename}', '{date}', '{sheet_name}'].map(tok => (
                  <button key={tok} className="fp-token" onClick={() => onUpdate({ title: (table.title || '') + tok })}>
                    + {tok}
                  </button>
                ))}
              </div>
              <Row>
                <Field label="Size">
                  <input type="number" min={10} max={32} value={table.title_size || 18} className="fp-input fp-input-sm"
                    onChange={e => onUpdate({ title_size: parseInt(e.target.value) })} />
                </Field>
                <Field label="Align">
                  <select value={table.title_align || 'left'} className="fp-select"
                    onChange={e => onUpdate({ title_align: e.target.value })}>
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </Field>
              </Row>
              <Row>
                <Toggle label="Bold" checked={table.title_bold ?? true}
                  onChange={v => onUpdate({ title_bold: v })} />
                <Toggle label="Italic" checked={table.title_italic ?? false}
                  onChange={v => onUpdate({ title_italic: v })} />
                <Field label="Color" inline>
                  <input type="color" value={table.title_color || '#ffffff'} className="fp-color"
                    onChange={e => onUpdate({ title_color: e.target.value })} />
                </Field>
              </Row>
              <div className="fp-divider" />
              <Field label="Subtitle">
                <input type="text" value={table.subtitle} className="fp-input"
                  onChange={e => onUpdate({ subtitle: e.target.value })}
                  placeholder="Source, date range, etc." />
              </Field>
              <Field label="Tab Name">
                <input type="text" value={table.name} className="fp-input"
                  onChange={e => onUpdate({ name: e.target.value })} />
              </Field>
              <div className="fp-divider" />
              <Toggle label="Auto Table Numbering" checked={table.auto_number ?? false}
                onChange={v => onUpdate({ auto_number: v })} />
              {table.auto_number && (
                <Row>
                  <Field label="Prefix">
                    <input type="text" value={table.table_number_prefix || 'Table'} className="fp-input fp-input-sm"
                      onChange={e => onUpdate({ table_number_prefix: e.target.value })} />
                  </Field>
                  <Field label="Number">
                    <input type="text" value={table.table_number || ''} className="fp-input fp-input-sm"
                      onChange={e => onUpdate({ table_number: e.target.value })} placeholder="1, 1.1, A-1..." />
                  </Field>
                </Row>
              )}
              <Field label="Source / Footnote">
                <textarea rows={2} value={table.footnote || ''} className="fp-textarea"
                  onChange={e => onUpdate({ footnote: e.target.value })}
                  placeholder="Source: XYZ Dataset, 2024" />
              </Field>
            </Section>

            {/* Header Renaming */}
            <Section title="Header Labels" icon="🏷" defaultOpen={false}>
              {allHeaderFields.length === 0 ? (
                <p className="fp-hint">Add fields to the table first</p>
              ) : (
                <>
                  <p className="fp-hint">Rename display labels for columns and rows</p>
                  {allHeaderFields.map(h => (
                    <div key={h} className="fp-rename-row">
                      <span className="fp-rename-original">{h}</span>
                      <span className="fp-rename-arrow">→</span>
                      <input type="text" className="fp-input"
                        value={(table.header_renames || {})[h] || ''}
                        onChange={e => updateHeaderRename(h, e.target.value)}
                        placeholder={h} />
                    </div>
                  ))}
                </>
              )}
            </Section>

            {/* Number Formats */}
            <Section title="Number Formats" icon="#" defaultOpen={false}>
              {table.values.length === 0 ? (
                <p className="fp-hint">Add value fields first</p>
              ) : (
                <div className="fp-list">
                  {table.values.map(v => {
                    const fmt = getNumFmt(v.field);
                    const isActive = activeValue === v.field;
                    return (
                      <div key={v.field} className={`fp-list-item ${isActive ? 'open' : ''}`}>
                        <button className="fp-list-toggle" onClick={() => setActiveValue(isActive ? null : v.field)}>
                          <span className="fp-list-name">{v.label || v.field}</span>
                          <span className="fp-list-preview">{formatPreview(fmt)}</span>
                          <span className="fp-list-chevron">{isActive ? '▾' : '▸'}</span>
                        </button>
                        {isActive && (
                          <div className="fp-list-body">
                            <Row>
                              <Field label="Style">
                                <select value={fmt.style} className="fp-select"
                                  onChange={e => updateNumFmt(v.field, { style: e.target.value as any })}>
                                  <option value="number">Number</option>
                                  <option value="currency">Currency</option>
                                  <option value="percent">Percent</option>
                                </select>
                              </Field>
                              <Field label="Decimals">
                                <input type="number" min={0} max={6} value={fmt.decimals} className="fp-input fp-input-sm"
                                  onChange={e => updateNumFmt(v.field, { decimals: parseInt(e.target.value) || 0 })} />
                              </Field>
                            </Row>
                            <Toggle label="Thousands Separator" checked={fmt.separator}
                              onChange={v2 => updateNumFmt(v.field, { separator: v2 })} />
                            {fmt.style === 'currency' && (
                              <Field label="Symbol">
                                <input type="text" value={fmt.currency_symbol} className="fp-input fp-input-xs"
                                  onChange={e => updateNumFmt(v.field, { currency_symbol: e.target.value })} style={{ width: 50 }} />
                              </Field>
                            )}
                            <Row>
                              <Field label="Prefix">
                                <input type="text" value={fmt.prefix} className="fp-input fp-input-sm"
                                  onChange={e => updateNumFmt(v.field, { prefix: e.target.value })} />
                              </Field>
                              <Field label="Suffix">
                                <input type="text" value={fmt.suffix} className="fp-input fp-input-sm"
                                  onChange={e => updateNumFmt(v.field, { suffix: e.target.value })} placeholder="pts" />
                              </Field>
                            </Row>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            {/* Header Formatting */}
            <Section title="Header Styling" icon="A" defaultOpen={false}>
              {allHeaderFields.length === 0 ? (
                <p className="fp-hint">Add fields first</p>
              ) : (
                <div className="fp-list">
                  {allHeaderFields.map(h => {
                    const fmt = getHeaderFmt(h);
                    const isOpen = activeHeader === h;
                    return (
                      <div key={h} className={`fp-list-item ${isOpen ? 'open' : ''}`}>
                        <button className="fp-list-toggle" onClick={() => setActiveHeader(isOpen ? null : h)}>
                          <span className="fp-list-name" style={{
                            fontWeight: fmt.bold ? 700 : 400,
                            fontStyle: fmt.italic ? 'italic' : 'normal',
                            color: fmt.color, background: fmt.backgroundColor,
                            padding: '1px 6px', borderRadius: 3,
                          }}>{h}</span>
                          <span className="fp-list-chevron">{isOpen ? '▾' : '▸'}</span>
                        </button>
                        {isOpen && (
                          <div className="fp-list-body">
                            <Row>
                              <Field label="Size">
                                <input type="number" min={8} max={24} value={fmt.size || 13} className="fp-input fp-input-sm"
                                  onChange={e => updateHeaderFmt(h, { size: parseInt(e.target.value) || 13 })} />
                              </Field>
                              <Field label="Font">
                                <select value={fmt.font || ''} className="fp-select"
                                  onChange={e => updateHeaderFmt(h, { font: e.target.value })}>
                                  <option value="">Default</option>
                                  <option value="Arial">Arial</option>
                                  <option value="Georgia">Georgia</option>
                                  <option value="Courier New">Courier</option>
                                  <option value="Times New Roman">Times</option>
                                </select>
                              </Field>
                            </Row>
                            <Row>
                              <Toggle label="Bold" checked={fmt.bold ?? false}
                                onChange={v => updateHeaderFmt(h, { bold: v })} />
                              <Toggle label="Italic" checked={fmt.italic ?? false}
                                onChange={v => updateHeaderFmt(h, { italic: v })} />
                            </Row>
                            <Row>
                              <Field label="Text" inline>
                                <input type="color" value={fmt.color || '#ffffff'} className="fp-color"
                                  onChange={e => updateHeaderFmt(h, { color: e.target.value })} />
                              </Field>
                              <Field label="Bg" inline>
                                <input type="color" value={fmt.backgroundColor || '#1e293b'} className="fp-color"
                                  onChange={e => updateHeaderFmt(h, { backgroundColor: e.target.value })} />
                              </Field>
                            </Row>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            {/* Date Formatting */}
            <Section title="Date Formats" icon="📅" defaultOpen={false}>
              {table.rows.length === 0 && table.columns.length === 0 ? (
                <p className="fp-hint">Add date fields to rows or columns</p>
              ) : (
                <>
                  <p className="fp-hint">Set display format for date-type fields</p>
                  {[...table.rows, ...table.columns].map(f => (
                    <div key={f} className="fp-inline-field">
                      <span className="fp-field-name">{f}</span>
                      <select value={getDateFmt(f)} className="fp-select" style={{ flex: 1 }}
                        onChange={e => updateDateFmt(f, e.target.value)}>
                        <option value="">Default</option>
                        {DATE_FORMATS.map(df => (
                          <option key={df.value} value={df.value}>{df.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </>
              )}
            </Section>
          </>
        )}

        {/* ═══ ADVANCED TAB ═══ */}
        {panelTab === 'advanced' && (
          <>
            {/* Totals & Subtotals */}
            <Section title="Totals & Subtotals" icon="Σ">
              <Toggle label="Grand Total Row" checked={table.grand_total}
                onChange={v => onUpdate({ grand_total: v })} />
              <Toggle label="Subtotals (hierarchical)" checked={table.subtotals}
                onChange={v => onUpdate({ subtotals: v })} />
              {table.subtotals && (
                <Field label="Position">
                  <select value={table.subtotals_position || 'bottom'} className="fp-select"
                    onChange={e => onUpdate({ subtotals_position: e.target.value as 'top' | 'bottom' })}>
                    <option value="bottom">Bottom of Group</option>
                    <option value="top">Top of Group</option>
                  </select>
                </Field>
              )}
              <Toggle label="Hide Zero/Blank Rows" checked={table.blank_suppress ?? false}
                onChange={v => onUpdate({ blank_suppress: v })} />
              <Field label="Missing Data">
                <select value={table.missing_data} className="fp-select"
                  onChange={e => onUpdate({ missing_data: e.target.value })}>
                  <option value="">Leave Blank</option>
                  <option value="0">0</option>
                  <option value="N/A">N/A</option>
                  <option value="–">– (dash)</option>
                  <option value="n/a">n/a</option>
                  <option value=".">.</option>
                </select>
              </Field>
            </Section>

            {/* Sorting */}
            <Section title="Multi-Sort" icon="↕" defaultOpen={false}>
              <div className="fp-sort-list">
                {(table.multi_sort || []).map((sk, i) => (
                  <div key={i} className="fp-sort-row">
                    <select value={sk.field} className="fp-select" style={{ flex: 2 }}
                      onChange={e => {
                        const arr = [...(table.multi_sort || [])];
                        arr[i] = { ...arr[i], field: e.target.value };
                        onUpdate({ multi_sort: arr });
                      }}>
                      <option value="">-- field --</option>
                      {table.values.map(v => <option key={v.field} value={v.label || v.field}>{v.label || v.field}</option>)}
                      {table.rows.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <select value={sk.order} className="fp-select" style={{ flex: 1 }}
                      onChange={e => {
                        const arr = [...(table.multi_sort || [])];
                        arr[i] = { ...arr[i], order: e.target.value as 'asc' | 'desc' };
                        onUpdate({ multi_sort: arr });
                      }}>
                      <option value="asc">Asc ▲</option>
                      <option value="desc">Desc ▼</option>
                    </select>
                    <button className="fp-btn-icon" onClick={() => {
                      onUpdate({ multi_sort: (table.multi_sort || []).filter((_, j) => j !== i) });
                    }}>✕</button>
                  </div>
                ))}
                <button className="fp-btn-sm fp-btn-ghost" onClick={() => {
                  onUpdate({ multi_sort: [...(table.multi_sort || []), { field: '', order: 'asc' as const }] });
                }}>+ Add Sort Key</button>
              </div>
            </Section>

            {/* Custom Sort Orders */}
            <Section title="Custom Category Order" icon="📋" defaultOpen={false}>
              {table.rows.length === 0 ? (
                <p className="fp-hint">Add row fields first</p>
              ) : (
                <>
                  <p className="fp-hint">Define category display order (one per line, top to bottom)</p>
                  {table.rows.map(f => (
                    <Field key={f} label={f}>
                      <textarea rows={3} className="fp-textarea"
                        value={((table.custom_sort_orders || {})[f] || []).join('\n')}
                        onChange={e => {
                          const vals = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
                          onUpdate({ custom_sort_orders: { ...(table.custom_sort_orders || {}), [f]: vals } });
                        }}
                        placeholder="Category A&#10;Category B&#10;Category C" />
                    </Field>
                  ))}
                </>
              )}
            </Section>

            {/* NET Rows */}
            <Section title="NET Rows (calculated)" icon="∑" defaultOpen={false}>
              {table.rows.length === 0 ? (
                <p className="fp-hint">Add a row field first</p>
              ) : (
                <>
                  <p className="fp-hint">
                    NET rows re-aggregate selected categories of <strong>{table.rows[0]}</strong> using the same metric
                    (e.g. NET Agree = Strongly Agree + Agree).
                  </p>
                  {(table.net_rows || []).map((nr, i) => (
                    <div key={i} className="fp-sort-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, padding: 6, border: '1px solid var(--border, #333)', borderRadius: 4, marginBottom: 6 }}>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input type="text" value={nr.label} className="fp-input" style={{ flex: 1 }} placeholder="Agree"
                          onChange={e => {
                            const arr = [...(table.net_rows || [])];
                            arr[i] = { ...arr[i], label: e.target.value };
                            onUpdate({ net_rows: arr });
                          }} />
                        <select value={nr.position || 'after_last_member'} className="fp-select" style={{ flex: 1 }}
                          onChange={e => {
                            const arr = [...(table.net_rows || [])];
                            arr[i] = { ...arr[i], position: e.target.value as any };
                            onUpdate({ net_rows: arr });
                          }}>
                          <option value="after_last_member">After last member</option>
                          <option value="before_first_member">Before first member</option>
                          <option value="end">End of table</option>
                        </select>
                        <button className="fp-btn-icon" onClick={() => {
                          onUpdate({ net_rows: (table.net_rows || []).filter((_, j) => j !== i) });
                        }}>✕</button>
                      </div>
                      <textarea rows={3} className="fp-textarea"
                        value={(nr.members || []).join('\n')}
                        onChange={e => {
                          const vals = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
                          const arr = [...(table.net_rows || [])];
                          arr[i] = { ...arr[i], members: vals };
                          onUpdate({ net_rows: arr });
                        }}
                        placeholder="Strongly Agree&#10;Agree" />
                    </div>
                  ))}
                  <button className="fp-btn-sm fp-btn-ghost" onClick={() => {
                    onUpdate({ net_rows: [...(table.net_rows || []), { label: '', members: [], position: 'after_last_member' as const }] });
                  }}>+ Add NET Row</button>
                </>
              )}
            </Section>

            {/* Conditional Formatting */}
            <Section title="Conditional Formatting" icon="🎯" defaultOpen={false}>
              {table.values.length === 0 ? (
                <p className="fp-hint">Add value fields first</p>
              ) : (
                <>
                  {(table.conditional_formats || []).map((cf, i) => (
                    <ConditionalFormatRule key={cf.id} cf={cf} valueFields={table.values.map(v => v.label || v.field)}
                      onChange={updated => {
                        const arr = [...(table.conditional_formats || [])];
                        arr[i] = updated;
                        onUpdate({ conditional_formats: arr });
                      }}
                      onRemove={() => {
                        onUpdate({ conditional_formats: (table.conditional_formats || []).filter((_, j) => j !== i) });
                      }} />
                  ))}
                  <button className="fp-btn-sm" onClick={() => {
                    const newRule: ConditionalFormat = {
                      id: String(Date.now()),
                      type: 'color_scale',
                      applies_to: table.values[0]?.label || table.values[0]?.field || '',
                      min_color: '#ff4444',
                      max_color: '#44bb44',
                    };
                    onUpdate({ conditional_formats: [...(table.conditional_formats || []), newRule] });
                  }}>+ Add Rule</button>
                </>
              )}
            </Section>

            {/* Footnotes */}
            <Section title="Footnotes" icon="*" defaultOpen={false}>
              <Field label="Footnote Style">
                <select value={table.footnote_style || 'numeric'} className="fp-select"
                  onChange={e => onUpdate({ footnote_style: e.target.value as any })}>
                  <option value="numeric">Numeric (1, 2, 3)</option>
                  <option value="alpha">Alpha (a, b, c)</option>
                  <option value="symbol">Symbol (*, †, ‡)</option>
                  <option value="custom">Custom</option>
                </select>
              </Field>
              {(table.footnotes || []).map((fn, i) => (
                <div key={i} className="fp-footnote-row">
                  <input type="text" value={fn.marker} className="fp-input fp-input-marker"
                    onChange={e => {
                      const arr = [...(table.footnotes || [])];
                      arr[i] = { ...arr[i], marker: e.target.value };
                      onUpdate({ footnotes: arr });
                    }} />
                  <input type="text" value={fn.text} className="fp-input" style={{ flex: 1 }}
                    placeholder="Footnote text..."
                    onChange={e => {
                      const arr = [...(table.footnotes || [])];
                      arr[i] = { ...arr[i], text: e.target.value };
                      onUpdate({ footnotes: arr });
                    }} />
                  <button className="fp-btn-icon fp-btn-danger"
                    onClick={() => onUpdate({ footnotes: (table.footnotes || []).filter((_, j) => j !== i) })}>×</button>
                </div>
              ))}
              <button className="fp-btn-sm fp-btn-ghost" onClick={() => {
                const style = table.footnote_style || 'numeric';
                const idx = (table.footnotes || []).length;
                const markers: Record<string, string[]> = {
                  numeric: ['1','2','3','4','5','6','7','8','9','10'],
                  alpha: ['a','b','c','d','e','f','g','h','i','j'],
                  symbol: ['*','†','‡','§','‖','¶','#','**','††','‡‡'],
                  custom: [String(idx + 1)],
                };
                const marker = markers[style]?.[idx] || String(idx + 1);
                onUpdate({ footnotes: [...(table.footnotes || []), { marker, text: '' }] });
              }}>+ Add Footnote</button>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Conditional Format Rule ───
const CF_TYPE_LABEL: Record<string, string> = {
  color_scale: '🌈 Color Scale',
  data_bar: '📊 Data Bar',
  icon_set: '⬆ Icon Set',
  rule: '📏 Rule-Based',
};

function ConditionalFormatRule({ cf, valueFields, onChange, onRemove }: {
  cf: ConditionalFormat;
  valueFields: string[];
  onChange: (updated: ConditionalFormat) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="fp-cf-rule">
      <button className="fp-cf-header" onClick={() => setOpen(o => !o)}>
        <span className="fp-cf-type">{CF_TYPE_LABEL[cf.type] || cf.type}</span>
        <span className="fp-cf-field">{cf.applies_to}</span>
        <button className="fp-btn-icon" onClick={e => { e.stopPropagation(); onRemove(); }}>✕</button>
        <span>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="fp-cf-body">
          <Row>
            <Field label="Type">
              <select value={cf.type} className="fp-select"
                onChange={e => onChange({ ...cf, type: e.target.value as any })}>
                <option value="color_scale">Color Scale</option>
                <option value="data_bar">Data Bar</option>
                <option value="icon_set">Icon Set</option>
                <option value="rule">Rule-Based</option>
              </select>
            </Field>
            <Field label="Applies To">
              <select value={cf.applies_to} className="fp-select"
                onChange={e => onChange({ ...cf, applies_to: e.target.value })}>
                {valueFields.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </Field>
          </Row>
          {cf.type === 'color_scale' && (
            <Row>
              <Field label="Min Color" inline>
                <input type="color" value={cf.min_color || '#ff4444'} className="fp-color"
                  onChange={e => onChange({ ...cf, min_color: e.target.value })} />
              </Field>
              {cf.use_mid && (
                <Field label="Mid" inline>
                  <input type="color" value={cf.mid_color || '#ffffaa'} className="fp-color"
                    onChange={e => onChange({ ...cf, mid_color: e.target.value })} />
                </Field>
              )}
              <Field label="Max Color" inline>
                <input type="color" value={cf.max_color || '#44bb44'} className="fp-color"
                  onChange={e => onChange({ ...cf, max_color: e.target.value })} />
              </Field>
              <Toggle label="Mid" checked={cf.use_mid ?? false}
                onChange={v => onChange({ ...cf, use_mid: v })} />
            </Row>
          )}
          {cf.type === 'rule' && (
            <>
              <Row>
                <Field label="Condition">
                  <select value={cf.rule_operator || '>'} className="fp-select"
                    onChange={e => onChange({ ...cf, rule_operator: e.target.value })}>
                    <option value=">">Greater than</option>
                    <option value="<">Less than</option>
                    <option value=">=">≥</option>
                    <option value="<=">≤</option>
                    <option value="==">Equal to</option>
                    <option value="!=">Not equal</option>
                  </select>
                </Field>
                <Field label="Value">
                  <input type="number" value={cf.rule_value ?? 0} className="fp-input fp-input-sm"
                    onChange={e => onChange({ ...cf, rule_value: parseFloat(e.target.value) || 0 })} />
                </Field>
              </Row>
              <Row>
                <Field label="Text Color" inline>
                  <input type="color" value={cf.rule_color || '#ff4444'} className="fp-color"
                    onChange={e => onChange({ ...cf, rule_color: e.target.value })} />
                </Field>
                <Field label="Bg Color" inline>
                  <input type="color" value={cf.rule_bg || ''} className="fp-color"
                    onChange={e => onChange({ ...cf, rule_bg: e.target.value })} />
                </Field>
                <Toggle label="Bold" checked={cf.rule_bold ?? false}
                  onChange={v => onChange({ ...cf, rule_bold: v })} />
              </Row>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Format Preview Helper ───
function formatPreview(fmt: NumberFormat): string {
  const val = 1234.5678;
  let str = '';
  const d = fmt.decimals ?? 2;
  if (fmt.style === 'percent') {
    str = (val * 100).toFixed(d) + '%';
  } else if (fmt.style === 'currency') {
    str = (fmt.currency_symbol || '$') + (fmt.separator ? val.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : val.toFixed(d));
  } else {
    str = fmt.separator ? val.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : val.toFixed(d);
  }
  return (fmt.prefix || '') + str + (fmt.suffix || '');
}
