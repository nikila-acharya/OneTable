/**
 * WP-1.6 — axe-core smoke pass over every ON01 screen (§16.7 AC: "zero
 * serious or critical issues on onboarding"). jsdom cannot compute
 * colour-contrast from CSS, so that rule is switched off here and is
 * covered by the Playwright follow-up; everything else runs for real.
 * Test seed households only (§13.1).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import OnboardingApp from "./onboarding";
import { STORAGE_KEY, newDraft, newMember, type OnboardingDraft } from "./store";

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

function seed(partial: Partial<OnboardingDraft>): OnboardingDraft {
  const d: OnboardingDraft = {
    ...newDraft(),
    household: {
      name: "The Rivera family",
      timezone: "America/New_York",
      weekdayBreakfastMinutes: 10,
      weeknightDinnerMinutes: 30,
      cuisines: ["Italian", "Mexican"],
      budgetFeel: "",
    },
    members: [
      {
        ...newMember(),
        id: "m1",
        name: "Ana",
        birthMonth: 3,
        birthYear: 1990,
        sex: "female",
        activity: "active",
        dietaryPattern: "omnivore",
        allergies: ["peanuts"],
        conditions: ["type 1 diabetes"],
        likes: ["pasta"],
        dislikes: ["olives"],
      },
      {
        ...newMember(),
        id: "m2",
        name: "Leo",
        birthMonth: 1,
        birthYear: 2015,
        sex: "male",
        activity: "very-active",
        allergies: ["milk"],
      },
    ],
    meals: [
      { memberId: "m1", breakfast: true, lunch: true, snack: false, secondSnack: false, dinner: true, packedLunch: "work" },
      { memberId: "m2", breakfast: true, lunch: false, snack: true, secondSnack: true, dinner: true, packedLunch: "school" },
    ],
    consent: {
      allergies: { granted: true, at: "2026-10-16T00:00:00.000Z", policyVersion: "2026-10-16" },
      conditions: { granted: true, at: "2026-10-16T00:00:00.000Z", policyVersion: "2026-10-16" },
    },
    ...partial,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  return d;
}

async function audit() {
  const { container, baseElement } = render(<OnboardingApp />);
  // let the mount effect load the draft
  await new Promise((r) => setTimeout(r, 0));
  const results = await axe(baseElement, {
    rules: { "color-contrast": { enabled: false } },
  });
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  void container;
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

describe("axe-core smoke (§16.7): every ON01 screen has no serious/critical issues", () => {
  it("1 Welcome", async () => {
    seed({ step: 1 });
    await audit();
  });

  it("2 Your household", async () => {
    seed({ step: 2 });
    await audit();
  });

  it("3 Family members", async () => {
    seed({ step: 3 });
    await audit();
  });

  it("4 Meals to plan", async () => {
    seed({ step: 4 });
    await audit();
  });

  it("6 Review with the first-plan stub finished", async () => {
    seed({ step: 6, completed: [1, 2, 3, 4], firstPlanRequestedAt: "2026-10-16T00:00:00.000Z" });
    await audit();
  });

  it("Done screen", async () => {
    seed({ step: 6, finishedAt: "2026-10-16T00:00:00.000Z" });
    await audit();
  });
});
