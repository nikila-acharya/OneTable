/**
 * WP-1.6 — bottom-sheet pickers built on the shared OtSheet (PRD §16.2:
 * "bottom-sheet pickers with Cancel and OK"). Each mirrors the equivalent
 * sheet in design/prototype.html (list, stepper, month/year, short text).
 */

"use client";

import { useState, type ReactNode } from "react";
import { OtButton, OtField, OtSheet } from "@/components/ui/controls";

export function SheetRadioList({
  title,
  options,
  current,
  onClose,
  onPick,
}: {
  title: string;
  options: { label: string; value: string }[];
  current: string | null;
  onClose: () => void;
  onPick: (value: string) => void;
}) {
  const [sel, setSel] = useState<string | null>(current);
  return (
    <OtSheet open title={title} onClose={onClose} onOk={() => sel && onPick(sel)}>
      <div role="radiogroup" aria-label={title}>
        {options.map((o) => (
          <div
            key={o.value}
            role="radio"
            aria-checked={sel === o.value}
            tabIndex={0}
            className={`ot-opt${sel === o.value ? " ot-opt--sel" : ""}`}
            onClick={() => setSel(o.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSel(o.value);
              }
            }}
          >
            <span>{o.label}</span>
            <span className="rd" aria-hidden="true" />
          </div>
        ))}
      </div>
    </OtSheet>
  );
}

export function SheetStepper({
  title,
  unit,
  min,
  max,
  stepBy,
  current,
  meta,
  onClose,
  onPick,
}: {
  title: string;
  unit: string;
  min: number;
  max: number;
  stepBy: number;
  current: number;
  meta?: string;
  onClose: () => void;
  onPick: (value: number) => void;
}) {
  const [v, setV] = useState(current);
  return (
    <OtSheet open title={title} onClose={onClose} onOk={() => onPick(v)}>
      <div className="ot-stepper">
        <OtButton kind="ghost" ariaLabel="Decrease" onClick={() => setV((x) => Math.min(max, Math.max(min, x - stepBy)))}>
          −
        </OtButton>
        <div className="val" aria-live="polite">
          {v} {unit}
        </div>
        <OtButton kind="ghost" ariaLabel="Increase" onClick={() => setV((x) => Math.min(max, Math.max(min, x + stepBy)))}>
          +
        </OtButton>
      </div>
      {meta ? <p className="ot-meta" style={{ textAlign: "center" }}>{meta}</p> : null}
    </OtSheet>
  );
}

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function SheetDate({
  title,
  month,
  year,
  onClose,
  onPick,
}: {
  title: string;
  month: number | null;
  year: number | null;
  onClose: () => void;
  onPick: (month: number, year: number) => void;
}) {
  const nowYear = new Date().getFullYear();
  const [mo, setMo] = useState(month ?? 1);
  const [yr, setYr] = useState(year ?? nowYear);
  return (
    <OtSheet open title={title} onClose={onClose} onOk={() => onPick(mo, yr)}>
      <div className="ot-grid2">
        <OtField label="Birth month" htmlFor="sm">
          <select
            id="sm"
            className="ot-input"
            value={mo}
            onChange={(e) => setMo(Number(e.target.value))}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </OtField>
        <OtField label="Birth year" htmlFor="sy">
          <select
            id="sy"
            className="ot-input"
            value={yr}
            onChange={(e) => setYr(Number(e.target.value))}
          >
            {Array.from({ length: 95 }, (_, i) => nowYear - i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </OtField>
      </div>
    </OtSheet>
  );
}

export function SheetText({
  title,
  label,
  placeholder,
  maxLength,
  okLabel = "OK",
  hint,
  onClose,
  onOk,
}: {
  title: string;
  label: string;
  placeholder?: string;
  maxLength: number;
  okLabel?: string;
  hint?: string;
  onClose: () => void;
  onOk: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <OtSheet open title={title} onClose={onClose} okLabel={okLabel} onOk={() => value.trim() && onOk(value.trim())}>
      <OtField label={label} htmlFor="st-in" hint={hint}>
        <input
          id="st-in"
          className="ot-input"
          maxLength={maxLength}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </OtField>
    </OtSheet>
  );
}

/** Slot switch row (steps 3 attendance + 4 meal toggles), matches prototype `.slot`. */
export function SlotSwitch({
  name,
  color,
  checked,
  onChange,
  ariaLabel,
}: {
  name: ReactNode;
  color?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <div className="ot-slot">
      <span className="ot-slot__name">
        {color ? <span className="ot-bar-tag" style={{ background: color }} aria-hidden="true" /> : null}
        {name}
      </span>
      <label className="ot-switch">
        <input type="checkbox" role="switch" checked={checked} aria-label={ariaLabel} onChange={(e) => onChange(e.target.checked)} />
        <span className="ot-switch__track" aria-hidden="true">
          <span className="ot-switch__thumb" />
        </span>
      </label>
    </div>
  );
}
