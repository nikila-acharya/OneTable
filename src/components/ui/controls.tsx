/**
 * Minimal UI primitives used by the ON01 onboarding screens (WP-1.6).
 * WP-0.6 owns the canonical component set; these are deliberately small,
 * token-based stand-ins with the same behavior PRD §16.2 calls for
 * (bottom-sheet pickers with Cancel and OK, chips, 44 px targets, focus
 * rings) so the screens match §16 design and can be swapped to WP-0.6
 * components at merge time.
 */

"use client";

import { useEffect, useRef, type ReactNode } from "react";

/* ---------------------------------- button ---------------------------------- */

export function OtButton({
  children,
  onClick,
  kind = "primary",
  type = "button",
  disabled = false,
  full = false,
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "ghost";
  type?: "button" | "submit";
  disabled?: boolean;
  full?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`ot-btn ot-btn--${kind}${full ? " ot-btn--full" : ""}`}
    >
      {children}
    </button>
  );
}

/* ----------------------------------- chip ----------------------------------- */

export function OtChip({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={selected}
      onClick={onToggle}
      className={`ot-chip${selected ? " ot-chip--selected" : ""}`}
    >
      {selected ? <span aria-hidden="true">✓ </span> : null}
      {label}
    </button>
  );
}

/**
 * Allergy chip: sand-colored 🔒 "Never planned" everywhere (§16.5), so color
 * is never the only signal (§16.6) — the text carries the meaning.
 */
export function AllergyChip({ allergen }: { allergen: string }) {
  return (
    <span className="ot-chip ot-chip--never" aria-label={`${allergen}: never planned`}>
      🔒 <span className="ot-chip--never-name">{allergen}</span> · Never planned
    </span>
  );
}

/* ---------------------------------- toggle ---------------------------------- */

export function OtToggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="ot-toggle">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="ot-toggle__track" aria-hidden="true">
        <span className="ot-toggle__thumb" />
      </span>
      <span className="ot-toggle__label">
        {label}
        {hint ? <span className="ot-toggle__hint"> · {hint}</span> : null}
      </span>
    </label>
  );
}

/* ----------------------------------- field ---------------------------------- */

export function OtField({
  label,
  htmlFor,
  children,
  hint,
  required,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div className="ot-field">
      <label htmlFor={htmlFor}>
        {label}
        {required ? <span className="ot-required"> *</span> : null}
      </label>
      {children}
      {hint ? (
        <p id={`${htmlFor}-hint`} className="ot-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------- bottom sheet -------------------------------- */

/**
 * Bottom-sheet with Cancel and OK (§16.2), focus trap and Esc to close
 * (§16.6). `onOk` is called when OK is pressed; the sheet stays mounted
 * while `open`.
 */
export function OtSheet({
  open,
  title,
  onClose,
  onOk,
  okLabel = "OK",
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onOk?: () => void;
  okLabel?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    const el = ref.current;
    // Move focus into the sheet.
    const first = el?.querySelector<HTMLElement>(
      "input, select, button, [tabindex]:not([tabindex='-1'])",
    );
    (first ?? el)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const focusables = Array.from(
        el.querySelectorAll<HTMLElement>(
          "input:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (focusables.length === 0) return;
      const firstEl = focusables[0]!;
      const lastEl = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="ot-sheet-backdrop" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="ot-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ot-sheet__handle" aria-hidden="true" />
        <h2 className="ot-sheet__title">{title}</h2>
        <div className="ot-sheet__body">{children}</div>
        <div className="ot-sheet__actions">
          <OtButton kind="ghost" onClick={onClose}>
            Cancel
          </OtButton>
          {onOk ? (
            <OtButton onClick={onOk} kind="primary">
              {okLabel}
            </OtButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- status note -------------------------------- */

/** Clinician-confirm style note (SG01) — warn color plus text, never color alone. */
export function ClinicianNote() {
  return (
    <p className="ot-note ot-note--warn" role="note">
      <span aria-hidden="true">⚕ </span>General guidance only. Confirm with your
      clinician.
    </p>
  );
}
