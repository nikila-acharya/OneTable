/**
 * WP-1.6 — ON01 flow tests against the prototype screens (PRD §5.0 / §16.5
 * acceptance criteria). Seed test data only (§13.1). prefers-reduced-motion
 * is stubbed ON so the first-plan stub resolves synchronously (also required
 * by §16.6).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import OnboardingApp from "./onboarding";
import { STORAGE_KEY, newDraft, newMember, type OnboardingDraft } from "./store";

function storedDraft(): OnboardingDraft {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as OnboardingDraft;
}

/** Reduced motion on: matchMedia exists in jsdom, so force matches=true. */
beforeEach(() => {
  cleanup();
  localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })),
  });
});

async function boot() {
  render(<OnboardingApp />);
  await screen.findByRole("button", { name: "Get started ›" });
}

async function toHousehold() {
  await boot();
  fireEvent.click(screen.getByRole("button", { name: "Get started ›" }));
  await screen.findByRole("heading", { name: "Your household" });
}

async function fillHousehold(name = "The Test Family") {
  fireEvent.change(screen.getByLabelText(/Household name/), { target: { value: name } });
}

async function openMemberSheet() {
  fireEvent.click(screen.getByRole("button", { name: "+ Add a member" }));
  await screen.findByRole("dialog", { name: "Add a member" });
}

async function setDob(month: number, year: number) {
  fireEvent.click(screen.getByLabelText(/Birth month and year/));
  const sheet = await screen.findByRole("dialog", { name: "Birth month and year" });
  fireEvent.change(within(sheet).getByLabelText("Birth month"), { target: { value: String(month) } });
  fireEvent.change(within(sheet).getByLabelText("Birth year"), { target: { value: String(year) } });
  fireEvent.click(within(sheet).getByRole("button", { name: "OK" }));
  await screen.findByRole("dialog", { name: /Add a member|Edit / });
}

async function setSex(label: "Female" | "Male" | "Prefer not to say") {
  fireEvent.click(screen.getByLabelText(/^Sex/));
  const sheet = await screen.findByRole("dialog", { name: "Sex" });
  fireEvent.click(within(sheet).getByRole("radio", { name: label }));
  fireEvent.click(within(sheet).getByRole("button", { name: "OK" }));
  await screen.findByRole("dialog", { name: /Add a member|Edit / });
}

describe("step 1 — welcome & privacy promise", () => {
  it("shows the three plain privacy lines and the inline-consent promise", async () => {
    await boot();
    expect(screen.getByText("Only you log in.")).toBeTruthy();
    expect(screen.getByText("Health details stay private.")).toBeTruthy();
    expect(screen.getByText("Nothing is shared with advertisers.")).toBeTruthy();
    expect(
      screen.getByText(/ask permission for allergies and health details only at the moment/),
    ).toBeTruthy();
    expect(screen.queryByText(/lose \d/i)).toBeNull(); // no weight-loss copy anywhere (§16.2)
  });
});

describe("step 2 — household", () => {
  it("requires a household name before continuing", async () => {
    await toHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Continue ›" }));
    expect(await screen.findByText("Please name your household.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Family members" })).toBeNull();
  });

  it("cooking-time stepper and cuisine chips save; resume-on-close restores step 2 with data", async () => {
    await toHousehold();
    await fillHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Italian" }));
    expect(screen.getByRole("button", { name: "Italian" }).getAttribute("aria-pressed")).toBe("true");

    // breakfast stepper: 10 -> 15
    fireEvent.click(screen.getByLabelText(/^Weekday breakfast/));
    const sheet = await screen.findByRole("dialog", { name: "Weekday breakfast" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Increase" }));
    expect(within(sheet).getByText("15 minutes")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "OK" }));
    expect(screen.getByLabelText(/^Weekday breakfast/).textContent).toContain("15 minutes");

    // close & reopen the browser: same step, same data (§5.0 AC)
    cleanup();
    await boot();
    // resumed directly at step 2, welcome not re-shown
    await screen.findByRole("heading", { name: "Your household" });
    expect((screen.getByLabelText(/Household name/) as HTMLInputElement).value).toBe("The Test Family");
    expect(screen.getByRole("button", { name: "Italian" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText(/^Weekday breakfast/).textContent).toContain("15 minutes");
  });
});

describe("step 3 — members: required fields, consent (PV01), child rules, SG01", () => {
  it("member sheet refuses incomplete members", async () => {
    await toHousehold();
    await fillHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Continue ›" }));
    await screen.findByRole("heading", { name: "Family members" });
    await openMemberSheet();

    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByRole("alert").textContent).toBe("Please enter a name.");

    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    expect(screen.getByRole("alert").textContent).toBe("Please set the birth month and year.");

    await setDob(3, 1990);
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    expect(screen.getByRole("alert").textContent).toBe("Please choose a sex option — it selects nutrient ranges.");

    await setSex("Female");
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    expect(screen.getByRole("alert").textContent).toBe("Please choose an activity level.");

    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    await screen.findByText("home for 4 of 4 meals");
    fireEvent.click(screen.getByRole("button", { name: "Continue to meals ›" }));
    await screen.findByRole("heading", { name: "Meals to plan" });
  });

  it("allergies stay locked until inline consent; 'Not now' stores nothing", async () => {
    await toHousehold();
    await fillHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Continue ›" }));
    await openMemberSheet();
    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "Ana" } });
    await setDob(3, 1990);
    await setSex("Female");
    fireEvent.click(screen.getByRole("button", { name: "Low active" }));

    fireEvent.click(screen.getByRole("button", { name: /More about Ana/ }));
    const lock = screen.getByRole("button", { name: /🔒.*Allergies/ });
    fireEvent.click(lock);
    expect(await screen.findByText("Allow OneTable to store Allergies?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Allow OneTable to store Allergies?")).toBeNull();
    expect(screen.queryByText("milk")).toBeNull(); // no allergen editor without consent

    fireEvent.click(lock);
    fireEvent.click(screen.getByRole("button", { name: "Yes, allow" }));
    // granted: chips now editable
    fireEvent.click(await screen.findByRole("button", { name: "peanuts" }));
    fireEvent.click(screen.getByRole("button", { name: /Add an allergy/ }));
    const add = await screen.findByRole("dialog", { name: "Other allergy" });
    fireEvent.change(within(add).getByLabelText("Another allergy"), { target: { value: "cilantro" } });
    fireEvent.click(within(add).getByRole("button", { name: "OK" }));
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));

    await screen.findByText("🔒 peanuts · Never planned");
    expect(screen.getByText("🔒 cilantro · Never planned")).toBeTruthy();

    // withdraw: stored allergy data is deleted right away (PV01)
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: /More about Ana/ }));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("🔒 peanuts · Never planned")).toBeNull();
    expect(storedDraft().members[0]!.allergies).toEqual([]);
  });

  it("listed condition shows the clinician-confirm note immediately (SG01)", async () => {
    await toHousehold();
    await fillHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Continue ›" }));
    await openMemberSheet();
    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "Ben" } });
    await setDob(7, 1985);
    await setSex("Male");
    fireEvent.click(screen.getByRole("button", { name: "Sedentary" }));
    fireEvent.click(screen.getByRole("button", { name: /More about Ben/ }));

    fireEvent.click(screen.getByRole("button", { name: /🔒.*Health conditions/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, allow" }));
    fireEvent.click(await screen.findByRole("button", { name: "Type 1 diabetes" }));
    expect(screen.getByText(/General guidance only\. Confirm with your clinician\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    // note persists on the saved card (§5.0 step 3)
    expect(screen.getByText(/General guidance only\. Confirm with your clinician\./)).toBeTruthy();
  });

  it("under-18 member: no weight field, growth line instead; no BMI/calorie elements (§16.5, §16.7 AC)", async () => {
    await toHousehold();
    await fillHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Continue ›" }));
    await openMemberSheet();
    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "Leo" } });
    await setDob(1, 2015);
    await setSex("Male");
    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    fireEvent.click(screen.getByRole("button", { name: /More about Leo/ }));

    // measurements group: consent, then the child variant of the editor
    fireEvent.click(screen.getByRole("button", { name: /🔒.*Height and weight/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, allow" }));

    expect(
      await screen.findByText("We plan for growth, never for weight loss. No weight field is shown for an under-18 member."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Weight (kg)")).toBeNull(); // no weight element for a child
    expect(within(document.body).queryByText(/BMI/i)).toBeNull();
    expect(within(document.body).queryByText(/kcal/i)).toBeNull();
    expect(within(document.body).queryByText(/calorie/i)).toBeNull();
  });
});

describe("steps 4 + 6 — meals, review and the first-plan stub", () => {
  it("full happy path: meals from attendance, review chips match storage, stub plan, done, resume", async () => {
    // household
    await toHousehold();
    await fillHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Continue ›" }));

    // member with two stored allergies
    await openMemberSheet();
    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "Ana" } });
    await setDob(3, 1990);
    await setSex("Female");
    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    fireEvent.click(screen.getByRole("button", { name: /More about Ana/ }));
    fireEvent.click(screen.getByRole("button", { name: /🔒.*Allergies/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, allow" }));
    fireEvent.click(await screen.findByRole("button", { name: "peanuts" }));
    fireEvent.click(await screen.findByRole("button", { name: "milk" }));
    // attendance defaults are all home; turn lunch off for Ana
    fireEvent.click(screen.getByRole("switch", { name: "Usually home for Lunch" }));
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));

    // step 4 seeded from attendance: lunch off => no packed sub-option for Ana
    fireEvent.click(screen.getByRole("button", { name: "Continue to meals ›" }));
    await screen.findByRole("heading", { name: "Meals to plan" });
    const lunchSwitch = screen.getByRole("switch", { name: "Plan lunch for Ana" });
    expect((lunchSwitch as HTMLInputElement).checked).toBe(false);
    // dinner stays planned; toggle dinner off to make packed-lunch path testable on lunch:
    fireEvent.click(screen.getByRole("switch", { name: "Plan dinner for Ana" }));
    fireEvent.click(lunchSwitch); // back on
    const packed = screen.getByRole("switch", { name: "Pack Ana's lunch to go" });
    fireEvent.click(packed);
    expect(storedDraft().meals[0]!.packedLunch).toBe("school");

    // review (step 5 unreachable: Continue lands on Review, §5.0/ADR 116)
    fireEvent.click(screen.getByRole("button", { name: "Continue ›" }));
    await screen.findByRole("heading", { name: /Review/ });
    expect(screen.queryByRole("heading", { name: /Where your family/ })).toBeNull();
    expect(screen.getByText("Sources")).toBeTruthy(); // stepper shows the "soon" source dot

    // chips read "Never planned" and match stored allergies exactly (§5.0 AC)
    const stored = storedDraft().members[0]!.allergies;
    expect(stored).toEqual(["peanuts", "milk"]);
    const neverChips = Array.from(document.querySelectorAll(".ot-chip--never"));
    expect(neverChips).toHaveLength(stored.length);
    neverChips.forEach((chip) => {
      const name = chip.querySelector(".ot-chip--never-name")!.textContent!;
      expect(stored).toContain(name);
      expect(chip.textContent).toBe(`🔒 ${name} · Never planned`);
    });

    // zero sources -> starter library fallback is stated on review (§5.0 AC)
    expect(screen.getByText(/plan from our recipe starter library/)).toBeTruthy();

    // meals summary line: breakfast + lunch packed (lunch on, dinner off, snack on)
    expect(screen.getByText("B · L packed · S")).toBeTruthy();

    // first-plan stub
    fireEvent.click(screen.getByRole("button", { name: "Plan our first week" }));
    const progress = await screen.findByRole("group", { name: "Approval card preview" });
    expect(within(progress).getByText(/Approval inbox · draft/)).toBeTruthy();
    expect(within(progress).getByText("✓ Passed safety checks")).toBeTruthy();
    expect(within(progress).getByText(/planner arrives with milestone M3/)).toBeTruthy();
    expect(within(progress).getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(true);
    expect(storedDraft().firstPlanRequestedAt).toBeTruthy();
    // the four progress lines are shown and complete
    const lines = document.querySelectorAll(".ot-prog-line--done");
    expect(lines).toHaveLength(4);
    expect(screen.getByText(/Checking allergies against every recipe/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Finish setup ›" }));
    await screen.findByText(/You're all set, The Test Family!/);

    // close & reopen the browser after finishing: still the saved state
    cleanup();
    render(<OnboardingApp />);
    await screen.findByText(/You're all set, The Test Family!/);
  });

  it("resuming mid-review replays the plan stub in its finished state", async () => {
    const d = newDraft();
    d.step = 6;
    d.completed = [1, 2, 3, 4];
    d.household.name = "Resume Household";
    d.members = [
      { ...newMember(), id: "m1", name: "Ana", birthMonth: 3, birthYear: 1990, sex: "female", activity: "active", allergies: ["peanuts"] },
    ];
    d.meals = [{ memberId: "m1", breakfast: true, lunch: false, snack: false, secondSnack: false, dinner: true, packedLunch: "" }];
    d.consent = { allergies: { granted: true, at: "2026-10-16T00:00:00.000Z", policyVersion: "2026-10-16" } };
    d.firstPlanRequestedAt = "2026-10-16T00:00:00.000Z";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));

    render(<OnboardingApp />);
    await screen.findByRole("heading", { name: /Review/ });
    await screen.findByRole("group", { name: "Approval card preview" }); // no animation needed on resume
    expect(screen.getByText("🔒 peanuts · Never planned")).toBeTruthy();
    expect(document.getElementById("stepnum")!.textContent).toBe("Step 6 of 6");
  });
});
