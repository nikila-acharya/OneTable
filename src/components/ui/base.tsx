/**
 * WP-0.6 base component set (PRD 16.8): card, status chip, segmented control,
 * meal bar, tab bar. Built on tokens.css; styles live in
 * src/app/styles/components.css. Every state is carried by text or an icon
 * as well as colour (PRD 16.6), and every target is >= 44 px.
 */
"use client";

import { useId, type KeyboardEvent, type ReactNode } from "react";

/* ---------------------------------- card ---------------------------------- */

export type CardTone = "stone" | "white" | "sky" | "sand";

export function OtCard({
  children,
  tone = "stone",
  heading,
}: {
  children: ReactNode;
  tone?: CardTone;
  heading?: string;
}) {
  return (
    <section className={`ot-card ot-card--${tone}`} aria-label={heading}>
      {heading ? <h3 className="ot-card__title">{heading}</h3> : null}
      {children}
    </section>
  );
}

/* ----------------------------- status chip ----------------------------- */

export type StatusKind = "ok" | "warn" | "info" | "neutral";

const STATUS_GLYPH: Record<StatusKind, string> = {
  ok: "✓",
  warn: "!",
  info: "i",
  neutral: "•",
};

export function OtStatusChip({
  kind,
  children,
}: {
  kind: StatusKind;
  children: ReactNode;
}) {
  // Glyph + text, so the status never depends on colour alone (PRD 16.6).
  return (
    <span className={`ot-status ot-status--${kind}`}>
      <span className="ot-status__glyph" aria-hidden="true">
        {STATUS_GLYPH[kind]}
      </span>
      {children}
    </span>
  );
}

/* --------------------------- segmented control --------------------------- */

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export function OtSegmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  const groupId = useId();

  // Roving tabindex: arrow keys move and select, as in a native radio group.
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % options.length;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + options.length) % options.length;
    if (next === null) return;
    e.preventDefault();
    const target = options[next];
    if (target) {
      onChange(target.value);
      document.getElementById(`${groupId}-${next}`)?.focus();
    }
  }

  return (
    <div role="radiogroup" aria-label={label} className="ot-seg">
      {options.map((opt, i) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            id={`${groupId}-${i}`}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={`ot-seg__opt${selected ? " ot-seg__opt--on" : ""}`}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------- meal bar -------------------------------- */

export type MealSlot = "breakfast" | "lunch" | "snack" | "dinner";

const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  snack: "Mid-day snack",
  dinner: "Dinner",
};

export function OtMealBar({
  slot,
  children,
}: {
  slot: MealSlot;
  children?: ReactNode;
}) {
  // The slot name is always printed, so colour is never the only signal.
  return (
    <div className={`ot-mealbar ot-mealbar--${slot}`}>
      <span className="ot-mealbar__label">{SLOT_LABEL[slot]}</span>
      {children ? <span className="ot-mealbar__body">{children}</span> : null}
    </div>
  );
}

/* -------------------------------- tab bar -------------------------------- */

export interface TabItem<T extends string> {
  id: T;
  label: string;
}

export function OtTabBar<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: TabItem<T>[];
  active: T;
  onSelect: (id: T) => void;
}) {
  // PRD 16.2: Plan · Recipes · Groceries · Household
  return (
    <nav aria-label="Main" className="ot-tabbar">
      <ul>
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <li key={t.id}>
              <button
                type="button"
                className={`ot-tabbar__tab${on ? " ot-tabbar__tab--on" : ""}`}
                aria-current={on ? "page" : undefined}
                onClick={() => onSelect(t.id)}
              >
                {t.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
