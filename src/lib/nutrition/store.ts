/**
 * RE03 storage: maps a saved recipe's ingredient lines to USDA foods (cached), writes the match and gram
 * weight per line, and stores the per-serving roll-up. Scoped to the household.
 */
import { and, asc, eq } from "drizzle-orm";
import { fdcCache, recipe, recipeIngredient, recipeNutrients } from "../../../db/schema";
import type { Db } from "../db";
import { parseIngredientLine } from "./ingredient-line";
import { chooseMatch, type FdcFood } from "./fdc";
import { aliasMatch, gramsFromAlias, lookupAlias } from "./aliases";
import { rollUp, type LineMatch, type RollUp } from "./rollup";
import { RecipeNotFoundError } from "../recipes/review";

export interface FoodSearch {
  search(query: string): Promise<FdcFood[]>;
}

const cacheKey = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

/** Cache first; the network is only called on a miss, and the answer is stored. */
export async function searchCached(db: Db, client: FoodSearch, query: string): Promise<FdcFood[]> {
  const key = cacheKey(query);
  const [hit] = await db.select().from(fdcCache).where(eq(fdcCache.query, key));
  if (hit) return hit.foods as FdcFood[];
  const foods = await client.search(query);
  await db
    .insert(fdcCache)
    .values({ query: key, foods })
    .onConflictDoUpdate({ target: fdcCache.query, set: { foods, fetchedAt: new Date() } });
  return foods;
}

export async function mapRecipeNutrition(db: Db, client: FoodSearch, householdId: string, recipeId: string, servings: number): Promise<RollUp & { matchedLines: number }> {
  const [r] = await db.select({ id: recipe.id }).from(recipe).where(and(eq(recipe.id, recipeId), eq(recipe.householdId, householdId)));
  if (!r) throw new RecipeNotFoundError();
  const rows = await db.select().from(recipeIngredient).where(eq(recipeIngredient.recipeId, recipeId)).orderBy(asc(recipeIngredient.position));

  const lines: LineMatch[] = [];
  for (const row of rows) {
    const parsed = parseIngredientLine(row.rawText);
    // ADR-125: the curated alias table is consulted first. A hit replaces the
    // fuzzy match (it is pinned, not guessed) and can supply grams from USDA's
    // own foodPortions when the line's volume/count unit left grams null.
    const alias = await lookupAlias(db, parsed.food);
    const foods = !alias && parsed.food ? await searchCached(db, client, parsed.food) : [];
    const match = alias ? aliasMatch(alias) : parsed.food ? chooseMatch(parsed.food, foods) : null;
    const aliasGrams = alias ? gramsFromAlias(parsed, alias) : null;
    const line = aliasGrams === null ? parsed : { ...parsed, grams: aliasGrams, gramsSource: "alias_density" as const };
    lines.push({ line, match });
    await db
      .update(recipeIngredient)
      .set({
        qty: line.qty === null ? null : String(line.qty),
        unit: line.unit,
        food: line.food || null,
        grams: line.grams === null ? null : String(line.grams),
        fdcId: match ? String(match.fdcId) : null,
        matchConf: match ? match.confidence : null,
      })
      .where(eq(recipeIngredient.id, row.id));
  }

  const result = rollUp(lines, servings);
  await db
    .insert(recipeNutrients)
    .values({ recipeId, perServing: result.perServing, completeness: result.completeness })
    .onConflictDoUpdate({ target: recipeNutrients.recipeId, set: { perServing: result.perServing, completeness: result.completeness } });
  return { ...result, matchedLines: lines.filter((l) => l.match).length };
}
