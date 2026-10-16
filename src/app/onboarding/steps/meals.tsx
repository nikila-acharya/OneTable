/** ON01 step 4 — Meals to plan (PRD §5.0, prototype scrMeals). */

"use client";

import { OtButton } from "@/components/ui/controls";
import { SlotSwitch } from "../pickers";
import type { MemberMeals, OnboardStep, OnboardingDraft } from "../store";

const SLOT_COLOR: Record<string, string> = {
  breakfast: "var(--sky)",
  lunch: "var(--sky)",
  snack: "var(--stone)",
  dinner: "var(--sand)",
};

export function weeklyMealCount(meals: MemberMeals[]): number {
  return meals.reduce((acc, mm) => {
    let c = 0;
    if (mm.breakfast) c++;
    if (mm.lunch) c++;
    if (mm.snack) c++;
    if (mm.secondSnack) c++;
    if (mm.dinner) c++;
    return acc + c * 7;
  }, 0);
}

export function slotLabel(mm: MemberMeals | undefined): string {
  if (!mm) return "No meals";
  const parts: string[] = [];
  if (mm.breakfast) parts.push("B");
  if (mm.lunch) parts.push(mm.packedLunch ? "L packed" : "L");
  if (mm.snack) parts.push("S");
  if (mm.secondSnack) parts.push("S2");
  if (mm.dinner) parts.push("D");
  return parts.length ? parts.join(" · ") : "No meals";
}

export function Meals({
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
  const rows = draft.members
    .map((m) => ({ member: m, mm: draft.meals.find((x) => x.memberId === m.id) }))
    .filter((x) => x.mm);

  const setRow = (memberId: string, patch: Partial<MemberMeals>) =>
    update({
      ...draft,
      meals: draft.meals.map((x) => (x.memberId === memberId ? { ...x, ...patch } : x)),
    });

  return (
    <section aria-label="Meals to plan">
      <h1>Meals to plan</h1>
      <p className="ot-sub">
        We start from who's home for what. Change anything — skipped meals are just meals we
        don't plan, nothing more.
      </p>

      {rows.map(({ member, mm }) => {
        const row = mm!;
        return (
          <div className="ot-card" key={member.id}>
            <h2>{member.name}</h2>
            {([
              ["breakfast", "Breakfast"],
              ["lunch", "Lunch"],
              ["snack", "Mid-day snack"],
              ["dinner", "Dinner"],
            ] as const).map(([k, l]) => (
              <div key={k}>
                <SlotSwitch
                  name={l}
                  color={SLOT_COLOR[k]}
                  checked={row[k]}
                  ariaLabel={`Plan ${l.toLowerCase()} for ${member.name}`}
                  onChange={(v) => setRow(member.id, { [k]: v } as Partial<MemberMeals>)}
                />
                {k === "lunch" && row.lunch ? (
                  <div className="ot-subopt">
                    <span>Packed to go (school, work)</span>
                    <label className="ot-switch">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={row.packedLunch !== ""}
                        aria-label={`Pack ${member.name}'s lunch to go`}
                        onChange={(e) =>
                          setRow(member.id, { packedLunch: e.target.checked ? row.packedLunch || "school" : "" })
                        }
                      />
                      <span className="ot-switch__track" aria-hidden="true">
                        <span className="ot-switch__thumb" />
                      </span>
                    </label>
                  </div>
                ) : null}
                {k === "snack" && row.snack ? (
                  <div className="ot-subopt">
                    <span>Add a second snack</span>
                    <label className="ot-switch">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={row.secondSnack}
                        aria-label={`Add a second snack for ${member.name}`}
                        onChange={(e) => setRow(member.id, { secondSnack: e.target.checked })}
                      />
                      <span className="ot-switch__track" aria-hidden="true">
                        <span className="ot-switch__thumb" />
                      </span>
                    </label>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        );
      })}

      <div className="ot-primary">
        <OtButton full onClick={() => goTo(6)}>Continue ›</OtButton>
        <div className="ot-navrow">
          <OtButton kind="ghost" onClick={goBack}>‹ Back</OtButton>
        </div>
      </div>
    </section>
  );
}
