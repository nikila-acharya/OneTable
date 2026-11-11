'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

export interface BottomSheetProps {
  open: boolean;
  /** Close request: scrim tap, X, Esc or Cancel. */
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /**
   * Confirm action; renders an OK button in the footer (template pickers
   * always have Cancel + OK, PRD §16.2).
   */
  onOk?: () => void;
  okLabel?: string;
  cancelLabel?: string;
  /** Extra node between body and footer, e.g. a link or explanation. */
  aside?: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet / picker (PRD §16.2 template sheet; §16.6: full keyboard
 * support, focus trapped while open, Esc closes). Rendered fixed to the
 * viewport; keeps its nodes in the DOM so the slide transition runs both
 * ways.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  onOk,
  okLabel = 'OK',
  cancelLabel = 'Cancel',
  aside,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useRef(`ot-sheet-title-${Math.random().toString(36).slice(2)}`).current;

  // Esc to close; focus trap; focus in/out management.
  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(sheet?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null,
      );

    // Move focus into the sheet on open.
    const first = focusables()[0];
    first?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === 'Tab' && sheet) {
        const items = focusables();
        if (items.length === 0) {
          event.preventDefault();
          return;
        }
        const firstItem = items[0];
        const lastItem = items[items.length - 1];
        if (event.shiftKey && document.activeElement === firstItem) {
          event.preventDefault();
          lastItem.focus();
        } else if (!event.shiftKey && document.activeElement === lastItem) {
          event.preventDefault();
          firstItem.focus();
        }
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  return (
    <>
      <div
        className={open ? 'ot-sheet-scrim ot-sheet-scrim--open' : 'ot-sheet-scrim'}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        className={open ? 'ot-sheet ot-sheet--open' : 'ot-sheet'}
        role="dialog"
        aria-modal={open ? true : undefined}
        aria-labelledby={titleId}
        aria-hidden={!open}
      >
        <div className="ot-sheet__grab" aria-hidden="true" />
        <h2 className="ot-sheet__title" id={titleId}>
          <span>{title}</span>
          <button type="button" className="ot-sheet__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </h2>
        <div className="ot-sheet__body">{children}</div>
        {aside}
        <div className="ot-sheet__footer">
          <button type="button" className="ot-btn ot-btn--ghost" onClick={onClose}>
            {cancelLabel}
          </button>
          {onOk ? (
            <button type="button" className="ot-btn" onClick={onOk}>
              {okLabel}
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
