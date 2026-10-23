/** WP-2.4 stage 2: mapping a saved recipe to USDA foods, cached lookups, roll-up stored, household scope (live DB). */
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
const fixtureFor: Record<string, string> = { chickpeas: "chickpeas", "soy milk": "soy-milk", "olive oil": "olive-oil" };
const FIELDS = { title: "Chickpea Bowl", author: null, ingredients: ["200 g chickpeas", "1 cup soy milk (warm)", "2 tbsp olive oil"], steps: ["Warm and serve."], yieldText: null, prepMinutes: null, cookMinutes: null, totalMinutes: null, category: [], cuisine: [] };

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

  it("maps lines to foods, stores matches and the roll-up, and reuses the cache on a second run", async () => {
    const hid = await newHousehold();
    const rid = await saveParsedRecipe(db, hid, { fields: FIELDS, confidence: {}, unsure: [], sourceUrl: "https://blog.example.test/bowl", parseMethod: "markup" });
    const { client, calls } = fakeClient();

    // start from an empty cache for these queries, so the first run reaches the (fake) network
    await db.delete(fdcCache).where(inArray(fdcCache.query, ["chickpeas", "soy milk", "olive oil"]));
    const first = await mapRecipeNutrition(db, client, hid, rid, 2);
    expect(calls.sort()).toEqual(["chickpeas", "olive oil", "soy milk"]);
    expect(first.matchedLines).toBe(3);
    expect(first.estimateIncomplete).toBe(true); // soy milk and olive oil are volume lines: 1 of 3 complete

    const rows = await db.select().from(recipeIngredient).where(eq(recipeIngredient.recipeId, rid));
    const chick = rows.find((r) => r.rawText === "200 g chickpeas")!;
    expect(chick.fdcId).not.toBeNull();
    expect(Number(chick.grams)).toBe(200);
    expect(chick.matchConf).toBeGreaterThan(0.5);

    const [nut] = await db.select().from(recipeNutrients).where(eq(recipeNutrients.recipeId, rid));
    expect(nut!.perServing.protein_g).toBeGreaterThan(0);
    expect(nut!.completeness).toBeCloseTo(0.33, 2);

    calls.length = 0;
    await mapRecipeNutrition(db, client, hid, rid, 2);
    expect(calls).toEqual([]); // all three lookups answered from fdc_cache
  });

  it("another household cannot map the recipe", async () => {
    const mine = await newHousehold();
    const theirs = await newHousehold();
    const rid = await saveParsedRecipe(db, mine, { fields: FIELDS, confidence: {}, unsure: [], sourceUrl: "https://blog.example.test/x", parseMethod: "markup" });
    const { client } = fakeClient();
    await expect(mapRecipeNutrition(db, client, theirs, rid, 2)).rejects.toBeInstanceOf(RecipeNotFoundError);
  });
});
