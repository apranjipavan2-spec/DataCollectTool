import React, { useState } from 'react';
import { TableConfig, TableSection } from '../types';

interface Props {
  tables: TableConfig[];
  sections: TableSection[];
  onReorderTables: (fromIdx: number, toIdx: number) => void;
  onAssignSection: (tableIdx: number, sectionId: string | undefined) => void;
  onSectionsChange: (sections: TableSection[]) => void;
  onClose: () => void;
}

const navBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer',
  fontSize: 9, padding: '2px 3px', lineHeight: 1,
};

export function OrganizeModal({ tables, sections, onReorderTables, onAssignSection, onSectionsChange, onClose }: Props) {
  const [dragTableId, setDragTableId] = useState<string | null>(null);
  const [dragSectionId, setDragSectionId] = useState<string | null>(null);
  const [overTableId, setOverTableId] = useState<string | null>(null);
  const [overSectionId, setOverSectionId] = useState<string | null>(null);

  const sortedSections = [...sections].sort((a, b) => a.order - b.order);
  const unsectioned = tables.filter(t => !t.section_id || !sortedSections.find(s => s.id === t.section_id));
  const groups: { section: TableSection | null; items: TableConfig[] }[] = [
    { section: null, items: unsectioned },
    ...sortedSections.map(sec => ({ section: sec, items: tables.filter(t => t.section_id === sec.id) })),
  ];

  const dropTableOnTable = (draggedId: string, targetId: string) => {
    const fromIdx = tables.findIndex(t => t.id === draggedId);
    const toIdx = tables.findIndex(t => t.id === targetId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    const dragged = tables[fromIdx];
    const target = tables[toIdx];
    if (dragged.section_id !== target.section_id) onAssignSection(fromIdx, target.section_id);
    onReorderTables(fromIdx, toIdx);
  };

  const dropTableOnSection = (draggedId: string, sectionId: string | undefined) => {
    const fromIdx = tables.findIndex(t => t.id === draggedId);
    if (fromIdx < 0) return;
    onAssignSection(fromIdx, sectionId);
  };

  const reorderSectionsTo = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    const ids = sortedSections.map(s => s.id);
    const fromI = ids.indexOf(draggedId);
    const toI = ids.indexOf(targetId);
    if (fromI < 0 || toI < 0) return;
    const reordered = [...sortedSections];
    const [moved] = reordered.splice(fromI, 1);
    reordered.splice(toI, 0, moved);
    onSectionsChange(reordered.map((s, i) => ({ ...s, order: i })));
  };

  const addSection = () => {
    const name = prompt('New section name:', `Section ${sections.length + 1}`);
    if (!name?.trim()) return;
    const id = `sec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    onSectionsChange([...sections, { id, name: name.trim(), order: sections.length }]);
  };

  const clearDrag = () => {
    setDragTableId(null); setDragSectionId(null); setOverTableId(null); setOverSectionId(null);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh' }}>
        <div className="modal-header">
          <h2>Organize Tables &amp; Sections</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ padding: '10px 0' }}>
          <div style={{ padding: '0 20px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              Drag rows to reorder · drag a table onto a section to move it in · ▲▼ for precise nudges
            </div>
            <button
              onClick={addSection}
              title="Create a new section"
              style={{ flexShrink: 0, padding: '4px 10px', background: 'rgba(168,85,247,0.15)', color: '#c4b5fd', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
            >+ Section</button>
          </div>

          {groups.map(g => (
            <div key={g.section?.id || '__unsectioned__'} style={{ marginBottom: 6 }}>
              {g.section ? (
                <div
                  className={`table-nav-item ${overSectionId === g.section.id ? 'table-nav-drag-over' : ''}`}
                  draggable
                  onDragStart={() => { setDragSectionId(g.section!.id); setDragTableId(null); }}
                  onDragOver={e => { e.preventDefault(); if (dragSectionId || dragTableId) setOverSectionId(g.section!.id); }}
                  onDragLeave={() => setOverSectionId(null)}
                  onDrop={e => {
                    e.preventDefault();
                    if (dragSectionId) reorderSectionsTo(dragSectionId, g.section!.id);
                    else if (dragTableId) dropTableOnSection(dragTableId, g.section!.id);
                    clearDrag();
                  }}
                  onDragEnd={clearDrag}
                  style={{
                    background: 'rgba(168,85,247,0.08)', fontWeight: 600, color: '#c4b5fd',
                    textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11,
                  }}
                >
                  <span className="table-nav-drag-grip" title="Drag to reorder section">⠿</span>
                  <span style={{ flex: 1 }}>{g.section.name} <span style={{ opacity: 0.6 }}>({g.items.length})</span></span>
                  <span style={{ display: 'flex', gap: 2 }}>
                    <button
                      onClick={() => {
                        const idx = sortedSections.findIndex(s => s.id === g.section!.id);
                        if (idx > 0) reorderSectionsTo(g.section!.id, sortedSections[idx - 1].id);
                      }}
                      title="Move section up" style={navBtnStyle}
                    >▲</button>
                    <button
                      onClick={() => {
                        const idx = sortedSections.findIndex(s => s.id === g.section!.id);
                        if (idx >= 0 && idx < sortedSections.length - 1) reorderSectionsTo(g.section!.id, sortedSections[idx + 1].id);
                      }}
                      title="Move section down" style={navBtnStyle}
                    >▼</button>
                  </span>
                </div>
              ) : (
                <div
                  className={`table-nav-item ${overSectionId === '__unsectioned__' ? 'table-nav-drag-over' : ''}`}
                  onDragOver={e => { e.preventDefault(); if (dragTableId) setOverSectionId('__unsectioned__'); }}
                  onDragLeave={() => setOverSectionId(null)}
                  onDrop={e => {
                    e.preventDefault();
                    if (dragTableId) dropTableOnSection(dragTableId, undefined);
                    clearDrag();
                  }}
                  style={{ fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, opacity: 0.7 }}
                >
                  <span style={{ flex: 1 }}>Unsectioned <span style={{ opacity: 0.6 }}>({g.items.length})</span></span>
                </div>
              )}

              {g.items.map((t, posInGroup) => {
                const realIdx = tables.indexOf(t);
                return (
                  <div
                    key={t.id}
                    className={`table-nav-item ${overTableId === t.id ? 'table-nav-drag-over' : ''}`}
                    draggable
                    onDragStart={() => { setDragTableId(t.id); setDragSectionId(null); }}
                    onDragOver={e => { e.preventDefault(); if (dragTableId) setOverTableId(t.id); }}
                    onDragLeave={() => setOverTableId(null)}
                    onDrop={e => {
                      e.preventDefault();
                      if (dragTableId) dropTableOnTable(dragTableId, t.id);
                      clearDrag();
                    }}
                    onDragEnd={clearDrag}
                    style={{ paddingLeft: 28 }}
                  >
                    <span className="table-nav-drag-grip" title="Drag to reorder / move to another section">⠿</span>
                    <span className="table-nav-num">{realIdx + 1}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || t.name}</span>
                    <span style={{ display: 'flex', gap: 2 }}>
                      <button
                        onClick={() => { const neighbor = g.items[posInGroup - 1]; if (neighbor) dropTableOnTable(t.id, neighbor.id); }}
                        title="Move up" style={navBtnStyle}
                      >▲</button>
                      <button
                        onClick={() => { const neighbor = g.items[posInGroup + 1]; if (neighbor) dropTableOnTable(t.id, neighbor.id); }}
                        title="Move down" style={navBtnStyle}
                      >▼</button>
                    </span>
                  </div>
                );
              })}
              {g.items.length === 0 && (
                <div style={{ paddingLeft: 28, fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic', padding: '6px 12px 6px 28px' }}>
                  Empty — drag a table here
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
