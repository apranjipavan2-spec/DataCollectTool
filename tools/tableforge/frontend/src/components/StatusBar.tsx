import React from 'react';
import { DatasetMeta, TableResult } from '../types';

interface Props {
  dataset: DatasetMeta | null;
  result: TableResult | null;
  undoCount?: number;
  redoCount?: number;
}

export function StatusBar({ dataset, result, undoCount, redoCount }: Props) {
  return (
    <div className="statusbar">
      <span>
        {dataset
          ? `${dataset.filename} — ${dataset.row_count.toLocaleString()} rows x ${dataset.columns.length} cols`
          : 'No file loaded'}
      </span>
      {result && (
        <span className="status-sep">
          Table: {result.row_count} rows x {result.col_count} cols
        </span>
      )}
      {(undoCount !== undefined && undoCount > 0) && (
        <span className="status-sep">Undo: {undoCount}</span>
      )}
      <span className="status-right">
        Ctrl+Z Undo | Ctrl+Y Redo | Ctrl+S Save | Ctrl+E Export
      </span>
      <span className="status-brand">TableForge by Pavankumar Deshetty</span>
    </div>
  );
}
