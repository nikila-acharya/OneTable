'use client';

import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'ghost';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = slate-blue filled; ghost = outlined. */
  variant?: ButtonVariant;
  /** sm = inline small action; md = default sheet/foot button. */
  size?: ButtonSize;
  /** false renders an inline-width button (template `.btn.small`). */
  wide?: boolean;
}

/**
 * OneTable primary action button (PRD §16.2 template `.btn`).
 * Full width by default, 44px+ touch target, focus ring per §16.6.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  wide = true,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'ot-btn',
    variant === 'ghost' ? 'ot-btn--ghost' : null,
    size === 'sm' ? 'ot-btn--small' : null,
    !wide ? 'ot-btn--inline' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={classes} {...rest} />;
}

/** Text link-styled button (template `.link`). */
export function LinkButton({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={['ot-link', className].filter(Boolean).join(' ')} {...rest} />;
}
