/**
 * The household's recipe box (PRD 5.3): its private copies. Ready recipes are listed;
 * recipes still waiting for a check are counted, not listed. Scoped to the household.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { recipe, recipeIngredient } from "../../../db/schema";
import type { Db } from "../db";

export interface BoxItem {
  id: string;
  title: string;
  sourceDomain: string | null;
  totalMinutes: number | null;
  cuisine: string | null;
  parseMethod: "markup" | "llm" | "manual";
  ingredientCount: number;
}

export interface BoxView {
  items: BoxItem[];
  waitingForCheck: number;
}

export async function getRecipeBox(db: Db, householdId: string): Promise<BoxView> {
  const rows = await db
    .select({
      id: recipe.id,
      title: recipe.title,
      sourceDomain: recipe.sourceDomain,
      totalMinutes: recipe.totalMin,
      cuisine: recipe.cuisine,
      parseMethod: recipe.parseMethod,
    })
    .from(recipe)
    .where(and(eq(recipe.householdId, householdId), eq(recipe.status, "ready")))
    .orderBy(asc(recipe.title));

  const counts = new Map<string, number>();
  if (rows.length > 0) {
    const grouped = await db
      .select({ recipeId: recipeIngredient.recipeId, n: sql<number>`count(*)::int` })
      .from(recipeIngredient)
      .where(inArray(recipeIngredient.recipeId, rows.map((r) => r.id)))
      .groupBy(recipeIngredient.recipeId);
    for (const g of grouped) counts.set(g.recipeId, Number(g.n));
  }

  const [waiting] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(recipe)
    .where(and(eq(recipe.householdId, householdId), eq(recipe.status, "needs_review")));

  return {
    items: rows.map((r) => ({ ...r, ingredientCount: counts.get(r.id) ?? 0 })),
    waitingForCheck: Number(waiting?.n ?? 0),
  };
}
