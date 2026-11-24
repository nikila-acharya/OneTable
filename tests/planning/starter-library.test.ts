/**
 * ADR-123: the starter library must actually make planning possible.
 *
 * The point of migration 0008 is that a household with nothing imported still
 * gets a real week, and that the shared rows obey the same safety rules as
 * private ones. Live DB (skipped without DATABASE_URL), as elsewhere here.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { openDb, type Db } from "../../db/index";
import { encryptHealth } from "../../db/crypto";
import {
  household,
  member,
  memberHealth,
  planSlot,
  recipe,
  recipeIngredient,
  recipeNutrients,
} from "../../db/schema";
import { loadRecipePool } from "../../src/lib/planning/pool";
import { ensureStarterLibrary } from "../helpers/ensure-starter-library";
import { generateWeekPlan } from "../../src/lib/planning/firstPlan";

const hasDb = Boolean(process.env.DATABASE_URL);
const NOW = new Date("2026-11-20T09:00:00.000Z");

// fixed ids from scripts/build-starter-library.ts
const MASALA_OATS = "00000000-0000-4000-8000-574400000001"; // peanuts + milk
const SUJI_UPMA = "00000000-0000-4000-8000-574400000003"; // peanuts + ghee(milk)
const DAL_TADKA = "00000000-0000-4000-8000-574400000005"; // ghee(milk)
const VEG_PULAO = "00000000-0000-4000-8000-574400000009"; // cashews(tree_nuts) + ghee
const MINE = [MASALA_OATS, SUJI_UPMA, DAL_TADKA, VEG_PULAO];

let db: Db;
beforeAll(async () => {
  const opened = openDb();
  db = opened.db;
  if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  // This suite is about the shared library, so it declares that precondition
  // instead of inheriting whatever ordering the run happened to produce
  // (tests/db.test.ts truncates the whole recipe table - see the helper).
  await ensureStarterLibrary(opened.sql as unknown as { unsafe: (s: string) => Promise<unknown> });
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
    // no allergens column on member by design (ADR-120): the health blob below
    // is the only place allergies live, and firstPlan reads it via readHealth().
  });
  // Allergens must go into the encrypted health blob: firstPlan reads them via
  // readHealth(), not from the member.allergens column, so a test that only sets
  // the column plans as if nobody had any allergy - which is exactly what an
  // earlier draft of this file did, and it produced a passing-looking peanut plan
  // for a peanut-allergic member.
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

(hasDb ? describe : describe.skip)("starter library (ADR-123)", () => {
  it("ships rows that the pool can actually use", { timeout: 30000 }, async () => {
    const rows = await db.select().from(recipe).where(inArray(recipe.id, MINE));
    expect(rows).toHaveLength(MINE.length);
    for (const r of rows) {
      expect(r.visibility).toBe("starter");
      // shared rows must belong to nobody, or PV03 erasure would miss them
      expect(r.householdId).toBeNull();
      expect(r.status).toBe("ready");
      expect(r.sourceUrl).toBeNull(); // original text, not scraped
      expect(r.parseMethod).toBe("manual");
      expect(r.dietTags).toContain("vegetarian");
    }

    const nutr = await db.select().from(recipeNutrients).where(inArray(recipeNutrients.recipeId, MINE));
    expect(nutr).toHaveLength(MINE.length);
    for (const n of nutr) {
      const kcal = Number((n.perServing as Record<string, unknown>).kcal ?? 0);
      // a pool row with 0 kcal is silently unplanable, which is how an earlier
      // draft of the generator produced a library that matched nothing
      expect(kcal).toBeGreaterThan(150);
      expect(kcal).toBeLessThan(900);
      expect(n.completeness).toBeGreaterThanOrEqual(0.8);
    }
  });

  it("labels shared ingredients with the canonical allergen vocabulary", { timeout: 30000 }, async () => {
    const ings = await db.select().from(recipeIngredient).where(inArray(recipeIngredient.recipeId, MINE));
    // union across every line of the recipe: an earlier draft built a Map keyed by
    // recipeId straight from the rows, which kept only the LAST line (salt, untagged)
    // and reported the attribution as missing.
    const tagsFor = (id: string) => [...new Set(ings.filter((i) => i.recipeId === id).flatMap((i) => i.uncertainAllergenTags ?? []))];
    expect(tagsFor(MASALA_OATS)).toContain("peanuts");
    expect(tagsFor(MASALA_OATS)).toContain("milk");
    expect(tagsFor(SUJI_UPMA)).toContain("peanuts");
    // the vocabulary emits USDA's label "tree nuts"; the member-facing enum is
    // "tree_nuts" and toAllergens() reconciles them (ADR-120)
    expect(tagsFor(VEG_PULAO)).toContain("tree nuts");
    expect(tagsFor(DAL_TADKA)).toContain("milk"); // ghee
  });

  it("plans a full week for a household that has imported nothing", { timeout: 60000 }, async () => {
    const hh = await newHousehold("starter-only");
    const m = await newMember(hh, { name: "Sana", birthYm: "1991-04" });

    const own = await db.select({ id: recipe.id }).from(recipe).where(eq(recipe.householdId, hh));
    expect(own).toHaveLength(0); // nothing of its own: only the shared library

    const res = await generateWeekPlan(db, hh, NOW);
    expect(res.created).toBe(true);
    expect(res.slots).toBe(21);

    const slots = await db.select().from(planSlot).where(eq(planSlot.planId, res.planId));
    expect(slots).toHaveLength(21);
    const ids = new Set(slots.map((s) => s.sharedRecipeId));
    expect(ids.size).toBeGreaterThan(3); // not one recipe repeated 21 times
    const library = await db.select({ id: recipe.id, visibility: recipe.visibility }).from(recipe).where(inArray(recipe.id, [...ids] as string[]));
    for (const l of library) expect(l.visibility).toBe("starter");
    expect(library).toHaveLength(ids.size);
    void m;
  });

  it("keeps a peanut allergy out of the shared rows, not just out of private ones", { timeout: 60000 }, async () => {
    const hh = await newHousehold("starter-peanut");
    const m = await newMember(hh, { name: "Ira", birthYm: "2014-02", allergens: ["peanuts"] });

    const pool = await loadRecipePool(db, hh, [
      { id: m, allergens: ["peanuts"], otherAllergens: [], conditions: [], diet: "unspecified" },
    ]);
    const ids = pool.recipes.map((r) => r.id);
    expect(ids).not.toContain(MASALA_OATS);
    expect(ids).not.toContain(SUJI_UPMA);
    expect(ids).toContain(DAL_TADKA); // no peanuts, only milk -> still allowed
    // pool.excluded is {title, reasons}; ExcludeReason has no per-allergen suffix.
    // With no allergen_confirmation rows (PR03 writes those only from the UI) the
    // safe outcome is allergen_unconfirmed - excluded rather than served.
    const excluded = pool.excluded.filter((e) => ["Masala Oats", "Suji Upma"].includes(e.title));
    expect(excluded.length).toBe(2);
    for (const e of excluded)
      expect(["allergen", "allergen_unconfirmed"].some((r) => (e.reasons as string[]).includes(r))).toBe(true);

    const res = await generateWeekPlan(db, hh, NOW);
    expect(res.created).toBe(true);
    const slots = await db.select().from(planSlot).where(eq(planSlot.planId, res.planId));
    const planned = new Set(slots.map((s) => s.sharedRecipeId));
    expect(planned.has(MASALA_OATS)).toBe(false);
    expect(planned.has(SUJI_UPMA)).toBe(false);
    // the week must still be full: refusing unsafe recipes cannot leave holes
    expect(slots).toHaveLength(21);
    const plannedRows = await db
      .select({ id: recipe.id, title: recipe.title })
      .from(recipe)
      .where(inArray(recipe.id, [...planned] as string[]));
    const withPeanut = plannedRows.filter((r) => ["Masala Oats", "Suji Upma"].includes(r.title));
    expect(withPeanut).toHaveLength(0);
  });

  it("excludes a tree-nut recipe on the attribution alone, with no tree nut named in the title", { timeout: 30000 }, async () => {
    const hh = await newHousehold("starter-treenut");
    const m = await newMember(hh, { name: "Noo", birthYm: "1988-11", allergens: ["tree_nuts"] });
    const pool = await loadRecipePool(db, hh, [
      { id: m, allergens: ["tree_nuts"], otherAllergens: [], conditions: [], diet: "unspecified" },
    ]);
    expect(pool.recipes.map((r) => r.id)).not.toContain(VEG_PULAO);
    const pulao = pool.excluded.find((e) => e.title === "Veg Pulao");
    expect(pulao).toBeDefined();
    expect(["allergen", "allergen_unconfirmed"].some((r) => ((pulao?.reasons ?? []) as string[]).includes(r))).toBe(true);
  });
});
