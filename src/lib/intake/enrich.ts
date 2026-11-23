/**
 * Post-import enrichment: turn a saved recipe into something the planner is
 * allowed to use.
 *
 * `importRecipeFromUrl` writes recipe + ingredients + steps, which is what the
 * review box needs, but the planning pool additionally requires per-ingredient
 * allergen tags and a nutrition roll-up. Both were previously written by nobody
 * anywhere in the codebase, which is why the pool could only ever return
 * `no_recipes`. This is that missing step, kept separate from the importer so
 * the importer stays testable without a nutrition client.
 *
 * Two deliberate asymmetries:
 * - Allergen attribution OVER-flags. A recipe that is merely excluded costs a
 *   candidate; a recipe wrongly judged safe costs someone an allergic reaction.
 * - Nutrition is never estimated here. If FDC is not configured the recipe is
 *   reported unmapped and the pool excludes it as `no_nutrients`, rather than
 *   inventing a kcal figure that would silently skew every calorie band.
 */
import { and, asc, eq } from "drizzle-orm";
import { recipe, recipeIngredient } from "../../../db/schema";
import type { Db } from "../db";
import { allergensFromIngredientLine } from "../health/allergen-vocabulary";
import { mapRecipeNutrition, type FoodSearch } from "../nutrition/store";
import { RecipeNotFoundError } from "../recipes/review";

export interface EnrichResult {
  recipeId: string;
  /** ingredient lines that received at least one allergen tag */
  flaggedLines: number;
  totalLines: number;
  tags: string[];
  dietTags: string[];
  nutrition:
    | { status: "mapped"; kcal: number; completeness: number; matchedLines: number }
    | { status: "unavailable"; reason: string; matchedLines?: number }
    | { status: "skipped"; reason: "no_fdc_key" };
}

export interface EnrichOptions {
  /** FDC search client. Omitted (no API key) => nutrition skipped, honestly reported. */
  fdc?: FoodSearch;
  /** Lines to attempt before giving up, so one call cannot run unbounded. */
  maxLines?: number;
}

export async function enrichRecipe(
  db: Db,
  householdId: string,
  recipeId: string,
  opts: EnrichOptions = {},
): Promise<EnrichResult> {
  const [row] = await db
    .select({
      id: recipe.id,
      yieldServings: recipe.yieldServings,
      dietTags: recipe.dietTags,
      status: recipe.status,
    })
    .from(recipe)
    .where(and(eq(recipe.id, recipeId), eq(recipe.householdId, householdId)));
  if (!row) throw new RecipeNotFoundError();

  const lines = await db
    .select({ id: recipeIngredient.id, rawText: recipeIngredient.rawText })
    .from(recipeIngredient)
    .where(eq(recipeIngredient.recipeId, recipeId))
    .orderBy(asc(recipeIngredient.position));

  const cap = opts.maxLines ?? 60;
  const union = new Set<string>();
  let flagged = 0;
  for (const line of lines.slice(0, cap)) {
    const tags = allergensFromIngredientLine(line.rawText);
    // Written even when empty: an explicit empty array means "classified, found
    // nothing", which is different information from a row nobody looked at.
    await db
      .update(recipeIngredient)
      .set({ uncertainAllergenTags: tags })
      .where(eq(recipeIngredient.id, line.id));
    if (tags.length) flagged++;
    for (const t of tags) union.add(t);
  }

  let nutrition: EnrichResult["nutrition"] = { status: "skipped", reason: "no_fdc_key" };
  if (opts.fdc) {
    try {
      const roll = await mapRecipeNutrition(db, opts.fdc, householdId, recipeId, row.yieldServings ?? 4);
      const kcal = Number(roll.perServing.kcal ?? 0);
      nutrition =
        kcal > 0
          ? { status: "mapped", kcal, completeness: roll.completeness, matchedLines: roll.matchedLines }
          : {
              status: "unavailable",
              reason: "no ingredient line matched a food with energy data",
              matchedLines: roll.matchedLines,
            };
    } catch (e) {
      // Network/limit failures are reported, not swallowed: an importer that
      // silently produced unplanable recipes would look like it worked.
      nutrition = { status: "unavailable", reason: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160) };
    }
  }

  return {
    recipeId,
    flaggedLines: flagged,
    totalLines: Math.min(lines.length, cap),
    tags: [...union].sort(),
    dietTags: row.dietTags ?? [],
    nutrition,
  };
}
