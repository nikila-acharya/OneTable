/** ON01 step 2 — Your household (PRD §5.0, prototype scrHousehold). */

"use client";

import { useState } from "react";
import { OtButton, OtField } from "@/components/ui/controls";
import { SheetRadioList, SheetStepper, SheetText } from "../pickers";
import { CUISINES, type OnboardStep, type OnboardingDraft } from "../store";

/** Common zones first (prototype list), plus the browser default if missing. */
const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
  "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "America/Toronto",
  "America/Mexico_City", "America/Sao_Paulo", "Europe/London", "Europe/Paris",
  "Europe/Berlin", "Europe/Madrid", "Europe/Rome", "Europe/Istanbul", "Africa/Cairo",
  "Africa/Lagos", "Africa/Nairobi", "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata",
  "Asia/Bangkok", "Asia/Jakarta", "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul",
  "Australia/Sydney", "Pacific/Auckland",
];

type Sheet = null | "tz" | "b" | "d" | "cuisine";

export function Household({
  draft,
  update,
  goTo,
  goBack,
}: {
  draft: OnboardingDraft;
  update: (d: OnboardingDraft) => void;
  goTo: (n: OnboardStep) => void;
  goBack: () => void;
}) {
  const h = draft.household;
  const [sheet, setSheet] = useState<Sheet>(null);
  const [err, setErr] = useState("");

  const setH = (patch: Partial<typeof h>) => update({ ...draft, household: { ...h, ...patch } });
  const cuisines = [...CUISINES, ...h.cuisines.filter((c) => !CUISINES.includes(c as (typeof CUISINES)[number]))];

  const tzOptions = h.timezone && !TIMEZONES.includes(h.timezone) ? [h.timezone, ...TIMEZONES] : TIMEZONES;

  const toggleCuisine = (c: string) =>
    setH({ cuisines: h.cuisines.includes(c) ? h.cuisines.filter((x) => x !== c) : [...h.cuisines, c] });

  const onContinue = () => {
    if (!h.name.trim()) {
      setErr("Please name your household.");
      return;
    }
    goTo(3);
  };

  return (
    <section aria-label="Your household">
      <h1>Your household</h1>
      <p className="ot-sub">The basics. Everything here stays editable later, on the Household tab.</p>

      <OtField label="Household name" htmlFor="hh-name" required>
        <input
          id="hh-name"
          className="ot-input"
          maxLength={40}
          placeholder="e.g. The Rivera family"
          value={h.name}
          onChange={(e) => {
            setH({ name: e.target.value });
            if (err) setErr("");
          }}
        />
      </OtField>

      <OtField label="Time zone" htmlFor="hh-tz" required>
        <button type="button" id="hh-tz" className="ot-picker" onClick={() => setSheet("tz")}>
          <span className={`v${h.timezone ? "" : " empty"}`}>{h.timezone || "Tap to choose"}</span>
          <span className="chev" aria-hidden="true">›</span>
        </button>
      </OtField>

      <h2>Cooking-time limits</h2>
      <p className="ot-meta" style={{ fontSize: 14 }}>
        We never plan a meal that takes longer than this on those days.
      </p>

      <OtField label="Weekday breakfast" htmlFor="hh-b">
        <button type="button" id="hh-b" className="ot-picker" onClick={() => setSheet("b")}>
          <span className="v">{h.weekdayBreakfastMinutes} minutes</span>
          <span className="chev" aria-hidden="true">›</span>
        </button>
      </OtField>
      <OtField label="Weeknight dinner" htmlFor="hh-d">
        <button type="button" id="hh-d" className="ot-picker" onClick={() => setSheet("d")}>
          <span className="v">{h.weeknightDinnerMinutes} minutes</span>
          <span className="chev" aria-hidden="true">›</span>
        </button>
      </OtField>

      <h2>Cuisines your family loves</h2>
      <p className="ot-meta" style={{ fontSize: 14 }}>
        Pick any that fit. This steers suggestions — it never excludes anything.
      </p>
      <div className="ot-chips" role="group" aria-label="Cuisines">
        {cuisines.map((c) => (
          <button
            key={c}
            type="button"
            className="ot-chip"
            aria-pressed={h.cuisines.includes(c)}
            onClick={() => toggleCuisine(c)}
          >
            {c}
          </button>
        ))}
        <button type="button" className="ot-chip ot-chip--add" onClick={() => setSheet("cuisine")}>
          + Your own
        </button>
      </div>

      <h2>
        Budget feel <span className="opt">(optional — coming later)</span>
      </h2>
      <button type="button" className="ot-picker" disabled>
        <span className="v empty">Ask for this in a later version</span>
      </button>

      <div className="ot-primary">
        <OtButton full onClick={onContinue}>Continue ›</OtButton>
        <OtButton kind="ghost" full onClick={goBack}>‹ Back</OtButton>
      </div>
      <p className="ot-err" role="alert">{err}</p>

      {sheet === "tz" && (
        <SheetRadioList
          title="Time zone"
          options={tzOptions.map((z) => ({ label: z, value: z }))}
          current={h.timezone}
          onClose={() => setSheet(null)}
          onPick={(v) => { setH({ timezone: v }); setSheet(null); }}
        />
      )}
      {sheet === "b" && (
        <SheetStepper
          title="Weekday breakfast"
          unit="minutes"
          min={5}
          max={45}
          stepBy={5}
          current={h.weekdayBreakfastMinutes}
          meta="Cooking time per meal — how long you're happy spending on a week's weekday breakfast most days."
          onClose={() => setSheet(null)}
          onPick={(v) => { setH({ weekdayBreakfastMinutes: v }); setSheet(null); }}
        />
      )}
      {sheet === "d" && (
        <SheetStepper
          title="Weeknight dinner"
          unit="minutes"
          min={10}
          max={90}
          stepBy={5}
          current={h.weeknightDinnerMinutes}
          meta="Cooking time per meal — how long you're happy spending on a week's weeknight dinner most days."
          onClose={() => setSheet(null)}
          onPick={(v) => { setH({ weeknightDinnerMinutes: v }); setSheet(null); }}
        />
      )}
      {sheet === "cuisine" && (
        <SheetText
          title="Your own"
          label="Your cuisine"
          placeholder="e.g. Peruvian"
          maxLength={24}
          onClose={() => setSheet(null)}
          onOk={(v) => {
            if (!h.cuisines.includes(v)) setH({ cuisines: [...h.cuisines, v] });
            setSheet(null);
          }}
        />
      )}
    </section>
  );
}
