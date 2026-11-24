/**
 * ON01 step 6 — Review & first plan (PRD §5.0, §16.5, prototype scrReview).
 *
 * Summary of the household; stored allergies shown as locked "Never
 * planned" chips that match the stored data exactly (§5.0 AC); the Sources
 * section shows the starter-library fallback (step 5 is WP-2.7, so
 * onboarding finishes with zero sources — §5.0 AC). "Plan our first week"
 * runs the real pipeline: it saves the draft, imports the household's linked
 * sources, then asks the server to draft the week and renders what came back
 * (or the plain reason nothing was drafted).
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
import { slotLabel } from "./meals";
import { activityLabel } from "./members";

function nextMondayLabel(): string {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() + ((7 - day) % 7 || 7));
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
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

type PlanMeal = { date: string; mealType: string; recipeId: string; recipeName: string };
type PlanView = {
  created: boolean;
  planId: string;
  weekStart: string;
  seed: number;
  slots: number;
  status: string;
  meals: PlanMeal[];
};
type ImportResponse = {
  imported: { url: string; status: string }[];
  skipped: { url: string; status?: string; reason: string }[];
  alreadyImported: number;
  remaining: number;
  nutritionConfigured: boolean;
};

const MEAL_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

/**
 * Plain next steps for the reasons the server can actually return from
 * /api/plans/first (ADR-119). An unknown code falls back to a generic line
 * rather than promising something we have not established.
 */
const FAILURE_NEXT_STEP: Record<string, string> = {
  no_recipes: "We have no recipes stored for your household yet. Link a few recipe pages and press again.",
  pool_blocked:
    "Someone in your household declared a diet we cannot prove for the recipes we hold, so nothing was guessed. Import recipes that state their diet.",
  planner_refused:
    "The recipes we hold are too few or too similar to fill every meal. Adding a couple more links usually fixes this.",
  no_members: "Add the people you cook for first, then draft the week.",
  save_rejected: "Fix the highlighted answers above and press again.",
  unauthenticated: "Your session expired - sign in again and press the button.",
};

function planByDay(meals: PlanMeal[]): Record<string, PlanMeal[]> {
  const by: Record<string, PlanMeal[]> = {};
  for (const m of meals) (by[m.date] ||= []).push(m);
  return Object.fromEntries(Object.entries(by).sort(([x], [y]) => (x < y ? -1 : 1)));
}

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export function Review({
  draft,
  update,
  goTo,
  goBack,
  submitDraft,
}: {
  draft: OnboardingDraft;
  update: (d: OnboardingDraft) => void;
  goTo: (n: OnboardStep) => void;
  /** Saves the draft to the backend (WP-1.6). Resolves ok, or a message to show. */
  submitDraft?: () => Promise<{ ok: true } | { ok: false; message: string }>;
  goBack: () => void;
}) {
  const h = draft.household;

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

  // Stages are driven by the actual requests, not by a timer. The stub that
  // used to live here animated four reassuring lines ("Reading the starter
  // library", "Planning 28 meals") and a "✓ Passed safety checks" card while
  // making no request at all: the screen claimed work it had not done.
  type Stage = "idle" | "saving" | "reading" | "planning" | "planned" | "failed";
  const [stage, setStage] = useState<Stage>("idle");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Resuming after a previous request must not create a second plan by itself.
  const [resumed] = useState<boolean>(Boolean(draft.firstPlanRequestedAt));

  // WP-2.7: step 5 stores sources on the server; review reads them back
  // (never the draft) so the numbers match what is actually saved.
  const [sourceCards, setSourceCards] = useState<
    { url: string; creatorName: string | null; chip: { kind: string; text: string } }[]
  >([]);
  const sourcesLoaded = useRef(false);
  useEffect(() => {
    if (sourcesLoaded.current) return;
    sourcesLoaded.current = true;
    fetch("/api/sources")
      .then((r) => (r.ok ? (r.json() as Promise<{ sources?: typeof sourceCards }>) : { sources: [] }))
      .then((j) => setSourceCards(Array.isArray(j.sources) ? j.sources : []))
      .catch(() => {});
  }, []);

  const STAGE_LABELS: Record<string, string> = {
    saving: "Saving your answers",
    reading: "Reading the recipe links you saved",
    planning: "Drafting your week",
  };
  const STAGE_ORDER = ["saving", "reading", "planning"];
  const stageIndex = STAGE_ORDER.indexOf(stage === "planned" || stage === "failed" ? "planning" : stage);
  const doneStages = STAGE_ORDER.slice(0, Math.max(0, stageIndex));

  async function postJson(path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
    const res = await fetch(path, {
      method: "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: Record<string, unknown> | null = null;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }

  const runPlan = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    setImportNote(null);
    try {
      setStage("saving");
      if (submitDraft) {
        const res = await submitDraft();
        if (!res.ok) {
          setSubmitError(res.message);
          setStage("failed");
          setFailure({ code: "save_rejected", message: res.message });
          return;
        }
      }
      setSubmitError(null);

      if (sourceCards.length > 0) {
        setStage("reading");
        const imp = await postJson("/api/sources/import");
        if (imp.status === 200 && imp.json) {
          const j = imp.json as unknown as ImportResponse;
          const totalLinks = j.imported.length + j.skipped.length + j.alreadyImported;
          const bits: string[] = [];
          bits.push(`${j.imported.length} of ${totalLinks} link${totalLinks === 1 ? "" : "s"} read`);
          if (j.alreadyImported) bits.push(`${j.alreadyImported} already in your library`);
          if (j.skipped.length) bits.push(`${j.skipped.length} skipped (${j.skipped[0]!.reason.replace(/\.$/, "").toLowerCase()})`);
          if (j.remaining) bits.push(`${j.remaining} still waiting - press again for the rest`);
          if (!j.nutritionConfigured) bits.push("no nutrition service configured, so new recipes cannot be planned yet");
          setImportNote(bits.join(" · "));
        } else if (imp.status === 409) {
          setImportNote("Nothing linked to read yet, so planning uses the recipes you already have.");
        } else {
          setImportNote("Your saved links could not be read this time, so planning used what is already stored.");
        }
      }

      setStage("planning");
      const p = await postJson("/api/plans/first");
      if (p.status === 200 || p.status === 201) {
        const j = p.json as unknown as PlanView;
        setPlan(j);
        setStage("planned");
        if (!draft.firstPlanRequestedAt) {
          update({ ...draft, firstPlanRequestedAt: new Date().toISOString() });
        }
        return;
      }
      const j = (p.json ?? {}) as { error?: string; message?: string };
      setStage("failed");
      setFailure({ code: j.error ?? `http_${p.status}`, message: j.message ?? "We could not draft the week just now." });
    } finally {
      setBusy(false);
    }
  };

  const startPlan = async () => {
    await runPlan();
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

      <ReviewSection title="Sources" onEdit={() => goTo(5)}>
        {sourceCards.length === 0 ? (
          <p className="ot-meta" style={{ margin: 0 }}>
            None yet — we’ll plan from our recipe starter library. Add some any time from the
            Household tab once your account is set up.
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {sourceCards.slice(0, 6).map((s) => (
              <li key={s.url} className="ot-meta">
                {s.creatorName ?? s.url} — {s.chip.text}
              </li>
            ))}
            {sourceCards.length > 6 && <li className="ot-meta">and {sourceCards.length - 6} more</li>}
          </ul>
        )}
      </ReviewSection>

      <div className="ot-primary">
        {submitError ? (
          <p role="alert" className="ot-sub" style={{ color: "var(--warn)", marginBottom: 8 }}>
            {submitError}
          </p>
        ) : null}
        <OtButton full onClick={() => void startPlan()} disabled={busy}>
          {plan ? "Draft the week again" : "Plan our first week"}
        </OtButton>
        <div className="ot-navrow">
          <OtButton kind="ghost" onClick={goBack}>‹ Back</OtButton>
        </div>
      </div>

      {resumed && !plan && stage === "idle" ? (
        <p className="ot-meta" style={{ marginTop: 10 }}>
          You already asked for a draft week once. Press the button to fetch it again -
          this does not create a second plan for the same week.
        </p>
      ) : null}

      {busy ? (
        <div className="ot-prog" aria-label="First plan progress" role="status">
          <h2>Working on your first week</h2>
          {STAGE_ORDER.map((k) => {
            const done = doneStages.includes(k);
            const current = stage === k;
            return (
              <div
                key={k}
                className={`ot-prog-line${done ? " ot-prog-line--done" : current ? " ot-prog-line--now" : ""}`}
              >
                <span className="tick" aria-hidden="true">{done || current ? "✓" : "·"}</span>
                <span>{STAGE_LABELS[k]}</span>
              </div>
            );
          })}
          <div className="ot-prog-bar" role="presentation">
            <i style={{ width: `${Math.round((doneStages.length / STAGE_ORDER.length) * 100)}%` }} />
          </div>
        </div>
      ) : null}

      {failure ? (
        <div className="ot-approval" role="alert" aria-label="First plan result">
          <p className="tag">No week drafted yet</p>
          <p className="ot-approval__title">{failure.message}</p>
          <p className="ot-meta">
            {FAILURE_NEXT_STEP[failure.code] ??
              "Nothing was changed. Try again, or add recipes from your saved links."}
          </p>
          <div className="ot-primary">
            <OtButton
              full
              onClick={() => update({ ...draft, finishedAt: new Date().toISOString(), completed: Array.from(new Set([...draft.completed, 6 as OnboardStep])) })}
            >
              Finish without a plan ›
            </OtButton>
          </div>
        </div>
      ) : null}

      {plan ? (
        <div className="ot-approval" role="group" aria-label="Drafted week">
          <p className="tag">Draft week · awaiting your review</p>
          <p className="ot-approval__title">Draft week · {nextMondayLabel()}</p>
          <p className="ot-meta">
            {draft.members.length} member{draft.members.length === 1 ? "" : "s"} · {plan.slots} meal
            slots · {plan.created ? "newly drafted" : "already drafted for this week"}
          </p>
          {importNote ? <p className="ot-meta">{importNote}</p> : null}
          <table className="ot-week">
            <caption className="ot-sr-only">Planned meals by day</caption>
            <tbody>
              {Object.entries(planByDay(plan.meals)).map(([day, slots]) => (
                <tr key={day}>
                  <th scope="row">{dayLabel(day)}</th>
                  <td>
                    {slots.map((m) => (
                      <div key={`${m.date}-${m.mealType}`} className="ot-mealcell">
                        <b>{MEAL_LABELS[m.mealType] ?? m.mealType}</b>
                        <span>{m.recipeName || "recipe name unavailable"}</span>
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ot-primary">
            <OtButton
              full
              onClick={() => update({ ...draft, finishedAt: new Date().toISOString(), completed: Array.from(new Set([...draft.completed, 6 as OnboardStep])) })}
            >
              Finish setup ›
            </OtButton>
          </div>
        </div>
      ) : null}
    </section>
  );
}
