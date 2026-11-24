/**
 * ADR-124: slots respect declared meal types, and a day never gets the same dish
 * twice. Pure unit tests - createPlan() is deterministic given (pool, seed), so no
 * database is needed and these must run in CI regardless of DATABASE_URL.
 */
import { describe, expect, it } from "vitest";
import { createPlan, type PlanOptions, type Recipe } from "../../src/lib/planner";

const R = (
  id: string,
  name: string,
  kcal: number,
  mealTypes: Recipe["mealTypes"],
  isOwnSource = false,
): Recipe => ({
  id,
  name,
  servings: 4,
  prepMinutes: 10,
  cookMinutes: 20,
  ingredients: ["x"],
  caloriesPerServing: kcal,
  allergens: [],
  isOwnSource,
  mealTypes,
});

const options = (pool: Recipe[], over: Partial<PlanOptions> = {}): PlanOptions => ({
  pool,
  seed: 42,
  memberIds: ["m1"],
  startDate: "2026-11-23",
  planDays: 7,
  targetEnergyKcal: 2000,
  allergens: [],
  dietPreferences: [],
  requireOwnSourceDinners: false,
  ...over,
});

const bySlot = (meals: ReturnType<typeof createPlan>["meals"], slot: string) =>
  meals.filter((m) => m.mealType === slot);

describe("ADR-124 meal-slot bands", () => {
  const taggedPool = [
    // 311 kcal fits the dinner (>=300) and lunch (250-450) energy bands, which is
    // exactly how a breakfast upma used to end up on the dinner table.
    R("b1", "Suji Upma", 311, ["breakfast"]),
    R("b2", "Masala Oats", 232, ["breakfast"]),
    R("l1", "Chana Masala", 282, ["lunch"]),
    R("l2", "Idli", 269, ["lunch", "breakfast"]),
    R("d1", "Rajma Chawal", 420, ["dinner"]),
    R("d2", "Veg Pulao", 407, ["dinner", "lunch"]),
  ];

  it("keeps a breakfast-tagged dish out of the dinner slot even when calories fit", () => {
    const plan = createPlan(options(taggedPool));
    expect(plan.meals).toHaveLength(21);

    const dinnerIds = new Set(taggedPool.filter((r) => (r.mealTypes ?? []).includes("dinner")).map((r) => r.id));
    const dinners = bySlot(plan.meals, "dinner").map((m) => m.recipe.id);
    // derived from the pool rather than a hardcoded list, so editing taggedPool
    // cannot leave this assertion silently checking the wrong set
    for (const id of dinners) expect(dinnerIds.has(id)).toBe(true);
    expect(dinners).not.toContain("b1");
    expect(dinners).not.toContain("b2");
    expect(dinners).not.toContain("l1");

    const breakfasts = bySlot(plan.meals, "breakfast").map((m) => m.recipe.id);
    for (const id of breakfasts) expect(["b1", "b2", "l2"]).toContain(id);

    const lunches = bySlot(plan.meals, "lunch").map((m) => m.recipe.id);
    for (const id of lunches) expect(["l1", "l2", "d2"]).toContain(id);
  });

  it("falls back to energy-only for an untagged pool instead of dropping meals", () => {
    // Pre-ADR-124 callers (and every planner fixture) pass no mealTypes. The band
    // rules must keep producing a full week rather than throwing or leaving holes.
    const untagged = [R("u1", "A", 311, undefined), R("u2", "B", 330, []), R("u3", "C", 360, undefined)];
    const plan = createPlan(options(untagged));
    expect(plan.meals).toHaveLength(21);
    expect(bySlot(plan.meals, "dinner").length).toBe(7);
    expect(bySlot(plan.meals, "breakfast").length).toBe(7);
  });

  it("never serves the same recipe twice in one calendar day", () => {
    const plan = createPlan(options(taggedPool, { seed: 7 }));
    const days = new Map<string, string[]>();
    for (const m of plan.meals) days.set(m.date, [...(days.get(m.date) ?? []), m.recipe.id]);
    expect(days.size).toBe(7);
    for (const [date, ids] of days) {
      expect(new Set(ids).size, `duplicate dish on ${date}: ${ids.join(",")}`).toBe(ids.length);
      expect(ids).toHaveLength(3);
    }
  });

  it("repeats rather than leaving a hole when a band has nothing fresh left", () => {
    // X is the only candidate for BOTH breakfast and dinner, so one of the two
    // slots must fall back to a repeat. A familiar dish is the honest failure
    // mode; a missing meal would be a TypeError-shaped hole in the week.
    const x = R("x", "Oats-Both", 311, ["breakfast", "dinner"]);
    const pool = [x, R("l1", "Lunch Only", 300, ["lunch"]), R("d2", "Dinner Two", 350, ["dinner"])];
    const plan = createPlan(options(pool, { seed: 3 }));
    expect(plan.meals).toHaveLength(21);
    const day0 = plan.meals.filter((m) => m.date === "2026-11-23");
    expect(day0.map((m) => m.recipe.id)).toContain("x");
    const xCount = day0.filter((m) => m.recipe.id === "x").length;
    expect(xCount).toBeGreaterThanOrEqual(1);
    expect(xCount).toBeLessThanOrEqual(2); // never three of one dish in a day
  });

  it("is deterministic: the same pool and seed produce the same week", () => {
    const a = createPlan(options(taggedPool, { seed: 11 }));
    const b = createPlan(options(taggedPool, { seed: 11 }));
    expect(a.meals.map((m) => `${m.date}/${m.mealType}/${m.recipe.id}`)).toEqual(
      b.meals.map((m) => `${m.date}/${m.mealType}/${m.recipe.id}`),
    );
  });

  it("still honours the own-source dinner bias once tags are applied", () => {
    const pool = [
      R("b1", "Breakfast", 250, ["breakfast"]),
      R("b2", "Breakfast Two", 240, ["breakfast"]),
      R("l1", "Lunch", 300, ["lunch"]),
      R("l2", "Lunch Two", 320, ["lunch"]),
      R("d-own", "Own Dinner", 430, ["dinner"], true),
      R("d-shared", "Shared Dinner", 400, ["dinner"], false),
    ];
    const plan = createPlan(options(pool, { requireOwnSourceDinners: true, seed: 5 }));
    const dinners = bySlot(plan.meals, "dinner").map((m) => m.recipe.id);
    for (const id of dinners) expect(["d-own", "d-shared"]).toContain(id);
    expect(dinners.filter((id) => id === "d-own").length).toBeGreaterThan(0);
  });

  it("throws a named band error when tags leave a slot with no candidate at all", () => {
    const pool = [R("b1", "Only Breakfast", 250, ["breakfast"]), R("l1", "Only Lunch", 280, ["lunch"])];
    // Nothing here reaches 300 kcal, so the dinner energy band is empty and the
    // pre-existing named-band error must still fire (unchanged by ADR-124).
    expect(() => createPlan(options(pool))).toThrow(/no candidate recipe left for dinner/);
  });
});

