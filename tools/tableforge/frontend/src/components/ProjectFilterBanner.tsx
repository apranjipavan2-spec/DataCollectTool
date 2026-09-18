import React from 'react';

interface Props {
  filters?: Record<string, string[]>;
  context?: string; // e.g., "analysis" | "battery" — small wording tweak
}

export function ProjectFilterBanner({ filters, context = 'analysis' }: Props) {
  if (!filters) return null;
  const active = Object.entries(filters).filter(([, v]) => v && v.length > 0);
  if (active.length === 0) return null;
  return (
    <div style={{
      background: 'rgba(56,189,248,0.10)',
      border: '1px solid rgba(56,189,248,0.35)',
      color: '#7dd3fc',
      borderRadius: 6,
      padding: '6px 10px',
      marginBottom: 12,
      fontSize: 12,
    }}>
      🌐 Project Filter active — {context} runs on the filtered subset only
      ({active.map(([k, v]) => `${k} (${v.length})`).join(', ')}).
    </div>
  );
}
