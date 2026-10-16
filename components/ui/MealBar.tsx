'use client';

import type { ReactNode } from 'react';

export type MealSlot = 'breakfast' | 'lunch' | 'snack' | 'dinner';

export interface MealBarProps {
  slot: MealSlot;
  /** Planned recipe/item title. */
  title: string;
  /** Minutes for the meta line, e.g. 10 -> "10 min". */
  time?: number;
  /** Who's eating: "Everyone", "Per person", custom text. */
  who?: string;
  /** Source badge, e.g. "From Spice Route Kitchen" (§16.4). */
  source?: string;
  /** Swap note, e.g. "Arjun swap: no mushrooms". */
  swap?: string;
  /** true shows "✓ Passed safety checks" (opens the applied rules). */
  safetyPassed?: boolean;
  /** Slot not planned: stone bar, muted text, "Not planned" label. */
  planned?: boolean;
  /** Tap opens the recipe screen (§16.4). */
  onOpen?: () => void;
  /** Fires when the safety-checks link is activated. */
  onSafetyInfo?: () => void;
  openLabel?: string;
  className?: string;
}

const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  snack: 'Snack',
  dinner: 'Dinner',
};

/**
 * Meal slot bar for the day view (PRD §16.2/§16.4: bars per slot, colored by
 * slot — breakfast/lunch sky, snack stone, dinner sand). The slot label is
 * always rendered so color is never the only signal (§16.6).
 *
 * Structure: the bar itself is a plain container. Opening the recipe is one
 * button (title + who + "View recipe ›" cue), "✓ Passed safety checks" is a
 * sibling button — no nested interactive elements. Copy stays warm and
 * plain: skipped meals are "Not planned", never a deficit (§16.5, NF-5).
 */
export function MealBar({
  slot,
  title,
  time,
  who,
  source,
  swap,
  safetyPassed = false,
  planned = true,
  onOpen,
  onSafetyInfo,
  openLabel = 'View recipe ›',
  className,
}: MealBarProps) {
  const classes = [
    'ot-meal',
    `ot-meal--${slot}`,
    planned ? null : 'ot-meal--off',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const whoText: ReactNode =
    swap && planned ? (
      <>
        {who ?? ''}
        {who ? ' · ' : ''}
        {swap}
      </>
    ) : (
      (who ?? '')
    );

  return (
    <div
      className={classes}
      aria-label={planned ? `${SLOT_LABEL[slot]}: ${title}` : `${SLOT_LABEL[slot]}: not planned`}
    >
      <div className="ot-meal__top">
        <span>
          {SLOT_LABEL[slot]}
          {planned && time != null ? ` · ${time} min` : ''}
        </span>
        {planned && source ? <span className="ot-meal__badge">From {source}</span> : null}
      </div>
      {onOpen && planned ? (
        <button type="button" className="ot-meal__main" onClick={onOpen}>
          <span className="ot-meal__title">{title}</span>
          {who || swap ? <span className="ot-meal__who">{whoText}</span> : null}
          <span className="ot-meal__open">{openLabel}</span>
        </button>
      ) : (
        <div>
          <div className="ot-meal__title">{planned ? title : 'Not planned'}</div>
          {planned && (who || swap) ? <div className="ot-meal__who">{whoText}</div> : null}
        </div>
      )}
      {planned && safetyPassed ? (
        <div className="ot-meal__foot">
          <button type="button" className="ot-meal__safe" onClick={onSafetyInfo}>
            ✓ Passed safety checks
          </button>
        </div>
      ) : null}
    </div>
  );
}
