import React, { useState, useEffect } from 'react';

const TOUR_STEPS = [
  {
    target: '.source-panel',
    title: '1. Source Columns',
    body: 'All your dataset columns appear here. Drag any column to a zone, or Ctrl+Click to select multiple.',
    position: 'right' as const,
  },
  {
    target: '.dropzone[data-zone="rows"]',
    title: '2. Rows Zone',
    body: 'Drop dimensions here to create row groupings. Date columns will prompt for Year/Quarter/Month grouping.',
    position: 'bottom' as const,
  },
  {
    target: '.dropzone[data-zone="values"]',
    title: '3. Values Zone',
    body: 'Drop any field here to aggregate it. Right-click chips to change aggregation (Sum, Count, Avg, %, etc.).',
    position: 'bottom' as const,
  },
  {
    target: '.topbar-actions',
    title: '4. Toolbar',
    body: 'Use Format for themes & styling, Export to download Excel/Word/PDF, Metrics for custom calculations, and Compare for period-over-period analysis.',
    position: 'bottom' as const,
  },
  {
    target: '.live-preview',
    title: '5. Live Preview',
    body: 'Your table updates instantly. Click any data cell to drill down to source rows. Right-click to add annotations. The 📊 tab shows a summary dashboard of all tables.',
    position: 'top' as const,
  },
];

const STORAGE_KEY = 'tableforge_tour_done';

interface Props {
  onClose: () => void;
}

export function OnboardingTour({ onClose }: Props) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(true);

  const current = TOUR_STEPS[step];

  const handleClose = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setVisible(false);
    onClose();
  };

  const handleNext = () => {
    if (step < TOUR_STEPS.length - 1) setStep(s => s + 1);
    else handleClose();
  };

  if (!visible) return null;

  return (
    <>
      <div className="tour-backdrop" onClick={handleClose} />
      <div className="tour-tooltip">
        <div className="tour-header">
          <span className="tour-step-badge">{step + 1}/{TOUR_STEPS.length}</span>
          <button className="tour-close" onClick={handleClose}>✕</button>
        </div>
        <div className="tour-title">{current.title}</div>
        <div className="tour-body">{current.body}</div>
        <div className="tour-footer">
          {step > 0 && (
            <button className="btn-secondary" onClick={() => setStep(s => s - 1)}>← Back</button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn-primary" onClick={handleNext}>
            {step < TOUR_STEPS.length - 1 ? 'Next →' : '🚀 Get Started'}
          </button>
        </div>
        <div className="tour-dots">
          {TOUR_STEPS.map((_, i) => (
            <span key={i} className={`tour-dot ${i === step ? 'active' : ''}`}
              onClick={() => setStep(i)} />
          ))}
        </div>
      </div>
    </>
  );
}

export function shouldShowTour(): boolean {
  return !localStorage.getItem(STORAGE_KEY);
}
