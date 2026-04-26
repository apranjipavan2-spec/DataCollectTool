import React, { useEffect, useState } from 'react';

interface Props {
  datasetId: string;
  onClose: () => void;
}

interface LogEntry {
  timestamp: string;
  action: string;
  details: string;
}

const ACTION_ICONS: Record<string, string> = {
  file_import: '📂',
  tabulation: '📊',
  metric_create: '📐',
  bin_create: '📦',
  comparison: '📈',
  export: '💾',
  project_save: '📁',
  annotation: '📝',
  sheet_change: '📋',
  data_modify: '✏️',
  sheet_union: '🔗',
  data_refresh: '🔄',
  filter_change: '🔍',
};

export function AuditTrail({ datasetId, onClose }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    fetch(`/api/audit/${datasetId}`)
      .then(r => r.json())
      .then(d => setLogs(d.logs || []))
      .finally(() => setLoading(false));
  }, [datasetId]);

  const formatTime = (ts: string) => {
    try { return new Date(ts).toLocaleString(); } catch { return ts; }
  };

  const filtered = filter
    ? logs.filter(l => l.action.includes(filter) || l.details.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `audit_trail_${datasetId}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportText = () => {
    const lines = logs.map(l => `[${formatTime(l.timestamp)}] ${l.action.replace(/_/g, ' ')}: ${l.details}`);
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `audit_trail_${datasetId}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Audit Trail</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="text" placeholder="Filter..." value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #444', background: '#1e293b', color: '#fff', width: 180 }} />
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="modal-body" style={{ maxHeight: 480, overflowY: 'auto' }}>
          {loading ? (
            <div className="loading-spinner">Loading audit trail...</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state"><p>No audit events recorded yet</p></div>
          ) : (
            <div className="audit-list">
              {[...filtered].reverse().map((log, i) => (
                <div key={i} className="audit-entry">
                  <span className="audit-icon">{ACTION_ICONS[log.action] || '•'}</span>
                  <div className="audit-content">
                    <div className="audit-action">{log.action.replace(/_/g, ' ')}</div>
                    {log.details && <div className="audit-details">{log.details}</div>}
                  </div>
                  <span className="audit-time">{formatTime(log.timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer" style={{ display: 'flex', gap: 8 }}>
          <span style={{ flex: 1, fontSize: 12, color: '#94a3b8', alignSelf: 'center' }}>
            {filtered.length} event{filtered.length !== 1 ? 's' : ''}
          </span>
          <button className="btn-secondary" onClick={exportText}>Export TXT</button>
          <button className="btn-secondary" onClick={exportJSON}>Export JSON</button>
          <button className="btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
