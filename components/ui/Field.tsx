'use client';

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cloneElement, isValidElement, useId } from 'react';

export interface FieldProps {
  label: string;
  /** Optional helper line under the control. */
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
}

/**
 * Labeled form field (PRD §16.2 template `.field`/`.input`).
 * Required fields first everywhere in OneTable (§16.5), so `required`
 * is a first-class prop. Pass `Input`, `Select`, `Textarea` or any control.
 */
export function Field({ label, hint, required, children, className, id }: FieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  // Attach the label's target id to the single control child (inputs,
  // selects and textareas are otherwise unnamed — axe `label`/`select-name`).
  const child =
    isValidElement<{ id?: string }>(children) && !children.props.id
      ? cloneElement(children, { id: fieldId })
      : children;
  return (
    <div className={['ot-field', className].filter(Boolean).join(' ')}>
      <label className="ot-field__label" htmlFor={fieldId}>
        {label}
        {required ? ' *' : ''}
      </label>
      {child}
      {hint ? <p className="ot-field__hint">{hint}</p> : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={['ot-input', className].filter(Boolean).join(' ')} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={['ot-input', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={['ot-input', className].filter(Boolean).join(' ')} {...rest} />;
}

/** Side-by-side field row (template `.row`). */
export function FieldRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={['ot-row', className].filter(Boolean).join(' ')}>{children}</div>;
}
