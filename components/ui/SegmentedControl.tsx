'use client';

import type { KeyboardEvent } from 'react';

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string | number> {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group, e.g. "Weekday breakfast". */
  ariaLabel: string;
  className?: string;
}

/**
 * Segmented choice control (PRD §16.2 template `.seg`; used for time budgets,
 * sex, activity in the member sheet). Radio group semantics with arrow-key
 * support per §16.6 full-keyboard requirement. Styling: `.ot-seg` in
 * app/styles/ui.css (imported by the screens, see §16.3 note in tokens.css).
 */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  const selectedIndex = options.findIndex((o) => o.value === value);

  function move(delta: number) {
    const next = options[(selectedIndex + delta + options.length) % options.length];
    if (next) onChange(next.value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={['ot-seg', className].filter(Boolean).join(' ')}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="ot-seg__option"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
