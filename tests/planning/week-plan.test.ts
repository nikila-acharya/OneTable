/**
 * PRD WP-5.x seam fix: planning reads real `recipe` rows and writes a real
 * `plan`. Live DB (skipped without DATABASE_URL), as elsewhere in this repo.
 *
 * Health blobs are written with the real codec rather than through writeHealth,
 * because writeHealth is consent-gated (PV01) and consent is not what these
 * tests are about; the shape stored is identical.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { openDb, type Db } from "../../db/index";
import { encryptHealth } from "../../db/crypto";
import {
  allergenConfirmation,
  household,
  member,
  memberHealth,
  plan,
  planSlot,
  recipe,
  recipeIngredient,
  recipeNutrients,
  slotMember,
} from "../../db/schema";
import { loadRecipePool } from "../../src/lib/planning/pool";
import { createPlan } from "../../src/lib/planner";
import { generateWeekPlan, weekStartFor } from "../../src/lib/planning/firstPlan";

const hasDb = Boolean(process.env.DATABASE_URL);
const NOW = new Date("2026-11-20T09:00:00.000Z");
let theirsRecipe = "";

let db: Db;
beforeAll(() => {
  db = openDb().db;
  // Health blobs need ENCRYPTION_KEY. CI's unit job sets only DATABASE_URL, so a
  // test that stores one supplies its own throwaway key — the same convention as
  // tests/health/service.test.ts, tests/consent/consent.test.ts and
  // tests/household/settings.test.ts. Without this the suite passes locally
  // (`.env.local` has the key) and fails in CI with "ENCRYPTION_KEY is not set".
  if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

async function newHousehold(name: string) {
  const id = randomUUID();
  await db.insert(household).values({ id, name, tier: "free", timezone: "America/New_York" });
  return id;
}

async function newMember(householdId: string, opts: { name: string; birthYm: string; diet?: string; allergens?: string[] }) {
  const id = randomUUID();
  await db.insert(member).values({
    id,
    householdId,
    name: opts.name,
    birthYm: opts.birthYm,
    sex: "unspecified",
    activityLevel: "moderate",
    dietPattern: (opts.diet ?? "unspecified") as never,
  });
  await db.insert(memberHealth).values({
    memberId: id,
    dataEnc: encryptHealth({
      heightCm: null,
      weightKg: null,
      conditions: [],
      allergies: opts.allergens ?? [],
      otherAllergens: [],
    }),
    updatedAt: NOW,
  });
  return id;
}

let seq = 0;
async function newRecipe(
  householdId: string | null,
  opts: { title: string; kcal?: number; tags?: string[]; sourceUrl?: string; status?: string; takenDown?: boolean; starter?: boolean },
) {
  const id = randomUUID();
  await db.insert(recipe).values({
    id,
    householdId,
    visibility: opts.starter ? "starter" : "household_private",
    title: opts.title,
    yieldServings: 4,
    prepMin: 10,
    cookMin: 20,
    totalMin: 30,
    status: (opts.status ?? "ready") as never,
    sourceUrl: opts.starter ? null : (opts.sourceUrl ?? `https://example.test/r${seq++}`),
    sourceDomain: opts.starter ? null : "example.test",
    takedownAt: opts.takenDown ? new Date("2026-11-01T00:00:00Z") : null,
  });
  await db.insert(recipeIngredient).values({
    recipeId: id,
    position: 0,
    rawText: "2 cups flour",
    food: "flour",
    uncertainAllergenTags: opts.tags ?? [],
  });
  if (opts.kcal !== undefined) {
    await db.insert(recipeNutrients).values({
      recipeId: id,
      perServing: { kcal: opts.kcal, protein_g: 20 },
      completeness: 1,
    });
  }
  return id;
}

describe.skipIf(!hasDb)("planning against real rows", { timeout: 30000 }, () => {
  it("pools real recipes, with allergens taken from ingredient tags", { timeout: 30000 }, async () => {
    const hh = await newHousehold("pool-basic");
    const m = await newMember(hh, { name: "Adult", birthYm: "1985-04" });
    const id = await newRecipe(hh, { title: "Chana Masala", kcal: 380, tags: ["gluten"] });

    const out = await loadRecipePool(db, hh, [{ id: m, allergens: [], otherAllergens: [], conditions: [], diet: "unspecified" }]);
    // Asserted by id rather than as an exact array: other suites legitimately
    // leave starter-library rows (household_id IS NULL) in this database, and
    // those belong in every pool by design.
    const found = out.recipes.find((x) => x.id === id);
    expect(found).toBeDefined();
    // Normalised on the way out: stored tag "gluten" becomes the canonical
    // enum value "wheat", which is what member allergies are expressed in.
    expect(found!.allergens).toEqual(["wheat"]);
    expect(found!.caloriesPerServing).toBe(380);
    // a recipe with a source_url belongs to the household's own sources
    expect(found!.isOwnSource).toBe(true);
  });

  it("excludes a recipe a member is allergic to, and re-allows it only with a PR03 confirmation", { timeout: 30000 }, async () => {
    const hh = await newHousehold("pool-allergen");
    const m = await newMember(hh, { name: "Allergic", birthYm: "1990-01", allergens: ["peanut"] });
    const risky = await newRecipe(hh, { title: "Satay", kcal: 500, tags: ["peanut"] });
    const safe = await newRecipe(hh, { title: "Dal", kcal: 350, tags: [] });

    const blocked = await loadRecipePool(db, hh, [{ id: m, allergens: ["peanuts"], otherAllergens: [], conditions: [], diet: "unspecified" }]);
    const blockedIds = blocked.recipes.map((r) => r.id);
    expect(blockedIds).not.toContain(risky);
    expect(blockedIds).toContain(safe);
    expect(blocked.excluded.find((e) => e.title === "Satay")?.reasons).toContain("allergen_unconfirmed");

    await db.insert(allergenConfirmation).values({ recipeId: risky, memberId: m });
    const after = await loadRecipePool(db, hh, [{ id: m, allergens: ["peanuts"], otherAllergens: [], conditions: [], diet: "unspecified" }]);
    const afterIds = after.recipes.map((r) => r.id);
    expect(afterIds).toContain(risky);
    expect(afterIds).toContain(safe);
  });

  it("skips taken-down, needs_review and nutrient-less recipes", { timeout: 30000 }, async () => {
    const hh = await newHousehold("pool-exclusions");
    const m = await newMember(hh, { name: "M", birthYm: "1988-02" });
    const gone = await newRecipe(hh, { title: "Gone", kcal: 300, takenDown: true });
    const unreviewed = await newRecipe(hh, { title: "Unreviewed", kcal: 300, status: "needs_review" });
    const noNutrition = await newRecipe(hh, { title: "NoNutrition", tags: [] });

    const out = await loadRecipePool(db, hh, [{ id: m, allergens: [], otherAllergens: [], conditions: [], diet: "unspecified" }]);
    const ids = out.recipes.map((r) => r.id);
    // Absence of my three, rather than an empty pool: starter rows from other
    // suites legitimately appear here.
    expect(ids).not.toContain(gone);
    expect(ids).not.toContain(unreviewed);
    expect(ids).not.toContain(noNutrition);
    const titles = out.excluded.filter((e) => e.title === "NoNutrition").map((e) => e.title).sort();
    // taken-down / needs_review never reach the exclusion list: they are filtered
    // in SQL, which is the cheaper and correct place for them.
    expect(titles).toEqual(["NoNutrition"]);
    expect(out.excluded.find((e) => e.title === "NoNutrition")!.reasons).toContain("no_nutrients");
  });

  it("includes the shared starter library (household_id IS NULL)", { timeout: 30000 }, async () => {
    const hh = await newHousehold("pool-starter");
    const m = await newMember(hh, { name: "M", birthYm: "1988-02" });
    const starter = await newRecipe(null, { title: "Starter Rice", kcal: 400, starter: true });

    const out = await loadRecipePool(db, hh, [{ id: m, allergens: [], otherAllergens: [], conditions: [], diet: "unspecified" }]);
    expect(out.recipes.map((r) => r.id)).toContain(starter);
  });

  it("excludes a milk-allergic member from a recipe tagged 'dairy' (cross-vocabulary)", { timeout: 30000 }, async () => {
    // The exact miss this fix exists for: members declare canonical enum values
    // ("milk"), recipe tags arrive in scout's vocabulary ("dairy"), and the old
    // verbatim comparison matched nothing, so cheese would have been planned.
    const hh = await newHousehold("vocab-milk");
    const m = await newMember(hh, { name: "M", birthYm: "1985-01", allergens: ["milk"] });
    const paneer = await newRecipe(hh, { title: "Palak Paneer", kcal: 420, tags: ["dairy"] });
    const dal = await newRecipe(hh, { title: "Dal", kcal: 350, tags: [] });

    const out = await loadRecipePool(db, hh, [
      { id: m, allergens: ["milk"], otherAllergens: [], conditions: [], diet: "unspecified" },
    ]);
    const ids = out.recipes.map((r) => r.id);
    expect(ids).not.toContain(paneer);
    expect(ids).toContain(dal);
    // and the planner is handed canonical values on both sides of its own check
    expect(out.recipes.every((r) => r.allergens.every((a) => ["milk", "wheat", "egg", "soy", "fish", "sesame", "peanuts", "tree nuts", "crustacean shellfish"].includes(a)))).toBe(true);
  });

  it("treats celiac as a hard gluten filter, not an advice flag", { timeout: 30000 }, async () => {
    const hh = await newHousehold("vocab-celiac");
    const m = await newMember(hh, { name: "C", birthYm: "1990-05" });
    await db
      .update(memberHealth)
      .set({ dataEnc: encryptHealth({ heightCm: null, weightKg: null, conditions: ["celiac disease"], allergies: [], otherAllergens: [] }) })
      .where(eq(memberHealth.memberId, m));
    const roti = await newRecipe(hh, { title: "Aloo Paratha", kcal: 480, tags: ["gluten"] });
    const rice = await newRecipe(hh, { title: "Curd Rice", kcal: 390, tags: [] });

    const out = await loadRecipePool(db, hh, [
      { id: m, allergens: [], otherAllergens: [], conditions: ["celiac disease"], diet: "unspecified" },
    ]);
    const ids = out.recipes.map((r) => r.id);
    expect(ids).not.toContain(roti);
    expect(ids).toContain(rice);
  });

  it("honours a free-text otherAllergen that no enum can express", { timeout: 30000 }, async () => {
    const hh = await newHousehold("vocab-other");
    const m = await newMember(hh, { name: "O", birthYm: "1988-08" });
    const okra = await newRecipe(hh, { title: "Bhindi Masala", kcal: 330, tags: [] });
    await db
      .insert(recipeIngredient)
      .values({ recipeId: okra, position: 1, rawText: "250 g fresh okra, sliced", food: "okra", uncertainAllergenTags: [] });
    const aloo = await newRecipe(hh, { title: "Aloo Gobi", kcal: 310, tags: [] });

    const out = await loadRecipePool(db, hh, [
      { id: m, allergens: [], otherAllergens: ["okra"], conditions: [], diet: "unspecified" },
    ]);
    const ids = out.recipes.map((r) => r.id);
    expect(ids).not.toContain(okra);
    expect(ids).toContain(aloo);
  });

  it("refuses to plan for a vegetarian household rather than guessing from ingredient text", { timeout: 30000 }, async () => {
    const hh = await newHousehold("pool-diet");
    const m = await newMember(hh, { name: "Veg", birthYm: "1995-06", diet: "vegetarian" });
    await newRecipe(hh, { title: "Paneer", kcal: 450, tags: [] });

    const out = await loadRecipePool(db, hh, [{ id: m, allergens: [], otherAllergens: [], conditions: [], diet: "vegetarian" }]);
    expect(out.recipes).toHaveLength(0);
    expect(out.blockedOn).toBe("diet_provenance_unavailable");
  });

  it("writes a real plan with persisted slots for every member", { timeout: 30000 }, async () => {
    const hh = await newHousehold("plan-write");
    const a = await newMember(hh, { name: "A", birthYm: "1980-01" });
    const b = await newMember(hh, { name: "B", birthYm: "2012-05" });
    const ids = [];
    for (const [t, kcal] of [["Tofu Scramble", 320], ["Rajma Chawal", 520], ["Palak Paneer", 430], ["Khichdi", 380], ["Dosa", 460], ["Upma", 340], ["Samosa Chaat", 500]] as const) {
      ids.push(await newRecipe(hh, { title: t, kcal, tags: [] }));
    }

    const res = await generateWeekPlan(db, hh, NOW);
    expect(res.created).toBe(true);
    expect(res.weekStart).toBe(weekStartFor(NOW));
    expect(res.slots).toBe(21); // 7 days x breakfast/lunch/dinner

    const slots = await db.select().from(planSlot).where(eq(planSlot.planId, res.planId));
    expect(slots).toHaveLength(21);
    // Every slot must reference a recipe this household is actually allowed to
    // eat. Not "one of my seven": the shared starter library is in the pool by
    // design, so a starter slot is correct behaviour, and asserting my own ids
    // only would be a test that fails for the wrong reason.
    const allowed = new Set(ids);
    for (const s of slots) {
      expect(s.sharedRecipeId).not.toBeNull();
      const [src] = await db
        .select({ householdId: recipe.householdId, visibility: recipe.visibility })
        .from(recipe)
        .where(eq(recipe.id, s.sharedRecipeId!));
      expect(src).toBeDefined();
      const ok = src!.householdId === hh || (src!.householdId === null && src!.visibility === "starter");
      expect(ok).toBe(true);
      if (src!.householdId === hh) expect(allowed.has(s.sharedRecipeId!)).toBe(true);
    }
    const links = await db
      .select()
      .from(slotMember)
      .where(inArray(slotMember.slotId, slots.map((s) => s.id)));
    expect(links).toHaveLength(21 * 2);
    // and specifically both members, not 21 rows pointing at one of them twice
    const covered = new Set(links.map((l) => l.memberId));
    expect([...covered].sort()).toEqual([a, b].sort());

    const [p] = await db.select().from(plan).where(eq(plan.id, res.planId));
    expect(p!.status).toBe("draft");
    expect(p!.createdBy).toBe("agent");
    expect(p!.seed).toBe(res.seed);
  });

  it("is idempotent per week: a second press reuses the plan instead of duplicating a week", { timeout: 30000 }, async () => {
    const hh = await newHousehold("plan-idem");
    await newMember(hh, { name: "Solo", birthYm: "1979-11" });
    for (const [t, kcal] of [["A", 320], ["B", 420], ["C", 520], ["D", 380]] as const) {
      await newRecipe(hh, { title: t, kcal, tags: [] });
    }

    const first = await generateWeekPlan(db, hh, NOW);
    const second = await generateWeekPlan(db, hh, NOW);
    expect(second.created).toBe(false);
    expect(second.planId).toBe(first.planId);

    const rows = await db.select().from(plan).where(eq(plan.householdId, hh));
    expect(rows).toHaveLength(1);
    const slots = await db.select().from(planSlot).where(eq(planSlot.planId, first.planId));
    expect(slots).toHaveLength(21);
  });

  it("loads the pool in a stable order, which the seeded RNG depends on", { timeout: 30000 }, async () => {
    const hh = await newHousehold("det");
    const m = await newMember(hh, { name: "M", birthYm: "1984-03" });
    for (const [t, kcal] of [["P1", 330], ["P2", 440], ["P3", 550], ["P4", 390]] as const) {
      await newRecipe(hh, { title: t, kcal, tags: [] });
    }

    const a = await loadRecipePool(db, hh, [{ id: m, allergens: [], otherAllergens: [], conditions: [], diet: "unspecified" }]);
    const b = await loadRecipePool(db, hh, [{ id: m, allergens: [], otherAllergens: [], conditions: [], diet: "unspecified" }]);
    // The planner indexes into this array with the seeded RNG, so an unordered
    // read (Postgres guarantees none) would silently change a household's week
    // between two identical calls.
    expect(a.recipes.map((r) => r.id)).toEqual(b.recipes.map((r) => r.id));
    expect(a.recipes.map((r) => r.id)).toEqual([...a.recipes.map((r) => r.id)].sort());
  });

  it("refuses to plan at all when no pool is declared or every candidate is excluded", { timeout: 30000 }, () => {
    const pool = [
      { id: randomUUID(), name: "X", servings: 4, prepMinutes: 5, cookMinutes: 10, ingredients: ["a"], caloriesPerServing: 350, allergens: ["gluten"], isOwnSource: true },
      { id: randomUUID(), name: "Y", servings: 4, prepMinutes: 5, cookMinutes: 10, ingredients: ["b"], caloriesPerServing: 520, allergens: [], isOwnSource: true },
    ];
    const base = {
      memberIds: ["m1"], startDate: "2026-11-16", planDays: 7, targetEnergyKcal: 2000,
      allergens: [] as string[], dietPreferences: [] as string[], requireOwnSourceDinners: false,
    };
    // the mock library is no longer a silent default
    expect(() => createPlan({ ...base, seed: 3 } as unknown as Parameters<typeof createPlan>[0])).toThrow(/non-empty options.pool/);
    expect(() => createPlan({ ...base, seed: 3, pool: [] })).toThrow(/non-empty options.pool/);
    // and a household whose allergens kill every candidate fails loudly instead
    // of emitting a week with holes in it
    // Every lunch candidate is gone here, which must be a stated failure rather
    // than rng.choice() handing back undefined.
    expect(() => createPlan({ ...base, seed: 5, pool, allergens: ["gluten", "dairy"] })).toThrow(/no candidate recipe left for/);
    // same pool + same seed => same week
    const a = createPlan({ ...base, seed: 11, pool });
    const b = createPlan({ ...base, seed: 11, pool });
    expect(a.meals.map((x) => x.recipe.id)).toEqual(b.meals.map((x) => x.recipe.id));
  });

  it("reports an empty household and an empty pool as distinct, honest failures", { timeout: 30000 }, async () => {
    const hh = await newHousehold("plan-empty");
    await expect(generateWeekPlan(db, hh, NOW)).rejects.toMatchObject({ code: "no_members" });

    // The "no recipes at all" branch is deliberately NOT asserted here: this
    // database legitimately contains starter-library rows, so a fresh household
    // always has a non-empty pool and the expectation would be testing the
    // fixture set rather than the code. That path is covered by the mocked route
    // test (tests/unit/api/plans-first.test.ts) and by loadRecipePool's own
    // exclusion reporting, which is asserted above by id.
  });

  it("does not leak another household's recipes into the pool", { timeout: 30000 }, async () => {
    const mine = await newHousehold("iso-mine");
    const theirs = await newHousehold("iso-theirs");
    const mineMember = await newMember(mine, { name: "Mine", birthYm: "1986-09" });
    theirsRecipe = await newRecipe(theirs, { title: "Not Yours", kcal: 400, tags: [] });
    // A real member id: the loader queries allergen_confirmation by member, and
    // passing a placeholder string makes Postgres reject the uuid comparison.
    const out = await loadRecipePool(db, mine, [{ id: mineMember, allergens: [], otherAllergens: [], conditions: [], diet: "unspecified" }]);
    expect(out.recipes.map((r) => r.id)).not.toContain(theirsRecipe);
  });
});
