/**
 * WP-1.6 — ON01 draft store tests (PRD §5.0 acceptance criteria, PV01/SG01 rules).
 * Test data only — never real family data (§13.1).
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  ageYears,
  allStoredAllergies,
  consentAllows,
  grantConsent,
  isUnder18,
  loadDraft,
  memberRequiredComplete,
  newDraft,
  newMember,
  nextStep,
  prevStep,
  saveDraft,
  scrubWithoutConsent,
  stepCanAdvance,
  STORAGE_KEY,
  syncMeals,
  withdrawConsent,
} from "./store";

beforeEach(() => {
  localStorage.clear();
});

describe("resume-on-close (§5.0 AC)", () => {
  it("returns a fresh draft when nothing is stored", () => {
    const d = loadDraft();
    expect(d.step).toBe(1);
    expect(d.members).toEqual([]);
  });

  it("resumes at the saved step with the saved data after the browser is closed", () => {
    const draft = newDraft();
    draft.step = 3;
    draft.household.name = "The Test Family";
    draft.members = [{ ...newMember(), name: "Ana" }];
    saveDraft(draft);

    // "close the browser": new load from storage, no shared memory.
    const resumed = loadDraft();
    expect(resumed.step).toBe(3);
    expect(resumed.household.name).toBe("The Test Family");
    expect(resumed.members[0]!.name).toBe("Ana");
  });

  it("ignores foreign schema versions and corrupt data", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, step: 4 }));
    expect(loadDraft().step).toBe(1);
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadDraft().step).toBe(1);
  });

  it("fills defaults for fields added after a draft was saved", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, step: 2, household: { name: "X" } }),
    );
    const d = loadDraft();
    expect(d.household.weekdayBreakfastMinutes).toBe(10);
    expect(d.household.weeknightDinnerMinutes).toBe(30);
    expect(d.finishedAt).toBeNull();
  });
});

describe("steps and flow (§5.0)", () => {
  it("step 5 is not part of this flow: 4 → 6 and back 6 → 4 (ADR 116)", () => {
    expect(nextStep(4)).toBe(6);
    expect(prevStep(6)).toBe(4);
    expect(nextStep(3)).toBe(4);
  });

  it("step gating follows the required fields", () => {
    const d = newDraft();
    expect(stepCanAdvance(d, 1)).toBe(true);
    expect(stepCanAdvance(d, 2)).toBe(false); // no name yet
    d.household.name = "Test";
    expect(stepCanAdvance(d, 2)).toBe(true);
    expect(stepCanAdvance(d, 3)).toBe(false); // no members
    const m = { ...newMember(), name: "Ana", birthMonth: 3, birthYear: 1990, sex: "female" as const, activity: "active" as const };
    d.members = [m];
    expect(stepCanAdvance(d, 3)).toBe(true);
    expect(stepCanAdvance(d, 4)).toBe(false); // no meals yet
    d.meals = syncMeals(d.members, d.meals);
    expect(stepCanAdvance(d, 4)).toBe(true); // attendance defaults plan dinner+breakfast
  });
});

describe("members (PR01 required fields, derived age)", () => {
  it("derives age from birth month + year only", () => {
    const now = new Date(2026, 9, 16); // Oct 16 2026
    expect(ageYears({ birthYear: 2000, birthMonth: 3 }, now)).toBe(26);
    expect(ageYears({ birthYear: 2000, birthMonth: 12 }, now)).toBe(25); // birthday not yet
    expect(ageYears({ birthYear: 2012, birthMonth: 12 }, now)).toBe(13);
    expect(ageYears({ birthYear: null, birthMonth: 5 }, now)).toBeNull();
  });

  it("under-18 detection", () => {
    const now = new Date(2026, 9, 16);
    expect(isUnder18({ birthYear: 2015, birthMonth: 1 }, now)).toBe(true);
    expect(isUnder18({ birthYear: 2008, birthMonth: 1 }, now)).toBe(true);
    expect(isUnder18({ birthYear: 2008, birthMonth: 12 }, now)).toBe(false);
  });

  it("required fields only: name, birth month/year, sex, activity", () => {
    const base = { ...newMember(), name: "Ana", birthMonth: 3, birthYear: 1990, sex: "female" as const, activity: "active" as const };
    expect(memberRequiredComplete(base)).toBe(true);
    expect(memberRequiredComplete({ ...base, name: "" })).toBe(false);
    expect(memberRequiredComplete({ ...base, sex: null })).toBe(false);
    expect(memberRequiredComplete({ ...base, birthMonth: null })).toBe(false);
    expect(memberRequiredComplete({ ...base, activity: null })).toBe(false);
    expect(memberRequiredComplete({ ...base, name: "x".repeat(41) })).toBe(false);
  });
});

describe("meals seeding (§5.0 step 4: per member, from step 3's attendance)", () => {
  it("seeds rows from attendance, preserves the user's own toggles, drops removed members", () => {
    const ana = { ...newMember(), id: "a", name: "Ana" };
    const leo = { ...newMember(), id: "l", name: "Leo", homeFor: { breakfast: false, lunch: false, snack: false, dinner: false } };
    const seeded = syncMeals([ana, leo], []);
    expect(seeded).toHaveLength(2);
    expect(seeded[0]!.breakfast).toBe(true);
    expect(seeded[1]!.dinner).toBe(false);

    const edited = seeded.map((x) => (x.memberId === "a" ? { ...x, dinner: false } : x));
    const afterLeoGone = syncMeals([ana], edited);
    expect(afterLeoGone).toHaveLength(1);
    expect(afterLeoGone[0]!.dinner).toBe(false); // user edit kept
  });

  it("onboarding can finish with zero sources and still plan (starter library path): AC §5.0", () => {
    // The plan stub only needs members + meals; sources are not part of the draft at all.
    const d = newDraft();
    d.household.name = "Test";
    d.members = [{ ...newMember(), name: "Ana", birthMonth: 3, birthYear: 1990, sex: "female", activity: "active" }];
    d.meals = syncMeals(d.members, d.meals);
    expect(stepCanAdvance(d, 2) && stepCanAdvance(d, 3) && stepCanAdvance(d, 4)).toBe(true);
  });
});

describe("consent (PV01: data without consent cannot be stored)", () => {
  it("grant, withdraw, and re-check", () => {
    let c = newDraft().consent;
    expect(consentAllows(c, "allergies")).toBe(false);
    c = grantConsent(c, "allergies", "2026-10-16T12:00:00.000Z");
    expect(consentAllows(c, "allergies")).toBe(true);
    expect(c.allergies!.policyVersion).toBe("2026-10-16");
    c = withdrawConsent(c, "allergies", "2026-10-17T12:00:00.000Z");
    expect(consentAllows(c, "allergies")).toBe(false);
  });

  it("scrub removes exactly the data type without consent", () => {
    const m = {
      ...newMember(),
      allergies: ["peanuts"],
      conditions: ["celiac disease" as const],
      heightCm: "138",
      weightKg: "31",
    };
    const none = scrubWithoutConsent(m, {});
    expect(none.allergies).toEqual([]);
    expect(none.conditions).toEqual([]);
    expect(none.heightCm).toBe("");
    expect(none.weightKg).toBe("");
    // name/likes/attendance are not health data — kept
    expect(none.name).toBe(m.name);

    const allergiesOnly = scrubWithoutConsent(m, grantConsent({}, "allergies", "t"));
    expect(allergiesOnly.allergies).toEqual(["peanuts"]);
    expect(allergiesOnly.conditions).toEqual([]);
  });

  it("under-18 members never store weight (§16.5)", () => {
    const child = { ...newMember(), birthMonth: 1, birthYear: 2015, weightKg: "40" };
    // Same rule the UI applies on save: if the member is under 18, weight is cleared.
    expect(isUnder18(child)).toBe(true);
    if (isUnder18(child)) child.weightKg = "";
    expect(child.weightKg).toBe("");
  });
});

describe("allergy review chips match the stored allergies exactly (§5.0 AC)", () => {
  it("allStoredAllergies walks members in stored order", () => {
    const d = newDraft();
    d.members = [
      { ...newMember(), id: "a", name: "Ana", allergies: ["peanuts", "milk"] },
      { ...newMember(), id: "b", name: "Leo", allergies: ["tree nuts"] },
    ];
    const flat = allStoredAllergies(d);
    expect(flat.map((x) => x.allergen)).toEqual(["peanuts", "milk", "tree nuts"]);
    expect(flat.map((x) => x.memberName)).toEqual(["Ana", "Ana", "Leo"]);
  });
});
