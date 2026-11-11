'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface CardProps {
  /** Optional card title row with a right-aligned action (template `.sum h4`). */
  title?: ReactNode;
  /** Action on the title row, e.g. an Edit `LinkButton`. */
  action?: ReactNode;
  /**
   * panel   = stone summary card (template `.sum`/`.member`),
   * outline = white bordered card (`.src`),
   * accent  = white card with primary border (`.approve`),
   * dashed  = "add" affordance (`.addcard`), rendered as a button.
   */
  variant?: 'panel' | 'outline' | 'accent' | 'dashed';
  /** Heading level for `title` — pick per screen outline (default h3). */
  headingLevel?: 'h2' | 'h3' | 'h4';
  children?: ReactNode;
  className?: string;
  /** For variant="dashed": click handler. */
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>['onClick'];
}

/**
 * Content card (PRD §16.2 template `.sum`, `.member`, `.src`, `.approve`,
 * `.addcard`). 18px radius per §16.3.
 */
export function Card({
  title,
  action,
  variant = 'panel',
  headingLevel = 'h3',
  children,
  className,
  onClick,
}: CardProps) {
  const variantClass =
    variant === 'outline'
      ? 'ot-card--outline'
      : variant === 'accent'
        ? 'ot-card--accent'
        : variant === 'dashed'
          ? 'ot-card--dashed'
          : null;
  const classes = ['ot-card', variantClass, className].filter(Boolean).join(' ');

  const Heading = headingLevel;
  if (variant === 'dashed') {
    return (
      <button type="button" className={classes} onClick={onClick}>
        {children}
      </button>
    );
  }
  return (
    <section className={classes}>
      {title ? (
        <Heading className="ot-card__head">
          <span>{title}</span>
          {action}
        </Heading>
      ) : null}
      <div className="ot-card__body">{children}</div>
    </section>
  );
}
