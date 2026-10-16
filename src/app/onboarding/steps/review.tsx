/**
 * ON01 step 6 — Review & first plan (PRD §5.0, §16.5, prototype scrReview).
 *
 * Summary of the household; stored allergies shown as locked "Never
 * planned" chips that match the stored data exactly (§5.0 AC); the Sources
 * section shows the starter-library fallback (step 5 is WP-2.7, so
 * onboarding finishes with zero sources — §5.0 AC). "Plan our first week"
 * runs the progress stub and the approval-card preview; the real planner
 * lands in M3.
 */

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AllergyChip, ClinicianNote, OtButton } from "@/components/ui/controls";
import {
  ageYears,
  allStoredAllergies,
  memberNeedsGeneralGuidance,
  type OnboardStep,
  type OnboardingDraft,
} from "../store";
import { slotLabel, weeklyMealCount } from "./meals";
import { activityLabel, conditionLabel, sexLabel } from "./members";

function nextMondayLabel(): string {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() + ((7 - day) % 7 || 7));
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function ReviewSection({
  title,
  onEdit,
  children,
}: {
  title: ReactNode;
  onEdit?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="ot-rsec">
      <div className="ot-rsec__hd">
        <b>{title}</b>
        {onEdit ? (
          <button type="button" className="ot-iconbtn" onClick={onEdit}>Edit ›</button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function KRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="ot-krow">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

export function Review({
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
  const mealCount = weeklyMealCount(draft.meals);

  // Stored allergies -> review chips, one per distinct allergen, in stored order (§5.0 AC).
  const stored = allStoredAllergies(draft);
  const chips: { allergen: string; who: string[] }[] = [];
  for (const s of stored) {
    const found = chips.find((c) => c.allergen === s.allergen);
    if (found) {
      if (!found.who.includes(s.memberName)) found.who.push(s.memberName);
    } else {
      chips.push({ allergen: s.allergen, who: [s.memberName] });
    }
  }

  const gatedCount = draft.members.filter(memberNeedsGeneralGuidance).length;

  type Phase = "idle" | "progress" | "approval";
  const [phase, setPhase] = useState<Phase>(draft.firstPlanRequestedAt ? "approval" : "idle");
  const [visible, setVisible] = useState(draft.firstPlanRequestedAt ? 4 : 0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lines = [
    "Using 0 sources · reading the starter library",
    "Checking allergies against every recipe",
    `Planning ${mealCount || 28} meals (7 days × every slot)`,
    "Making sure nobody gets a meal they can't eat",
  ];

  useEffect(() => {
    if (phase !== "progress") return;
    if (prefersReducedMotion()) {
      setVisible(lines.length);
      finish();
      return;
    }
    if (visible >= lines.length) {
      finish();
      return;
    }
    timer.current = setTimeout(() => setVisible((v) => v + 1), 550);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, visible]);

  function finish() {
    setPhase("approval");
    if (!draft.firstPlanRequestedAt) {
      update({ ...draft, firstPlanRequestedAt: new Date().toISOString() });
    }
  }

  const startPlan = () => {
    setVisible(0);
    setPhase("progress");
  };

  const memberLine = (i: number) => {
    const m = draft.members[i];
    const age = ageYears(m);
    return `${age !== null ? `${age} yrs` : "age not set"} · ${activityLabel(m.activity) || "activity not set"}${m.dietaryPattern ? ` · ${m.dietaryPattern}` : ""}`;
  };

  return (
    <section aria-label="Review and first plan">
      <h1>Review &amp; first plan</h1>
      <p className="ot-sub">One look before we draft your week. Tap any section to change it.</p>

      <ReviewSection title="Household" onEdit={() => goTo(2)}>
        <KRow k="Name" v={h.name} />
        <KRow k="Time zone" v={h.timezone} />
        <KRow k="Weekday breakfast" v={`${h.weekdayBreakfastMinutes} min`} />
        <KRow k="Weeknight dinner" v={`${h.weeknightDinnerMinutes} min`} />
        <KRow k="Cuisines" v={h.cuisines.length ? h.cuisines.join(", ") : "Any"} />
      </ReviewSection>

      <ReviewSection title={`Members (${draft.members.length})`} onEdit={() => goTo(3)}>
        {draft.members.map((m) => (
          <KRow key={m.id} k={m.name} v={memberLine(draft.members.indexOf(m))} />
        ))}
        <div style={{ marginTop: 10 }}>
          <div className="ot-chips">
            {chips.map((c) => (
              <span key={c.allergen} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <AllergyChip allergen={c.allergen} />
                <span className="ot-meta" style={{ margin: 0 }}>({c.who.join(", ")})</span>
              </span>
            ))}
          </div>
          {chips.length ? (
            <p className="ot-meta" style={{ marginTop: 8 }}>
              These become hard never-plan rules for the members above, including shared meals.
            </p>
          ) : (
            <p className="ot-meta">No allergies stored.</p>
          )}
        </div>
        {gatedCount > 0 ? (
          <ClinicianNote />
        ) : null}
        {gatedCount > 0 ? (
          <p className="ot-meta">
            {gatedCount} of {draft.members.length} member{draft.members.length === 1 ? "" : "s"} use
            general-guidance mode.
          </p>
        ) : null}
      </ReviewSection>

      <ReviewSection title="Meals" onEdit={() => goTo(4)}>
        {draft.members.map((m) => (
          <KRow key={m.id} k={m.name} v={slotLabel(draft.meals.find((x) => x.memberId === m.id))} />
        ))}
      </ReviewSection>

      <ReviewSection title="Sources">
        <p className="ot-meta" style={{ margin: 0 }}>
          None yet — we'll plan from our recipe starter library. You can add sources in the next
          version, any time from Household.
        </p>
      </ReviewSection>

      <div className="ot-primary">
        <OtButton full onClick={startPlan} disabled={phase === "progress"}>
          Plan our first week
        </OtButton>
        <div className="ot-navrow">
          <OtButton kind="ghost" onClick={goBack}>‹ Back</OtButton>
        </div>
      </div>

      {phase !== "idle" && (
        <div className="ot-prog" aria-label="First plan progress">
          <h2>Your first week</h2>
          {lines.map((l, i) => (
            <div
              key={l}
              className={`ot-prog-line${i < visible ? " ot-prog-line--done" : i === visible ? " ot-prog-line--now" : ""}`}
            >
              <span className="tick" aria-hidden="true">✓</span>
              <span>{l}</span>
            </div>
          ))}
          <div className="ot-prog-bar" role="presentation">
            <i style={{ width: `${Math.round((visible / lines.length) * 100)}%` }} />
          </div>
        </div>
      )}

      {phase === "approval" && (
        <div className="ot-approval" role="group" aria-label="Approval card preview">
          <p className="tag">Approval inbox · draft</p>
          <p className="ot-approval__title">Draft week · {nextMondayLabel()}</p>
          <p className="ot-meta">
            {draft.members.length} member{draft.members.length === 1 ? "" : "s"} · {mealCount} meals ·
            from the starter library
          </p>
          <p className="ot-okline">✓ Passed safety checks</p>
          <div className="ot-disabled-btns">
            <OtButton disabled>Approve</OtButton>
            <OtButton kind="ghost" disabled>Edit</OtButton>
            <OtButton kind="ghost" disabled>Decline</OtButton>
          </div>
          <p className="ot-stub-note">
            This is where the drafted week lands and goes to your approval inbox. The planner
            arrives with milestone M3 (WP-3.1–3.6), so no real recipes are shown yet.
          </p>
          <div className="ot-primary">
            <OtButton
              full
              onClick={() => update({ ...draft, finishedAt: new Date().toISOString(), completed: Array.from(new Set([...draft.completed, 6 as OnboardStep])) })}
            >
              Finish setup ›
            </OtButton>
          </div>
        </div>
      )}
    </section>
  );
}
