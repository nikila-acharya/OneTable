/** WP-2.3 review — unsure fields, confirm/edit, planning pool, household scope (live DB). */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { household } from "../../db/schema";
import { openDb, type Db } from "../../db/index";
import { eraseHousehold } from "../../src/lib/consent/erase";
import { saveParsedRecipe, listNeedsReview, getForReview, confirmField, editFields, inPlanningPool, RecipeNotFoundError } from "../../src/lib/recipes/review";

const hasDb = Boolean(process.env.DATABASE_URL);
const FIELDS = { title: "Chickpea Tacos", ingredients: ["1 can chickpeas"], steps: ["Mash the chickpeas.", "Fry them."], yieldText: null, prepMinutes: 10, cookMinutes: null, totalMinutes: null, category: [], cuisine: ["Mexican"], author: null };
const SRC = "https://blog.example.test/tacos";

describe.skipIf(!hasDb)("RE02 review (live DB)", () => {
  let db: Db;
  const created: string[] = [];
  beforeAll(() => {
    if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    db = openDb().db;
  });
  afterAll(async () => {
    for (const id of created) await eraseHousehold(db, id);
  });
  async function newHousehold(name = "review") {
    const [hh] = await db.insert(household).values({ name, tier: "household", timezone: "UTC" }).returning();
    created.push(hh!.id);
    return hh!.id;
  }

  it("an unsure recipe waits in the box, outside the planning pool", async () => {
    const hid = await newHousehold();
    const id = await saveParsedRecipe(db, hid, { fields: FIELDS, confidence: { title: 0.5, steps: 0.9 }, unsure: ["title"], sourceUrl: SRC, parseMethod: "llm" });
    const r = await getForReview(db, hid, id);
    expect(r.status).toBe("needs_review");
    expect(r.unsureFields).toEqual(["title"]);
    expect(inPlanningPool(r)).toBe(false);
    expect((await listNeedsReview(db, hid)).map((x) => x.id)).toContain(id);
  });

  it("confirming every unsure field makes it ready and removes it from the review list", async () => {
    const hid = await newHousehold();
    const id = await saveParsedRecipe(db, hid, { fields: FIELDS, confidence: {}, unsure: ["title", "steps"], sourceUrl: SRC, parseMethod: "llm" });
    const once = await confirmField(db, hid, id, "title");
    expect(once.status).toBe("needs_review");
    const done = await confirmField(db, hid, id, "steps");
    expect(done.status).toBe("ready");
    expect(inPlanningPool(done)).toBe(true);
    expect((await listNeedsReview(db, hid)).map((x) => x.id)).not.toContain(id);
  });

  it("an edit replaces the lines and counts as confirming those fields", async () => {
    const hid = await newHousehold();
    const id = await saveParsedRecipe(db, hid, { fields: FIELDS, confidence: {}, unsure: ["steps", "ingredients"], sourceUrl: SRC, parseMethod: "llm" });
    const edited = await editFields(db, hid, id, { steps: ["Mash the chickpeas well.", "Fry them until golden."], ingredients: ["1 can chickpeas, drained", "2 tbsp oil"] });
    expect(edited.steps).toEqual(["Mash the chickpeas well.", "Fry them until golden."]);
    expect(edited.ingredients).toEqual(["1 can chickpeas, drained", "2 tbsp oil"]);
    expect(edited.status).toBe("ready");
  });

  it("another household cannot see or change the recipe", async () => {
    const mine = await newHousehold("mine");
    const theirs = await newHousehold("theirs");
    const id = await saveParsedRecipe(db, mine, { fields: FIELDS, confidence: {}, unsure: ["title"], sourceUrl: SRC, parseMethod: "llm" });
    await expect(getForReview(db, theirs, id)).rejects.toBeInstanceOf(RecipeNotFoundError);
    await expect(confirmField(db, theirs, id, "title")).rejects.toBeInstanceOf(RecipeNotFoundError);
    expect((await getForReview(db, mine, id)).unsureFields).toEqual(["title"]);
  });

  it("a recipe with nothing unsure is ready straight away", async () => {
    const hid = await newHousehold();
    const id = await saveParsedRecipe(db, hid, { fields: FIELDS, confidence: {}, unsure: [], sourceUrl: SRC, parseMethod: "markup" });
    expect((await getForReview(db, hid, id)).status).toBe("ready");
  });
});
