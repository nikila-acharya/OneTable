'use client';

import type { ReactNode } from 'react';

export type StatusTone = 'running' | 'ok' | 'needs-action';

export interface StatusChipProps {
  tone: StatusTone;
  /**
   * Status text — REQUIRED. Color is never the only signal (§16.6):
   * "Importing recipes…", "42 recipes added", "Linked · share posts or add
   * their website" (§16.5).
   */
  children: ReactNode;
  className?: string;
}

/**
 * Live status pill on source cards and other async rows (PRD §16.5,
 * template `.status-chip`/`.s-run`/`.s-ok`/`.s-need`).
 * running = sky, ok = soft green, needs-action = sand with AA text.
 */
export function StatusChip({ tone, children, className }: StatusChipProps) {
  return (
    <span className={['ot-status', `ot-status--${tone}`, className].filter(Boolean).join(' ')}>
      {children}
    </span>
  );
}
