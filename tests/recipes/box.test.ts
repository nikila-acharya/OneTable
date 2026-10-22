/** Recipe box: ready recipes only, counted waiting ones, household scope (live DB). */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { household } from "../../db/schema";
import { openDb, type Db } from "../../db/index";
import { eraseHousehold } from "../../src/lib/consent/erase";
import { saveParsedRecipe, confirmField } from "../../src/lib/recipes/review";
import { getRecipeBox } from "../../src/lib/recipes/box";

const hasDb = Boolean(process.env.DATABASE_URL);
const FIELDS = { title: "Bean Soup", ingredients: ["1 cup beans", "1 onion"], steps: ["Simmer."], yieldText: null, prepMinutes: null, cookMinutes: null, totalMinutes: 40, category: [], cuisine: ["Mexican"], author: null };

describe.skipIf(!hasDb)("recipe box (live DB)", () => {
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
    const [hh] = await db.insert(household).values({ name: "box", tier: "household", timezone: "UTC" }).returning();
    created.push(hh!.id);
    return hh!.id;
  }

  it("lists ready recipes with their ingredient count and counts the ones waiting for a check", async () => {
    const hid = await newHousehold();
    await saveParsedRecipe(db, hid, { fields: FIELDS, confidence: {}, unsure: [], sourceUrl: "https://blog.example.test/soup", parseMethod: "markup" });
    const waitingId = await saveParsedRecipe(db, hid, { fields: { ...FIELDS, title: "Unsure Stew" }, confidence: {}, unsure: ["steps"], sourceUrl: "https://blog.example.test/stew", parseMethod: "llm" });
    const box = await getRecipeBox(db, hid);
    expect(box.items.map((i) => i.title)).toEqual(["Bean Soup"]);
    expect(box.items[0]!.ingredientCount).toBe(2);
    expect(box.items[0]!.sourceDomain).toBe("blog.example.test");
    expect(box.waitingForCheck).toBe(1);
    expect(box.items.map((i) => i.id)).not.toContain(waitingId);
  });

  it("a recipe joins the box once its last unsure field is confirmed", async () => {
    const hid = await newHousehold();
    const id = await saveParsedRecipe(db, hid, { fields: FIELDS, confidence: {}, unsure: ["steps"], sourceUrl: "https://blog.example.test/x", parseMethod: "llm" });
    expect((await getRecipeBox(db, hid)).items).toHaveLength(0);
    await confirmField(db, hid, id, "steps");
    const box = await getRecipeBox(db, hid);
    expect(box.items.map((i) => i.id)).toEqual([id]);
    expect(box.waitingForCheck).toBe(0);
  });

  it("another household's recipes are not in the box", async () => {
    const mine = await newHousehold();
    const theirs = await newHousehold();
    await saveParsedRecipe(db, mine, { fields: FIELDS, confidence: {}, unsure: [], sourceUrl: "https://blog.example.test/m", parseMethod: "markup" });
    expect((await getRecipeBox(db, theirs)).items).toHaveLength(0);
  });
});
