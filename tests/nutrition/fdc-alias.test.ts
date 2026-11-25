/** ADR-125: curated alias table — parser hygiene (pure), alias lookup + USDA densities (live DB). */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../db/index";
import { parseIngredientLine } from "../../src/lib/nutrition/ingredient-line";
import { gramsFromAlias, lookupAlias, normalizeFood, aliasMatch } from "../../src/lib/nutrition/aliases";

describe("parseIngredientLine hygiene (ADR-125)", () => {
  it("strips leading bullets so quantity parsing survives", () => {
    const p = parseIngredientLine("– 1 tbsp ghee");
    expect(p.qty).toBe(1);
    expect(p.unit).toBe("tbsp");
    expect(p.food).toBe("ghee");
  });
  it("reads ranges at the lower bound", () => {
    expect(parseIngredientLine("3-4 scallions").qty).toBe(3);
    const r = parseIngredientLine("1.5-2 cups black beans");
    expect(r.qty).toBe(1.5);
    expect(r.unit).toBe("cup");
    expect(r.food).toBe("black beans");
  });
  it("drops the range tail after a fraction glyph", () => {
    const p = parseIngredientLine("½-1 tbsp crushed kasuri methi");
    expect(p.qty).toBe(0.5);
    expect(p.unit).toBe("tbsp");
    expect(p.food).toBe("crushed kasuri methi");
  });
  it("turns size descriptors into piece counts with a clean food", () => {
    const p = parseIngredientLine("1 medium onion");
    expect(p.unit).toBe("piece");
    expect(p.food).toBe("onion");
    const q = parseIngredientLine("2 large eggs");
    expect(q.qty).toBe(2);
    expect(q.unit).toBe("piece");
    expect(q.food).toBe("eggs");
  });
  it("removes an English 'of' left behind by a unit", () => {
    expect(parseIngredientLine("2 cups of milk").food).toBe("milk");
  });
});

describe("normalizeFood", () => {
  it("matches the fdc_cache normalisation", () => {
    expect(normalizeFood("  Cup of  Rice ")).toBe("cup of rice");
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);
describe.skipIf(!hasDb)("fdc_alias table (live DB, migration 0009)", () => {
  let db: Db;
  let raw: import("postgres").Sql;
  beforeAll(() => {
    if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const opened = openDb();
    db = opened.db;
    raw = opened.sql;
  });

  it("ships the curated rows, dietitian-approved and household-less by construction", async () => {
    const row = await lookupAlias(db, "cooked rice");
    expect(row).not.toBeNull();
    expect(row!.unitGrams.cup).toBe(158); // USDA #169708 foodPortions: 1 cup cooked rice = 158 g
    expect(row!.per100g.energyKcal).toBeGreaterThan(100);
    expect(row!.reviewed).toBe(true); // RD pass 2026-11-25 (sheet: 203/203 approved; mispins fixed in 0010; flip in 0011)
    const cols = await raw`select column_name from information_schema.columns where table_name = 'fdc_alias' and column_name = 'household_id'`;
    expect(Array.from(cols as unknown[]).length).toBe(0); // global rows: PV03 erasure must never have to reach them
  });

  it("gramsFromAlias weighs volume and count lines, and never touches weighed ones", async () => {
    const rice = (await lookupAlias(db, "cooked rice"))!;
    expect(gramsFromAlias(parseIngredientLine("1 cup cooked rice"), rice)).toBe(158);
    expect(gramsFromAlias(parseIngredientLine("2 cups of cooked rice"), rice)).toBe(316);
    expect(gramsFromAlias(parseIngredientLine("cooked rice, to taste"), rice)).toBeNull(); // no qty
    expect(gramsFromAlias(parseIngredientLine("1 stick cooked rice"), rice)).toBeNull(); // rice has no USDA "stick" portion
    const butter = (await lookupAlias(db, "butter"))!;
    expect(gramsFromAlias(parseIngredientLine("1 stick butter"), butter)).toBe(113);
    const garlic = (await lookupAlias(db, "garlic"))!;
    expect(gramsFromAlias(parseIngredientLine("4 cloves garlic"), garlic)).toBe(12);
    const weighed = parseIngredientLine("200 g cooked rice");
    expect(gramsFromAlias(weighed, rice)).toBeNull(); // explicit grams always win
  });

  it("aliasMatch carries the pinned record at curated confidence", async () => {
    const row = (await lookupAlias(db, "onion"))!;
    const m = aliasMatch(row);
    expect(m.confidence).toBe(0.95);
    expect(m.description).toMatch(/onions/i);
    expect(m.per100g.energyKcal).toBeCloseTo(40, 0);
  });

  it("a descriptor-parsed line resolves through the alias table", async () => {
    const parsed = parseIngredientLine("1 medium onion");
    const row = await lookupAlias(db, parsed.food);
    expect(row).not.toBeNull();
    expect(gramsFromAlias(parsed, row!)).toBe(row!.unitGrams.piece); // 110 g (USDA "1 medium")
  });
});
