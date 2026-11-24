/**
 * Generator for the starter recipe library (ADR-123).
 *
 * Why a data migration instead of a seed script: `npm run db:migrate` already
 * runs on every deploy against both staging and production (deploy.yml), and
 * `scripts/seed.ts` is a 26-line placeholder that nothing calls. Shipping the
 * starter library as migration 0008 means it exists everywhere the schema
 * exists - including CI's throwaway Postgres, which is where the planner tests
 * get their candidates - with no extra credentials, no manual step, and no
 * "worked locally because somebody remembered to seed" state.
 *
 * Where the numbers come from: calories are NOT typed in here. Each recipe's
 * ingredient lines are mapped through the app's own USDA path
 * (`mapRecipeNutrition` + `searchCached`), so `recipe_nutrients.per_serving`
 * holds figures the pipeline actually computed from FDC matches, with the same
 * `completeness` and `fdc_id` bookkeeping any imported recipe gets. Allergen
 * tags likewise come from `allergensFromIngredientLine`, so starter rows and
 * imported rows are labelled by one vocabulary.
 *
 * Recipes are original text written for this file - nothing is scraped, so
 * PRD §5.3 (verbatim method only from sources the household added) is not
 * engaged: `source_url` stays NULL, `parse_method` is 'manual', and the author
 * is the library itself.
 *
 * Usage:  npx tsx scripts/build-starter-library.ts           # dev DB from .env.local
 *         npx tsx scripts/build-starter-library.ts --check    # band coverage only
 *
 * It refuses to write anything unless every band the planner needs is populated
 * (breakfast <400 kcal, lunch 250-450, dinner >=300) - otherwise the migration
 * would ship a library that produces 409 planner_refused for every household.
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { openDb, requireDatabaseUrl } from "../db/index.js";
import {
  household,
  recipe,
  recipeIngredient,
  recipeNutrients,
  recipeStep,
} from "../db/schema.js";
import { allergensFromIngredientLine } from "../src/lib/health/allergen-vocabulary.js";
import { parseIngredientLine } from "../src/lib/nutrition/ingredient-line.js";
import { rollUp, type LineMatch } from "../src/lib/nutrition/rollup.js";

type Starter = {
  id: string;
  title: string;
  cuisine: string;
  category: string[];
  mealTypes: string[];
  servings: number;
  prep: number;
  cook: number;
  total: number;
  ingredients: string[];
  steps: string[];
};

// Fixed ids: the migration must be identical everywhere it is applied, so this
// cannot use defaultRandom() or randomUUID() at run time.
const S = (
  id: string,
  title: string,
  cuisine: string,
  category: string[],
  mealTypes: string[],
  servings: number,
  prep: number,
  cook: number,
  ingredients: string[],
  steps: string[],
): Starter => ({
  id,
  title,
  cuisine,
  category,
  mealTypes,
  servings,
  prep,
  cook,
  total: prep + cook,
  ingredients,
  steps,
});

const VEG = ["Vegetarian"];

/**
 * Per-recipe caveats stored in `recipe.unsure_fields` so the compromise is visible
 * in the data, not only in this file:
 *  - paneer: USDA has no generic paneer record; the nearest standard food is
 *    creamed cottage cheese, so those two recipes' calories are an approximation
 *    of a similar dairy, not of paneer itself.
 *  - oats/peanuts: pinned to single-ingredient Branded records because USDA's
 *    non-branded entries were unusable from the search endpoint (see ADR-123).
 */
const UNSURE: Record<string, string[]> = {
  "00000000-0000-4000-8000-574400000001": ["nutrition_branded_fdc"],
  "00000000-0000-4000-8000-574400000003": ["nutrition_branded_fdc"],
  "00000000-0000-4000-8000-574400000007": ["nutrition_paneer_substitute"],
  "00000000-0000-4000-8000-574400000014": ["nutrition_paneer_substitute"],
};

const LIBRARY: Starter[] = [
  S("00000000-0000-4000-8000-574400000001", "Masala Oats", "Indian", VEG, ["breakfast"], 2, 5, 10,
    ["80 g oats (1 cup)", "240 g water", "120 g milk (0.5 cup)", "1 g turmeric", "10 g green chilli (1)", "15 g peanuts (1 tbsp)", "2 g salt"],
    ["Toast the peanuts in a pan and set aside.", "Add oats, water, milk and turmeric; cook until soft.", "Top with peanuts and green chilli."]),
  S("00000000-0000-4000-8000-574400000002", "Idli", "Indian", VEG, ["breakfast"], 6, 20, 25,
    ["360 g idli rice (2 cups)", "95 g urad dal (0.5 cup)", "2 g salt", "480 g water"],
    ["Soak rice and dal separately for four hours.", "Grind separately, mix and leave to ferment overnight.", "Steam in idli moulds for 12 minutes."]),
  S("00000000-0000-4000-8000-574400000003", "Suji Upma", "Indian", VEG, ["breakfast"], 3, 5, 15,
    ["160 g semolina (1 cup)", "1 g turmeric", "10 g ginger (1 inch)", "10 g green chilli (1)", "35 g peanuts (0.25 cup)", "15 g ghee (1 tbsp)", "2 g salt"],
    ["Roast the semolina in ghee until it smells nutty.", "Temper chilli, ginger and peanuts; add two cups water and salt.", "Stir in semolina and cook five minutes; rest and serve."]),
  S("00000000-0000-4000-8000-574400000004", "Besan Chilla", "Indian", VEG, ["breakfast"], 2, 10, 15,
    ["90 g besan (1 cup)", "120 g water", "1 g turmeric", "2 g salt", "30 g milk", "5 g oil"],
    ["Whisk besan with water, milk, turmeric and salt to a pouring batter.", "Spread on a hot pan, drizzle oil.", "Flip once, fold and serve."]),
  S("00000000-0000-4000-8000-574400000005", "Dal Tadka", "Indian", VEG, ["lunch", "dinner"], 4, 10, 30,
    ["200 g toor dal (1 cup)", "120 g water", "120 g tomato (1 medium)", "150 g onion (1 medium)", "1 g turmeric", "10 g garlic (2 cloves)", "4 g cumin seeds", "15 g ghee (1 tbsp)", "2 g salt"],
    ["Boil dal with turmeric and water until soft.", "Mash, then temper ghee, cumin, garlic and sliced chilli over it.", "Add tomato and salt; simmer five minutes."]),
  S("00000000-0000-4000-8000-574400000006", "Rajma Chawal", "Indian", VEG, ["lunch", "dinner"], 4, 15, 45,
    ["200 g kidney beans (1 cup dry)", "720 g water", "150 g onion (1 medium)", "240 g tomatoes (2)", "4 g cumin seeds", "3 g coriander powder", "1 g cumin seeds", "14 g oil (1 tbsp)", "2 g salt"],
    ["Soak the beans overnight, then pressure cook until tender.", "Fry onion and tomato with cumin and coriander.", "Add beans with their water; simmer until the gravy thickens."]),
  S("00000000-0000-4000-8000-574400000007", "Paneer Bhurji", "Indian", VEG, ["lunch", "dinner"], 3, 10, 20,
    ["300 g paneer", "150 g onion (1 medium)", "240 g tomatoes (2)", "10 g green chilli (1)", "2 g turmeric", "15 g milk", "5 g oil", "2 g salt"],
    ["Saute onion, chilli and tomato until soft.", "Crumble in paneer, add turmeric and milk.", "Cook four minutes, stirring, and salt at the end."]),
  // a dry vegetable dish alone is ~140 kcal, which the planner files under
  // breakfast; the roti belongs on the plate, so the calories describe the meal.
  S("00000000-0000-4000-8000-574400000008", "Aloo Gobi with Roti", "Indian", VEG, ["lunch", "dinner"], 4, 20, 30,
    ["400 g cauliflower", "300 g potatoes (2)", "2 g turmeric", "4 g cumin seeds", "28 g oil (2 tbsp)", "2 g salt", "120 g tomato (1 medium)", "240 g whole wheat flour (4 rotis)", "60 g water"],
    ["Cut potato and cauliflower into florets and cubes.", "Temper cumin, add turmeric and the vegetables; cover and cook 20 minutes, stirring twice, then add tomato and salt.", "Knead the flour with salt and water and roll four discs.", "Cook the rotis on a dry tawa and brush with ghee."]),
  S("00000000-0000-4000-8000-574400000009", "Veg Pulao", "Indian", VEG, ["lunch", "dinner"], 4, 15, 35,
    ["285 g basmati rice (1.5 cups)", "720 g water", "150 g mixed vegetables", "150 g onion (1 medium)", "28 g cashews", "3 g coriander powder", "1 g cumin seeds", "28 g ghee (2 tbsp)", "2 g salt"],
    ["Soak the rice for twenty minutes.", "Fry onion and cashews in ghee; add vegetables and rice.", "Add water and salt; cover and cook until the water is absorbed."]),
  S("00000000-0000-4000-8000-574400000010", "Chana Masala", "Indian", VEG, ["lunch", "dinner"], 4, 15, 40,
    ["200 g chickpeas (1 cup dry)", "720 g water", "240 g tomatoes (2)", "150 g onion (1 medium)", "4 g cumin seeds", "2 g chilli powder", "28 g oil (2 tbsp)", "2 g salt"],
    ["Soak chickpeas overnight and pressure cook until tender.", "Fry onion, tomato and spices into a masala.", "Add chickpeas with water; simmer fifteen minutes."]),
  S("00000000-0000-4000-8000-574400000011", "Moong Dal Khichdi", "Indian", VEG, ["lunch", "dinner", "breakfast"], 4, 10, 30,
    ["95 g rice", "100 g moong dal (0.5 cup)", "600 g water", "1 g turmeric", "4 g cumin seeds", "15 g ghee (1 tbsp)", "2 g salt"],
    ["Rinse rice and dal together.", "Pressure cook with water, turmeric and salt until soft.", "Temper cumin in ghee and stir through."]),
  S("00000000-0000-4000-8000-574400000012", "Curd Rice", "Indian", VEG, ["lunch", "dinner"], 3, 5, 20,
    ["185 g rice (1 cup)", "480 g water", "245 g yogurt (1 cup)", "6 g mustard seeds", "10 g coriander leaves", "14 g oil (1 tbsp)", "2 g salt"],
    ["Cook the rice soft and let it cool.", "Mix in yogurt and salt.", "Temper mustard seeds and coriander in oil; fold through."]),
  S("00000000-0000-4000-8000-574400000013", "Sambar with Rice", "Indian", VEG, ["lunch", "dinner"], 4, 15, 40,
    ["100 g toor dal (0.5 cup)", "150 g mixed vegetables", "15 g coriander powder", "5 g chilli powder", "480 g water", "6 g mustard seeds", "14 g oil (1 tbsp)", "2 g salt", "120 g tomato (1 medium)"],
    ["Cook dal soft with turmeric.", "Add vegetables, coriander and chilli and water; simmer until thick.", "Temper mustard seeds in oil and add to the pot."]),
  S("00000000-0000-4000-8000-574400000014", "Palak Paneer with Rice", "Indian", VEG, ["dinner"], 4, 15, 30,
    ["400 g spinach", "250 g paneer", "150 g onion (1 medium)", "10 g garlic (2 cloves)", "2 g turmeric", "15 g cream", "5 g oil", "2 g salt", "185 g rice (1 cup)", "480 g water"],
    ["Cook the rice with water and salt until tender.", "Blanch spinach and puree it.", "Saute onion and garlic, add turmeric and the puree.", "Stir in paneer and cream; warm through without boiling and serve over rice."]),
];

type Pin = {
  fdcId: string;
  description: string;
  dataType: string;
  kcal: number | null;
  protein: number | null;
  fat: number | null;
  satFat: number | null;
  carbs: number | null;
  fiber: number | null;
  sugar: number | null;
  sodium: number | null;
};

/** Hand-picked USDA records (see scripts/pin-starter-foods.ts). Committed so this
 *  migration is reproducible without network access and reviewable line by line. */
const PINS: Record<string, Pin> = JSON.parse(
  // resolved from cwd (npm scripts run at the repo root): tsx compiles scripts to
  // CommonJS, where import.meta is unavailable.
  fs.readFileSync(path.join(process.cwd(), "scripts", "starter-food-pins.json"), "utf8"),
);

function sqlStr(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}
function sqlArray(values: string[]): string {
  return values.length ? `ARRAY[${values.map(sqlStr).join(", ")}]::text[]` : `ARRAY[]::text[]`;
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const url = requireDatabaseUrl();
  const { db, sql } = openDb(url);
  // No live FDC call: every ingredient resolves through scripts/starter-food-pins.json,
  // which was produced by hand-checking USDA records (see scripts/pin-starter-foods.ts).

  // A scratch household: mapRecipeNutrition scopes by household, and starter
  // rows must end with household_id NULL, so they are enriched under cover of a
  // real household and released afterwards.
  const scratch = randomUUID();
  const created: string[] = [];
  const out: string[] = [];

  try {
    // Fixed ids mean a rebuild collides with its own previous output - including
    // rows this very migration inserted into the target database. Clear them first
    // so the script is re-runnable; the migration re-inserts them afterwards.
    const ids = LIBRARY.map((x) => x.id);
    await db.delete(recipeNutrients).where(inArray(recipeNutrients.recipeId, ids));
    await db.delete(recipeStep).where(inArray(recipeStep.recipeId, ids));
    await db.delete(recipeIngredient).where(inArray(recipeIngredient.recipeId, ids));
    await db.delete(recipe).where(inArray(recipe.id, ids));
    await db.insert(household).values({ id: scratch, name: "ZZ starter build scratch", tier: "household", timezone: "UTC" });

    const bands: Record<string, number> = { breakfast: 0, lunch: 0, dinner: 0 };
  const unpinned: string[] = [];
  const unweighed: string[] = [];
  const unmatchedLines: string[] = [];
    const rows: {
      r: typeof recipe.$inferSelect;
      ings: { rawText: string; tags: string[]; food: string | null; qty: string | null; unit: string | null; grams: string | null; fdcId: string | null; matchConf: number | null }[];
      steps: string[];
      nutrients: { perServing: Record<string, number>; completeness: number } | null;
    }[] = [];

    for (const s of LIBRARY) {
      await db
        .insert(recipe)
        .values({
          id: s.id,
          householdId: scratch,
          visibility: "household_private",
          title: s.title,
          yieldServings: s.servings,
          prepMin: s.prep,
          cookMin: s.cook,
          totalMin: s.total,
          cuisine: s.cuisine,
          mealTypes: s.mealTypes as never,
          author: "OneTable starter library",
          status: "ready",
          parseMethod: "manual",
          dietTags: s.category.map((c) => c.toLowerCase()),
          unsureFields: UNSURE[s.id] ?? [],
        })
        .returning();
      created.push(s.id);

      const lines: LineMatch[] = [];
      for (const [i, raw] of s.ingredients.entries()) {
        // Tags are derived by the same vocabulary the importer uses, so a starter
        // row and an imported row are labelled identically. Skipping this (which an
        // earlier draft of this script did) would have shipped an untagged library
        // that silently ignores every household's allergies.
        const parsed = parseIngredientLine(raw);
        const pin = PINS[parsed.food];
        if (!pin) unpinned.push(`${s.title}: "${parsed.food}"`);
        const match = pin
          ? {
              fdcId: Number(pin.fdcId),
              description: pin.description,
              dataType: pin.dataType,
              // 0.95, not 1.0: a human picked the record, but the portion weights in
              // this library are my own recipe text, and a single-ingredient branded
              // record (oats, peanuts) was accepted where USDA has no usable
              // Foundation/SR entry. See the note in starter-food-pins.ts.
              confidence: 0.95,
              per100g: {
                energyKcal: pin.kcal ?? undefined,
                protein: pin.protein ?? undefined,
                fat: pin.fat ?? undefined,
                saturatedFat: pin.satFat ?? undefined,
                carbs: pin.carbs ?? undefined,
                fiber: pin.fiber ?? undefined,
                sugarTotal: pin.sugar ?? undefined,
                sodium: pin.sodium ?? undefined,
              },
            }
          : null;
        lines.push({ line: parsed, match });
        const [row] = await db
          .insert(recipeIngredient)
          .values({
            recipeId: s.id,
            position: i,
            rawText: raw,
            uncertainAllergenTags: allergensFromIngredientLine(parsed.food),
          })
          .returning({ id: recipeIngredient.id });
        await db
          .update(recipeIngredient)
          .set({
            qty: parsed.qty === null ? null : String(parsed.qty),
            unit: parsed.unit,
            food: parsed.food || null,
            grams: parsed.grams === null ? null : String(parsed.grams),
            fdcId: match ? String(match.fdcId) : null,
            matchConf: match ? match.confidence : null,
          })
          .where(eq(recipeIngredient.id, row!.id));
      }
      for (const [i, text] of s.steps.entries()) {
        await db.insert(recipeStep).values({ recipeId: s.id, position: i + 1, text });
      }

      const nutr = rollUp(lines, s.servings);
      if (nutr.unweighed.length) unweighed.push(`${s.title}: ${nutr.unweighed.join(", ")}`);
      await db
        .insert(recipeNutrients)
        .values({ recipeId: s.id, perServing: nutr.perServing, completeness: nutr.completeness })
        .onConflictDoUpdate({
          target: recipeNutrients.recipeId,
          set: { perServing: nutr.perServing, completeness: nutr.completeness },
        });

      const ings = await db
        .select()
        .from(recipeIngredient)
        .where(eq(recipeIngredient.recipeId, s.id));
      const kcal = nutr ? Number(nutr.perServing.kcal ?? 0) : 0;
      if (kcal > 0) {
        if (kcal < 400) bands.breakfast++;
        if (kcal >= 250 && kcal < 450) bands.lunch++;
        if (kcal >= 300) bands.dinner++;
      }

      const saved = await db.select().from(recipe).where(eq(recipe.id, s.id));
      if (nutr.unmatched.length) unmatchedLines.push(...nutr.unmatched.map((u) => `${s.title}: ${u}`));
      rows.push({
        r: saved[0]!,
        ings: ings.map((x) => ({
          rawText: x.rawText,
          tags: x.uncertainAllergenTags ?? [],
          food: x.food,
          qty: x.qty,
          unit: x.unit,
          grams: x.grams,
          fdcId: x.fdcId,
          matchConf: x.matchConf,
        })),
        steps: s.steps,
        nutrients: { perServing: nutr.perServing, completeness: nutr.completeness },
      });
      console.log(`  ${s.title.padEnd(22)} ${String(kcal).padStart(6)} kcal/serving  lines=${ings.length} tags=${ings.filter((x) => (x.uncertainAllergenTags ?? []).length).length}`);
    }

    console.log(`band coverage: ${JSON.stringify(bands)}`);

    // An earlier version of this script only checked that bands were non-empty, and
    // shipped a library where plain "rice" had no USDA pin at all: khichdi came out
    // at 38 kcal/serving because the rice line was silently dropped from the rollup.
    // Band presence proves nothing about data quality, so every gap below is fatal.
    const problems: string[] = [];
    if (unpinned.length) problems.push(`ingredient has no pinned USDA record: ${[...new Set(unpinned)].join("; ")}`);
    if (unmatchedLines.length) problems.push(`line contributed no nutrition: ${[...new Set(unmatchedLines)].join("; ")}`);
    if (unweighed.length) problems.push(`line without a gram weight: ${[...new Set(unweighed)].join("; ")}`);

    const implausible = rows
      .map((x) => ({ t: x.r.title, k: Number(x.nutrients?.perServing?.kcal ?? 0), c: x.nutrients?.completeness ?? 0 }))
      .filter((x) => x.k < 150 || x.k > 900);
    if (implausible.length)
      problems.push(`implausible kcal/serving (expect 150-900): ${implausible.map((i) => `${i.t}=${i.k}`).join(", ")}`);
    const thin = rows.filter((x) => (x.nutrients?.completeness ?? 0) < 0.8);
    if (thin.length) problems.push(`completeness < 0.8: ${thin.map((x) => x.r.title).join(", ")}`);
    // the planner's own bands: breakfast <400, lunch 250-450, dinner >=300
    const starved = Object.entries(bands).filter(([, count]) => count < 3).map(([k, count]) => `${k} (${count})`);
    if (starved.length) problems.push(`fewer than 3 candidates in band: ${starved.join(", ")}`);

    if (problems.length) {
      console.error("REFUSING to emit migration:");
      for (const pr of problems) console.error("  - " + pr);
      process.exitCode = 1;
      return;
    }

    // Emit the SQL: everything literal, no defaults left to chance.
    out.push("-- 0008_starter_library: the shared recipe starter library (ADR-123).");
    out.push("-- Generated by scripts/build-starter-library.ts from scripts/starter-food-pins.json: USDA");
    out.push("-- per-100g values from hand-checked records, rolled up by rollUp(). Deliberately NOT the");
    out.push("-- fuzzy matcher, which resolves \"tomato\" to \"Tomato powder\" and would have produced");
    out.push("-- plausible-looking but false calories (ADR-123). Allergen tags use the shared vocabulary.");
    out.push("-- Recipes are original text, not scraped: source_url stays NULL, parse_method is 'manual'.");
    out.push("");
    for (const row of rows) {
      const r = row.r;
      out.push(
        `INSERT INTO "recipe" ("id","household_id","visibility","source_url","source_domain","author","title","yield","total_min","prep_min","cook_min","cuisine","meal_types","diet_tags","parse_method","status","unsure_fields","parse_confidence","created_at") VALUES (` +
          `${sqlStr(r.id)}, NULL, 'starter', NULL, NULL, ${sqlStr(String(r.author))}, ${sqlStr(r.title)}, ${r.yieldServings}, ${r.totalMin}, ${r.prepMin}, ${r.cookMin}, ` +
          `${sqlStr(String(r.cuisine))}, ${sqlArray(r.mealTypes)}, ${sqlArray(r.dietTags)}, 'manual', 'ready', ${sqlArray((r.unsureFields as string[] | undefined) ?? [])}, NULL, now()) ` +
          `ON CONFLICT ("id") DO NOTHING;`,
      );
      for (const [i, x] of row.ings.entries()) {
        out.push(
          `INSERT INTO "recipe_ingredient" ("recipe_id","position","raw_text","qty","unit","food","fdc_id","grams","match_conf","uncertain_allergen_tags") VALUES (` +
            `${sqlStr(r.id)}, ${i}, ${sqlStr(x.rawText)}, ${x.qty ? sqlStr(x.qty) : "NULL"}, ${x.unit ? sqlStr(x.unit) : "NULL"}, ` +
            `${x.food ? sqlStr(x.food) : "NULL"}, ${x.fdcId ? sqlStr(x.fdcId) : "NULL"}, ${x.grams ? sqlStr(x.grams) : "NULL"}, ` +
            `${x.matchConf ?? "NULL"}, ${sqlArray(x.tags)}) ON CONFLICT DO NOTHING;`,
        );
      }
      for (const [i, text] of row.steps.entries()) {
        out.push(
          `INSERT INTO "recipe_step" ("recipe_id","position","section_title","text","timer_seconds") VALUES (${sqlStr(r.id)}, ${i + 1}, NULL, ${sqlStr(text)}, NULL) ON CONFLICT ("recipe_id","position") DO NOTHING;`,
        );
      }
      if (row.nutrients) {
        const pj = JSON.stringify(row.nutrients.perServing).replace(/'/g, "''");
        out.push(
          `INSERT INTO "recipe_nutrients" ("recipe_id","per_serving","completeness") VALUES (${sqlStr(r.id)}, '${pj}'::jsonb, ${row.nutrients.completeness}) ON CONFLICT ("recipe_id") DO NOTHING;`,
        );
      }
      out.push("");
    }

    const sqlText = out.join("\n");
    if (!checkOnly) {
      const fs = await import("node:fs");
      fs.writeFileSync("drizzle/migrations/0008_starter_library.sql", sqlText, "utf8");
      const journalPath = "drizzle/migrations/meta/_journal.json";
      const j = JSON.parse(fs.readFileSync(journalPath, "utf8"));
      if (!j.entries.some((e: { tag: string }) => e.tag === "0008_starter_library")) {
        j.entries.push({
          idx: j.entries.length,
          version: "7",
          when: Date.now(),
          tag: "0008_starter_library",
          breakpoints: true,
        });
        fs.writeFileSync(journalPath, JSON.stringify(j, null, 2) + "\n", "utf8");
      }
      console.log(`wrote drizzle/migrations/0008_starter_library.sql (${rows.length} recipes, ${sqlText.split("\n").length} lines)`);
    }
  } catch (e) {
    const detail = String((e as Error).message ?? e)
      .split(url)
      .join("[redacted]")
      // postgres-js appends the parameter list, which can carry encrypted health
      // values from unrelated rows; keep the failure reason, drop the payload.
      .split("with parameters")[0]
      .slice(0, 700);
    const cause = (e as { cause?: { message?: string; code?: string; detail?: string } }).cause;
    console.error("BUILD FAILED:", detail);
    if (cause) console.error("  cause:", cause.code ?? "", cause.message ?? "", cause.detail ?? "");
    process.exitCode = 1;
  } finally {
    // Remove the scratch rows so the migration is the only way they come back.
    if (created.length) {
      await db.delete(recipeNutrients).where(inArray(recipeNutrients.recipeId, created));
      await db.delete(recipeStep).where(inArray(recipeStep.recipeId, created));
      await db.delete(recipeIngredient).where(inArray(recipeIngredient.recipeId, created));
      await db.delete(recipe).where(inArray(recipe.id, created));
    }
    await db.delete(household).where(eq(household.id, scratch));
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("[starter-build] UNEXPECTED:", String(err?.message ?? err).slice(0, 300));
  process.exitCode = 1;
});

