'use client';

import type { ReactNode } from 'react';

export interface ChipProps {
  label: string;
  /** Toggle selection (sky when on, §16.3). */
  selected?: boolean;
  onToggle?: (selected: boolean) => void;
  /**
   * Locked chip: allergies render as sand-colored 🔒 "Never planned" chips
   * wherever they appear (PRD §16.5 / PV rule). Not interactive.
   */
  locked?: boolean;
  className?: string;
}

/**
 * Selectable pill chip (PRD §16.2 template `.chip`), plus the locked
 * allergy variant. The lock shows 🔒 AND text — color is never the only
 * signal (§16.6).
 */
export function Chip({ label, selected = false, onToggle, locked = false, className }: ChipProps) {
  const classes = ['ot-chip', locked ? 'ot-chip--locked' : null, className]
    .filter(Boolean)
    .join(' ');
  if (locked) {
    return (
      <span className={classes} aria-label={`Never planned: ${label}`}>
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={classes}
      aria-pressed={selected}
      onClick={() => onToggle?.(!selected)}
    >
      {label}
    </button>
  );
}

/** Chip row wrapper (template `.chips`). */
export function ChipGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={['ot-chips', className].filter(Boolean).join(' ')}>{children}</div>;
}

/** Static inline tag inside cards (template `.tag`; allergy = sand, clinician = dashed warn). */
export function Tag({
  children,
  tone = 'plain',
  className,
}: {
  children: ReactNode;
  tone?: 'plain' | 'allergy' | 'clinician';
  className?: string;
}) {
  const toneClass =
    tone === 'allergy' ? 'ot-tag--allergy' : tone === 'clinician' ? 'ot-tag--clinician' : null;
  return (
    <span className={['ot-tag', toneClass, className].filter(Boolean).join(' ')}>{children}</span>
  );
}
