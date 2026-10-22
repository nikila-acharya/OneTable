/**
 * WP-1.6 — ON01 onboarding flow root (PRD §5.0 steps 1–4 and 6, §16.4 IA).
 *
 * Owns the draft state: every mutation goes through `update()`, which writes
 * the draft to storage immediately — "saved after every step so the User can
 * stop and come back" (§5.0). On mount the saved draft is loaded, so closing
 * the browser and returning resumes at the saved step with the data intact
 * (§5.0 AC).
 *
 * Step 5 (sources) is WP-2.7: it appears in the stepper as a marked "soon"
 * dot but is not reachable from this flow (ADR 116). The Meals screen's
 * Continue goes straight to Review, which shows the starter-library
 * fallback so onboarding can finish with zero sources (§5.0 AC).
 */

"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import "./onboarding.css";
import { signIn } from "next-auth/react";
import {
  clearDraft,
  getDraftSnapshot,
  newDraft,
  saveDraft,
  subscribeDraft,
  syncMeals,
  type OnboardStep,
  type OnboardingDraft,
} from "./store";
import { Welcome } from "./steps/welcome";
import { Household } from "./steps/household";
import { Members } from "./steps/members";
import { Meals } from "./steps/meals";
import { Review } from "./steps/review";
import { Done } from "./steps/done";

/** Stepper model — matches design/prototype.html STEPS, including the "soon" source dot. */
export const FLOW_STEPS: { n: OnboardStep | 5; label: string; title: string; soon?: boolean }[] = [
  { n: 1, label: "Welcome", title: "Welcome & privacy promise" },
  { n: 2, label: "Household", title: "Your household" },
  { n: 3, label: "Members", title: "Family members" },
  { n: 4, label: "Meals", title: "Meals to plan" },
  { n: 5, label: "Sources", title: "Where your food comes from", soon: true },
  { n: 6, label: "Review", title: "Review & first plan" },
];

/** Stable server snapshot for useSyncExternalStore hydration (renders Welcome; storage is read on the client). */
const SERVER_SNAPSHOT: OnboardingDraft = newDraft();

export default function OnboardingApp() {
  // SSR-safe: useSyncExternalStore renders the static SERVER_SNAPSHOT during
  // hydration (matching the server HTML), then switches to the storage
  // snapshot — the resumed step and data render exactly as saved (§5.0
  // resume AC) without a cascading-render effect.
  const draft = useSyncExternalStore(subscribeDraft, getDraftSnapshot, () => SERVER_SNAPSHOT);
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const flashSaved = useCallback(() => {
    setSavedFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSavedFlash(false), 1200);
  }, []);

  /** Write-through update: save to storage, subscribers re-render. */
  const update = useCallback(
    (next: OnboardingDraft) => {
      saveDraft(next);
      flashSaved();
    },
    [flashSaved],
  );

  const goTo = useCallback(
    (n: OnboardStep) => {
      const next: OnboardingDraft = {
        ...draft,
        step: n,
        completed: draft.completed.includes(draft.step)
          ? draft.completed
          : [...draft.completed, draft.step],
        // Meals rows are seeded from step 3's attendance when we arrive
        // (§5.0 step 4: "Per member, from step 3's attendance").
        meals: n === 4 ? syncMeals(draft.members, draft.meals) : draft.meals,
      };
      update(next);
    },
    [draft, update],
  );

  const goBack = useCallback(() => {
    // Back from step 6 lands on Meals: step 5 has no screen until WP-2.7 (ADR 116).
    const order: OnboardStep[] = [1, 2, 3, 4, 6];
    const i = order.indexOf(draft.step);
    if (i > 0) update({ ...draft, step: order[i - 1] });
  }, [draft, update]);

  const startOver = useCallback(() => {
    clearDraft();
  }, []);

  /** Reopen the review screen from Done (prototype behaviour). */
  const reopenReview = useCallback(() => {
    update({ ...draft, step: 6, finishedAt: null, firstPlanRequestedAt: null });
  }, [draft, update]);

  /** Sign-up, then sign-in with the same details (covers an existing account). */
  const createAccount = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.status === 422) return "Use a valid email and a password of at least 10 characters.";
      if (!res.ok && res.status !== 409) return "We could not create the account. Please try again.";
      const r = await signIn("credentials", { email, password, redirect: false });
      if (!r || r.error) return "That email and password do not match an account.";
      update({
        ...draft,
        accountCreated: true,
        step: 2,
        completed: draft.completed.includes(1) ? draft.completed : [...draft.completed, 1],
      });
      return null;
    },
    [draft, update],
  );

  /** Saves the whole draft in one call; the server validates before writing. */
  const submitDraft = useCallback(async (): Promise<{ ok: true } | { ok: false; message: string }> => {
    const res = await fetch("/api/onboarding/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401) {
      // Session gone: back to the welcome step to sign in again. Answers are kept.
      update({ ...draft, accountCreated: false, step: 1, finishedAt: null, firstPlanRequestedAt: null });
      return { ok: false, message: "Your sign-in has ended. Sign in again to save your plan." };
    }
    if (res.status === 422) {
      const body = (await res.json().catch(() => ({}))) as { issues?: unknown };
      const issues = Array.isArray(body.issues) ? body.issues.slice(0, 3).join(" · ") : "";
      return { ok: false, message: `Some details need a fix before we can save: ${issues}` };
    }
    return { ok: false, message: "We could not save your plan yet. Your answers are kept, so try again." };
  }, [draft, update]);

  const finished = draft.finishedAt !== null;

  // The Done screen shows what the server stored, not just the browser draft.
  const [saved, setSaved] = useState<{ householdName: string; memberNames: string[] } | null>(null);
  useEffect(() => {
    if (!finished) return;
    let cancelled = false;
    fetch("/api/onboarding/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        const s = j as { householdName?: unknown; memberNames?: unknown } | null;
        if (!cancelled && s && typeof s.householdName === "string" && Array.isArray(s.memberNames)) {
          setSaved({ householdName: s.householdName, memberNames: s.memberNames as string[] });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [finished]);
  const meta = FLOW_STEPS.find((s) => s.n === (finished ? 6 : draft.step))!;

  return (
    <main className="ot-flow">
      {!finished && (
        <header className="ot-top">
          <div className="ot-top__row">
            <span className="ot-top__stepnum" id="stepnum">Step {draft.step} of 6</span>
            <span id="saved" className={`ot-top__saved${savedFlash ? " ot-top__saved--show" : ""}`} aria-live="polite">
              ✓ Saved
            </span>
          </div>
          <p className="ot-top__title" id="steptitle">{meta.title}</p>
          <div className="ot-top__bar" role="presentation">
            <i style={{ width: `${(Math.min(draft.step, 6) / 6) * 100}%` }} />
          </div>
          <nav className="ot-dots" aria-label="Onboarding progress">
            {FLOW_STEPS.map((s) => {
              const active = s.n === draft.step;
              const done = !active && !s.soon && (s.n as number) < draft.step;
              const clickable = done && s.n !== 5;
              return (
                <div
                  key={s.n}
                  className={`ot-dot${active ? " ot-dot--active" : ""}${done ? " ot-dot--done" : ""}${s.soon ? " ot-dot--soon" : ""}`}
                  title={s.soon ? "Arrives in M2 (WP-2.7)" : undefined}
                  {...(clickable ? { role: "button", tabIndex: 0 } : {})}
                  aria-current={active ? "step" : undefined}
                  onClick={clickable ? () => goTo(s.n as OnboardStep) : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            goTo(s.n as OnboardStep);
                          }
                        }
                      : undefined
                  }
                >
                  <i aria-hidden="true" />
                  <span className="lbl">{s.label}</span>
                </div>
              );
            })}
          </nav>
        </header>
      )}

      {finished ? (
        <Done draft={draft} onReopen={reopenReview} onStartOver={startOver} saved={saved} />
      ) : (
        <div className="ot-screen" key={draft.step}>
          {draft.step === 1 && (
            <Welcome
              draft={draft}
              onStart={() => goTo(2)}
              onStartOver={startOver}
              needsAccount={!draft.accountCreated}
              onCreateAccount={createAccount}
            />
          )}
          {draft.step === 2 && <Household draft={draft} update={update} goTo={goTo} goBack={goBack} />}
          {draft.step === 3 && <Members draft={draft} update={update} goTo={goTo} goBack={goBack} />}
          {draft.step === 4 && <Meals draft={draft} update={update} goTo={goTo} goBack={goBack} />}
          {draft.step === 6 && (
            <Review draft={draft} update={update} goTo={goTo} goBack={goBack} submitDraft={submitDraft} />
          )}
        </div>
      )}
    </main>
  );
}
