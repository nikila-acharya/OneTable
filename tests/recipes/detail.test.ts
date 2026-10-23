/** Recipe detail: ordered lines, source and times; not for waiting recipes; household scope (live DB). */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { household } from "../../db/schema";
import { openDb, type Db } from "../../db/index";
import { eraseHousehold } from "../../src/lib/consent/erase";
import { saveParsedRecipe } from "../../src/lib/recipes/review";
import { getRecipeDetail } from "../../src/lib/recipes/detail";
import { RecipeNotFoundError } from "../../src/lib/recipes/review";

const hasDb = Boolean(process.env.DATABASE_URL);
const FIELDS = { title: "Lentil Dal", author: "A. Cook", ingredients: ["1 cup lentils", "1 onion"], steps: ["Rinse the lentils.", "Simmer for 20 minutes."], yieldText: null, prepMinutes: 5, cookMinutes: 25, totalMinutes: 30, category: [], cuisine: ["Indian"] };

describe.skipIf(!hasDb)("recipe detail (live DB)", () => {
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
    const [hh] = await db.insert(household).values({ name: "detail", tier: "household", timezone: "UTC" }).returning();
    created.push(hh!.id);
    return hh!.id;
  }

  it("returns lines in order with source and times", async () => {
    const hid = await newHousehold();
    const id = await saveParsedRecipe(db, hid, { fields: FIELDS, confidence: {}, unsure: [], sourceUrl: "https://blog.example.test/dal", parseMethod: "markup" });
    const d = await getRecipeDetail(db, hid, id);
    expect(d.ingredients).toEqual(["1 cup lentils", "1 onion"]);
    expect(d.steps).toEqual(["Rinse the lentils.", "Simmer for 20 minutes."]);
    expect(d.sourceDomain).toBe("blog.example.test");
    expect(d.totalMinutes).toBe(30);
    expect(d.author).toBe("A. Cook");
  });

  it("a recipe still waiting for a check is not shown", async () => {
    const hid = await newHousehold();
    const id = await saveParsedRecipe(db, hid, { fields: FIELDS, confidence: {}, unsure: ["title"], sourceUrl: "https://blog.example.test/w", parseMethod: "llm" });
    await expect(getRecipeDetail(db, hid, id)).rejects.toBeInstanceOf(RecipeNotFoundError);
  });

  it("another household gets not_found", async () => {
    const mine = await newHousehold();
    const theirs = await newHousehold();
    const id = await saveParsedRecipe(db, mine, { fields: FIELDS, confidence: {}, unsure: [], sourceUrl: "https://blog.example.test/m", parseMethod: "markup" });
    await expect(getRecipeDetail(db, theirs, id)).rejects.toBeInstanceOf(RecipeNotFoundError);
  });
});
