/** WP-2.4 stage 2: mapping a saved recipe to USDA foods, cached lookups, roll-up stored, household scope (live DB).
 * ADR-125 note: curated aliases now answer soy milk / olive oil / chickpeas without any network call and
 * supply USDA foodPortions grams for their volume lines, so the dragonfruit line is what still exercises
 * the fuzzy+cache path. */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { fdcCache, household, recipeIngredient, recipeNutrients } from "../../db/schema";
import { openDb, type Db } from "../../db/index";
import { eraseHousehold } from "../../src/lib/consent/erase";
import { saveParsedRecipe, RecipeNotFoundError } from "../../src/lib/recipes/review";
import { mapRecipeNutrition } from "../../src/lib/nutrition/store";
import type { FdcFood } from "../../src/lib/nutrition/fdc";

const hasDb = Boolean(process.env.DATABASE_URL);
const fixtureFor: Record<string, string> = { dragonfruit: "soy-milk" };
const FIELDS = { title: "Chickpea Bowl", author: null, ingredients: ["200 g chickpeas", "1 cup soy milk (warm)", "2 tbsp olive oil", "30 g dragonfruit, diced"], steps: ["Warm and serve."], yieldText: null, prepMinutes: null, cookMinutes: null, totalMinutes: null, category: [], cuisine: [] };

function fakeClient() {
  const calls: string[] = [];
  return {
    calls,
    client: {
      async search(q: string): Promise<FdcFood[]> {
        calls.push(q);
        const f = fixtureFor[q];
        if (!f) return [];
        return (JSON.parse(readFileSync(`tests/fixtures/fdc/${f}.json`, "utf8")) as { foods: FdcFood[] }).foods;
      },
    },
  };
}

describe.skipIf(!hasDb)("recipe nutrition mapping (live DB)", () => {
  let db: Db;
  const created: string[] = [];
  beforeAll(() => {
    if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    db = openDb().db;
  });
  afterAll(async () => {
    for (const id of created) await eraseHousehold(db, id);
  });
  async function newHousehold() {
    const [hh] = await db.insert(household).values({ name: "nutrition", tier: "household", timezone: "UTC" }).returning();
    created.push(hh!.id);
    return hh!.id;
  }

  it("prefers curated aliases, weighs volume lines from USDA portions, and caches the fuzzy path", async () => {
    const hid = await newHousehold();
    const rid = await saveParsedRecipe(db, hid, { fields: FIELDS, confidence: {}, unsure: [], sourceUrl: "https://blog.example.test/bowl", parseMethod: "markup" });
    const { client, calls } = fakeClient();

    // start from an empty cache for these queries, so the first run reaches the (fake) network
    await db.delete(fdcCache).where(inArray(fdcCache.query, ["dragonfruit"]));
    const first = await mapRecipeNutrition(db, client, hid, rid, 2);
    expect(calls).toEqual(["dragonfruit"]); // aliases answer the other three lines without any search
    expect(first.matchedLines).toBe(3);
    expect(first.unmatched).toEqual(["30 g dragonfruit, diced"]); // no alias, and the fuzzy fixture doesn't word-match
    expect(first.estimateIncomplete).toBe(true); // 3 of 4 complete

    const rows = await db.select().from(recipeIngredient).where(eq(recipeIngredient.recipeId, rid));
    const chick = rows.find((r) => r.rawText === "200 g chickpeas")!;
    expect(chick.fdcId).not.toBeNull();
    expect(Number(chick.grams)).toBe(200);
    expect(chick.matchConf).toBe(0.95); // curated confidence (starter-library convention)
    const soy = rows.find((r) => r.rawText === "1 cup soy milk (warm)")!;
    expect(Number(soy.grams)).toBe(243); // USDA foodPortions: 1 cup soymilk = 243 g
    const oil = rows.find((r) => r.rawText === "2 tbsp olive oil")!;
    expect(Number(oil.grams)).toBe(27); // 2 x 13.5 g

    const [nut] = await db.select().from(recipeNutrients).where(eq(recipeNutrients.recipeId, rid));
    expect(nut!.perServing.protein_g).toBeGreaterThan(0);
    expect(nut!.completeness).toBeCloseTo(0.75, 2);

    calls.length = 0;
    await mapRecipeNutrition(db, client, hid, rid, 2);
    expect(calls).toEqual([]); // dragonfruit answered from fdc_cache, aliases never needed the network
  });

  it("one failing FDC lookup zeroes nothing: the line reports unmatched, aliases still weigh (production 2026-11-24)", async () => {
    const hid = await newHousehold();
    const rid = await saveParsedRecipe(db, hid, {
      fields: { ...FIELDS, title: "Hardened Bowl", ingredients: ["2 sized purple brinjal / baingan / eggplant", "1 cup cooked rice", "300 g mystery slime"] },
      confidence: {}, unsure: [], sourceUrl: "https://blog.example.test/hard", parseMethod: "markup",
    });
    const client = {
      async search(q: string): Promise<FdcFood[]> {
        if (q.includes("mystery")) throw new Error("fdc http 400"); // what the old code turned into a dead recipe
        return [];
      },
    };
    const roll = await mapRecipeNutrition(db, client, hid, rid, 2);
    expect(roll.fdcFailures).toEqual(["mystery slime"]);
    expect(roll.unmatched).toContain("2 sized purple brinjal / baingan / eggplant");
    expect(roll.perServing.kcal).toBeGreaterThan(0); // the alias line carried the recipe
    const rows = await db.select().from(recipeIngredient).where(eq(recipeIngredient.recipeId, rid));
    expect(Number(rows.find((r) => r.rawText === "1 cup cooked rice")!.grams)).toBe(158);
    expect(rows.find((r) => r.rawText.includes("mystery"))!.fdcId).toBeNull(); // grams parsed, but no food matched after the failed lookup
  });

  it("another household cannot map the recipe", async () => {
    const mine = await newHousehold();
    const theirs = await newHousehold();
    const rid = await saveParsedRecipe(db, mine, { fields: FIELDS, confidence: {}, unsure: [], sourceUrl: "https://blog.example.test/x", parseMethod: "markup" });
    const { client } = fakeClient();
    await expect(mapRecipeNutrition(db, client, theirs, rid, 2)).rejects.toBeInstanceOf(RecipeNotFoundError);
  });
});
