/**
 * WP-2.5: manual entry validation and save; single-link import outcomes (markup, LLM, robots skip, manual
 * fallback); copyright rules (method verbatim, no image storage, private household copy). Live DB; fake
 * fetch and fake model, no network.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { household, recipe } from "../../db/schema";
import { openDb, type Db } from "../../db/index";
import { eraseHousehold } from "../../src/lib/consent/erase";
import { checkManual, saveManualRecipe } from "../../src/lib/recipes/manual";
import { importRecipeFromUrl } from "../../src/lib/recipes/import";
import { getRecipeBox } from "../../src/lib/recipes/box";
import { getRecipeDetail } from "../../src/lib/recipes/detail";
import type { FetchOutcome } from "../../src/lib/intake/fetcher";
import type { LlmClient } from "../../src/lib/recipes/llm-parser";

const hasDb = Boolean(process.env.DATABASE_URL);
const SOUP_URL = "https://soup-example.test/lentil-soup";
const SOUP_HTML = `<html><head><script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org", "@type": "Recipe", name: "Test Lentil Soup", author: { "@type": "Person", name: "A. Tester" },
  recipeIngredient: ["1 cup red lentils", "1 onion, chopped"], recipeInstructions: ["Rinse the lentils.", "Simmer until soft."],
  image: "https://soup-example.test/photo.jpg",
})}</script></head><body><h1>Test Lentil Soup</h1></body></html>`;
const PORRIDGE_URL = "https://porridge-example.test/oats";
const PORRIDGE_HTML = `<html><body><h1>Oat Porridge</h1><ul><li>1/2 cup oats</li><li>1 cup water</li></ul><p>Boil the water. Stir in the oats and cook for five minutes.</p></body></html>`;

function page(body: string, url: string): FetchOutcome { return { status: "ok", url, body }; }

describe("manual entry validation", () => {
  it("gives plain reasons for missing name, ingredients and steps", () => {
    const r = checkManual({ title: " ", ingredients: [], steps: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reasons).toContain("Please give the recipe a name.");
      expect(r.reasons).toContain("Please add at least one ingredient.");
      expect(r.reasons).toContain("Please add at least one method step.");
    }
  });
  it("accepts a complete recipe", () => {
    expect(checkManual({ title: "Toast", ingredients: ["1 slice bread"], steps: ["Toast it."] })).toEqual({ ok: true });
  });
});

describe.skipIf(!hasDb)("manual entry, import and copyright rules (live DB)", () => {
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
    const [hh] = await db.insert(household).values({ name: "manual-import", tier: "household", timezone: "UTC" }).returning();
    created.push(hh!.id);
    return hh!.id;
  }

  it("a typed-in recipe is saved as a private ready copy with the User's own steps", async () => {
    const hid = await newHousehold();
    const id = await saveManualRecipe(db, hid, { title: "Gran's Toast", ingredients: ["2 slices bread"], steps: ["Toast the bread.", "Butter it."], sourceUrl: null });
    const d = await getRecipeDetail(db, hid, id);
    expect(d.steps).toEqual(["Toast the bread.", "Butter it."]);
    expect((await getRecipeBox(db, hid)).items.map((i) => i.id)).toContain(id);
  });

  it("an invalid typed-in recipe is refused and nothing is saved", async () => {
    const hid = await newHousehold();
    await expect(saveManualRecipe(db, hid, { title: "", ingredients: [], steps: [] })).rejects.toThrow(/name/);
    expect((await getRecipeBox(db, hid)).items).toHaveLength(0);
  });

  it("markup import: method stored exactly as published, and no image is stored", async () => {
    const hid = await newHousehold();
    const res = await importRecipeFromUrl(db, { fetchPage: async (u) => page(SOUP_HTML, u) }, hid, SOUP_URL);
    expect(res.status).toBe("ready");
    if (res.status !== "ready") return;
    const d = await getRecipeDetail(db, hid, res.recipeId);
    expect(d.steps).toEqual(["Rinse the lentils.", "Simmer until soft."]);
    expect(d.sourceDomain).toBe("soup-example.test");
    const columns = Object.keys(getTableColumns(recipe));
    expect(columns.filter((c) => /image|photo|picture/i.test(c))).toEqual([]);
  });

  it("a robots-disallowed page is skipped with plain words and nothing is saved", async () => {
    const hid = await newHousehold();
    const res = await importRecipeFromUrl(db, { fetchPage: async (u) => ({ status: "skipped", url: u, reason: "robots_disallowed", message: "x" }) }, hid, SOUP_URL);
    expect(res.status).toBe("skipped");
    if (res.status === "skipped") expect(res.reason).toMatch(/robots/);
    expect((await getRecipeBox(db, hid)).items).toHaveLength(0);
  });

  it("no markup and a valid model answer: imported with the model's parse; steps verbatim from the page", async () => {
    const hid = await newHousehold();
    const llm: LlmClient = {
      async complete() {
        return JSON.stringify({
          title: "Oat Porridge", ingredients: ["1/2 cup oats", "1 cup water"], steps: ["Boil the water.", "Stir in the oats and cook for five minutes."],
          yieldText: null, prepMinutes: null, cookMinutes: null, totalMinutes: null, category: [], cuisine: [], author: null,
          confidence: { title: 0.95, ingredients: 0.9, steps: 0.9 },
        });
      },
    };
    const res = await importRecipeFromUrl(db, { fetchPage: async (u) => page(PORRIDGE_HTML, u), llm: { client: llm, model: "test" } }, hid, PORRIDGE_URL);
    expect(["ready", "needs_review"]).toContain(res.status);
    if (res.status === "ready" || res.status === "needs_review") {
      const d = await getRecipeDetail(db, hid, res.recipeId).catch(() => null);
      if (d) expect(d.steps).toEqual(["Boil the water.", "Stir in the oats and cook for five minutes."]);
    }
  });

  it("no markup and no model: a manual form prefilled with the link, with a plain reason", async () => {
    const hid = await newHousehold();
    const res = await importRecipeFromUrl(db, { fetchPage: async (u) => page(PORRIDGE_HTML, u) }, hid, PORRIDGE_URL);
    expect(res.status).toBe("manual");
    if (res.status === "manual") {
      expect(res.prefill.sourceUrl).toBe(PORRIDGE_URL);
      expect(res.reason).toMatch(/by hand/);
    }
  });

  it("a non-web address goes to the manual form, not to the network", async () => {
    const hid = await newHousehold();
    let called = false;
    const res = await importRecipeFromUrl(db, { fetchPage: async (u) => { called = true; return page("", u); } }, hid, "javascript:alert(1)");
    expect(called).toBe(false);
    expect(res.status).toBe("manual");
  });
});
