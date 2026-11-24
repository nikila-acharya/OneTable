/**
 * Bulk import of linked sources (PR-2b). Live DB, NO network: the fetcher runs
 * on an injected fetchImpl, and the SSRF refusal is proven by asserting the fake
 * was never asked for the private address.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { openDb, type Db } from "../../db/index";
import { household, member, recipe, recipeIngredient, source } from "../../db/schema";
import { eraseHousehold } from "../../src/lib/consent/erase";
import { importLinkedSources, NoSourcesError } from "../../src/lib/intake/importSources";
import { ensureStarterLibrary } from "../helpers/ensure-starter-library";
import { loadRecipePool } from "../../src/lib/planning/pool";

const hasDb = Boolean(process.env.DATABASE_URL);

const jsonLd = (name: string, ings: string[], category: string[] | null) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Recipe",
    name,
    author: { "@type": "Person", name: "Site Author" },
    recipeIngredient: ings,
    recipeInstructions: ["Cook it.", "Serve it."],
    recipeCategory: category ?? [],
    prepTime: "PT10M",
    cookTime: "PT20M",
    totalTime: "PT30M",
  })}</script></head><body><h1>${name}</h1></body></html>`;

const PANEER_URL = "https://veg-example.test/palak-paneer";
const DAL_URL = "https://dal-example.test/dal";
const UNTAGGED_URL = "https://plain-example.test/chana";
const EXTRA_URL = "https://extra-example.test/rice";

const PAGES: Record<string, string> = {
  [PANEER_URL]: jsonLd("Palak Paneer", ["400 g paneer", "2 tbsp tahini", "300 g spinach"], ["Vegetarian"]),
  [DAL_URL]: jsonLd("Dal Tadka", ["1 cup toor dal", "1 onion", "2 tbsp cashews"], ["vegetarian", "gluten free"]),
  [UNTAGGED_URL]: jsonLd("Chana Masala", ["1 cup chickpeas", "1 tomato"], null),
  [EXTRA_URL]: jsonLd("Curd Rice", ["1 cup rice", "200 g yogurt"], ["Vegetarian"]),
};

let db: Db;
const created: string[] = [];

async function newHousehold(urls: string[]) {
  const [hh] = await db
    .insert(household)
    .values({ name: "import-sources", tier: "household", timezone: "UTC" })
    .returning();
  const id = hh!.id;
  created.push(id);
  for (const u of urls) {
    // platform is NOT NULL text (not derived from kind), matching how prod rows look
    await db.insert(source).values({ householdId: id, kind: "website", platform: "website", url: u, status: "active" });
  }
  return id;
}

/** Injected fetch: robots.txt 404 (=> allowed), pages from PAGES. Records every URL asked. */
function makeFetch(seen: string[]) {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    const body = PAGES[url];
    if (!body) return new Response("gone", { status: 404 });
    return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }) as unknown as typeof fetch;
}

beforeAll(async () => {
  // Health blobs need a key and CI's unit job does not set one (repo convention).
  if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const opened = openDb();
  db = opened.db;
  // ADR-123 dependency, declared rather than assumed: this file's vegetarian-member
  // test expects the shared starter library to cover the household, and
  // tests/db.test.ts truncates the whole recipe table whenever it runs first.
  await ensureStarterLibrary(opened.sql as unknown as { unsafe: (s: string) => Promise<unknown> });
});

afterAll(async () => {
  for (const id of created) await eraseHousehold(db, id);
});

describe.skipIf(!hasDb)("importLinkedSources (live DB, no network)", () => {
  it("imports each active link, records asserted diet tags and flags allergens", { timeout: 30000 }, async () => {
    const hh = await newHousehold([PANEER_URL, DAL_URL]);
    const seen: string[] = [];

    const summary = await importLinkedSources(db, hh, { fetchImpl: makeFetch(seen), env: {} });

    expect(summary.imported).toHaveLength(2);
    expect(summary.remaining).toBe(0);
    expect(summary.nutritionConfigured).toBe(false);
    expect(summary.llmFallbackConfigured).toBe(false);
    expect(summary.plannerReady).toBe(0); // honest: nothing is planable without nutrition
    expect(summary.imported.every((r) => r.status === "imported")).toBe(true);

    const rows = await db.select().from(recipe).where(eq(recipe.householdId, hh));
    expect(rows).toHaveLength(2);

    const paneer = rows.find((r) => r.sourceUrl === PANEER_URL)!;
    expect(paneer.dietTags).toEqual(["vegetarian"]);
    // "gluten free" is not stored as an assertion: that diet is checked against
    // wheat tags instead, which needs no claim from the source (ADR-120).
    const dal = rows.find((r) => r.sourceUrl === DAL_URL)!;
    expect(dal.dietTags).toEqual(["vegetarian"]);

    const ings = await db
      .select({ rawText: recipeIngredient.rawText, tags: recipeIngredient.uncertainAllergenTags })
      .from(recipeIngredient)
      .where(inArray(recipeIngredient.recipeId, rows.map((r) => r.id)));

    expect(ings.find((i) => i.rawText.includes("paneer"))!.tags).toContain("milk");
    expect(ings.find((i) => i.rawText.includes("tahini"))!.tags).toContain("sesame");
    expect(ings.find((i) => i.rawText.includes("cashew"))!.tags).toContain("tree nuts");
    // (no yogurt assertion here: this test imports paneer + dal only, and a
    // find() that misses silently yields undefined - which is exactly how this
    // line failed the first time. Curd/yogurt tagging is covered by
    // tests/unit/health/allergen-vocabulary.test.ts and the repro in CI.)
    // classified-and-empty is recorded as an explicit empty array, which is
    // different information from a line nobody examined
    expect(ings.find((i) => i.rawText.includes("spinach"))!.tags).toEqual([]);
    expect(ings.find((i) => i.rawText.includes("toor dal"))!.tags).toEqual([]);
  });

  it("re-running imports nothing twice and fetches no recipe page again", { timeout: 30000 }, async () => {
    const hh = await newHousehold([PANEER_URL, DAL_URL]);
    await importLinkedSources(db, hh, { fetchImpl: makeFetch([]), env: {} });

    const second: string[] = [];
    const again = await importLinkedSources(db, hh, { fetchImpl: makeFetch(second), env: {} });
    expect(again.imported).toHaveLength(0);
    expect(again.alreadyImported).toBe(2);
    expect(second.filter((u) => !u.endsWith("/robots.txt"))).toEqual([]);

    const rows = await db.select().from(recipe).where(eq(recipe.householdId, hh));
    expect(rows).toHaveLength(2);
  });

  it("refuses a metadata or localhost link without asking the network for it", { timeout: 30000 }, async () => {
    const hh = await newHousehold(["http://169.254.169.254/latest/meta-data/", "http://localhost:5432/x"]);
    const seen: string[] = [];

    const summary = await importLinkedSources(db, hh, { fetchImpl: makeFetch(seen), env: {} });
    expect(summary.imported).toHaveLength(0);
    expect(summary.skipped).toHaveLength(2);
    expect(seen).toEqual([]);
    expect((await db.select().from(recipe).where(eq(recipe.householdId, hh)))).toHaveLength(0);
  });

  it("checks robots.txt before the page it guards", { timeout: 30000 }, async () => {
    const hh = await newHousehold([DAL_URL]);
    const seen: string[] = [];
    await importLinkedSources(db, hh, { fetchImpl: makeFetch(seen), env: {} });
    const robots = seen.findIndex((u) => u.endsWith("/robots.txt"));
    const page = seen.indexOf(DAL_URL);
    expect(robots).toBeGreaterThanOrEqual(0);
    expect(page).toBeGreaterThan(robots);
  });

  it("applies diet proof per recipe for a vegetarian member, not as a household veto", { timeout: 30000 }, async () => {
    const hh = await newHousehold([PANEER_URL, UNTAGGED_URL]);
    await importLinkedSources(db, hh, { fetchImpl: makeFetch([]), env: {} });

    const [m] = await db
      .insert(member)
      .values({ householdId: hh, name: "Veg", birthYm: "1990-01", dietPattern: "vegetarian" })
      .returning({ id: member.id });

    const pool = await loadRecipePool(db, hh, [
      { id: m!.id, allergens: [], otherAllergens: [], conditions: [], diet: "vegetarian" },
    ]);

    // Per-recipe reasons are the point, and they survive the library: the asserted
    // recipe is excluded only for missing nutrition, the unasserted one on diet.
    // isOwnSource distinguishes this household's rows from the shared library
    // (starter rows have no sourceUrl and visibility 'starter'), and it is the
    // honest way to express "neither imported recipe made the pool" - matching by
    // title would be wrong, because the library ships its own Chana Masala.
    expect(pool.recipes.filter((r) => r.isOwnSource)).toHaveLength(0);
    const paneerEntry = pool.excluded.find((e) => e.title === "Palak Paneer");
    const chanaEntry = pool.excluded.find((e) => e.title === "Chana Masala");
    expect(paneerEntry!.reasons).toEqual(["no_nutrients"]);
    expect(chanaEntry!.reasons).toContain("diet_provenance_unavailable");
    // And this changed with ADR-123, deliberately: the household is no longer
    // blocked outright, because the shared starter library covers a vegetarian
    // member. The two imported recipes are still excluded for their own reasons.
    expect(pool.blockedOn).toBeNull();
    expect(pool.recipes.length).toBeGreaterThan(0);
  });

  it("caps the run and reports what is left", { timeout: 30000 }, async () => {
    const hh = await newHousehold([PANEER_URL, DAL_URL, UNTAGGED_URL, EXTRA_URL]);
    const summary = await importLinkedSources(db, hh, { fetchImpl: makeFetch([]), env: {}, limit: 2 });
    expect(summary.imported).toHaveLength(2);
    expect(summary.remaining).toBe(2);
  });

  it("honours a limit above the cap by clamping rather than overreaching", { timeout: 30000 }, async () => {
    const hh = await newHousehold([PANEER_URL, DAL_URL, UNTAGGED_URL, EXTRA_URL]);
    const summary = await importLinkedSources(db, hh, { fetchImpl: makeFetch([]), env: {}, limit: 99 });
    expect(summary.imported.length).toBeLessThanOrEqual(5);
  });

  it("throws NoSourcesError when nothing is linked", { timeout: 30000 }, async () => {
    const hh = await newHousehold([]);
    await expect(importLinkedSources(db, hh, { fetchImpl: makeFetch([]), env: {} })).rejects.toBeInstanceOf(NoSourcesError);
  });
});
