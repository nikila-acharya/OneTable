/**
 * t_02ae1826 — Playwright seed fixtures for the ON01 screens (PRD §16.7).
 *
 * Seeds localStorage "onetable:onboarding:v1" (shape in
 * src/app/onboarding/store.ts) so each snapshot captures the step in the
 * state a real family would be in, using test seed data only (§13.1).
 * Determinism: fixed ids/timestamps and a frozen clock (page.clock) so the
 * review screen's "Draft week · next Monday" label and derived ages are
 * byte-stable across runs.
 */

import type { Page } from "@playwright/test";
import {
  STORAGE_KEY,
  newDraft,
  type MemberDraft,
  type MemberMeals,
  type OnboardStep,
  type OnboardingDraft,
} from "../src/app/onboarding/store";

/** Frozen "now" — Friday 2026-10-16 15:00 UTC → nextMondayLabel() = Mon, Oct 19. */
export const FROZEN_NOW = new Date("2026-10-16T15:00:00.000Z");

const CONSENTED = {
  allergies: { granted: true, at: "2026-10-16T14:50:00.000Z", policyVersion: "2026-10-16" },
  conditions: { granted: true, at: "2026-10-16T14:50:10.000Z", policyVersion: "2026-10-16" },
  measurements: { granted: true, at: "2026-10-16T14:50:20.000Z", policyVersion: "2026-10-16" },
};

const MEMBERS: MemberDraft[] = [
  {
    id: "m_maya",
    name: "Maya",
    birthYear: 1987,
    birthMonth: 4,
    sex: "female",
    activity: "active",
    dietaryPattern: "omnivore",
    allergies: ["peanuts", "milk"],
    conditions: [],
    likes: ["pasta", "tacos"],
    dislikes: ["liver"],
    heightCm: "165",
    weightKg: "62",
    homeFor: { breakfast: true, lunch: true, snack: false, dinner: true },
    packedLunch: "work",
  },
  {
    id: "m_leo",
    name: "Leo",
    birthYear: 2018,
    birthMonth: 6,
    sex: "male",
    activity: "low-active",
    dietaryPattern: "omnivore",
    allergies: ["peanuts"],
    conditions: [],
    likes: ["pancakes"],
    dislikes: ["olives"],
    heightCm: "",
    weightKg: "", // under 18 → no weight stored (§5.2 PR04)
    homeFor: { breakfast: true, lunch: true, snack: true, dinner: true },
    packedLunch: "school",
  },
  {
    id: "m_diego",
    name: "Diego",
    birthYear: 1979,
    birthMonth: 11,
    sex: "male",
    activity: "sedentary",
    dietaryPattern: "omnivore",
    allergies: [],
    conditions: ["type 2 diabetes"], // SG01 → general-guidance mode surfaces on members + review
    likes: [],
    dislikes: [],
    heightCm: "",
    weightKg: "",
    homeFor: { breakfast: true, lunch: false, snack: false, dinner: true },
    packedLunch: "",
  },
];

const MEALS: MemberMeals[] = [
  { memberId: "m_maya", breakfast: true, lunch: true, snack: false, secondSnack: false, dinner: true, packedLunch: "work" },
  { memberId: "m_leo", breakfast: true, lunch: true, snack: true, secondSnack: false, dinner: true, packedLunch: "school" },
  { memberId: "m_diego", breakfast: true, lunch: false, snack: false, secondSnack: false, dinner: true, packedLunch: "" },
];

function filled(step: OnboardStep, completed: OnboardStep[]): OnboardingDraft {
  return {
    ...newDraft(),
    step,
    completed,
    household: {
      name: "The Rivera family",
      timezone: "America/New_York",
      weekdayBreakfastMinutes: 10,
      weeknightDinnerMinutes: 30,
      cuisines: ["Italian", "Mexican"],
      budgetFeel: "balanced",
    },
    members: step === 1 ? [] : MEMBERS.map((m) => ({ ...m, homeFor: { ...m.homeFor } })),
    meals: step === 4 || step === 6 ? MEALS.map((x) => ({ ...x })) : [],
    consent: CONSENTED,
  };
}

/** Canonical snapshot state for each onboarding step + Done. */
export const SCREEN_SEEDS: Record<string, OnboardingDraft> = {
  // Step 1: the Welcome a first-time User sees (empty draft, "Get started ›").
  "step-1": { ...newDraft(), household: { ...newDraft().household, timezone: "America/New_York" } },
  "step-2": filled(2, [1]),
  "step-3": filled(3, [1, 2]),
  "step-4": filled(4, [1, 2, 3]),
  // Step 6 with firstPlanRequestedAt set → Review renders the approval-card
  // phase directly (no animation timers), the state the prototype scrReview ends in.
  "step-6": { ...filled(6, [1, 2, 3, 4]), firstPlanRequestedAt: "2026-10-16T14:59:00.000Z" },
  done: {
    ...filled(6, [1, 2, 3, 4, 6]),
    firstPlanRequestedAt: "2026-10-16T14:59:00.000Z",
    finishedAt: "2026-10-16T15:00:00.000Z",
  },
};

/**
 * Boot the /onboarding page with the given draft in localStorage and a frozen
 * clock. The draft is written by an init script before any app code runs, so
 * useSyncExternalStore hydrates straight into the saved step (§5.0 resume
 * path) — no clicks, no "✓ Saved" flash, no animation timers involved.
 */
export async function bootWithDraft(page: Page, draft: OnboardingDraft, opts: { frozenClock?: boolean } = {}): Promise<void> {
  if (opts.frozenClock !== false) {
    await page.clock.install({ time: FROZEN_NOW });
  }
  await page.addInitScript(
    ([key, payload]) => {
      window.localStorage.setItem(key, payload);
    },
    [STORAGE_KEY, JSON.stringify(draft)] as [string, string],
  );
  await page.goto("/onboarding", { waitUntil: "load" });
}
